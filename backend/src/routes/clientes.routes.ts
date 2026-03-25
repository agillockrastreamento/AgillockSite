import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { param, query } from '../utils/params';

const router = Router();
router.use(authMiddleware);

// GET /api/clientes
router.get('/', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const busca = query(req.query.busca);
  const status = query(req.query.status) as 'ATIVO' | 'INATIVO' | undefined;
  const vendedorId = query(req.query.vendedorId);

  const clientes = await prisma.cliente.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(vendedorId ? { vendedorId } : {}),
      ...(busca ? {
        OR: [
          { nome: { contains: busca, mode: 'insensitive' } },
          { cpfCnpj: { contains: busca, mode: 'insensitive' } },
          { telefone: { contains: busca, mode: 'insensitive' } },
          { placas: { some: { placa: { contains: busca, mode: 'insensitive' } } } },
        ],
      } : {}),
    },
    include: {
      vendedor: { select: { id: true, nome: true } },
      criadoPor: { select: { id: true, nome: true } },
      placas: { where: { ativo: true }, select: { id: true, placa: true, descricao: true } },
      dispositivos: { select: { id: true, nome: true, identificador: true, placa: true, categoria: true, ativo: true } },
      _count: { select: { dispositivosVinculados: true } },
    },
    orderBy: { nome: 'asc' },
  });

  res.json(clientes);
});

// GET /api/clientes/:id
router.get('/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const cliente = await prisma.cliente.findUnique({
    where: { id },
    include: {
      vendedor: { select: { id: true, nome: true } },
      criadoPor: { select: { id: true, nome: true } },
      placas: { orderBy: { placa: 'asc' } },
      dispositivos: { orderBy: { nome: 'asc' } },
      carnes: {
        include: {
          boletos: {
            orderBy: { numeroParcela: 'asc' },
            include: {
              placasUnificadas: { select: { placaId: true, valorPlaca: true } },
              dispositivosUnificados: { select: { dispositivoId: true, valorDispositivo: true } },
            },
          },
          geradoPor: { select: { id: true, nome: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!cliente) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  res.json(cliente);
});

// GET /api/clientes/:id/carnes
router.get('/:id/carnes', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const existe = await prisma.cliente.findUnique({ where: { id }, select: { id: true } });
  if (!existe) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  const carnes = await prisma.carne.findMany({
    where: { clienteId: id },
    include: {
      boletos: {
        orderBy: { numeroParcela: 'asc' },
        include: {
          placa: { select: { id: true, placa: true } },
          dispositivo: { select: { id: true, nome: true, identificador: true, placa: true } },
          placasUnificadas: {
            include: { placa: { select: { id: true, placa: true } } },
          },
          dispositivosUnificados: {
            include: { dispositivo: { select: { id: true, nome: true, identificador: true, placa: true } } },
          },
        },
      },
      geradoPor: { select: { id: true, nome: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(carnes);
});

// POST /api/clientes
router.post('/', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    nome, cpfCnpj, telefone, email, notas, vendedorId,
    cep, logradouro, numero, complemento, bairro, cidade, estado,
    dataNascimento, rg, profissao, estadoCivil,
    tipoPessoa, nirc, emailCobranca, origemCliente, socios,
  } = req.body;

  if (!nome) {
    res.status(400).json({ error: 'O nome do cliente é obrigatório.' });
    return;
  }
  if (!cep || !logradouro || !numero || !bairro || !cidade || !estado) {
    res.status(400).json({ error: 'Endereço completo é obrigatório (CEP, logradouro, número, bairro, cidade e UF).' });
    return;
  }

  const cliente = await prisma.cliente.create({
    data: {
      nome, cpfCnpj, telefone, email, notas,
      dataNascimento: dataNascimento || null,
      rg: rg || null,
      profissao: profissao || null,
      estadoCivil: estadoCivil || null,
      tipoPessoa: tipoPessoa || 'PF',
      nirc: nirc || null,
      emailCobranca: emailCobranca || null,
      origemCliente: origemCliente || null,
      socios: socios ?? null,
      vendedorId: vendedorId || null,
      cep, logradouro, numero, complemento, bairro, cidade, estado,
      criadoPorId: req.user!.userId,
    },
    include: {
      vendedor: { select: { id: true, nome: true } },
      criadoPor: { select: { id: true, nome: true } },
      placas: true,
    },
  });

  res.status(201).json(cliente);
});

// PUT /api/clientes/:id
router.put('/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeEditarCliente) {
    res.status(403).json({ error: 'Sem permissão para editar clientes.' });
    return;
  }
  const id = param(req, 'id');
  const {
    nome, cpfCnpj, telefone, email, notas, vendedorId,
    cep, logradouro, numero, complemento, bairro, cidade, estado,
    dataNascimento, rg, profissao, estadoCivil,
    tipoPessoa, nirc, emailCobranca, origemCliente, socios,
  } = req.body;

  const existe = await prisma.cliente.findUnique({ where: { id }, select: { id: true } });
  if (!existe) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  const cliente = await prisma.cliente.update({
    where: { id },
    data: {
      nome, cpfCnpj, telefone, email, notas,
      dataNascimento: dataNascimento || null,
      rg: rg || null,
      profissao: profissao || null,
      estadoCivil: estadoCivil || null,
      tipoPessoa: tipoPessoa || 'PF',
      nirc: nirc || null,
      emailCobranca: emailCobranca || null,
      origemCliente: origemCliente || null,
      socios: socios ?? null,
      vendedorId: vendedorId || null,
      cep, logradouro, numero, complemento, bairro, cidade, estado,
    },
    include: {
      vendedor: { select: { id: true, nome: true } },
      criadoPor: { select: { id: true, nome: true } },
      placas: true,
    },
  });

  res.json(cliente);
});

// PATCH /api/clientes/:id/status
router.patch('/:id/status', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeInativarCliente) {
    res.status(403).json({ error: 'Sem permissão para inativar/ativar clientes.' });
    return;
  }
  const id = param(req, 'id');

  const existe = await prisma.cliente.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!existe) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  const novoStatus = existe.status === 'ATIVO' ? 'INATIVO' : 'ATIVO';
  const cliente = await prisma.cliente.update({
    where: { id },
    data: { status: novoStatus },
    select: { id: true, nome: true, status: true },
  });

  res.json(cliente);
});

// DELETE /api/clientes/:id
router.delete('/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeExcluirCliente) {
    res.status(403).json({ error: 'Sem permissão para excluir clientes.' });
    return;
  }
  const id = param(req, 'id');

  const existe = await prisma.cliente.findUnique({ where: { id }, select: { id: true } });
  if (!existe) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  const contratosCount = await prisma.contrato.count({ where: { clienteId: id } });
  if (contratosCount > 0) {
    res.status(400).json({ error: 'Não é possível excluir um cliente com contratos.' });
    return;
  }

  const activeBoletosCount = await prisma.boleto.count({
    where: { carne: { clienteId: id }, status: { in: ['PENDENTE', 'ATRASADO'] } },
  });
  if (activeBoletosCount > 0) {
    res.status(400).json({ error: 'Não é possível excluir um cliente com boletos pendentes ou atrasados. Cancele os carnês primeiro.' });
    return;
  }

  // Desvincular dispositivos (não excluir — podem ser reutilizados)
  await prisma.dispositivo.updateMany({ where: { clienteId: id }, data: { clienteId: null } });

  // Comissões pagas: salvar snapshot de dataPagamento e desvinvular do boleto
  const comissoesPagas = await prisma.comissaoVendedor.findMany({
    where: { boleto: { carne: { clienteId: id }, dataPagamento: { not: null } } },
    select: { id: true, boleto: { select: { dataPagamento: true } } },
  });
  for (const c of comissoesPagas) {
    await prisma.comissaoVendedor.update({
      where: { id: c.id },
      data: { boletoId: null, dataPagamento: c.boleto!.dataPagamento },
    });
  }
  // Comissões não pagas: excluir
  await prisma.comissaoVendedor.deleteMany({ where: { boleto: { carne: { clienteId: id } } } });

  // Excluir registros em cascata
  await prisma.boletoPlaca.deleteMany({ where: { boleto: { carne: { clienteId: id } } } });
  await prisma.boletoDispositivo.deleteMany({ where: { boleto: { carne: { clienteId: id } } } });
  await prisma.boleto.deleteMany({ where: { carne: { clienteId: id } } });
  await prisma.carne.deleteMany({ where: { clienteId: id } });
  await prisma.placa.deleteMany({ where: { clienteId: id } });
  await prisma.cliente.delete({ where: { id } });
  res.status(204).send();
});

// GET /api/clientes/:id/dispositivos — retorna TODOS os dispositivos com flag vinculado
router.get('/:id/dispositivos', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const clienteId = param(req, 'id');
  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
  if (!cliente) { res.status(404).json({ error: 'Cliente não encontrado.' }); return; }

  const [vinculados, dispositivos] = await Promise.all([
    prisma.dispositivoCliente.findMany({ where: { clienteId }, select: { dispositivoId: true } }),
    prisma.dispositivo.findMany({
      orderBy: { nome: 'asc' },
      select: {
        id: true, nome: true, identificador: true, placa: true,
        categoria: true, ativo: true, clienteId: true,
        cliente: { select: { id: true, nome: true } },
      },
    }),
  ]);

  const vinculadosSet = new Set(vinculados.map((v) => v.dispositivoId));
  // Dispositivo é vinculado ao cliente se: é o responsável (clienteId) OU está na junction table
  res.json(dispositivos.map((d) => ({ ...d, vinculado: vinculadosSet.has(d.id) || d.clienteId === clienteId })));
});

export default router;
