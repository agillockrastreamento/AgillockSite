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
      where: {
        clienteLoginId,
        dispositivoId,
      },
    });

    // Converter para o formato que o frontend espera
    const result: any = { preferencias: {} };
    prefs.forEach(p => {
      result.preferencias[p.tipoEvento] = {
        web: p.web,
        app: p.app,
        email: p.email,
      };
      if (p.tipoEvento === 'overspeed') {
        result.overspeedLimit = p.overspeedLimit;
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
    const { dispositivoId, preferencias, overspeedLimit } = req.body;
    const clienteLoginId = req.cliente.sub;

    // Usar uma transação para salvar todas as preferências
    await prisma.$transaction(
      Object.keys(preferencias).map(tipo => {
        return prisma.preferenciaNotificacao.upsert({
          where: {
            clienteLoginId_dispositivoId_tipoEvento: {
              clienteLoginId,
              dispositivoId,
              tipoEvento: tipo,
            },
          },
          update: {
            web: preferencias[tipo].web,
            app: preferencias[tipo].app,
            email: preferencias[tipo].email,
            overspeedLimit: tipo === 'overspeed' ? overspeedLimit : undefined,
          },
          create: {
            clienteLoginId,
            dispositivoId,
            tipoEvento: tipo,
            web: preferencias[tipo].web,
            app: preferencias[tipo].app,
            email: preferencias[tipo].email,
            overspeedLimit: tipo === 'overspeed' ? overspeedLimit : undefined,
          },
        });
      })
    );

    res.json({ message: 'Preferências salvas com sucesso!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro ao salvar preferências.' });
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
      where: {
        clienteLoginId,
        createdAt: dateFilter,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        dispositivo: {
          select: { nome: true, placa: true }
        }
      }
    });

    res.json(eventos.map(e => ({
      id: e.id,
      dispositivoId: e.dispositivoId,
      tipo: e.tipoEvento,
      tipoLabel: e.mensagem.split(':')[0], // Simples extração do label
      mensagem: e.mensagem,
      serverTime: e.createdAt,
      lat: e.latitude,
      lng: e.longitude,
      velocidade: e.velocidade,
      dispositivoNome: e.dispositivo.nome,
      dispositivoPlaca: e.dispositivo.placa
    })));
  } catch (error) {
    res.status(500).json({ message: 'Erro ao obter histórico de eventos.' });
  }
});

export default router;