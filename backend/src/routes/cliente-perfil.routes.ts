import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { ClienteRequest, clienteAuthMiddleware } from '../middleware/cliente-auth.middleware';
import { CLIENTE_AVATAR_UPLOADS_DIR, UPLOADS_DIR } from '../utils/upload-paths';

const router = Router();
router.use(clienteAuthMiddleware);

const uploadDir = CLIENTE_AVATAR_UPLOADS_DIR;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
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
      veiculosFaturamento: faturamentoDispositivos,
      veiculosVinculados: vinculadoDispositivos,
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

export default router;
