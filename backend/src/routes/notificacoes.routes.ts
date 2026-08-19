import { Router } from 'express';
import prisma from '../utils/prisma';
import {
  clienteAuthMiddleware,
  whereDispositivosDoCliente,
  ClienteRequest,
} from '../middleware/cliente-auth.middleware';
import EmailService from '../services/email.service';
import ExpoPushService from '../services/expo-push.service';
import NotificationService, { periodoKmOuPadrao } from '../services/notification.service';
import { salvarPreferenciasEmMassa } from '../utils/preferencias-notificacao';

const router = Router();

router.get('/app-tokens', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const clienteLoginId = req.cliente.sub;
    const tokens = await prisma.appPushToken.findMany({
      where: { clienteLoginId, ativo: true },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, token: true, plataforma: true, deviceId: true, lastSeenAt: true, createdAt: true },
    });
    res.json(tokens);
  } catch {
    res.status(500).json({ message: 'Erro ao listar tokens do app.' });
  }
});

router.post('/app-tokens', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const clienteLoginId = req.cliente.sub;
    const { token, plataforma, deviceId } = req.body as { token?: string; plataforma?: string; deviceId?: string };

    if (!token || !ExpoPushService.isValidToken(token)) {
      return res.status(400).json({ message: 'Token Expo inválido.' });
    }

    const salvo = await prisma.appPushToken.upsert({
      where: { token },
      update: {
        clienteLoginId,
        plataforma: plataforma || null,
        deviceId: deviceId || null,
        ativo: true,
        ultimoErro: null,
        lastSeenAt: new Date(),
      },
      create: {
        clienteLoginId,
        token,
        plataforma: plataforma || null,
        deviceId: deviceId || null,
      },
      select: { id: true, token: true, plataforma: true, deviceId: true, ativo: true, lastSeenAt: true },
    });

    res.json({ message: 'Token do app registrado com sucesso.', token: salvo });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro ao registrar token do app.' });
  }
});

router.delete('/app-tokens', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const clienteLoginId = req.cliente.sub;
    const { token, deviceId } = req.body as { token?: string; deviceId?: string };

    if (!token && !deviceId) {
      return res.status(400).json({ message: 'Informe token ou deviceId.' });
    }

    await prisma.appPushToken.updateMany({
      where: {
        clienteLoginId,
        ...(token ? { token } : { deviceId }),
      },
      data: { ativo: false },
    });

    res.json({ message: 'Token do app removido com sucesso.' });
  } catch {
    res.status(500).json({ message: 'Erro ao remover token do app.' });
  }
});

// Monta o formato que as telas consomem a partir das linhas do banco.
function montarPreferencias(prefs: Array<Record<string, any>>) {
  const result: any = { preferencias: {} };
  prefs.forEach(p => {
    result.preferencias[p.tipoEvento] = { web: p.web, app: p.app, email: p.email };
    if (p.tipoEvento === 'overspeed') {
      result.overspeedLimit = p.overspeedLimit;
    }
    if (p.tipoEvento === 'kmExcedida') {
      result.kmExcedida = {
        kmMaximo30Dias: p.kmMaximo30Dias,
        diaRenovacaoMes: p.diaRenovacaoMes,
        diaSemanaRenovacao: p.diaSemanaRenovacao,
        periodo: periodoKmOuPadrao(p.kmPeriodo, 'kmExcedida'),
      };
    }
    if (p.tipoEvento === 'kmReduzida') {
      result.kmReduzida = {
        kmMinimo7Dias: p.kmMinimo7Dias,
        diaSemanaRenovacao: p.diaSemanaRenovacao,
        diaRenovacaoMes: p.diaRenovacaoMes,
        periodo: periodoKmOuPadrao(p.kmPeriodo, 'kmReduzida'),
      };
    }
    if (p.tipoEvento === 'trocaOleo') {
      result.kmTrocaOleo = p.kmTrocaOleo;
    }
    if (p.tipoEvento === 'semAtualizacao') {
      result.semAtualizacaoHoras = p.semAtualizacaoHoras;
    }
  });
  return result;
}

// Preferências de TODOS os dispositivos do cliente numa tacada.
// O "Configurar todos" da tela precisa do conjunto inteiro para mostrar o
// denominador comum; antes ele fazia uma requisição por veículo (com 300
// veículos eram 300 chamadas simultâneas, e os cards demoravam a aparecer).
router.get('/preferencias', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const clienteLoginId = req.cliente.sub;

    const dispositivos = await prisma.dispositivo.findMany({
      where: whereDispositivosDoCliente(req),
      select: { id: true },
    });
    const ids = dispositivos.map(d => d.id);

    const prefs = ids.length
      ? await prisma.preferenciaNotificacao.findMany({
        where: { clienteLoginId, dispositivoId: { in: ids } },
      })
      : [];

    // Agrupa numa passada só, em vez de varrer a lista inteira por dispositivo.
    const agrupado = new Map<string, Array<Record<string, any>>>();
    for (const p of prefs) {
      const lista = agrupado.get(p.dispositivoId);
      if (lista) lista.push(p as any);
      else agrupado.set(p.dispositivoId, [p as any]);
    }

    // Todo dispositivo aparece no retorno, mesmo sem preferência salva.
    const porDispositivo: Record<string, any> = {};
    for (const id of ids) porDispositivo[id] = montarPreferencias(agrupado.get(id) ?? []);

    res.json({ porDispositivo });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro ao obter preferências.' });
  }
});

// Obter preferências de um dispositivo
router.get('/preferencias/:dispositivoId', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const { dispositivoId } = req.params;
    const clienteLoginId = req.cliente.sub;

    const prefs = await prisma.preferenciaNotificacao.findMany({
      where: { clienteLoginId, dispositivoId },
    });

    res.json(montarPreferencias(prefs as any));
  } catch (error) {
    res.status(500).json({ message: 'Erro ao obter preferências.' });
  }
});

// Salvar preferências — aceita um dispositivo (dispositivoId) ou vários (dispositivoIds).
// Salvar para vários é o "configurar todos": grava a mesma preferência em cada dispositivo,
// que depois pode ser sobrescrita individualmente.
router.post('/preferencias', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const { dispositivoId, dispositivoIds, preferencias, overspeedLimit, kmExcedida, kmReduzida, kmTrocaOleo, semAtualizacaoHoras } = req.body;
    const clienteLoginId = req.cliente.sub;

    const alvos: string[] = Array.isArray(dispositivoIds) && dispositivoIds.length
      ? [...new Set(dispositivoIds.map(String))]
      : (dispositivoId ? [String(dispositivoId)] : []);

    if (!alvos.length) {
      res.status(400).json({ message: 'Informe dispositivoId ou dispositivoIds.' });
      return;
    }
    if (!preferencias || typeof preferencias !== 'object') {
      res.status(400).json({ message: 'preferencias é obrigatório.' });
      return;
    }

    // Só deixa gravar em dispositivos que o cliente logado enxerga.
    const permitidos = await prisma.dispositivo.findMany({
      where: { id: { in: alvos }, ...whereDispositivosDoCliente(req) },
      select: { id: true },
    });
    if (permitidos.length !== alvos.length) {
      res.status(403).json({ message: 'Um ou mais dispositivos não pertencem a este cliente.' });
      return;
    }

    // Gravação em massa: um upsert por linha numa transação só estourava o
    // timeout de 5 s quando o cliente configurava todos os veículos de uma vez.
    await salvarPreferenciasEmMassa({
      clienteLoginId,
      dispositivoIds: alvos,
      preferencias,
      extras: { overspeedLimit, kmTrocaOleo, semAtualizacaoHoras, kmExcedida, kmReduzida },
    });

    // Invalida o cache do caminho quente para que a mudança valha imediatamente.
    NotificationService.invalidarCachePreferencias(clienteLoginId);

    res.json({ message: 'Preferências salvas com sucesso!', dispositivosAtualizados: alvos.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro ao salvar preferências.' });
  }
});

// Atualizar apenas o intervalo de km de troca de óleo (chamado direto do card de rastreamento)
router.patch('/km-troca-oleo/:dispositivoId', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const { dispositivoId } = req.params;
    const clienteLoginId = req.cliente.sub;
    const { kmTrocaOleo } = req.body;

    if (!kmTrocaOleo || typeof kmTrocaOleo !== 'number' || kmTrocaOleo < 1) {
      return res.status(400).json({ message: 'Informe um intervalo válido em km.' });
    }

    await prisma.preferenciaNotificacao.upsert({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo' } },
      update: { kmTrocaOleo },
      create: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo', web: false, app: false, email: false, kmTrocaOleo },
    });

    // Resetar o estado para iniciar contagem do km atual
    const dispositivo = await prisma.dispositivo.findUnique({ where: { id: dispositivoId }, select: { odometroSistemaMetros: true } });
    await prisma.estadoKmNotificacao.upsert({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo' } },
      update: { kmBaseMetros: dispositivo?.odometroSistemaMetros ?? 0, dataBase: new Date(), notificacaoEnviada: false, ultimaNotificacaoKm: -9999 },
      create: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo', kmBaseMetros: dispositivo?.odometroSistemaMetros ?? 0, dataBase: new Date(), notificacaoEnviada: false, ultimaNotificacaoKm: -9999 },
    });

    res.json({ message: 'Intervalo atualizado com sucesso!', kmTrocaOleo });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro ao atualizar intervalo.' });
  }
});

// Confirmar que a troca de óleo foi realizada (reseta contador)
router.post('/confirmar-troca-oleo/:dispositivoId', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const { dispositivoId } = req.params;
    const clienteLoginId = req.cliente.sub;

    const [dispositivo, pref, login] = await Promise.all([
      prisma.dispositivo.findUnique({
        where: { id: dispositivoId },
        select: { odometroSistemaMetros: true, nome: true, placa: true },
      }),
      prisma.preferenciaNotificacao.findUnique({
        where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo' } },
        select: { web: true, app: true, email: true },
      }),
      prisma.clienteLogin.findUnique({
        where: { id: clienteLoginId },
        select: { email: true, cliente: { select: { nome: true } } },
      }),
    ]);

    await prisma.estadoKmNotificacao.upsert({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo' } },
      update: { kmBaseMetros: dispositivo?.odometroSistemaMetros ?? 0, dataBase: new Date(), notificacaoEnviada: false, ultimaNotificacaoKm: -9999 },
      create: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo', kmBaseMetros: dispositivo?.odometroSistemaMetros ?? 0, dataBase: new Date(), notificacaoEnviada: false, ultimaNotificacaoKm: -9999 },
    });

    const nomeVeiculo = dispositivo?.nome ?? 'Veículo';
    const placa = dispositivo?.placa ? ` (${dispositivo.placa})` : '';
    const mensagem = `Troca de Óleo Realizada: A troca de óleo do veículo ${nomeVeiculo}${placa} foi confirmada com sucesso.`;

    if (pref?.web || pref?.app) {
      await prisma.eventoNotificacao.create({
        data: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleoFeita', mensagem, latitude: null, longitude: null, velocidade: null },
      });
    }

    if (pref?.email && login) {
      const html = EmailService.gerarTemplateAlerta(
        login.cliente.nome,
        nomeVeiculo,
        dispositivo?.placa ?? '',
        'Troca de Óleo Realizada',
        new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        undefined,
      );
      await EmailService.enviarEmail(login.email, `Troca de Óleo Realizada — ${nomeVeiculo}`, html);
    }

    res.json({ message: 'Troca de óleo confirmada com sucesso!', mensagem });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro ao confirmar troca de óleo.' });
  }
});

// Configuração de km para exibir no card de rastreamento (troca de óleo)
router.get('/km-config/:dispositivoId', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const { dispositivoId } = req.params;
    const clienteLoginId = req.cliente.sub;

    const prefOleo = await prisma.preferenciaNotificacao.findUnique({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo' } },
    });

    let trocaOleo: object | null = null;
    if (prefOleo?.kmTrocaOleo) {
      const estado = await prisma.estadoKmNotificacao.findUnique({
        where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo' } },
      });
      trocaOleo = {
        kmIntervalo: prefOleo.kmTrocaOleo,
        kmBaseMetros: estado?.kmBaseMetros ?? null,
      };
    }

    res.json({ trocaOleo });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao obter configuração de km.' });
  }
});

// Obter histórico de eventos do cliente
router.get('/eventos', clienteAuthMiddleware, async (req: ClienteRequest, res) => {
  try {
    const clienteLoginId = req.cliente!.sub;
    const { periodo } = req.query;

    let dateFilter = {};
    const { de, ate } = req.query as { de?: string; ate?: string };

    const meiaNoBrasil = (offsetMs = 0) => {
      const d = new Date(Date.now() + offsetMs);
      const s = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      return new Date(s + 'T00:00:00-03:00');
    };

    if (periodo === 'hoje') {
      dateFilter = { gte: meiaNoBrasil(), lt: meiaNoBrasil(86400000) };
    } else if (periodo === 'ontem') {
      dateFilter = { gte: meiaNoBrasil(-86400000), lt: meiaNoBrasil() };
    } else if (periodo === '7dias') {
      dateFilter = { gte: meiaNoBrasil(-7 * 86400000) };
    } else if (periodo === 'custom' && de && ate) {
      const inicio = new Date((de as string) + 'T00:00:00-03:00');
      const fim    = new Date((ate as string) + 'T23:59:59-03:00');
      if (!isNaN(inicio.getTime()) && !isNaN(fim.getTime())) {
        dateFilter = { gte: inicio, lte: fim };
      }
    }

    // Sub-usuários só veem eventos dos dispositivos permitidos e nunca veem notificações
    // financeiras (boleto). Responsáveis veem tudo do seu cliente.
    const isResponsavel = req.cliente!.tipo === 'responsavel';
    const dispositivoFilter = { dispositivo: whereDispositivosDoCliente(req) };
    const eventosWhere: Record<string, unknown> = {
      clienteLoginId,
      adminEvento: false,
      createdAt: dateFilter,
    };
    if (isResponsavel) {
      // Inclui eventos sem dispositivo (boletos) ou de dispositivos do cliente
      eventosWhere.OR = [{ dispositivoId: null }, dispositivoFilter];
    } else {
      // Sub-usuário: exige dispositivo e que ele esteja na lista permitida; sem boletos.
      eventosWhere.dispositivoId = { not: null };
      eventosWhere.boletoId = null;
      Object.assign(eventosWhere, dispositivoFilter);
    }

    const eventos = await prisma.eventoNotificacao.findMany({
      where: eventosWhere,
      orderBy: { createdAt: 'desc' },
      include: {
        dispositivo: { select: { nome: true, placa: true } },
        boleto: { select: { id: true, numeroParcela: true, valor: true, vencimento: true, status: true, linkBoleto: true } },
      },
    });

    res.json(eventos.map(e => ({
      id: e.id,
      dispositivoId: e.dispositivoId,
      tipo: e.tipoEvento,
      tipoLabel: e.mensagem.split(':')[0],
      origemTipo: e.origemTipo,
      origemId: e.origemId,
      mensagem: e.mensagem,
      serverTime: e.createdAt,
      lat: e.latitude,
      lng: e.longitude,
      endereco: e.endereco,
      velocidade: e.velocidade,
      dispositivoNome: e.dispositivo?.nome ?? null,
      dispositivoPlaca: e.dispositivo?.placa ?? null,
      boleto: e.boleto ? {
        id: e.boleto.id,
        numeroParcela: e.boleto.numeroParcela,
        valor: Number(e.boleto.valor),
        vencimento: e.boleto.vencimento,
        status: e.boleto.status,
        linkBoleto: e.boleto.linkBoleto,
      } : null,
    })));
  } catch (error) {
    res.status(500).json({ message: 'Erro ao obter histórico de eventos.' });
  }
});

// Contar notificações não lidas
router.get('/nao-lidas/count', clienteAuthMiddleware, async (req: ClienteRequest, res) => {
  try {
    const clienteLoginId = req.cliente!.sub;
    const isResponsavel = req.cliente!.tipo === 'responsavel';
    const where: Record<string, unknown> = { clienteLoginId, lido: false, adminEvento: false };
    if (!isResponsavel) {
      // Sub-usuário: só conta eventos dos veículos permitidos e nunca de boletos
      where.boletoId = null;
      where.dispositivo = whereDispositivosDoCliente(req);
    }
    const count = await prisma.eventoNotificacao.count({ where });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao contar notificações.' });
  }
});

// Marcar notificações como lidas
router.post('/marcar-lidas', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const clienteLoginId = req.cliente.sub;
    const { ate } = req.body as { ate?: string };

    // Se não informar "ate", marca todas como lidas
    const where: any = { clienteLoginId, lido: false, adminEvento: false };
    if (ate) {
      where.createdAt = { lte: new Date(ate) };
    }

    await prisma.eventoNotificacao.updateMany({
      where,
      data: { lido: true },
    });

    res.json({ message: 'Notificações marcadas como lidas.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao marcar notificações.' });
  }
});

export default router;
