import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { param, query } from '../utils/params';

const router = Router();
router.use(authMiddleware);

// ─── Helpers reutilizáveis ────────────────────────────────────────────────────

const COLAB_SELECT = {
  id: true, nome: true, email: true, role: true, ativo: true, createdAt: true,
  podeExcluirCliente: true, podeEditarCliente: true, podeInativarCliente: true,
  podeExcluirPlaca: true, podeInativarPlaca: true,
  podeBaixaManual: true, podeCancelarCarne: true, podeAlterarVencimento: true,
} as const;

async function criarUsuario(
  res: Response,
  dados: {
    nome: string; email: string; senha: string; role: 'COLABORADOR' | 'VENDEDOR';
    podeExcluirCliente?: boolean; podeEditarCliente?: boolean; podeInativarCliente?: boolean;
    podeExcluirPlaca?: boolean; podeInativarPlaca?: boolean;
    podeBaixaManual?: boolean; podeCancelarCarne?: boolean; podeAlterarVencimento?: boolean;
  }
) {
  const { nome, email, senha, role } = dados;
  if (!nome || !email || !senha) {
    res.status(400).json({ error: 'nome, email e senha são obrigatórios.' });
    return;
  }
  const existe = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existe) {
    res.status(400).json({ error: 'E-mail já cadastrado.' });
    return;
  }
  const senhaHash = await bcrypt.hash(senha, 10);
  const data: Prisma.UserCreateInput = { nome, email, senhaHash, role };
  if (role === 'COLABORADOR') {
    data.podeExcluirCliente    = dados.podeExcluirCliente    ?? true;
    data.podeEditarCliente     = dados.podeEditarCliente     ?? true;
    data.podeInativarCliente   = dados.podeInativarCliente   ?? true;
    data.podeExcluirPlaca      = dados.podeExcluirPlaca      ?? true;
    data.podeInativarPlaca     = dados.podeInativarPlaca     ?? true;
    data.podeBaixaManual       = dados.podeBaixaManual       ?? true;
    data.podeCancelarCarne     = dados.podeCancelarCarne     ?? true;
    data.podeAlterarVencimento = dados.podeAlterarVencimento ?? true;
  }
  const user = await prisma.user.create({ data, select: COLAB_SELECT });
  res.status(201).json(user);
}

async function editarUsuario(
  req: AuthRequest,
  res: Response,
  role: 'COLABORADOR' | 'VENDEDOR'
) {
  const id = param(req, 'id');
  const { nome, email, senha, podeExcluirCliente, podeEditarCliente, podeInativarCliente, podeExcluirPlaca, podeInativarPlaca, podeBaixaManual, podeCancelarCarne, podeAlterarVencimento } = req.body;

  const existe = await prisma.user.findFirst({ where: { id, role }, select: { id: true } });
  if (!existe) {
    res.status(404).json({ error: `${role === 'COLABORADOR' ? 'Colaborador' : 'Vendedor'} não encontrado.` });
    return;
  }
  if (email) {
    const emUso = await prisma.user.findFirst({ where: { email, NOT: { id } }, select: { id: true } });
    if (emUso) {
      res.status(400).json({ error: 'E-mail já cadastrado por outro usuário.' });
      return;
    }
  }
  const data: Record<string, unknown> = {};
  if (nome)  data.nome = nome;
  if (email) data.email = email;
  if (senha) data.senhaHash = await bcrypt.hash(senha, 10);
  if (role === 'COLABORADOR') {
    if (podeExcluirCliente    !== undefined) data.podeExcluirCliente    = podeExcluirCliente;
    if (podeEditarCliente     !== undefined) data.podeEditarCliente     = podeEditarCliente;
    if (podeInativarCliente   !== undefined) data.podeInativarCliente   = podeInativarCliente;
    if (podeExcluirPlaca      !== undefined) data.podeExcluirPlaca      = podeExcluirPlaca;
    if (podeInativarPlaca     !== undefined) data.podeInativarPlaca     = podeInativarPlaca;
    if (podeBaixaManual       !== undefined) data.podeBaixaManual       = podeBaixaManual;
    if (podeCancelarCarne     !== undefined) data.podeCancelarCarne     = podeCancelarCarne;
    if (podeAlterarVencimento !== undefined) data.podeAlterarVencimento = podeAlterarVencimento;
  }

  const user = await prisma.user.update({ where: { id }, data, select: COLAB_SELECT });
  res.json(user);
}

async function toggleStatus(req: AuthRequest, res: Response, role: 'COLABORADOR' | 'VENDEDOR') {
  const id = param(req, 'id');
  const existe = await prisma.user.findFirst({ where: { id, role }, select: { id: true, ativo: true } });
  if (!existe) {
    res.status(404).json({ error: `${role === 'COLABORADOR' ? 'Colaborador' : 'Vendedor'} não encontrado.` });
    return;
  }
  const user = await prisma.user.update({
    where: { id },
    data: { ativo: !existe.ativo },
    select: { id: true, nome: true, ativo: true },
  });
  res.json(user);
}

async function excluirUsuario(req: AuthRequest, res: Response, role: 'COLABORADOR' | 'VENDEDOR') {
  const id = param(req, 'id');
  const existe = await prisma.user.findFirst({ where: { id, role }, select: { id: true } });
  if (!existe) {
    res.status(404).json({ error: `${role === 'COLABORADOR' ? 'Colaborador' : 'Vendedor'} não encontrado.` });
    return;
  }
  const [totalCriados, totalCarnes, totalVendidos, totalComissoes] = await Promise.all([
    prisma.cliente.count({ where: { criadoPorId: id } }),
    prisma.carne.count({ where: { geradoPorId: id } }),
    role === 'VENDEDOR' ? prisma.cliente.count({ where: { vendedorId: id } }) : Promise.resolve(0),
    role === 'VENDEDOR' ? prisma.comissaoVendedor.count({ where: { vendedorId: id } }) : Promise.resolve(0),
  ]);
  if (totalCriados > 0 || totalCarnes > 0 || totalVendidos > 0 || totalComissoes > 0) {
    res.status(400).json({ error: 'Usuário possui registros vinculados. Inative-o em vez de excluir.' });
    return;
  }
  await prisma.user.delete({ where: { id } });
  res.status(204).send();
}

// ─── Colaboradores ────────────────────────────────────────────────────────────

router.get('/colaboradores', requireRoles('ADMIN'), async (_req: AuthRequest, res: Response): Promise<void> => {
  const lista = await prisma.user.findMany({
    where: { role: 'COLABORADOR' },
    select: COLAB_SELECT,
    orderBy: { nome: 'asc' },
  });
  res.json(lista);
});

router.post('/colaboradores', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  await criarUsuario(res, { ...req.body, role: 'COLABORADOR' });
});

router.put('/colaboradores/:id', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  await editarUsuario(req, res, 'COLABORADOR');
});

router.patch('/colaboradores/:id/status', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  await toggleStatus(req, res, 'COLABORADOR');
});

router.delete('/colaboradores/:id', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  await excluirUsuario(req, res, 'COLABORADOR');
});

// ─── Vendedores ───────────────────────────────────────────────────────────────

// GET /api/vendedores — acessível por ADMIN e COLABORADOR (para associar vendedor a cliente)
router.get('/vendedores', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const busca = query(req.query.busca);
  const lista = await prisma.user.findMany({
    where: {
      role: 'VENDEDOR', ativo: true,
      ...(busca ? {
        OR: [
          { nome: { contains: busca, mode: 'insensitive' } },
          { email: { contains: busca, mode: 'insensitive' } },
        ],
      } : {}),
    },
    select: {
      id: true, nome: true, email: true, ativo: true, createdAt: true,
      _count: { select: { clientesVendidos: true } },
    },
    orderBy: { nome: 'asc' },
    take: 20,
  });
  res.json(lista);
});

router.post('/vendedores', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  await criarUsuario(res, { ...req.body, role: 'VENDEDOR' });
});

router.put('/vendedores/:id', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  await editarUsuario(req, res, 'VENDEDOR');
});

router.patch('/vendedores/:id/status', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  await toggleStatus(req, res, 'VENDEDOR');
});

router.delete('/vendedores/:id', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  await excluirUsuario(req, res, 'VENDEDOR');
});

// GET /api/vendedores/:id/clientes — clientes do vendedor com próximo boleto
router.get('/vendedores/:id/clientes', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const vendedor = await prisma.user.findFirst({
    where: { id, role: 'VENDEDOR' },
    select: { id: true, nome: true, email: true },
  });
  if (!vendedor) {
    res.status(404).json({ error: 'Vendedor não encontrado.' });
    return;
  }

  const clientes = await prisma.cliente.findMany({
    where: { vendedorId: id },
    include: {
      placas: { where: { ativo: true }, select: { id: true, placa: true, descricao: true } },
      carnes: {
        where: { boletos: { some: { status: { in: ['PENDENTE', 'ATRASADO'] } } } },
        select: {
          id: true, tipo: true, efiCarneId: true,
          boletos: {
            where: { status: { in: ['PENDENTE', 'ATRASADO'] } },
            orderBy: { vencimento: 'asc' },
            take: 1,
            select: { id: true, valor: true, vencimento: true, status: true, linkBoleto: true },
          },
        },
      },
    },
    orderBy: { nome: 'asc' },
  });

  res.json({ vendedor, clientes });
});

export default router;
