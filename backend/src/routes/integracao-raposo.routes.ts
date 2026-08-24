import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { raposoApiKeyMiddleware } from '../middleware/raposo-api-key.middleware';
import {
  traccarGetDeviceByImei,
  traccarGetPositions,
  traccarSendCommand,
  traccarUpdateDeviceAccumulators,
} from '../services/traccar.service';
import {
  DISPOSITIVO_MEDIDORES_SELECT,
  sincronizarDispositivosComPosicoes,
  decorarPosicaoComMedidores,
  reancorarRecorrenciasSeOdometroMenor,
} from '../services/medidores.service';
import {
  _calcularProximaData,
  _parseDataSp,
  _validarCamposRecorrenciaData,
  _ativarNotificacaoRecorrenciaData,
} from './manutencoes.routes';

/**
 * Superfície de integração dedicada ao Raposo Motors (server-to-server, API key).
 * Monta em /api/integracao/raposo. Resolve o veículo POR PLACA (o Raposo liga por placa),
 * devolve KM/velocidade/bloqueado e envia bloquear/desbloquear com CONFIRMAÇÃO por polling
 * do campo `bloqueado` (a Ágil Lock/Traccar não tem ACK síncrono — confirma na próxima
 * comunicação do veículo). Ver docs/integracao/API-Integracao-Raposo.md.
 */
const router = Router();
router.use(raposoApiKeyMiddleware);

function normalizarPlaca(placa: string): string {
  return String(placa || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

async function resolverDispositivoPorPlaca(placaRaw: string) {
  const norm = normalizarPlaca(placaRaw);
  // A placa é salva em UPPER/trim (com ou sem hífen). Tenta as duas formas.
  const comHifen = norm.length >= 4 ? `${norm.slice(0, 3)}-${norm.slice(3)}` : norm;
  return prisma.dispositivo.findFirst({
    where: { ativo: true, OR: [{ placa: norm }, { placa: comHifen }] },
    select: {
      id: true,
      nome: true,
      identificador: true,
      placa: true,
      // Dados cadastrais do veículo — a Raposo os usa para preencher o cadastro
      // dela quando a placa já existe aqui (evita redigitar chassi e renavam).
      marca: true,
      modeloVeiculo: true,
      cor: true,
      ano: true,
      renavam: true,
      chassi: true,
      ...DISPOSITIVO_MEDIDORES_SELECT,
    },
  });
}

type Dispositivo = NonNullable<Awaited<ReturnType<typeof resolverDispositivoPorPlaca>>>;

async function posicaoAtual(dispositivo: Dispositivo) {
  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) return { traccarDevice: null, posicao: null as ReturnType<typeof decorarPosicaoComMedidores> | null };
  const posicoes = await traccarGetPositions([traccarDevice.id]).catch(() => []);
  const bruta = posicoes[0];
  if (bruta) {
    const atualizados = await sincronizarDispositivosComPosicoes(
      [dispositivo],
      new Map([[dispositivo.identificador, bruta]]),
    );
    Object.assign(dispositivo, atualizados.get(dispositivo.identificador) ?? dispositivo);
  }
  return { traccarDevice, posicao: bruta ? decorarPosicaoComMedidores(dispositivo, bruta) : null };
}

/** GET /api/integracao/raposo/veiculo/:placa/detalhe → KM (km), velocidade, bloqueado, posição. */
router.get('/veiculo/:placa/detalhe', async (req: Request, res: Response) => {
  try {
    const dispositivo = await resolverDispositivoPorPlaca(String(req.params.placa));
    if (!dispositivo) {
      res.status(404).json({ error: 'Veículo não encontrado para a placa informada.' });
      return;
    }
    const { traccarDevice, posicao } = await posicaoAtual(dispositivo);
    const odometroM = (posicao as { odometro?: number | null } | null)?.odometro ?? null;
    res.json({
      placa: dispositivo.placa,
      dispositivoId: dispositivo.id,
      /**
       * Cadastro do veículo (acrescentado em 31/07/2026, a pedido da Raposo).
       * Campos **adicionais** — nada foi removido da resposta, então
       * integrações existentes continuam funcionando sem alteração.
       */
      veiculo: {
        marca: dispositivo.marca ?? null,
        modelo: dispositivo.modeloVeiculo ?? null,
        cor: dispositivo.cor ?? null,
        ano: dispositivo.ano ?? null,
        renavam: dispositivo.renavam ?? null,
        chassi: dispositivo.chassi ?? null,
      },
      online: traccarDevice?.status === 'online',
      km: odometroM != null ? Math.round(odometroM / 1000) : null,
      odometroMetros: odometroM,
      velocidade: (posicao as { velocidade?: number | null } | null)?.velocidade ?? null,
      bloqueado: (posicao as { bloqueado?: boolean | null } | null)?.bloqueado ?? null,
      latitude: (posicao as { latitude?: number | null } | null)?.latitude ?? null,
      longitude: (posicao as { longitude?: number | null } | null)?.longitude ?? null,
      atualizadoEm:
        (posicao as { serverTime?: string | null; fixTime?: string | null } | null)?.serverTime ??
        (posicao as { fixTime?: string | null } | null)?.fixTime ??
        null,
    });
  } catch (err) {
    console.error('[integracao-raposo] detalhe:', err);
    res.status(500).json({ error: 'Erro ao consultar o veículo.' });
  }
});

/**
 * POST /api/integracao/raposo/veiculo/:placa/comando
 * body: { tipo: 'engineStop' | 'engineResume', aguardarConfirmacao?: boolean }
 * Envia o comando; com aguardarConfirmacao, faz poll do `bloqueado` até refletir (timeout 60s).
 */
router.post('/veiculo/:placa/comando', async (req: Request, res: Response) => {
  const tipo = (req.body || {}).tipo;
  const aguardar = !!(req.body || {}).aguardarConfirmacao;
  if (tipo !== 'engineStop' && tipo !== 'engineResume') {
    res.status(400).json({ error: 'tipo inválido — use "engineStop" ou "engineResume".' });
    return;
  }
  try {
    const dispositivo = await resolverDispositivoPorPlaca(String(req.params.placa));
    if (!dispositivo) {
      res.status(404).json({ error: 'Veículo não encontrado para a placa informada.' });
      return;
    }
    const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
    if (!traccarDevice) {
      res.status(502).json({ error: 'Dispositivo sem vínculo no rastreador.' });
      return;
    }
    await traccarSendCommand(traccarDevice.id, tipo);

    let confirmado = false;
    let bloqueado: boolean | null = null;
    if (aguardar) {
      const alvo = tipo === 'engineStop';
      const fim = Date.now() + 60_000;
      while (Date.now() < fim) {
        await new Promise((r) => setTimeout(r, 5_000));
        const posicoes = await traccarGetPositions([traccarDevice.id]).catch(() => []);
        if (!posicoes[0]) continue;
        // Persiste o último 'blocked' conhecido (o Traccar não manda em todo pacote) e
        // lê o estado decorado já com o fallback aplicado.
        const atualizados = await sincronizarDispositivosComPosicoes(
          [dispositivo],
          new Map([[dispositivo.identificador, posicoes[0]]]),
        );
        Object.assign(dispositivo, atualizados.get(dispositivo.identificador) ?? dispositivo);
        const p = decorarPosicaoComMedidores(dispositivo, posicoes[0]);
        bloqueado = (p as { bloqueado?: boolean | null }).bloqueado ?? null;
        if (bloqueado === alvo) {
          confirmado = true;
          break;
        }
      }
    }
    res.json({ ok: true, enfileirado: true, confirmado, bloqueado, dispositivoId: dispositivo.id });
  } catch (err) {
    console.error('[integracao-raposo] comando:', err);
    res.status(502).json({ error: 'Falha ao enviar o comando ao rastreador.' });
  }
});

/**
 * GET /api/integracao/raposo/veiculo/:placa/manutencoes
 * Devolve os PLANOS (recorrências por KM e por data) e os REGISTROS de manutenção do
 * veículo (por placa). O Raposo importa isso: recorrência → plano_manutencao
 * (agillock_recorrencia_id), registro → manutencao (origem IMPORTADO_AGILLOCK). Ver
 * docs/integracao/API-Integracao-Raposo.md §manutenções. Somente leitura.
 */
router.get('/veiculo/:placa/manutencoes', async (req: Request, res: Response) => {
  try {
    const dispositivo = await resolverDispositivoPorPlaca(String(req.params.placa));
    if (!dispositivo) {
      res.status(404).json({ error: 'Veículo não encontrado para a placa informada.' });
      return;
    }
    const [recorrencias, recorrenciasData, registros] = await Promise.all([
      prisma.manutencaoRecorrencia.findMany({
        where: { dispositivoId: dispositivo.id, ativa: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.manutencaoRecorrenciaData.findMany({
        where: { dispositivoId: dispositivo.id, ativa: true },
        orderBy: { dataReferencia: 'asc' },
      }),
      /**
       * 🐛 **O que nasceu na Raposo não volta para a Raposo** (07/08/2026,
       * previsto por quem usa antes de acontecer em campo).
       *
       * Marcar um plano como feito lá cria a manutenção **lá** e empurra o
       * `/feito` para cá, que deixa um `ManutencaoRegistro` de origem `RAPOSO`.
       * Esse registro voltava nesta lista, a Raposo não o reconhecia (nunca
       * tinha importado esse id) e criava uma **segunda** manutenção — a mesma
       * revisão, duas vezes na tela, uma delas sem valor e sem responsável.
       *
       * É a mesma regra do anti-eco do webhook: origem `RAPOSO` fica fora.
       * Ela continua no histórico daqui, que é o lugar dela.
       */
      prisma.manutencaoRegistro.findMany({
        where: { dispositivoId: dispositivo.id, origem: { not: 'RAPOSO' } },
        orderBy: { dataRealizacao: 'desc' },
        take: 100,
      }),
    ]);
    res.json({
      placa: dispositivo.placa,
      dispositivoId: dispositivo.id,
      recorrencias: recorrencias.map((r) => ({
        id: r.id,
        titulo: r.titulo,
        descricao: r.descricao,
        intervaloKm: r.intervaloKm,
        kmBase: r.kmBase,
      })),
      recorrenciasData: recorrenciasData.map((r) => ({
        id: r.id,
        titulo: r.titulo,
        descricao: r.descricao,
        tipoRecorrencia: r.tipoRecorrencia,
        dataReferencia: r.dataReferencia,
        intervaloDias: r.intervaloDias,
      })),
      registros: registros.map((r) => ({
        id: r.id,
        titulo: r.titulo,
        tipo: r.tipo,
        descricao: r.descricao,
        dataRealizacao: r.dataRealizacao,
        kmRealizacao: r.kmRealizacao,
        custo: r.custo,
        oficina: r.oficina,
        // A origem viaja para o Raposo poder se defender sozinho: se uma versão
        // antiga desta API (sem o filtro acima) estiver no ar, ele ainda
        // reconhece o que é dele e não reimporta.
        origem: r.origem,
      })),
    });
  } catch (err) {
    console.error('[integracao-raposo] manutencoes:', err);
    res.status(500).json({ error: 'Erro ao consultar as manutenções do veículo.' });
  }
});

/**
 * ⭐ **A recorrência ganha dono** (07/08/2026). Ela nascia com `clienteLoginId`
 * nulo — é uma chamada server-to-server, não há login por trás — e isso a fazia
 * sumir dos filtros das telas (ver o 🐛 em
 * `manutencoes.routes.ts:_filtroManutencoesVisiveis`, já corrigido).
 *
 * O filtro deixou de depender disto, mas o dono continua importando por outro
 * motivo: as preferências de notificação são ligadas **por clienteLogin**, e sem
 * dono a recorrência criada pela Raposo nunca notificaria ninguém aqui. Pega-se
 * o primeiro login do cliente do dispositivo — o mesmo que o portal usaria.
 */
async function donoDoDispositivo(dispositivoId: string): Promise<{ id: string } | null> {
  return prisma.dispositivo
    .findUnique({ where: { id: dispositivoId }, select: { clienteId: true } })
    .then(d =>
      d?.clienteId
        ? prisma.clienteLogin.findFirst({ where: { clienteId: d.clienteId }, select: { id: true } })
        : null,
    )
    .catch(() => null);
}

/** km atual do veículo (odômetro em km), best-effort. */
async function kmAtualDoVeiculo(dispositivo: Dispositivo): Promise<number | null> {
  const { posicao } = await posicaoAtual(dispositivo).catch(() => ({ posicao: null }));
  const odo = (posicao as { odometro?: number | null } | null)?.odometro ?? null;
  return odo != null ? Math.round(odo / 1000) : null;
}

/**
 * POST /api/integracao/raposo/veiculo/:placa/manutencoes/recorrencia
 * body: { titulo, descricao?, intervaloKm } → cria uma recorrência por KM (origem RAPOSO).
 * É a direção Raposo → Ágil Lock: criar plano no Raposo reflete aqui.
 */
router.post('/veiculo/:placa/manutencoes/recorrencia', async (req: Request, res: Response) => {
  try {
    const { titulo, descricao, intervaloKm } = req.body || {};
    if (!titulo || !intervaloKm) {
      res.status(400).json({ error: 'titulo e intervaloKm são obrigatórios.' });
      return;
    }
    const dispositivo = await resolverDispositivoPorPlaca(String(req.params.placa));
    if (!dispositivo) {
      res.status(404).json({ error: 'Veículo não encontrado para a placa informada.' });
      return;
    }
    const kmBase = (await kmAtualDoVeiculo(dispositivo)) ?? 0;
    const dono = await donoDoDispositivo(dispositivo.id);

    const rec = await prisma.manutencaoRecorrencia.create({
      data: {
        dispositivoId: dispositivo.id,
        ...(dono ? { clienteLoginId: dono.id } : {}),
        titulo: String(titulo),
        descricao: descricao ? String(descricao) : null,
        intervaloKm: parseInt(String(intervaloKm), 10),
        kmBase,
        origem: 'RAPOSO',
      },
    });
    res.status(201).json({ id: rec.id, kmBase });
  } catch (err) {
    console.error('[integracao-raposo] criar recorrência:', err);
    res.status(500).json({ error: 'Erro ao criar a recorrência.' });
  }
});

/**
 * POST /api/integracao/raposo/veiculo/:placa/manutencoes/recorrencia/:id/feito
 * Marca a recorrência como feita: reseta o contador (kmBase = km atual) e cria o
 * registro. É o "reset" que o Raposo empurra ao marcar o plano feito — o efeito
 * financeiro (responsável/lançamento) fica no Raposo, não aqui.
 */
router.post('/veiculo/:placa/manutencoes/recorrencia/:id/feito', async (req: Request, res: Response) => {
  try {
    const dispositivo = await resolverDispositivoPorPlaca(String(req.params.placa));
    if (!dispositivo) {
      res.status(404).json({ error: 'Veículo não encontrado para a placa informada.' });
      return;
    }
    const rec = await prisma.manutencaoRecorrencia.findFirst({
      where: { id: String(req.params.id), dispositivoId: dispositivo.id },
    });
    if (!rec) {
      res.status(404).json({ error: 'Recorrência não encontrada.' });
      return;
    }
    const kmAtual = (await kmAtualDoVeiculo(dispositivo)) ?? rec.kmBase;
    await prisma.manutencaoRecorrencia.update({
      where: { id: rec.id },
      data: {
        kmBase: kmAtual,
        alerta50Enviado: false,
        alerta25Enviado: false,
        alerta0Enviado: false,
        ultimaAlertaPostDueKm: -1,
      },
    });
    await prisma.manutencaoRegistro.create({
      data: {
        dispositivoId: dispositivo.id,
        titulo: `${rec.titulo} — confirmado (Raposo)`,
        tipo: 'recorrencia',
        descricao: `Recorrência "${rec.titulo}" marcada como feita pelo Raposo Motors.`,
        dataRealizacao: new Date(),
        kmRealizacao: kmAtual,
        origem: 'RAPOSO',
      },
    });
    res.json({ ok: true, kmBase: kmAtual });
  } catch (err) {
    console.error('[integracao-raposo] recorrência feito:', err);
    res.status(500).json({ error: 'Erro ao marcar a recorrência como feita.' });
  }
});

/**
 * Resolve o dispositivo pela placa e já responde 404 quando ela não existe aqui.
 * Devolve `null` quando a resposta foi enviada — quem chama só precisa sair.
 */
async function dispositivoOu404(req: Request, res: Response): Promise<Dispositivo | null> {
  const dispositivo = await resolverDispositivoPorPlaca(String(req.params.placa));
  if (!dispositivo) {
    res.status(404).json({ error: 'Veículo não encontrado para a placa informada.' });
    return null;
  }
  return dispositivo;
}

/**
 * ⭐ **A mão dupla completa** (07/08/2026, docs/05 §5.4.1 do Raposo).
 *
 * Até aqui a superfície da Raposo sabia três coisas de manutenção: ler tudo,
 * criar recorrência por KM e marcá-la feita. Sem editar, sem excluir e sem nada
 * por data — então o espelho **passava a mentir na primeira edição**, e um plano
 * do tipo AMBOS (KM + data) só existia pela metade deste lado.
 *
 * As seis rotas abaixo fecham o quadro. Cada uma faz o que a rota equivalente do
 * portal do cliente (`manutencoes.routes.ts`) faz, reusando os mesmos helpers de
 * data — mudam só a autenticação (API key server-to-server, sem login de
 * cliente) e a `origem`, que fica `RAPOSO`.
 *
 * 🔴 **Excluir é desativar** (`ativa: false`), nunca apagar. Os registros de
 * manutenção apontam para a recorrência: apagá-la levaria o histórico junto — e
 * o histórico é do cliente, não da integração.
 */

// ── Recorrência por KM: editar e desativar ────────────────────────────────────

/**
 * PUT /api/integracao/raposo/veiculo/:placa/manutencoes/recorrencia/:id
 * body: { titulo?, descricao?, intervaloKm?, kmBase?, kmProximo? }
 *
 * `kmProximo` existe porque os dois lados contam de formas diferentes: a Ágil
 * Lock guarda **base + intervalo**, o Raposo guarda o **alvo absoluto**. Quem
 * edita o alvo lá manda `kmProximo` e a conversão acontece aqui, onde as duas
 * peças estão à mão — em vez de o Raposo ter de adivinhar a `kmBase` daqui.
 */
router.put('/veiculo/:placa/manutencoes/recorrencia/:id', async (req: Request, res: Response) => {
  try {
    const dispositivo = await dispositivoOu404(req, res);
    if (!dispositivo) return;

    const rec = await prisma.manutencaoRecorrencia.findFirst({
      where: { id: String(req.params.id), dispositivoId: dispositivo.id },
    });
    if (!rec) {
      res.status(404).json({ error: 'Recorrência não encontrada.' });
      return;
    }

    const { titulo, descricao, intervaloKm, kmBase, kmProximo } = req.body || {};
    const novoIntervalo = intervaloKm != null ? parseInt(String(intervaloKm), 10) : rec.intervaloKm;
    let novaBase = kmBase != null ? Number(kmBase) : rec.kmBase;
    if (kmProximo != null) novaBase = Number(kmProximo) - novoIntervalo;

    /**
     * 🔴 **Alvo que muda zera os avisos já enviados.** Sem isto, uma revisão
     * empurrada de 10.000 para 15.000 km continuaria com "faltam 50 km" marcado
     * como avisado — e o aviso de verdade, cinco mil quilômetros depois, nunca
     * sairia. O portal não faz esse reset ao editar; aqui faz, porque é a
     * edição que vem de fora e ninguém está olhando a tela para perceber.
     */
    const alvoMudou = novoIntervalo !== rec.intervaloKm || Math.round(novaBase) !== Math.round(rec.kmBase);

    const atualizada = await prisma.manutencaoRecorrencia.update({
      where: { id: rec.id },
      data: {
        titulo: titulo ? String(titulo) : rec.titulo,
        descricao: descricao !== undefined ? (descricao ? String(descricao) : null) : rec.descricao,
        intervaloKm: novoIntervalo,
        kmBase: novaBase,
        ativa: true,
        ...(alvoMudou
          ? {
              alerta50Enviado: false,
              alerta25Enviado: false,
              alerta0Enviado: false,
              ultimaAlertaPostDueKm: -1,
            }
          : {}),
      },
    });

    res.json({
      id: atualizada.id,
      titulo: atualizada.titulo,
      intervaloKm: atualizada.intervaloKm,
      kmBase: atualizada.kmBase,
    });
  } catch (err) {
    console.error('[integracao-raposo] editar recorrência:', err);
    res.status(500).json({ error: 'Erro ao editar a recorrência.' });
  }
});

/**
 * DELETE /api/integracao/raposo/veiculo/:placa/manutencoes/recorrencia/:id
 * Desativa (`ativa: false`). Idempotente: desativar de novo devolve 200.
 */
router.delete('/veiculo/:placa/manutencoes/recorrencia/:id', async (req: Request, res: Response) => {
  try {
    const dispositivo = await dispositivoOu404(req, res);
    if (!dispositivo) return;

    const rec = await prisma.manutencaoRecorrencia.findFirst({
      where: { id: String(req.params.id), dispositivoId: dispositivo.id },
      select: { id: true },
    });
    if (!rec) {
      res.status(404).json({ error: 'Recorrência não encontrada.' });
      return;
    }
    await prisma.manutencaoRecorrencia.update({ where: { id: rec.id }, data: { ativa: false } });
    res.json({ ok: true, id: rec.id });
  } catch (err) {
    console.error('[integracao-raposo] desativar recorrência:', err);
    res.status(500).json({ error: 'Erro ao desativar a recorrência.' });
  }
});

// ── Recorrência por DATA: criar, editar, marcar feita e desativar ─────────────

/**
 * POST /api/integracao/raposo/veiculo/:placa/manutencoes/recorrencia-data
 * body: { titulo, descricao?, tipoRecorrencia?, dataReferencia, intervaloDias?,
 *         diasSemana?, diaDoMes?, mesDoAno? }
 *
 * `tipoRecorrencia` aceita AVULSA | INTERVALO | SEMANAL | MENSAL | ANUAL e cai
 * em AVULSA quando não vier — o plano por data do Raposo é "a cada N dias"
 * (INTERVALO) ou uma data única (AVULSA), e os outros três existem para o dia em
 * que a tela de lá crescer.
 */
router.post('/veiculo/:placa/manutencoes/recorrencia-data', async (req: Request, res: Response) => {
  try {
    const { titulo, descricao, tipoRecorrencia, dataReferencia, intervaloDias, diasSemana, diaDoMes, mesDoAno } =
      req.body || {};
    if (!titulo || !dataReferencia) {
      res.status(400).json({ error: 'titulo e dataReferencia são obrigatórios.' });
      return;
    }
    const dispositivo = await dispositivoOu404(req, res);
    if (!dispositivo) return;

    const tipo = tipoRecorrencia ? String(tipoRecorrencia) : 'AVULSA';
    try {
      _validarCamposRecorrenciaData(tipo, intervaloDias, diasSemana, diaDoMes, mesDoAno);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Campos inválidos para o tipo de recorrência.' });
      return;
    }

    const dono = await donoDoDispositivo(dispositivo.id);
    const rec = await prisma.manutencaoRecorrenciaData.create({
      data: {
        dispositivoId: dispositivo.id,
        ...(dono ? { clienteLoginId: dono.id } : {}),
        titulo: String(titulo),
        descricao: descricao ? String(descricao) : null,
        tipoRecorrencia: tipo,
        dataReferencia: _parseDataSp(dataReferencia),
        intervaloDias: intervaloDias ? parseInt(String(intervaloDias), 10) : null,
        diasSemana: diasSemana || null,
        diaDoMes: diaDoMes ? parseInt(String(diaDoMes), 10) : null,
        mesDoAno: mesDoAno ? parseInt(String(mesDoAno), 10) : null,
        origem: 'RAPOSO',
      },
    });
    // Mesma cortesia do portal: a recorrência nasce com a notificação ligada
    // para o dono. Sem dono não há preferência a ligar, e a recorrência vale
    // como registro — o alerta de verdade, nesse caso, é o do Raposo.
    if (dono) await _ativarNotificacaoRecorrenciaData(dono.id, dispositivo.id);

    res.status(201).json({ id: rec.id, dataReferencia: rec.dataReferencia });
  } catch (err) {
    console.error('[integracao-raposo] criar recorrência por data:', err);
    res.status(500).json({ error: 'Erro ao criar a recorrência por data.' });
  }
});

/** PUT /api/integracao/raposo/veiculo/:placa/manutencoes/recorrencia-data/:id */
router.put('/veiculo/:placa/manutencoes/recorrencia-data/:id', async (req: Request, res: Response) => {
  try {
    const dispositivo = await dispositivoOu404(req, res);
    if (!dispositivo) return;

    const rec = await prisma.manutencaoRecorrenciaData.findFirst({
      where: { id: String(req.params.id), dispositivoId: dispositivo.id },
    });
    if (!rec) {
      res.status(404).json({ error: 'Recorrência não encontrada.' });
      return;
    }

    const { titulo, descricao, tipoRecorrencia, dataReferencia, intervaloDias, diasSemana, diaDoMes, mesDoAno } =
      req.body || {};
    const novoTipo = tipoRecorrencia ? String(tipoRecorrencia) : rec.tipoRecorrencia;
    if (tipoRecorrencia || intervaloDias !== undefined || diasSemana !== undefined || diaDoMes !== undefined) {
      try {
        _validarCamposRecorrenciaData(
          novoTipo,
          intervaloDias !== undefined ? intervaloDias : rec.intervaloDias,
          diasSemana !== undefined ? diasSemana : rec.diasSemana,
          diaDoMes !== undefined ? diaDoMes : rec.diaDoMes,
          mesDoAno !== undefined ? mesDoAno : rec.mesDoAno,
        );
      } catch (e: any) {
        res.status(400).json({ error: e?.message || 'Campos inválidos para o tipo de recorrência.' });
        return;
      }
    }

    const atualizada = await prisma.manutencaoRecorrenciaData.update({
      where: { id: rec.id },
      data: {
        titulo: titulo ? String(titulo) : rec.titulo,
        descricao: descricao !== undefined ? (descricao ? String(descricao) : null) : rec.descricao,
        tipoRecorrencia: novoTipo,
        dataReferencia: dataReferencia ? _parseDataSp(dataReferencia) : rec.dataReferencia,
        intervaloDias:
          intervaloDias !== undefined ? (intervaloDias ? parseInt(String(intervaloDias), 10) : null) : rec.intervaloDias,
        diasSemana: diasSemana !== undefined ? diasSemana || null : (rec.diasSemana as any),
        diaDoMes: diaDoMes !== undefined ? (diaDoMes ? parseInt(String(diaDoMes), 10) : null) : rec.diaDoMes,
        mesDoAno: mesDoAno !== undefined ? (mesDoAno ? parseInt(String(mesDoAno), 10) : null) : rec.mesDoAno,
        ativa: true,
        // Data nova zera os avisos — o mesmo motivo do reset por KM acima. É o
        // que o portal já faz nesta rota.
        ...(dataReferencia
          ? {
              alerta7dEnviado: false,
              alerta4dEnviado: false,
              alerta2dEnviado: false,
              alerta1dEnviado: false,
              alertaDiaEnviado: false,
              ultimoAlertaPosDue: null,
            }
          : {}),
      },
    });

    res.json({
      id: atualizada.id,
      titulo: atualizada.titulo,
      tipoRecorrencia: atualizada.tipoRecorrencia,
      dataReferencia: atualizada.dataReferencia,
      intervaloDias: atualizada.intervaloDias,
    });
  } catch (err) {
    console.error('[integracao-raposo] editar recorrência por data:', err);
    res.status(500).json({ error: 'Erro ao editar a recorrência por data.' });
  }
});

/**
 * POST /api/integracao/raposo/veiculo/:placa/manutencoes/recorrencia-data/:id/feito
 * Avança para a próxima data (ou desativa, se AVULSA) e deixa o registro.
 *
 * Como na irmã por KM: aqui fica só o **reset**, e o efeito financeiro
 * (responsável, rateio, lançamento) é 100 % do Raposo. E, também como ela, não
 * dispara notificação ao cliente da Ágil Lock — quem marcou feito foi a oficina
 * do Raposo, que já avisa quem precisa saber pelos canais dela.
 */
router.post('/veiculo/:placa/manutencoes/recorrencia-data/:id/feito', async (req: Request, res: Response) => {
  try {
    const dispositivo = await dispositivoOu404(req, res);
    if (!dispositivo) return;

    const rec = await prisma.manutencaoRecorrenciaData.findFirst({
      where: { id: String(req.params.id), dispositivoId: dispositivo.id },
    });
    if (!rec) {
      res.status(404).json({ error: 'Recorrência não encontrada.' });
      return;
    }

    const agora = new Date();
    const proximaData = rec.tipoRecorrencia !== 'AVULSA' ? _calcularProximaData(rec as any, agora) : null;

    await prisma.manutencaoRecorrenciaData.update({
      where: { id: rec.id },
      data: proximaData
        ? {
            dataReferencia: proximaData,
            ciclosCompletos: rec.ciclosCompletos + 1,
            alerta7dEnviado: false,
            alerta4dEnviado: false,
            alerta2dEnviado: false,
            alerta1dEnviado: false,
            alertaDiaEnviado: false,
            ultimoAlertaPosDue: null,
          }
        : { ativa: false, ciclosCompletos: rec.ciclosCompletos + 1 },
    });

    const kmAtual = await kmAtualDoVeiculo(dispositivo);
    await prisma.manutencaoRegistro.create({
      data: {
        dispositivoId: dispositivo.id,
        titulo: `${rec.titulo} — confirmado (Raposo)`,
        tipo: 'recorrenciaData',
        descricao: `Recorrência por data "${rec.titulo}" marcada como feita pelo Raposo Motors.`,
        dataRealizacao: agora,
        ...(kmAtual != null ? { kmRealizacao: kmAtual } : {}),
        origem: 'RAPOSO',
      },
    });

    res.json({ ok: true, proximaData, ativa: proximaData != null });
  } catch (err) {
    console.error('[integracao-raposo] recorrência por data feito:', err);
    res.status(500).json({ error: 'Erro ao marcar a recorrência por data como feita.' });
  }
});

/** DELETE /api/integracao/raposo/veiculo/:placa/manutencoes/recorrencia-data/:id */
router.delete('/veiculo/:placa/manutencoes/recorrencia-data/:id', async (req: Request, res: Response) => {
  try {
    const dispositivo = await dispositivoOu404(req, res);
    if (!dispositivo) return;

    const rec = await prisma.manutencaoRecorrenciaData.findFirst({
      where: { id: String(req.params.id), dispositivoId: dispositivo.id },
      select: { id: true },
    });
    if (!rec) {
      res.status(404).json({ error: 'Recorrência não encontrada.' });
      return;
    }
    await prisma.manutencaoRecorrenciaData.update({ where: { id: rec.id }, data: { ativa: false } });
    res.json({ ok: true, id: rec.id });
  } catch (err) {
    console.error('[integracao-raposo] desativar recorrência por data:', err);
    res.status(500).json({ error: 'Erro ao desativar a recorrência por data.' });
  }
});

/**
 * ⭐ **Calibrar o odômetro pela placa** (24/08/2026, a pedido da Raposo). A KM que a Raposo lê
 * vem do rastreador; quando o operador tem o número REAL do painel (rastreador novo, contador
 * zerado, drift), ele corrige na tela de Manutenções do Raposo e isso precisa refletir aqui.
 *
 * Mesma mecânica do "definir odômetro" do portal do cliente: grava `odometroSistemaMetros` (o
 * override que a leitura usa), re-ancora as recorrências se o número CAIU (para não mostrar "km
 * percorrido" negativo) e sincroniza o accumulator do Traccar (para o próprio rastreador contar
 * a partir dali). Server-to-server por API key, resolvido por placa.
 */
router.put('/veiculo/:placa/odometro', async (req: Request, res: Response) => {
  try {
    const km = Number((req.body || {}).km);
    if (!Number.isFinite(km) || km < 0) {
      res.status(400).json({ error: 'km inválido — informe um número maior ou igual a 0.' });
      return;
    }
    const dispositivo = await dispositivoOu404(req, res);
    if (!dispositivo) return;

    const atualizado = await prisma.dispositivo.update({
      where: { id: dispositivo.id },
      data: { odometroSistemaMetros: Math.round(km * 1000) },
      select: { id: true, odometroSistemaMetros: true, horimetroSistemaSegundos: true },
    });

    await reancorarRecorrenciasSeOdometroMenor(dispositivo.id, atualizado.odometroSistemaMetros);

    const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
    if (traccarDevice && atualizado.odometroSistemaMetros != null) {
      traccarUpdateDeviceAccumulators(
        traccarDevice.id,
        atualizado.odometroSistemaMetros,
        atualizado.horimetroSistemaSegundos * 1000,
      ).catch((err) => console.error('[integracao-raposo] Traccar accumulators:', err.message));
    }

    res.json({
      ok: true,
      placa: dispositivo.placa,
      km: atualizado.odometroSistemaMetros != null ? Math.round(atualizado.odometroSistemaMetros / 1000) : null,
    });
  } catch (err) {
    console.error('[integracao-raposo] odometro:', err);
    res.status(500).json({ error: 'Erro ao atualizar o odômetro.' });
  }
});

export default router;
