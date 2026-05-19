import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { signToken, signClienteToken } from '../utils/jwt';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// POST /api/auth/login — login unificado (admin/colaborador/vendedor/cliente)
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    return;
  }

  // 1. Tentar como User (admin / colaborador / vendedor)
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    if (!user.ativo) {
      res.status(401).json({ error: 'Usuário inativo. Contate o administrador.' });
      return;
    }
    if (user.role === 'RESGATE') {
      res.status(403).json({ error: 'Usuário de resgate só pode acessar pelo aplicativo.' });
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
      payload.podeCriarContrato      = user.podeCriarContrato;
      payload.podeEditarContrato     = user.podeEditarContrato;
      payload.podeExcluirContrato    = user.podeExcluirContrato;
      payload.podeAcessarMonitoramento = user.podeAcessarMonitoramento;
      payload.podeCriarLoginCliente    = user.podeCriarLoginCliente;
      payload.podeEditarLoginCliente   = user.podeEditarLoginCliente;
      payload.podeInativarLoginCliente = user.podeInativarLoginCliente;
      payload.podeExcluirLoginCliente  = user.podeExcluirLoginCliente;
    }
    const token = signToken(payload);
    res.json({ token, user: { id: user.id, nome: user.nome, email: user.email, role: user.role } });
    return;
  }

  // 2. Tentar como ClienteLogin (portal do cliente)
  const clienteLogin = await prisma.clienteLogin.findUnique({
    where: { email },
    include: {
      cliente: { select: { id: true, nome: true, status: true } },
    },
  });

  if (clienteLogin) {
    if (!clienteLogin.ativo) {
      res.status(401).json({ error: 'Acesso inativo. Contate o administrador.' });
      return;
    }
    if (clienteLogin.cliente.status !== 'ATIVO') {
      res.status(401).json({ error: 'Cliente inativo. Contate o administrador.' });
      return;
    }
    const senhaValida = await bcrypt.compare(senha, clienteLogin.senhaHash);
    if (!senhaValida) {
      res.status(401).json({ error: 'Credenciais inválidas.' });
      return;
    }

    const tipo: 'responsavel' | 'vinculado' =
      clienteLogin.tipo === 'vinculado' ? 'vinculado' : 'responsavel';

    // Sub-usuário usa o nome próprio (se cadastrado); responsável usa o nome do cliente.
    const nomeExibicao = (tipo === 'vinculado' && clienteLogin.nome)
      ? clienteLogin.nome
      : clienteLogin.cliente.nome;

    const token = signClienteToken({
      sub: clienteLogin.id,
      clienteId: clienteLogin.cliente.id,
      role: 'CLIENTE',
      tipo,
      nome: nomeExibicao,
    });

    res.json({
      token,
      user: { id: clienteLogin.cliente.id, nome: nomeExibicao, email: clienteLogin.email, role: 'CLIENTE', tipo },
    });
    return;
  }

  res.status(401).json({ error: 'Credenciais inválidas.' });
});

// POST /api/auth/login-app — login unificado para o aplicativo móvel
// Aceita: User (ADMIN, RESGATE) e ClienteLogin (CLIENTE)
// Retorna `tipoSessao` para o app rotear pra tela correta
router.post('/login-app', async (req: Request, res: Response): Promise<void> => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    return;
  }

  // 1. Tentar como User (ADMIN para parear tags, RESGATE para resgate)
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    if (!user.ativo) {
      res.status(401).json({ error: 'Usuário inativo. Contate o administrador.' });
      return;
    }
    // No app, só ADMIN e RESGATE têm tela útil (COLABORADOR/VENDEDOR usam o site)
    if (user.role !== 'ADMIN' && user.role !== 'RESGATE') {
      res.status(403).json({
        error: 'Este perfil de usuário só pode acessar pelo site (https://agillock.com.br).',
      });
      return;
    }
    const senhaValida = await bcrypt.compare(senha, user.senhaHash);
    if (!senhaValida) {
      res.status(401).json({ error: 'Credenciais inválidas.' });
      return;
    }

    const payload: Parameters<typeof signToken>[0] = {
      userId: user.id,
      role: user.role,
      nome: user.nome,
    };
    const token = signToken(payload);
    const tipoSessao = user.role === 'RESGATE' ? 'resgate' : 'admin';
    res.json({
      token,
      tipoSessao,
      user: { id: user.id, nome: user.nome, email: user.email, role: user.role },
    });
    return;
  }

  // 2. Tentar como ClienteLogin (portal do cliente)
  const clienteLogin = await prisma.clienteLogin.findUnique({
    where: { email },
    include: {
      cliente: { select: { id: true, nome: true, status: true } },
    },
  });

  if (clienteLogin) {
    if (!clienteLogin.ativo) {
      res.status(401).json({ error: 'Acesso inativo. Contate o administrador.' });
      return;
    }
    if (clienteLogin.cliente.status !== 'ATIVO') {
      res.status(401).json({ error: 'Cliente inativo. Contate o administrador.' });
      return;
    }
    const senhaValida = await bcrypt.compare(senha, clienteLogin.senhaHash);
    if (!senhaValida) {
      res.status(401).json({ error: 'Credenciais inválidas.' });
      return;
    }

    const tipo: 'responsavel' | 'vinculado' =
      clienteLogin.tipo === 'vinculado' ? 'vinculado' : 'responsavel';

    const nomeExibicao =
      tipo === 'vinculado' && clienteLogin.nome ? clienteLogin.nome : clienteLogin.cliente.nome;

    const token = signClienteToken({
      sub: clienteLogin.id,
      clienteId: clienteLogin.cliente.id,
      role: 'CLIENTE',
      tipo,
      nome: nomeExibicao,
    });

    res.json({
      token,
      tipoSessao: 'cliente',
      user: {
        id: clienteLogin.cliente.id,
        nome: nomeExibicao,
        email: clienteLogin.email,
        role: 'CLIENTE',
        tipo,
      },
    });
    return;
  }

  res.status(401).json({ error: 'Credenciais inválidas.' });
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

// POST /api/auth/cliente — mantido por compatibilidade, delega para /login
router.post('/cliente', async (req: Request, res: Response): Promise<void> => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    return;
  }

  const login = await prisma.clienteLogin.findUnique({
    where: { email },
    include: {
      cliente: { select: { id: true, nome: true, status: true } },
    },
  });

  if (!login || !login.ativo || login.cliente.status !== 'ATIVO') {
    res.status(401).json({ error: 'Credenciais inválidas ou acesso inativo.' });
    return;
  }

  const senhaValida = await bcrypt.compare(senha, login.senhaHash);
  if (!senhaValida) {
    res.status(401).json({ error: 'Credenciais inválidas.' });
    return;
  }

  const tipo: 'responsavel' | 'vinculado' =
    login.tipo === 'vinculado' ? 'vinculado' : 'responsavel';

  const nomeExibicao = (tipo === 'vinculado' && login.nome) ? login.nome : login.cliente.nome;

  const token = signClienteToken({
    sub: login.id,
    clienteId: login.cliente.id,
    role: 'CLIENTE',
    tipo,
    nome: nomeExibicao,
  });

  res.json({
    token,
    cliente: { id: login.cliente.id, nome: nomeExibicao, tipo },
  });
});

export default router;
