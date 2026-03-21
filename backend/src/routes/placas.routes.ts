import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { param } from '../utils/params';

const router = Router();
router.use(authMiddleware);

// GET /api/clientes/:clienteId/placas
router.get('/clientes/:clienteId/placas', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const clienteId = param(req, 'clienteId');

  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
  if (!cliente) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  const placas = await prisma.placa.findMany({
    where: { clienteId },
    orderBy: { placa: 'asc' },
  });

  res.json(placas);
});

// POST /api/clientes/:clienteId/placas
router.post('/clientes/:clienteId/placas', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const clienteId = param(req, 'clienteId');
  const { placa, descricao } = req.body;

  if (!placa) {
    res.status(400).json({ error: 'A placa é obrigatória.' });
    return;
  }

  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
  if (!cliente) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  const placaUpper = String(placa).toUpperCase();
  const jaExiste = await prisma.placa.findFirst({ where: { placa: placaUpper }, select: { id: true } });
  if (jaExiste) {
    res.status(400).json({ error: `A placa ${placaUpper} já está cadastrada.` });
    return;
  }

  const novaPlaca = await prisma.placa.create({
    data: { placa: placaUpper, descricao: descricao || null, clienteId },
  });

  res.status(201).json(novaPlaca);
});

// PUT /api/placas/:id
router.put('/placas/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const { placa, descricao } = req.body;

  const existe = await prisma.placa.findUnique({ where: { id }, select: { id: true, placa: true } });
  if (!existe) {
    res.status(404).json({ error: 'Placa não encontrada.' });
    return;
  }

  const placaNova = placa ? String(placa).toUpperCase() : existe.placa;

  if (placaNova !== existe.placa) {
    const jaExiste = await prisma.placa.findFirst({
      where: { placa: placaNova, NOT: { id } },
      select: { id: true },
    });
    if (jaExiste) {
      res.status(400).json({ error: `A placa ${placaNova} já está cadastrada.` });
      return;
    }
  }

  const placaAtualizada = await prisma.placa.update({
    where: { id },
    data: {
      placa: placaNova,
      ...(descricao !== undefined ? { descricao: descricao || null } : {}),
    },
  });

  res.json(placaAtualizada);
});

// PATCH /api/placas/:id/valor
router.patch('/placas/:id/valor', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const { valor } = req.body;

  if (valor === undefined || valor === null || isNaN(Number(valor)) || Number(valor) < 0) {
    res.status(400).json({ error: 'valor deve ser um número >= 0.' });
    return;
  }

  const existe = await prisma.placa.findUnique({ where: { id }, select: { id: true } });
  if (!existe) {
    res.status(404).json({ error: 'Placa não encontrada.' });
    return;
  }

  const placa = await prisma.placa.update({
    where: { id },
    data: { valorPadrao: Number(valor) > 0 ? Number(valor) : null },
    select: { id: true, valorPadrao: true },
  });

  res.json(placa);
});

// PATCH /api/placas/:id/status
router.patch('/placas/:id/status', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeInativarPlaca) {
    res.status(403).json({ error: 'Sem permissão para inativar/ativar placas.' });
    return;
  }
  const id = param(req, 'id');

  const existe = await prisma.placa.findUnique({ where: { id }, select: { id: true, ativo: true } });
  if (!existe) {
    res.status(404).json({ error: 'Placa não encontrada.' });
    return;
  }

  const placaAtualizada = await prisma.placa.update({
    where: { id },
    data: { ativo: !existe.ativo },
    select: { id: true, placa: true, ativo: true },
  });

  res.json(placaAtualizada);
});

// DELETE /api/placas/:id
router.delete('/placas/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeExcluirPlaca) {
    res.status(403).json({ error: 'Sem permissão para excluir placas.' });
    return;
  }
  const id = param(req, 'id');

  const existe = await prisma.placa.findUnique({ where: { id }, select: { id: true } });
  if (!existe) {
    res.status(404).json({ error: 'Placa não encontrada.' });
    return;
  }

  const totalBoletos = await prisma.boleto.count({ where: { placaId: id } });
  if (totalBoletos > 0) {
    res.status(400).json({ error: 'Não é possível excluir uma placa com boletos. Inative-a.' });
    return;
  }

  await prisma.placa.delete({ where: { id } });
  res.status(204).send();
});

export default router;
