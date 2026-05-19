import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { param, query } from '../utils/params';

const router = Router();
router.use(authMiddleware);

const RESGATE_SELECT = {
  id: true,
  nome: true,
  email: true,
  role: true,
  ativo: true,
  createdAt: true,
  _count: { select: { dispositivosResgate: true } },
} as const;

// GET /api/usuarios-resgate — lista todos
router.get(
  '/usuarios-resgate',
  requireRoles('ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const busca = query(req.query.busca);
    const lista = await prisma.user.findMany({
      where: {
        role: 'RESGATE',
        ...(busca
          ? {
              OR: [
                { nome: { contains: busca, mode: 'insensitive' } },
                { email: { contains: busca, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: RESGATE_SELECT,
      orderBy: { nome: 'asc' },
    });
    res.json(lista);
  }
);

// GET /api/usuarios-resgate/:id — detalhe com dispositivos atribuídos
router.get(
  '/usuarios-resgate/:id',
  requireRoles('ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const id = param(req, 'id');
    const usuario = await prisma.user.findFirst({
      where: { id, role: 'RESGATE' },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        ativo: true,
        createdAt: true,
        dispositivosResgate: {
          select: {
            dispositivoId: true,
            tagId: true,
            dispositivo: {
              select: {
                id: true,
                nome: true,
                placa: true,
                identificador: true,
                enderecoMac: true,
              },
            },
            tag: {
              select: {
                id: true,
                apelido: true,
                mac: true,
                nomeBleAdvertised: true,
              },
            },
          },
        },
      },
    });
    if (!usuario) {
      res.status(404).json({ error: 'Usuário de resgate não encontrado.' });
      return;
    }
    res.json(usuario);
  }
);

// POST /api/usuarios-resgate — cria usuário + atribui dispositivos/tags
router.post(
  '/usuarios-resgate',
  requireRoles('ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { nome, email, senha, dispositivos } = req.body as {
      nome?: string;
      email?: string;
      senha?: string;
      dispositivos?: Array<{ dispositivoId: string; tagId?: string | null }>;
    };

    if (!nome || !email || !senha) {
      res.status(400).json({ error: 'nome, email e senha são obrigatórios.' });
      return;
    }

    const emUsoUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    const emUsoCliente = await prisma.clienteLogin.findUnique({
      where: { email },
      select: { id: true },
    });
    if (emUsoUser || emUsoCliente) {
      res.status(400).json({ error: 'E-mail já cadastrado no sistema.' });
      return;
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const usuario = await prisma.user.create({
      data: {
        nome,
        email,
        senhaHash,
        role: 'RESGATE',
        ...(Array.isArray(dispositivos) && dispositivos.length > 0
          ? {
              dispositivosResgate: {
                create: dispositivos.map((d) => ({
                  dispositivoId: d.dispositivoId,
                  tagId: d.tagId ?? null,
                })),
              },
            }
          : {}),
      },
      select: RESGATE_SELECT,
    });
    res.status(201).json(usuario);
  }
);

// PUT /api/usuarios-resgate/:id — edita (nome, email, senha opcional, dispositivos)
router.put(
  '/usuarios-resgate/:id',
  requireRoles('ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const id = param(req, 'id');
    const { nome, email, senha, dispositivos } = req.body as {
      nome?: string;
      email?: string;
      senha?: string;
      dispositivos?: Array<{ dispositivoId: string; tagId?: string | null }>;
    };

    const existe = await prisma.user.findFirst({
      where: { id, role: 'RESGATE' },
      select: { id: true },
    });
    if (!existe) {
      res.status(404).json({ error: 'Usuário de resgate não encontrado.' });
      return;
    }

    if (email) {
      const emUsoUser = await prisma.user.findFirst({
        where: { email, NOT: { id } },
        select: { id: true },
      });
      const emUsoCliente = await prisma.clienteLogin.findUnique({
        where: { email },
        select: { id: true },
      });
      if (emUsoUser || emUsoCliente) {
        res.status(400).json({ error: 'E-mail já cadastrado no sistema.' });
        return;
      }
    }

    const data: Record<string, unknown> = {};
    if (nome) data.nome = nome;
    if (email) data.email = email;
    if (senha) data.senhaHash = await bcrypt.hash(senha, 10);

    // Atualiza atribuições de dispositivos em transação se fornecido
    if (Array.isArray(dispositivos)) {
      await prisma.$transaction([
        prisma.usuarioResgateDispositivo.deleteMany({ where: { usuarioId: id } }),
        ...(dispositivos.length > 0
          ? [
              prisma.usuarioResgateDispositivo.createMany({
                data: dispositivos.map((d) => ({
                  usuarioId: id,
                  dispositivoId: d.dispositivoId,
                  tagId: d.tagId ?? null,
                })),
              }),
            ]
          : []),
        prisma.user.update({ where: { id }, data }),
      ]);
    } else {
      await prisma.user.update({ where: { id }, data });
    }

    const usuario = await prisma.user.findUnique({
      where: { id },
      select: RESGATE_SELECT,
    });
    res.json(usuario);
  }
);

// PATCH /api/usuarios-resgate/:id/status — toggle ativo
router.patch(
  '/usuarios-resgate/:id/status',
  requireRoles('ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const id = param(req, 'id');
    const existe = await prisma.user.findFirst({
      where: { id, role: 'RESGATE' },
      select: { id: true, ativo: true },
    });
    if (!existe) {
      res.status(404).json({ error: 'Usuário de resgate não encontrado.' });
      return;
    }
    const usuario = await prisma.user.update({
      where: { id },
      data: { ativo: !existe.ativo },
      select: { id: true, nome: true, ativo: true },
    });
    res.json(usuario);
  }
);

// DELETE /api/usuarios-resgate/:id
router.delete(
  '/usuarios-resgate/:id',
  requireRoles('ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const id = param(req, 'id');
    const existe = await prisma.user.findFirst({
      where: { id, role: 'RESGATE' },
      select: { id: true },
    });
    if (!existe) {
      res.status(404).json({ error: 'Usuário de resgate não encontrado.' });
      return;
    }
    // cascade já apaga UsuarioResgateDispositivo via onDelete: Cascade
    await prisma.user.delete({ where: { id } });
    res.status(204).send();
  }
);

export default router;
