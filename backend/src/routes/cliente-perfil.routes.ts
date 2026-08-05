import { Router, Response } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { ClienteRequest, clienteAuthMiddleware } from '../middleware/cliente-auth.middleware';
import { CLIENTE_AVATAR_UPLOADS_DIR, CLIENTE_LOGO_UPLOADS_DIR, UPLOADS_DIR } from '../utils/upload-paths';
import { cifrarSenha } from '../utils/senha-cifrada';

const router = Router();
router.use(clienteAuthMiddleware);

// Mesmo mínimo cobrado no cadastro de sub-usuários (cliente-usuarios.routes.ts).
const SENHA_MIN_CARACTERES = 6;

const uploadDir = CLIENTE_AVATAR_UPLOADS_DIR;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(CLIENTE_LOGO_UPLOADS_DIR)) {
  fs.mkdirSync(CLIENTE_LOGO_UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const uploadAvatar = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Apenas imagens são permitidas'));
    }
    cb(null, true);
  },
});

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

// GET /api/cliente/perfil
// Retorna os dados do perfil do cliente autenticado
router.get('/', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const clienteLoginId = req.cliente!.sub;
    const clienteLogin = await prisma.clienteLogin.findUnique({
      where: { id: clienteLoginId },
      include: {
        cliente: {
          select: {
            nome: true,
            email: true,
            telefone: true,
            cpfCnpj: true,
            multasHabilitado: true,
          }
        }
      }
    });

    if (!clienteLogin) {
      res.status(404).json({ error: 'Login não encontrado' });
      return;
    }

    const { cliente } = clienteLogin;

    // Busca veículos de faturamento
    const faturamentoDispositivos = await prisma.dispositivo.findMany({
      where: { clienteId: clienteLogin.clienteId, ativo: true },
      select: { id: true, nome: true, placa: true }
    });

    // Busca veículos vinculados
    const vinculados = await prisma.dispositivoCliente.findMany({
      where: { clienteId: clienteLogin.clienteId },
      include: {
        dispositivo: {
          select: { id: true, nome: true, placa: true, ativo: true }
        }
      }
    });

    const vinculadoDispositivos = vinculados
      .filter(v => v.dispositivo.ativo)
      .map(v => v.dispositivo);

    res.json({
      id: clienteLogin.id,
      nome: cliente.nome,
      email: clienteLogin.email, // Email de login
      telefone: cliente.telefone,
      cpfCnpj: cliente.cpfCnpj,
      avatarUrl: clienteLogin.avatarUrl,
      logoUrl: clienteLogin.logoUrl,
      veiculosFaturamento: faturamentoDispositivos,
      veiculosVinculados: vinculadoDispositivos,
      multasHabilitado: cliente.multasHabilitado,
    });
  } catch (error) {
    console.error('[Perfil Cliente] Erro ao buscar perfil:', error);
    res.status(500).json({ error: 'Erro ao buscar dados do perfil' });
  }
});

// POST /api/cliente/perfil/avatar
// Faz upload de uma nova foto de avatar e atualiza o banco de dados
router.post('/avatar', uploadAvatar.single('avatar'), async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const clienteLoginId = req.cliente!.sub;

    if (!req.file) {
      res.status(400).json({ error: 'Nenhum arquivo enviado' });
      return;
    }

    const clienteLogin = await prisma.clienteLogin.findUnique({
      where: { id: clienteLoginId },
      select: { avatarUrl: true }
    });

    if (!clienteLogin) {
      fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'Login não encontrado' });
      return;
    }

    const novaAvatarUrl = `/uploads/cliente-avatar/${req.file.filename}`;

    // Atualiza no banco
    await prisma.clienteLogin.update({
      where: { id: clienteLoginId },
      data: { avatarUrl: novaAvatarUrl },
    });

    // Deleta o avatar antigo, se existir
    if (clienteLogin.avatarUrl) {
      try {
        const oldPath = path.join(UPLOADS_DIR, clienteLogin.avatarUrl.replace(/^\/uploads\//, ''));
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      } catch (err) {
        console.error('[Perfil Cliente] Erro ao deletar avatar antigo:', err);
      }
    }

    res.json({ message: 'Avatar atualizado com sucesso', avatarUrl: novaAvatarUrl });
  } catch (error: any) {
    console.error('[Perfil Cliente] Erro ao fazer upload de avatar:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ error: error.message || 'Erro ao processar o upload' });
  }
});

// POST /api/cliente/perfil/logo
router.post('/logo', uploadLogo.single('logo'), async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const clienteLoginId = req.cliente!.sub;

    if (!req.file) {
      res.status(400).json({ error: 'Nenhum arquivo enviado' });
      return;
    }

    const clienteLogin = await prisma.clienteLogin.findUnique({
      where: { id: clienteLoginId },
      select: { logoUrl: true },
    });

    if (!clienteLogin) {
      fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'Login não encontrado' });
      return;
    }

    const novaLogoUrl = `/uploads/cliente-logo/${req.file.filename}`;

    await prisma.clienteLogin.update({
      where: { id: clienteLoginId },
      data: { logoUrl: novaLogoUrl },
    });

    if (clienteLogin.logoUrl) {
      try {
        const oldPath = path.join(UPLOADS_DIR, clienteLogin.logoUrl.replace(/^\/uploads\//, ''));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      } catch (_) {}
    }

    res.json({ logoUrl: novaLogoUrl });
  } catch (error: any) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(400).json({ error: error.message || 'Erro ao processar o upload' });
  }
});

// DELETE /api/cliente/perfil/logo
router.delete('/logo', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const clienteLoginId = req.cliente!.sub;

    const clienteLogin = await prisma.clienteLogin.findUnique({
      where: { id: clienteLoginId },
      select: { logoUrl: true },
    });

    if (!clienteLogin) {
      res.status(404).json({ error: 'Login não encontrado' });
      return;
    }

    if (clienteLogin.logoUrl) {
      try {
        const oldPath = path.join(UPLOADS_DIR, clienteLogin.logoUrl.replace(/^\/uploads\//, ''));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      } catch (_) {}
    }

    await prisma.clienteLogin.update({
      where: { id: clienteLoginId },
      data: { logoUrl: null },
    });

    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao remover logo' });
  }
});

// PATCH /api/cliente/perfil/senha
// Troca a senha do PRÓPRIO login. Sem `requireResponsavel` de propósito: o
// sub-usuário vinculado não enxerga a tela de Usuários e não teria outro caminho
// para trocar a própria senha.
router.patch('/senha', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const clienteLoginId = req.cliente!.sub;
    const senhaAtual = typeof req.body?.senhaAtual === 'string' ? req.body.senhaAtual : '';
    const novaSenha = typeof req.body?.novaSenha === 'string' ? req.body.novaSenha : '';

    if (!senhaAtual || !novaSenha) {
      res.status(400).json({ error: 'Informe a senha atual e a nova senha.' });
      return;
    }
    if (novaSenha.length < SENHA_MIN_CARACTERES) {
      res.status(400).json({ error: `A nova senha deve ter pelo menos ${SENHA_MIN_CARACTERES} caracteres.` });
      return;
    }
    if (novaSenha === senhaAtual) {
      res.status(400).json({ error: 'A nova senha deve ser diferente da atual.' });
      return;
    }

    const clienteLogin = await prisma.clienteLogin.findUnique({
      where: { id: clienteLoginId },
      select: { senhaHash: true },
    });
    if (!clienteLogin) {
      res.status(404).json({ error: 'Login não encontrado' });
      return;
    }

    const confere = await bcrypt.compare(senhaAtual, clienteLogin.senhaHash);
    if (!confere) {
      res.status(400).json({ error: 'A senha atual não confere.' });
      return;
    }

    await prisma.clienteLogin.update({
      where: { id: clienteLoginId },
      data: {
        senhaHash: await bcrypt.hash(novaSenha, 10),
        // Espelho reversível que o admin consulta na ficha do cliente — sem isso ele
        // continuaria vendo a senha antiga.
        senhaCifrada: cifrarSenha(novaSenha),
      },
    });

    // O token continua válido: trocar a senha não desloga a sessão em uso.
    res.json({ ok: true });
  } catch (error) {
    console.error('[Perfil Cliente] Erro ao alterar senha:', error);
    res.status(500).json({ error: 'Erro ao alterar a senha' });
  }
});

export default router;

