import { Router } from 'express';
import prisma from '../utils/prisma';
import { clienteAuthMiddleware } from '../middleware/cliente-auth.middleware';

const router = Router();

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
    const agora = new Date();
    const { de, ate } = req.query as { de?: string; ate?: string };

    if (periodo === 'hoje') {
      dateFilter = { gte: new Date(agora.setHours(0, 0, 0, 0)) };
    } else if (periodo === 'ontem') {
      const ontem = new Date(agora);
      ontem.setDate(agora.getDate() - 1);
      dateFilter = {
        gte: new Date(ontem.setHours(0, 0, 0, 0)),
        lt: new Date(agora.setHours(0, 0, 0, 0)),
      };
    } else if (periodo === '7dias') {
      const seteDias = new Date(agora);
      seteDias.setDate(agora.getDate() - 7);
      dateFilter = { gte: seteDias };
    } else if (periodo === 'custom' && de && ate) {
      const inicio = new Date(de as string);
      inicio.setHours(0, 0, 0, 0);
      const fim = new Date(ate as string);
      fim.setHours(23, 59, 59, 999);
      if (!isNaN(inicio.getTime()) && !isNaN(fim.getTime())) {
        dateFilter = { gte: inicio, lte: fim };
      }
    }

    const eventos = await prisma.eventoNotificacao.findMany({
      where: { clienteLoginId, createdAt: dateFilter },
      orderBy: { createdAt: 'desc' },
      include: { dispositivo: { select: { nome: true, placa: true } } },
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
      velocidade: e.velocidade,
      dispositivoNome: e.dispositivo.nome,
      dispositivoPlaca: e.dispositivo.placa,
    })));
  } catch (error) {
    res.status(500).json({ message: 'Erro ao obter histórico de eventos.' });
  }
});

export default router;
