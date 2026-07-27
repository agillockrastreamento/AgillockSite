import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { raposoApiKeyMiddleware } from '../middleware/raposo-api-key.middleware';
import {
  traccarGetDeviceByImei,
  traccarGetPositions,
  traccarSendCommand,
} from '../services/traccar.service';
import {
  DISPOSITIVO_MEDIDORES_SELECT,
  sincronizarDispositivosComPosicoes,
  decorarPosicaoComMedidores,
} from '../services/medidores.service';

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
      prisma.manutencaoRegistro.findMany({
        where: { dispositivoId: dispositivo.id },
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
      })),
    });
  } catch (err) {
    console.error('[integracao-raposo] manutencoes:', err);
    res.status(500).json({ error: 'Erro ao consultar as manutenções do veículo.' });
  }
});

export default router;
