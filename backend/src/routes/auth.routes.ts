import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { signToken } from '../utils/jwt';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.ativo) {
    res.status(401).json({ error: 'Credenciais inválidas.' });
    return;
  }

  const senhaValida = await bcrypt.compare(senha, user.senhaHash);
  if (!senhaValida) {
    res.status(401).json({ error: 'Credenciais inválidas.' });
    return;
  }

  const payload: Parameters<typeof signToken>[0] = { userId: user.id, role: user.role, nome: user.nome };
  if (user.role === 'COLABORADOR') {
    payload.podeExcluirCliente    = user.podeExcluirCliente;
    payload.podeEditarCliente     = user.podeEditarCliente;
    payload.podeInativarCliente   = user.podeInativarCliente;
    payload.podeExcluirPlaca        = user.podeExcluirPlaca;
    payload.podeInativarPlaca       = user.podeInativarPlaca;
    payload.podeExcluirDispositivo      = user.podeExcluirDispositivo;
    payload.podeInativarDispositivo     = user.podeInativarDispositivo;
    payload.podeCriarDispositivo        = user.podeCriarDispositivo;
    payload.podeEditarDispositivo       = user.podeEditarDispositivo;
    payload.podeDesvincularDispositivo  = user.podeDesvincularDispositivo;
    payload.podeBaixaManual         = user.podeBaixaManual;
    payload.podeCancelarCarne     = user.podeCancelarCarne;
    payload.podeAlterarVencimento = user.podeAlterarVencimento;
  }
  const token = signToken(payload);

  res.json({
    token,
    user: { id: user.id, nome: user.nome, email: user.email, role: user.role },
  });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req: AuthRequest, res: Response): void => {
  res.json({ user: req.user });
});

// PATCH /api/auth/change-password
router.patch('/change-password', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const { senhaAtual, senhaNova } = req.body;

  if (!senhaAtual || !senhaNova) {
    res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias.' });
    return;
  }

  if (senhaNova.length < 6) {
    res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }

  const senhaValida = await bcrypt.compare(senhaAtual, user.senhaHash);
  if (!senhaValida) {
    res.status(400).json({ error: 'Senha atual incorreta.' });
    return;
  }

  const senhaHash = await bcrypt.hash(senhaNova, 10);
  await prisma.user.update({ where: { id: user.id }, data: { senhaHash } });

  res.json({ message: 'Senha alterada com sucesso.' });
});

export default router;
