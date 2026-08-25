import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { param, query } from '../utils/params';
import { criarJobConsulta } from '../services/multas.service';

const router = Router();
router.use(authMiddleware);

// GET /api/clientes
router.get('/', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const busca = query(req.query.busca);
  const status = query(req.query.status) as 'ATIVO' | 'INATIVO' | undefined;
  const vendedorId = query(req.query.vendedorId);

  const where: Prisma.ClienteWhereInput = {
    ...(status ? { status } : {}),
    ...(vendedorId ? { vendedorId } : {}),
    ...(busca ? {
      OR: [
        { nome: { contains: busca, mode: 'insensitive' } },
        { cpfCnpj: { contains: busca, mode: 'insensitive' } },
        { telefone: { contains: busca, mode: 'insensitive' } },
        { email: { contains: busca, mode: 'insensitive' } },
        { placas: { some: { placa: { contains: busca, mode: 'insensitive' } } } },
      ],
    } : {}),
  };

  const include = {
    vendedor: { select: { id: true, nome: true } },
    criadoPor: { select: { id: true, nome: true } },
    placas: { where: { ativo: true }, select: { id: true, placa: true, descricao: true } },
    dispositivos: { select: { id: true, nome: true, identificador: true, placa: true, categoria: true, ativo: true, eventosAdminHabilitado: true } },
    _count: { select: { dispositivosVinculados: true } },
  };

  // Paginação OPT-IN: com `page`/`limit` devolve `{ data, total, page, limit, totalPages }`;
  // sem eles, array puro (retrocompatível com combos/autocompletes que carregam tudo).
  const paginado = req.query.page !== undefined || req.query.limit !== undefined;
  if (paginado) {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
    const [itens, total] = await Promise.all([
      prisma.cliente.findMany({ where, include, orderBy: { nome: 'asc' }, skip: (page - 1) * limit, take: limit }),
      prisma.cliente.count({ where }),
    ]);
    res.json({
      data: itens,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
    return;
  }

  const clientes = await prisma.cliente.findMany({ where, include, orderBy: { nome: 'asc' } });
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

  const cliente = await prisma.cliente.create({
    data: {
      nome,
      cpfCnpj: cpfCnpj || null,
      telefone: telefone || null,
      email: email || null,
      notas: notas || null,
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
      cep: cep || null,
      logradouro: logradouro || null,
      numero: numero || null,
      complemento: complemento || null,
      bairro: bairro || null,
      cidade: cidade || null,
      estado: estado || null,
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

  if (!nome) {
    res.status(400).json({ error: 'O nome do cliente é obrigatório.' });
    return;
  }

  const cliente = await prisma.cliente.update({
    where: { id },
    data: {
      nome,
      cpfCnpj: cpfCnpj || null,
      telefone: telefone || null,
      email: email || null,
      notas: notas || null,
      dataNascimento: dataNascimento || null,
      rg: rg || null,
      profissao: profissao || null,
      estadoCivil: estadoCivil || null,
      tipoPessoa: tipoPessoa || 'PF',
      nirc: nirc || null,
      emailCobranca: emailCobranca || null,
      origemCliente: origemCliente || null,
      socios: socios ?? null,
      // Só altera o vendedor quando o campo vem no corpo. Payloads que omitem
      // vendedorId (formulários antigos, integrações) não devem desvincular o cliente.
      ...(vendedorId !== undefined ? { vendedorId: vendedorId || null } : {}),
      cep: cep || null,
      logradouro: logradouro || null,
      numero: numero || null,
      complemento: complemento || null,
      bairro: bairro || null,
      cidade: cidade || null,
      estado: estado || null,
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
  const [cliente] = await prisma.$transaction([
    prisma.cliente.update({
      where: { id },
      data: { status: novoStatus },
      select: { id: true, nome: true, status: true },
    }),
    ...(novoStatus === 'INATIVO'
      ? [
          prisma.clienteLogin.updateMany({
            where: { clienteId: id },
            data: { ativo: false },
          }),
        ]
      : []),
  ]);

  res.json(cliente);
});

// PATCH /api/clientes/:id/medidores-permissao — Toggle permissão do cliente editar medidores
router.patch('/:id/medidores-permissao', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const existe = await prisma.cliente.findUnique({ where: { id }, select: { id: true, podeEditarMedidores: true } });
  if (!existe) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  const cliente = await prisma.cliente.update({
    where: { id },
    data: { podeEditarMedidores: !existe.podeEditarMedidores },
    select: { id: true, nome: true, podeEditarMedidores: true },
  });

  res.json(cliente);
});

// PATCH /api/clientes/:id/multas-habilitado — Toggle consulta de multas (Detran) do cliente
router.patch('/:id/multas-habilitado', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const existe = await prisma.cliente.findUnique({ where: { id }, select: { id: true, multasHabilitado: true } });
  if (!existe) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  const cliente = await prisma.cliente.update({
    where: { id },
    data: { multasHabilitado: !existe.multasHabilitado },
    select: { id: true, nome: true, multasHabilitado: true },
  });

  // Ao habilitar, dispara uma consulta inicial (assíncrona) dos veículos elegíveis —
  // só os que também estão habilitados individualmente para multas.
  if (cliente.multasHabilitado) {
    const disps = await prisma.dispositivo.findMany({
      where: { clienteId: id, ativo: true, placa: { not: null }, multasHabilitado: true, OR: [{ renavam: { not: null } }, { chassi: { not: null } }] },
      select: { id: true, placa: true, renavam: true, chassi: true },
    });
    for (const d of disps) await criarJobConsulta(d, 'MANUAL_ADMIN');
  }

  res.json(cliente);
});

// PATCH /api/clientes/:id/eventos-admin — Liga/desliga os eventos-admin de TODOS os
// dispositivos do cliente de uma vez (o mesmo interruptor do card em admin/dispositivo.html,
// que só dá para acionar veículo a veículo). Desligado, o admin para de receber os eventos
// desses veículos no painel e em tempo real; o CLIENTE continua recebendo normalmente.
//
// Só afeta os dispositivos em que este cliente é o titular — um dispositivo apenas
// vinculado pertence a outro cliente e silenciá-lo aqui afetaria o painel do dono.
router.patch('/:id/eventos-admin', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const existe = await prisma.cliente.findUnique({ where: { id }, select: { id: true, nome: true } });
  if (!existe) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  // Auto-toggle igual aos demais botões da tela de clientes: se ainda há algum
  // veículo enviando eventos ao admin, silencia todos; se todos já estão
  // silenciados, religa todos.
  const ligados = await prisma.dispositivo.count({ where: { clienteId: id, eventosAdminHabilitado: true } });
  const ligar = ligados === 0;

  const { count } = await prisma.dispositivo.updateMany({
    where: { clienteId: id },
    data: { eventosAdminHabilitado: ligar },
  });

  res.json({ id: existe.id, nome: existe.nome, eventosAdminHabilitado: ligar, dispositivosAfetados: count });
});

// PATCH /api/clientes/:id/dispositivos-habilitado — Habilita a tela de dispositivos do cliente
// Body: { habilitado: boolean, limite?: number }. O limite é o teto TOTAL de dispositivos
// do cliente (os associados pelo admin também contam na cota).
router.patch('/:id/dispositivos-habilitado', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const { habilitado, limite } = req.body;

  const existe = await prisma.cliente.findUnique({ where: { id }, select: { id: true } });
  if (!existe) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  const ligar = habilitado === true || habilitado === 'true';
  let novoLimite = 0;
  if (ligar) {
    novoLimite = Number(limite);
    if (!Number.isInteger(novoLimite) || novoLimite < 1) {
      res.status(400).json({ error: 'Informe uma quantidade de dispositivos maior que zero.' });
      return;
    }
  }

  const cliente = await prisma.cliente.update({
    where: { id },
    data: { dispositivosHabilitado: ligar, limiteDispositivos: novoLimite },
    select: { id: true, nome: true, dispositivosHabilitado: true, limiteDispositivos: true },
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
