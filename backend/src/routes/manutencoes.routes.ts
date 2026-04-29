'use strict';

import { Router } from 'express';
import prisma from '../utils/prisma';
import { clienteAuthMiddleware } from '../middleware/cliente-auth.middleware';

const router = Router();
router.use(clienteAuthMiddleware);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _dispositivoIdsDoCliente(clienteLoginId: string): Promise<string[]> {
  const login = await prisma.clienteLogin.findUnique({
    where: { id: clienteLoginId },
    include: {
      cliente: {
        include: {
          dispositivos: { select: { id: true } },
          dispositivosVinculados: { select: { dispositivoId: true } },
        },
      },
    },
  });
  return [
    ...(login?.cliente?.dispositivos ?? []).map(d => d.id),
    ...(login?.cliente?.dispositivosVinculados ?? []).map(dv => dv.dispositivoId),
  ];
}

async function _ativarNotificacaoManutencao(clienteLoginId: string, dispositivoId: string) {
  try {
    await prisma.preferenciaNotificacao.upsert({
      where: {
        clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'manutencao' },
      },
      update: { web: true, app: true, email: true },
      create: { clienteLoginId, dispositivoId, tipoEvento: 'manutencao', web: true, app: true, email: true },
    });
  } catch (err) {
    console.error('Erro ao ativar notificação de manutenção:', err);
  }
}

// ── Registros ─────────────────────────────────────────────────────────────────

// GET /api/cliente/manutencoes/registros?dispositivoId=X
router.get('/registros', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { dispositivoId } = req.query as { dispositivoId?: string };

    const idsPermitidos = await _dispositivoIdsDoCliente(clienteLoginId);
    if (!idsPermitidos.length) return res.json([]);

    const filtroDispositivo = dispositivoId && idsPermitidos.includes(dispositivoId)
      ? dispositivoId
      : undefined;

    const registros = await prisma.manutencaoRegistro.findMany({
      where: {
        dispositivoId: filtroDispositivo ?? { in: idsPermitidos },
        OR: [
          { clienteLoginId },
          { origem: 'ADMIN' },
        ],
      },
      include: { dispositivo: { select: { nome: true, placa: true } } },
      orderBy: { dataRealizacao: 'desc' },
    });

    res.json(registros);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao carregar registros.' });
  }
});

// POST /api/cliente/manutencoes/registros
router.post('/registros', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { dispositivoId, titulo, tipo, descricao, dataRealizacao, kmRealizacao, custo, oficina, notas, fotos } = req.body;

    if (!dispositivoId || !titulo || !dataRealizacao) {
      return res.status(400).json({ message: 'Campos obrigatórios: dispositivoId, titulo, dataRealizacao.' });
    }

    const idsPermitidos = await _dispositivoIdsDoCliente(clienteLoginId);
    if (!idsPermitidos.includes(dispositivoId)) {
      return res.status(403).json({ message: 'Acesso negado a este dispositivo.' });
    }

    const registro = await prisma.manutencaoRegistro.create({
      data: {
        dispositivoId,
        clienteLoginId,
        titulo,
        tipo: tipo || 'preventiva',
        descricao: descricao || null,
        dataRealizacao: new Date(dataRealizacao),
        kmRealizacao: kmRealizacao != null ? parseFloat(kmRealizacao) : null,
        custo: custo != null ? parseFloat(custo) : null,
        oficina: oficina || null,
        notas: notas || null,
        fotos: fotos || [],
        origem: 'CLIENTE',
      },
      include: { dispositivo: { select: { nome: true, placa: true } } },
    });

    res.json(registro);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao criar registro.' });
  }
});

// DELETE /api/cliente/manutencoes/registros/:id
router.delete('/registros/:id', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { id } = req.params;

    const registro = await prisma.manutencaoRegistro.findFirst({
      where: { id, clienteLoginId, origem: 'CLIENTE' },
    });
    if (!registro) return res.status(404).json({ message: 'Registro não encontrado ou não pode ser excluído.' });

    await prisma.manutencaoRegistro.delete({ where: { id } });
    res.json({ message: 'Registro excluído com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao excluir registro.' });
  }
});

// ── Recorrências ──────────────────────────────────────────────────────────────

// GET /api/cliente/manutencoes/recorrencias?dispositivoId=X
router.get('/recorrencias', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { dispositivoId } = req.query as { dispositivoId?: string };

    const idsPermitidos = await _dispositivoIdsDoCliente(clienteLoginId);
    if (!idsPermitidos.length) return res.json([]);

    const filtroDispositivo = dispositivoId && idsPermitidos.includes(dispositivoId)
      ? dispositivoId
      : undefined;

    const recorrencias = await prisma.manutencaoRecorrencia.findMany({
      where: {
        dispositivoId: filtroDispositivo ?? { in: idsPermitidos },
        ativa: true,
        OR: [
          { clienteLoginId },
          { origem: 'ADMIN' },
        ],
      },
      include: {
        dispositivo: {
          select: { nome: true, placa: true, odometroSistemaMetros: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(recorrencias);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao carregar recorrências.' });
  }
});

// POST /api/cliente/manutencoes/recorrencias
router.post('/recorrencias', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { dispositivoId, titulo, descricao, intervaloKm } = req.body;

    if (!dispositivoId || !titulo || !intervaloKm) {
      return res.status(400).json({ message: 'Campos obrigatórios: dispositivoId, titulo, intervaloKm.' });
    }

    const idsPermitidos = await _dispositivoIdsDoCliente(clienteLoginId);
    if (!idsPermitidos.includes(dispositivoId)) {
      return res.status(403).json({ message: 'Acesso negado a este dispositivo.' });
    }

    const dispositivo = await prisma.dispositivo.findUnique({
      where: { id: dispositivoId },
      select: { odometroSistemaMetros: true },
    });
    const kmBase = (dispositivo?.odometroSistemaMetros ?? 0) / 1000;

    const recorrencia = await prisma.manutencaoRecorrencia.create({
      data: {
        dispositivoId,
        clienteLoginId,
        titulo,
        descricao: descricao || null,
        intervaloKm: parseInt(intervaloKm),
        kmBase,
        origem: 'CLIENTE',
      },
      include: { dispositivo: { select: { nome: true, placa: true, odometroSistemaMetros: true } } },
    });

    // Garante que as notificações de manutenção estão ativas para este dispositivo
    await _ativarNotificacaoManutencao(clienteLoginId, dispositivoId);

    res.json(recorrencia);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao criar recorrência.' });
  }
});

// POST /api/cliente/manutencoes/recorrencias/:id/feito
router.post('/recorrencias/:id/feito', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { id } = req.params;
    const { notas, fotos } = req.body;

    const recorrencia = await prisma.manutencaoRecorrencia.findFirst({
      where: {
        id,
        OR: [{ clienteLoginId }, { origem: 'ADMIN' }],
      },
      include: {
        dispositivo: { select: { odometroSistemaMetros: true, nome: true, placa: true } },
      },
    });
    if (!recorrencia) return res.status(404).json({ message: 'Recorrência não encontrada.' });

    const idsPermitidos = await _dispositivoIdsDoCliente(clienteLoginId);
    if (!idsPermitidos.includes(recorrencia.dispositivoId)) {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    const kmAtual = (recorrencia.dispositivo.odometroSistemaMetros ?? 0) / 1000;

    await prisma.manutencaoRecorrencia.update({
      where: { id },
      data: { kmBase: kmAtual, alerta50Enviado: false, alerta25Enviado: false, alerta0Enviado: false },
    });

    await prisma.manutencaoRegistro.create({
      data: {
        dispositivoId: recorrencia.dispositivoId,
        clienteLoginId,
        titulo: `${recorrencia.titulo} — confirmado`,
        tipo: 'preventiva',
        descricao: `Manutenção recorrente "${recorrencia.titulo}" confirmada como realizada.`,
        dataRealizacao: new Date(),
        kmRealizacao: kmAtual,
        notas: notas || null,
        fotos: fotos || [],
        origem: 'CLIENTE',
      },
    });

    res.json({ message: 'Manutenção marcada como feita. Contador reiniciado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao confirmar manutenção.' });
  }
});

// DELETE /api/cliente/manutencoes/recorrencias/:id
router.delete('/recorrencias/:id', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { id } = req.params;

    const recorrencia = await prisma.manutencaoRecorrencia.findFirst({
      where: { id, clienteLoginId, origem: 'CLIENTE' },
    });
    if (!recorrencia) return res.status(404).json({ message: 'Recorrência não encontrada ou não pode ser excluída.' });

    await prisma.manutencaoRecorrencia.update({ where: { id }, data: { ativa: false } });
    res.json({ message: 'Recorrência removida com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao remover recorrência.' });
  }
});

export default router;
