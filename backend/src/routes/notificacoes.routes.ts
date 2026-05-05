import { Router } from 'express';
import prisma from '../utils/prisma';
import { clienteAuthMiddleware } from '../middleware/cliente-auth.middleware';
import EmailService from '../services/email.service';
import ExpoPushService from '../services/expo-push.service';

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

// Obter preferências de um dispositivo
router.get('/preferencias/:dispositivoId', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const { dispositivoId } = req.params;
    const clienteLoginId = req.cliente.sub;

    const prefs = await prisma.preferenciaNotificacao.findMany({
      where: { clienteLoginId, dispositivoId },
    });

    const result: any = { preferencias: {} };
    prefs.forEach(p => {
      result.preferencias[p.tipoEvento] = { web: p.web, app: p.app, email: p.email };
      if (p.tipoEvento === 'overspeed') {
        result.overspeedLimit = p.overspeedLimit;
      }
      if (p.tipoEvento === 'kmExcedida') {
        result.kmExcedida = { kmMaximo30Dias: p.kmMaximo30Dias, diaRenovacaoMes: p.diaRenovacaoMes };
      }
      if (p.tipoEvento === 'kmReduzida') {
        result.kmReduzida = { kmMinimo7Dias: p.kmMinimo7Dias, diaSemanaRenovacao: p.diaSemanaRenovacao };
      }
      if (p.tipoEvento === 'trocaOleo') {
        result.kmTrocaOleo = p.kmTrocaOleo;
      }
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao obter preferências.' });
  }
});

// Salvar preferências
router.post('/preferencias', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const { dispositivoId, preferencias, overspeedLimit, kmExcedida, kmReduzida, kmTrocaOleo } = req.body;
    const clienteLoginId = req.cliente.sub;

    await prisma.$transaction(
      Object.keys(preferencias).map(tipo => {
        const extra: any = {};
        if (tipo === 'overspeed') extra.overspeedLimit = overspeedLimit ?? 100;
        if (tipo === 'kmExcedida') {
          extra.kmMaximo30Dias = kmExcedida?.kmMaximo30Dias ?? null;
          extra.diaRenovacaoMes = kmExcedida?.diaRenovacaoMes ?? null;
        }
        if (tipo === 'kmReduzida') {
          extra.kmMinimo7Dias = kmReduzida?.kmMinimo7Dias ?? null;
          extra.diaSemanaRenovacao = kmReduzida?.diaSemanaRenovacao ?? null;
        }
        if (tipo === 'trocaOleo') {
          extra.kmTrocaOleo = kmTrocaOleo ?? null;
        }

        return prisma.preferenciaNotificacao.upsert({
          where: {
            clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: tipo },
          },
          update: { web: preferencias[tipo].web, app: preferencias[tipo].app, email: preferencias[tipo].email, ...extra },
          create: { clienteLoginId, dispositivoId, tipoEvento: tipo, web: preferencias[tipo].web, app: preferencias[tipo].app, email: preferencias[tipo].email, ...extra },
        });
      })
    );

    res.json({ message: 'Preferências salvas com sucesso!' });
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
router.get('/eventos', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const clienteLoginId = req.cliente.sub;
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

    const eventos = await prisma.eventoNotificacao.findMany({
      where: { clienteLoginId, adminEvento: false, createdAt: dateFilter },
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
router.get('/nao-lidas/count', clienteAuthMiddleware, async (req: any, res) => {
  try {
    const clienteLoginId = req.cliente.sub;
    const count = await prisma.eventoNotificacao.count({
      where: { clienteLoginId, lido: false, adminEvento: false },
    });
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
