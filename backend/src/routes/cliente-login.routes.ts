import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import { param } from '../utils/params';
import prisma from '../utils/prisma';
import { CLIENTE_LOGO_UPLOADS_DIR, UPLOADS_DIR } from '../utils/upload-paths';

const router = Router();
router.use(authMiddleware);
router.use(requireRoles('ADMIN', 'COLABORADOR'));

if (!fs.existsSync(CLIENTE_LOGO_UPLOADS_DIR)) {
  fs.mkdirSync(CLIENTE_LOGO_UPLOADS_DIR, { recursive: true });
}

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CLIENTE_LOGO_UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Apenas imagens são permitidas'));
    }
    cb(null, true);
  },
});

// ── GET /api/clientes/:id/login ───────────────────────────────────────────────
// Retorna o login 'responsavel' do cliente (login primário cadastrado pelo admin).
// Sub-usuários ('vinculado') são gerenciados pelo próprio cliente via portal.
router.get('/:id/login', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const login = await prisma.clienteLogin.findFirst({
    where: { clienteId: id, tipo: 'responsavel' },
    select: { id: true, email: true, ativo: true, logoUrl: true, createdAt: true, updatedAt: true },
  });

  res.json(login || null);
});

// ── POST /api/clientes/:id/login ──────────────────────────────────────────────
router.post('/:id/login', async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && req.user!.podeCriarLoginCliente === false) {
    res.status(403).json({ error: 'Sem permissão para criar login de cliente.' });
    return;
  }

  const id = param(req, 'id');
  const { email, senha } = req.body as { email: string; senha: string };

  if (!email || !senha) {
    res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    return;
  }
  if (senha.length < 6) {
    res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    return;
  }

  const cliente = await prisma.cliente.findUnique({ where: { id }, select: { id: true } });
  if (!cliente) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  const existente = await prisma.clienteLogin.findFirst({
    where: { clienteId: id, tipo: 'responsavel' },
  });
  if (existente) {
    res.status(409).json({ error: 'Este cliente já possui login cadastrado.' });
    return;
  }

  const emailEmUsoCliente = await prisma.clienteLogin.findUnique({ where: { email } });
  const emailEmUsoUser = await prisma.user.findUnique({ where: { email } });
  if (emailEmUsoCliente || emailEmUsoUser) {
    res.status(409).json({ error: 'Este email já está em uso no sistema.' });
    return;
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  const login = await prisma.clienteLogin.create({
    data: { clienteId: id, email, senhaHash, tipo: 'responsavel' },
    select: { id: true, email: true, ativo: true, logoUrl: true, createdAt: true },
  });

  res.status(201).json(login);
});

// ── PUT /api/clientes/:id/login ───────────────────────────────────────────────
router.put('/:id/login', async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && req.user!.podeEditarLoginCliente === false) {
    res.status(403).json({ error: 'Sem permissão para editar login de cliente.' });
    return;
  }

  const id = param(req, 'id');
  const { email, senha } = req.body as { email?: string; senha?: string };

  const login = await prisma.clienteLogin.findFirst({
    where: { clienteId: id, tipo: 'responsavel' },
  });
  if (!login) {
    res.status(404).json({ error: 'Login não encontrado para este cliente.' });
    return;
  }

  if (email && email !== login.email) {
    const emailEmUsoCliente = await prisma.clienteLogin.findFirst({
      where: { email, id: { not: login.id } },
    });
    const emailEmUsoUser = await prisma.user.findUnique({ where: { email } });
    if (emailEmUsoCliente || emailEmUsoUser) {
      res.status(409).json({ error: 'Este email já está em uso no sistema.' });
      return;
    }
  }
  if (senha && senha.length < 6) {
    res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    return;
  }

  const data: Record<string, unknown> = {};
  if (email) data.email = email;
  if (senha) data.senhaHash = await bcrypt.hash(senha, 10);

  const updated = await prisma.clienteLogin.update({
    where: { id: login.id },
    data,
    select: { id: true, email: true, ativo: true, logoUrl: true, updatedAt: true },
  });

  res.json(updated);
});

// ── POST /api/clientes/:id/login/logo ────────────────────────────────────────
router.post('/:id/login/logo', uploadLogo.single('logo'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && req.user!.podeEditarLoginCliente === false) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(403).json({ error: 'Sem permissão para editar login de cliente.' });
    return;
  }

  const id = param(req, 'id');

  if (!req.file) {
    res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    return;
  }

  const login = await prisma.clienteLogin.findFirst({
    where: { clienteId: id, tipo: 'responsavel' },
    select: { id: true, logoUrl: true },
  });

  if (!login) {
    fs.unlinkSync(req.file.path);
    res.status(404).json({ error: 'Login não encontrado para este cliente.' });
    return;
  }

  const novaLogoUrl = `/uploads/cliente-logo/${req.file.filename}`;

  await prisma.clienteLogin.update({
    where: { id: login.id },
    data: { logoUrl: novaLogoUrl },
  });

  if (login.logoUrl) {
    try {
      const oldPath = path.join(UPLOADS_DIR, login.logoUrl.replace(/^\/uploads\//, ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch (_) {}
  }

  res.json({ logoUrl: novaLogoUrl });
});

// ── DELETE /api/clientes/:id/login/logo ──────────────────────────────────────
router.delete('/:id/login/logo', async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && req.user!.podeEditarLoginCliente === false) {
    res.status(403).json({ error: 'Sem permissão para editar login de cliente.' });
    return;
  }

  const id = param(req, 'id');
  const login = await prisma.clienteLogin.findFirst({
    where: { clienteId: id, tipo: 'responsavel' },
    select: { id: true, logoUrl: true },
  });

  if (!login) {
    res.status(404).json({ error: 'Login não encontrado.' });
    return;
  }

  if (login.logoUrl) {
    try {
      const oldPath = path.join(UPLOADS_DIR, login.logoUrl.replace(/^\/uploads\//, ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch (_) {}
  }

  await prisma.clienteLogin.update({
    where: { id: login.id },
    data: { logoUrl: null },
  });

  res.status(204).send();
});

// ── PATCH /api/clientes/:id/login/status ─────────────────────────────────────
router.patch('/:id/login/status', async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && req.user!.podeInativarLoginCliente === false) {
    res.status(403).json({ error: 'Sem permissão para ativar/inativar login de cliente.' });
    return;
  }

  const id = param(req, 'id');
  const login = await prisma.clienteLogin.findFirst({
    where: { clienteId: id, tipo: 'responsavel' },
  });
  if (!login) {
    res.status(404).json({ error: 'Login não encontrado.' });
    return;
  }

  const updated = await prisma.clienteLogin.update({
    where: { id: login.id },
    data: { ativo: !login.ativo },
    select: { id: true, email: true, ativo: true },
  });

  res.json(updated);
});

// ── DELETE /api/clientes/:id/login ────────────────────────────────────────────
router.delete('/:id/login', async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && req.user!.podeExcluirLoginCliente === false) {
    res.status(403).json({ error: 'Sem permissão para excluir login de cliente.' });
    return;
  }

  const id = param(req, 'id');
  const login = await prisma.clienteLogin.findFirst({
    where: { clienteId: id, tipo: 'responsavel' },
  });
  if (!login) {
    res.status(404).json({ error: 'Login não encontrado.' });
    return;
  }

  if (login.logoUrl) {
    try {
      const oldPath = path.join(UPLOADS_DIR, login.logoUrl.replace(/^\/uploads\//, ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch (_) {}
  }

  // Apaga todos os logins (responsável + sub-usuários) deste cliente.
  // Sem o responsável, sub-usuários ficam sem gestor — preferimos remover juntos.
  await prisma.clienteLogin.deleteMany({ where: { clienteId: id } });
  res.status(204).send();
});

export default router;
