import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import {
  clienteAuthMiddleware,
  requireResponsavel,
  ClienteRequest,
} from '../middleware/cliente-auth.middleware';
import { param } from '../utils/params';
import prisma from '../utils/prisma';
import { normalizarPermissoes } from '../utils/cliente-permissoes';

const router = Router();

// Auth para todas as rotas
router.use(clienteAuthMiddleware);

// GET /api/cliente/me/permissoes — qualquer cliente logado pode consultar suas próprias permissões
router.get('/me/permissoes', async (req: ClienteRequest, res: Response): Promise<void> => {
  if (!req.cliente) {
    res.status(401).json({ error: 'Não autenticado.' });
    return;
  }
  const cli = await prisma.cliente.findUnique({
    where: { id: req.cliente.clienteId },
    select: { multasHabilitado: true },
  });
  res.json({
    tipo: req.cliente.tipo,
    nome: req.cliente.nome,
    clienteId: req.cliente.clienteId,
    permissoes: req.cliente.permissoes,
    dispositivoIdsPermitidos: req.cliente.dispositivoIdsPermitidos,
    multasHabilitado: cli?.multasHabilitado ?? false,
  });
});

// IMPORTANTE: NÃO usar `router.use(requireResponsavel)` aqui porque o middleware roda
// para qualquer request que entre neste router (mesmo as não-correspondentes), bloqueando
// rotas dos demais routers montados no mesmo prefixo `/api/cliente`. Aplique nas rotas.

// GET /api/cliente/usuarios — lista sub-usuários do cliente atual
router.get('/usuarios', requireResponsavel, async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;

  const usuarios = await prisma.clienteLogin.findMany({
    where: { clienteId, tipo: 'vinculado' },
    select: {
      id: true,
      email: true,
      nome: true,
      ativo: true,
      perfil: true,
      cpfCnpj: true,
      permissoes: true,
      createdAt: true,
      updatedAt: true,
      placasPermitidas: { select: { dispositivoId: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(
    usuarios.map((u) => ({
      ...u,
      dispositivoIds: u.placasPermitidas.map((p) => p.dispositivoId),
      placasPermitidas: undefined,
    })),
  );
});

// GET /api/cliente/usuarios/:id — detalhe (para o form de edição)
router.get('/usuarios/:id', requireResponsavel, async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const id = param(req, 'id');

  const usuario = await prisma.clienteLogin.findFirst({
    where: { id, clienteId, tipo: 'vinculado' },
    select: {
      id: true,
      email: true,
      nome: true,
      ativo: true,
      perfil: true,
      cpfCnpj: true,
      permissoes: true,
      createdAt: true,
      updatedAt: true,
      placasPermitidas: { select: { dispositivoId: true } },
    },
  });

  if (!usuario) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  res.json({
    ...usuario,
    dispositivoIds: usuario.placasPermitidas.map((p) => p.dispositivoId),
    placasPermitidas: undefined,
  });
});

interface PayloadUsuario {
  email?: string;
  senha?: string;
  nome?: string | null;
  perfil?: string | null;
  cpfCnpj?: string | null;
  permissoes?: unknown;
  dispositivoIds?: string[];
}

function validarPayload(body: PayloadUsuario, exigirSenha: boolean): string | null {
  if (!body.email || typeof body.email !== 'string') return 'Email é obrigatório.';
  if (exigirSenha && (!body.senha || typeof body.senha !== 'string')) {
    return 'Senha é obrigatória.';
  }
  if (body.senha && body.senha.length < 6) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }
  if (body.cpfCnpj) {
    const digits = String(body.cpfCnpj).replace(/\D/g, '');
    if (digits.length !== 11 && digits.length !== 14) {
      return 'CPF/CNPJ inválido — informe 11 (CPF) ou 14 (CNPJ) dígitos.';
    }
  }
  return null;
}

// Normaliza o cpfCnpj do payload: dígitos, ou null para limpar, ou undefined se ausente
function normalizarCpfCnpj(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  const digits = String(valor ?? '').replace(/\D/g, '');
  return digits || null;
}

// CPF/CNPJ do sub-usuário não pode colidir com outro login nem com o CPF/CNPJ de um
// cliente (que já identifica o login responsável dele) — evita ambiguidade no login.
async function cpfCnpjEmUso(digits: string, ignorarLoginId?: string): Promise<boolean> {
  const login = await prisma.clienteLogin.findFirst({
    where: { cpfCnpj: digits, ...(ignorarLoginId ? { id: { not: ignorarLoginId } } : {}) },
    select: { id: true },
  });
  if (login) return true;
  const cliente = await prisma.cliente.findFirst({
    where: { cpfCnpj: digits },
    select: { id: true },
  });
  return !!cliente;
}

async function validarDispositivos(
  clienteId: string,
  dispositivoIds: string[],
): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (dispositivoIds.length === 0) return { ok: true };
  const validos = await prisma.dispositivo.findMany({
    where: { id: { in: dispositivoIds }, clienteId },
    select: { id: true },
  });
  if (validos.length !== dispositivoIds.length) {
    return { ok: false, erro: 'Um ou mais dispositivos não pertencem a este cliente.' };
  }
  return { ok: true };
}

// POST /api/cliente/usuarios
router.post('/usuarios', requireResponsavel, async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const criadoPorLoginId = req.cliente!.sub;
  const body = req.body as PayloadUsuario;

  const erro = validarPayload(body, true);
  if (erro) {
    res.status(400).json({ error: erro });
    return;
  }

  // Email não pode colidir com nenhum outro login do sistema
  const emailEmUsoCliente = await prisma.clienteLogin.findUnique({ where: { email: body.email! } });
  const emailEmUsoUser = await prisma.user.findUnique({ where: { email: body.email! } });
  if (emailEmUsoCliente || emailEmUsoUser) {
    res.status(409).json({ error: 'Este email já está em uso no sistema.' });
    return;
  }

  const dispositivoIds = Array.isArray(body.dispositivoIds) ? body.dispositivoIds : [];
  const check = await validarDispositivos(clienteId, dispositivoIds);
  if (!check.ok) {
    res.status(400).json({ error: check.erro });
    return;
  }

  const cpfCnpj = normalizarCpfCnpj(body.cpfCnpj) ?? null;
  if (cpfCnpj && (await cpfCnpjEmUso(cpfCnpj))) {
    res.status(409).json({ error: 'Este CPF/CNPJ já está em uso no sistema.' });
    return;
  }

  const senhaHash = await bcrypt.hash(body.senha!, 10);
  const permissoes = normalizarPermissoes(body.permissoes);

  const criado = await prisma.clienteLogin.create({
    data: {
      clienteId,
      email: body.email!,
      senhaHash,
      tipo: 'vinculado',
      nome: body.nome?.trim() ?? null,
      perfil: body.perfil ?? null,
      cpfCnpj,
      permissoes: permissoes as unknown as object,
      criadoPorLoginId,
      placasPermitidas: {
        create: dispositivoIds.map((dispositivoId) => ({ dispositivoId })),
      },
    },
    select: {
      id: true, email: true, nome: true, ativo: true, perfil: true, cpfCnpj: true,
      permissoes: true, createdAt: true,
      placasPermitidas: { select: { dispositivoId: true } },
    },
  });

  res.status(201).json({
    ...criado,
    dispositivoIds: criado.placasPermitidas.map((p) => p.dispositivoId),
    placasPermitidas: undefined,
  });
});

// PUT /api/cliente/usuarios/:id
router.put('/usuarios/:id', requireResponsavel, async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const id = param(req, 'id');
  const body = req.body as PayloadUsuario;

  const alvo = await prisma.clienteLogin.findFirst({
    where: { id, clienteId, tipo: 'vinculado' },
    select: { id: true, email: true },
  });
  if (!alvo) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  const erro = validarPayload(body, false);
  if (erro) {
    res.status(400).json({ error: erro });
    return;
  }

  if (body.email && body.email !== alvo.email) {
    const emailEmUsoCliente = await prisma.clienteLogin.findFirst({
      where: { email: body.email, id: { not: id } },
    });
    const emailEmUsoUser = await prisma.user.findUnique({ where: { email: body.email } });
    if (emailEmUsoCliente || emailEmUsoUser) {
      res.status(409).json({ error: 'Este email já está em uso no sistema.' });
      return;
    }
  }

  const dispositivoIds = Array.isArray(body.dispositivoIds) ? body.dispositivoIds : undefined;
  if (dispositivoIds) {
    const check = await validarDispositivos(clienteId, dispositivoIds);
    if (!check.ok) {
      res.status(400).json({ error: check.erro });
      return;
    }
  }

  const cpfCnpj = normalizarCpfCnpj(body.cpfCnpj);
  if (cpfCnpj && (await cpfCnpjEmUso(cpfCnpj, id))) {
    res.status(409).json({ error: 'Este CPF/CNPJ já está em uso no sistema.' });
    return;
  }

  const data: Record<string, unknown> = {};
  if (body.email) data.email = body.email;
  if (body.senha) data.senhaHash = await bcrypt.hash(body.senha, 10);
  if (body.nome !== undefined) data.nome = body.nome?.trim() || null;
  if (body.perfil !== undefined) data.perfil = body.perfil ?? null;
  if (cpfCnpj !== undefined) data.cpfCnpj = cpfCnpj;
  if (body.permissoes !== undefined) {
    data.permissoes = normalizarPermissoes(body.permissoes) as unknown as object;
  }

  await prisma.$transaction(async (tx) => {
    await tx.clienteLogin.update({ where: { id }, data });
    if (dispositivoIds) {
      await tx.clienteLoginPlaca.deleteMany({ where: { clienteLoginId: id } });
      if (dispositivoIds.length > 0) {
        await tx.clienteLoginPlaca.createMany({
          data: dispositivoIds.map((dispositivoId) => ({ clienteLoginId: id, dispositivoId })),
        });
      }
    }
  });

  const atualizado = await prisma.clienteLogin.findUnique({
    where: { id },
    select: {
      id: true, email: true, nome: true, ativo: true, perfil: true, cpfCnpj: true,
      permissoes: true, updatedAt: true,
      placasPermitidas: { select: { dispositivoId: true } },
    },
  });
  res.json({
    ...atualizado!,
    dispositivoIds: atualizado!.placasPermitidas.map((p) => p.dispositivoId),
    placasPermitidas: undefined,
  });
});

// PATCH /api/cliente/usuarios/:id/status — toggle ativo
router.patch('/usuarios/:id/status', requireResponsavel, async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const id = param(req, 'id');

  const alvo = await prisma.clienteLogin.findFirst({
    where: { id, clienteId, tipo: 'vinculado' },
    select: { id: true, ativo: true },
  });
  if (!alvo) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  const atualizado = await prisma.clienteLogin.update({
    where: { id },
    data: { ativo: !alvo.ativo },
    select: { id: true, email: true, ativo: true },
  });
  res.json(atualizado);
});

// DELETE /api/cliente/usuarios/:id
router.delete('/usuarios/:id', requireResponsavel, async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const id = param(req, 'id');

  const alvo = await prisma.clienteLogin.findFirst({
    where: { id, clienteId, tipo: 'vinculado' },
    select: { id: true },
  });
  if (!alvo) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  await prisma.clienteLogin.delete({ where: { id } });
  res.status(204).send();
});

// GET /api/cliente/usuarios-dispositivos — dispositivos disponíveis para vincular ao sub-usuário
// (todos os dispositivos ativos do cliente). Helper exclusivo da tela Usuários.
router.get('/usuarios-dispositivos', requireResponsavel, async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivos = await prisma.dispositivo.findMany({
    where: { clienteId, ativo: true },
    select: {
      id: true,
      nome: true,
      placa: true,
      apelidoCliente: true,
    },
    orderBy: { nome: 'asc' },
  });
  res.json(dispositivos);
});

export default router;
