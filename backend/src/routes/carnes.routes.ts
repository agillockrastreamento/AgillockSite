import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { param } from '../utils/params';
import * as efiService from '../services/efi.service';

const router = Router();
router.use(authMiddleware);

// ─── Helper: monta objeto customer para EFI (PF e PJ) ────────────────────────
function buildEfiCustomer(cliente: {
  nome: string;
  cpfCnpj?: string | null;
  tipoPessoa?: string | null;
  socios?: any;
  telefone?: string | null;
  email?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cep?: string | null;
  cidade?: string | null;
  estado?: string | null;
  complemento?: string | null;
}): efiService.EfiCustomer {
  const isPJ = cliente.tipoPessoa === 'PJ';
  const socios: any[] = Array.isArray(cliente.socios) ? cliente.socios : [];
  const primeiroSocio = socios[0] || null;

  const name  = isPJ && primeiroSocio?.nome ? primeiroSocio.nome : cliente.nome;
  const cpf   = isPJ
    ? (primeiroSocio?.cpf ? primeiroSocio.cpf.replace(/\D/g, '') : undefined)
    : (cliente.cpfCnpj ? cliente.cpfCnpj.replace(/\D/g, '') : undefined);

  const customer: efiService.EfiCustomer = { name };
  // A EFI aceita no mÃ¡ximo 11 dÃ­gitos no campo 'cpf'. Se for CNPJ (14), nÃ£o deve ir aqui.
  if (cpf && cpf.length <= 11) customer.cpf = cpf;
  
  if (cliente.telefone) customer.phone_number = cliente.telefone.replace(/\D/g, '');
  if (cliente.email) customer.email = cliente.email;
  if (isPJ && cliente.cpfCnpj) {
    customer.juridical_person = {
      corporate_name: cliente.nome,
      cnpj: cliente.cpfCnpj.replace(/\D/g, ''),
    };
  }
  if (cliente.logradouro && cliente.cidade && cliente.estado) {
    customer.address = {
      street: cliente.logradouro,
      number: cliente.numero || 'S/N',
      neighborhood: cliente.bairro || '',
      zipcode: (cliente.cep || '').replace(/\D/g, ''),
      city: cliente.cidade,
      state: cliente.estado,
      ...(cliente.complemento ? { complement: cliente.complemento } : {}),
    };
  }
  return customer;
}

// ─── Helper: valida se cliente pode gerar carnê na EFI ───────────────────────
function validarClienteParaCarne(cliente: { tipoPessoa?: string | null; socios?: any; cpfCnpj?: string | null }): string | null {
  if (cliente.tipoPessoa === 'PJ') {
    const socios: any[] = Array.isArray(cliente.socios) ? cliente.socios : [];
    const cpf = socios[0]?.cpf?.replace(/\D/g, '');
    if (!cpf || cpf.length !== 11) {
      return 'Para clientes PJ, é necessário cadastrar ao menos um sócio com CPF válido no cadastro do cliente antes de gerar cobranças.';
    }
    if (!cliente.cpfCnpj || cliente.cpfCnpj.replace(/\D/g, '').length !== 14) {
      return 'CNPJ inválido no cadastro do cliente. Verifique o CNPJ antes de gerar cobranças.';
    }
  }
  return null;
}

// ─── POST /api/carnes — Gerar carnê individual (1 dispositivo ou placa) ───────
router.post('/', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { clienteId, placaId, dispositivoId, valor, dataVencimento, numeroParcelas, vendedorId, descricaoBoleto } = req.body;

  if (!clienteId || (!placaId && !dispositivoId) || !valor || !dataVencimento || !numeroParcelas) {
    res.status(400).json({ error: 'clienteId, placaId ou dispositivoId, valor, dataVencimento e numeroParcelas são obrigatórios.' });
    return;
  }
  if (Number(valor) <= 0 || Number(numeroParcelas) < 1) {
    res.status(400).json({ error: 'valor deve ser positivo e numeroParcelas >= 1.' });
    return;
  }

  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: {
      id: true, nome: true, cpfCnpj: true, tipoPessoa: true, socios: true, telefone: true, email: true, vendedorId: true,
      cep: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true,
    },
  });
  if (!cliente) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  // Associar vendedor ao cliente se informado e ainda não associado
  if (vendedorId && !cliente.vendedorId) {
    await prisma.cliente.update({ where: { id: clienteId }, data: { vendedorId } });
  }

  // Determinar vendedor efetivo da cobrança: prioriza o informado na cobrança, depois o do cliente
  const vendedorEfetivo = vendedorId || cliente.vendedorId || null;

  // Resolução do item de cobrança: dispositivo (novo) ou placa (legado)
  let itemNome: string;
  let itemVendedorId: string | null = null;
  let boletoExtra: Record<string, string | null> = {};

  if (dispositivoId) {
    const dispositivo = await prisma.dispositivo.findFirst({
      where: { id: dispositivoId, clienteId, ativo: true },
      select: { id: true, nome: true, identificador: true, placa: true, vendedorId: true },
    });
    if (!dispositivo) {
      res.status(404).json({ error: 'Dispositivo não encontrado ou inativo.' });
      return;
    }
    const base = dispositivo.placa
      ? `Rastreamento ${dispositivo.placa}`
      : `Rastreamento ${dispositivo.identificador}`;
    itemNome = (descricaoBoleto ? `${base} - ${descricaoBoleto}` : base).slice(0, 255);
    itemVendedorId = dispositivo.vendedorId;
    boletoExtra = { dispositivoId };

    // Definir vendedor dono do dispositivo (somente se ainda não tiver um)
    if (vendedorEfetivo && !dispositivo.vendedorId) {
      await prisma.dispositivo.update({ where: { id: dispositivoId }, data: { vendedorId: vendedorEfetivo } });
    }
  } else {
    const placa = await prisma.placa.findFirst({
      where: { id: placaId, clienteId, ativo: true },
      select: { id: true, placa: true, descricao: true, vendedorId: true },
    });
    if (!placa) {
      res.status(404).json({ error: 'Placa não encontrada ou inativa.' });
      return;
    }
    const base = placa.descricao ? `${placa.placa} - ${placa.descricao}` : `Rastreamento ${placa.placa}`;
    itemNome = (descricaoBoleto ? `${base} - ${descricaoBoleto}` : base).slice(0, 255);
    itemVendedorId = placa.vendedorId;
    boletoExtra = { placaId };

    if (vendedorEfetivo && !placa.vendedorId) {
      await prisma.placa.update({ where: { id: placaId }, data: { vendedorId: vendedorEfetivo } });
    }
  }

  // Aviso se cliente já tem carnê unificado ativo
  const carneUnificado = await prisma.carne.findFirst({
    where: {
      clienteId,
      tipo: 'UNIFICADO',
      boletos: { some: { status: { in: ['PENDENTE', 'ATRASADO'] } } },
    },
    select: { id: true },
  });

  // Buscar configurações de multa/juros
  const config = await prisma.configuracoes.findUnique({ where: { id: '1' } });
  const configurations = config ? {
    fine: Number(config.multaPercentual) > 0 ? Math.round(Number(config.multaPercentual) * 100) : undefined,
    interest: Number(config.jurosDiarios) > 0
      ? { type: 'daily', value: Math.round(Number(config.jurosDiarios) * 1000) }
      : undefined,
  } : undefined;

  // Validar cliente para EFI
  const erroCliente = validarClienteParaCarne(cliente);
  if (erroCliente) { res.status(400).json({ error: erroCliente }); return; }

  // Chamar EFI
  const valorCentavos = Math.round(Number(valor) * 100);
  let efiResult: efiService.EfiCarneResult;
  try {
    efiResult = await efiService.criarCarne({
      customer: buildEfiCustomer(cliente),
      items: [{ name: itemNome, value: valorCentavos, amount: 1 }],
      expire_at: dataVencimento,
      repeats: Number(numeroParcelas),
      configurations: configurations?.fine || configurations?.interest ? configurations : undefined,
    });
  } catch (err: any) {
    console.error('Erro EFI ao criar carnê:', err);
    res.status(502).json({ error: `Erro ao comunicar com EFI Bank: ${err.message || 'erro desconhecido'}` });
    return;
  }

  // Salvar no banco
  const carne = await prisma.carne.create({
    data: {
      tipo: 'INDIVIDUAL',
      efiCarneId: String(efiResult.carnet_id),
      efiCarneLink: efiResult.link,
      valorTotal: Number(valor) * Number(numeroParcelas),
      numeroParcelas: Number(numeroParcelas),
      clienteId,
      geradoPorId: req.user!.userId,
      vendedorId: vendedorEfetivo,
      boletos: {
        create: efiResult.charges.map((charge) => {
          const [ey, em, ed] = charge.expire_at.split('-').map(Number);
          return {
            numeroParcela: Number(charge.parcel),
            valor: Number(valor),
            vencimento: new Date(ey, em - 1, ed, 12, 0, 0),
            status: 'PENDENTE' as const,
            efiChargeId: String(charge.charge_id),
            linkBoleto: charge.url,
            ...boletoExtra,
          };
        }),
      },
    },
    include: {
      boletos: { orderBy: { numeroParcela: 'asc' } },
    },
  });

  res.status(201).json({
    ...carne,
    avisoUnificado: carneUnificado
      ? 'Atenção: cliente já possui carnê unificado ativo. Considere adicionar esta placa ao carnê unificado.'
      : undefined,
  });

  // Se charge.url = link do carnê completo (não individual), corrige em background
  const urlsIguaisAoCarne = efiResult.charges.every((c) => c.url === efiResult.link);
  if (urlsIguaisAoCarne) {
    setImmediate(() => corrigirLinksBoletos(carne.id, efiResult.charges, dataVencimento));
  }
});

// Busca os links individuais via listCharges e atualiza os boletos do carnê
async function corrigirLinksBoletos(
  carneId: string,
  charges: Array<{ charge_id: number; url: string }>,
  dataVencimento: string,
): Promise<void> {
  try {
    const chargesList = await efiService.listarCarnetCharges({
      begin_date: dataVencimento,
      end_date:   dataVencimento,
    });
    const linkPorId = new Map<string, string>();
    for (const c of chargesList) {
      if (c.payment?.carnet?.link) {
        linkPorId.set(String(c.id), c.payment.carnet.link);
      }
    }
    for (const charge of charges) {
      const link = linkPorId.get(String(charge.charge_id));
      if (link) {
        await prisma.boleto.updateMany({
          where: { carneId, efiChargeId: String(charge.charge_id) },
          data: { linkBoleto: link },
        });
      }
    }
    console.log(`[carnes] links individuais corrigidos para carnê ${carneId}`);
  } catch (err) {
    console.error(`[carnes] falha ao corrigir links do carnê ${carneId}:`, err);
  }
}

// ─── GET /api/carnes/:id/pdf — Link para download do PDF ──────────────────────
router.get('/:id/pdf', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const carne = await prisma.carne.findUnique({
    where: { id },
    select: { id: true, efiCarneLink: true },
  });
  if (!carne) {
    res.status(404).json({ error: 'Carnê não encontrado.' });
    return;
  }
  if (!carne.efiCarneLink) {
    res.status(404).json({ error: 'Link do PDF não disponível.' });
    return;
  }

  res.json({ link: carne.efiCarneLink });
});

// ─── DELETE /api/carnes/:id — Cancelar ou excluir carnê ──────────────────────
// Se todos os boletos já estão cancelados: exclui o registro do banco.
// Se há boletos ativos: cancela no EFI e marca como cancelados.
router.delete('/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeCancelarCarne) {
    res.status(403).json({ error: 'Sem permissão para cancelar/excluir carnês.' });
    return;
  }
  const id = param(req, 'id');

  const carne = await prisma.carne.findUnique({
    where: { id },
    include: {
      boletos: { select: { id: true, status: true } },
    },
  });
  if (!carne) {
    res.status(404).json({ error: 'Carnê não encontrado.' });
    return;
  }

  const activeBoletos = carne.boletos.filter((b) => b.status === 'PENDENTE' || b.status === 'ATRASADO');

  if (activeBoletos.length === 0) {
    // Todos os boletos já estão cancelados/pagos — excluir fisicamente
    const boletoIds = carne.boletos.map((b) => b.id);
    await prisma.boletoPlaca.deleteMany({ where: { boletoId: { in: boletoIds } } });
    await prisma.comissaoVendedor.deleteMany({ where: { boletoId: { in: boletoIds } } });
    await prisma.boleto.deleteMany({ where: { carneId: id } });
    await prisma.carne.delete({ where: { id } });
    res.status(204).send();
    return;
  }

  // Cancelar no EFI
  if (carne.efiCarneId) {
    try {
      await efiService.cancelarCarne(Number(carne.efiCarneId));
    } catch (err: any) {
      console.error('Erro EFI ao cancelar carnê:', err);
      res.status(502).json({ error: `Erro ao cancelar no EFI Bank: ${err.message || 'erro desconhecido'}` });
      return;
    }
  }

  // Marcar boletos pendentes/atrasados como cancelados
  await prisma.boleto.updateMany({
    where: { carneId: id, status: { in: ['PENDENTE', 'ATRASADO'] } },
    data: { status: 'CANCELADO' },
  });

  res.status(204).send();
});

// ─── POST /api/carnes/unificar — Unificar carnês individuais ─────────────────
router.post('/unificar', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { clienteId, dataVencimento, numeroParcelas } = req.body;

  if (!clienteId || !dataVencimento || !numeroParcelas) {
    res.status(400).json({ error: 'clienteId, dataVencimento e numeroParcelas são obrigatórios.' });
    return;
  }

  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: {
      id: true, nome: true, cpfCnpj: true, tipoPessoa: true, socios: true, telefone: true, email: true, vendedorId: true,
      cep: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true,
    },
  });
  if (!cliente) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  // Buscar carnês individuais com boletos pendentes
  const carnesIndividuais = await prisma.carne.findMany({
    where: {
      clienteId,
      tipo: 'INDIVIDUAL',
      boletos: { some: { status: { in: ['PENDENTE', 'ATRASADO'] } } },
    },
    include: {
      boletos: {
        where: { status: { in: ['PENDENTE', 'ATRASADO'] } },
        orderBy: { numeroParcela: 'asc' },
        include: { placa: { select: { id: true, placa: true, descricao: true, vendedorId: true } } },
      },
    },
  });

  if (carnesIndividuais.length === 0) {
    res.status(400).json({ error: 'Nenhum carnê individual ativo encontrado para este cliente.' });
    return;
  }

  // Verificar se já tem unificado ativo
  const jaUnificado = await prisma.carne.findFirst({
    where: {
      clienteId,
      tipo: 'UNIFICADO',
      boletos: { some: { status: { in: ['PENDENTE', 'ATRASADO'] } } },
    },
    select: { id: true },
  });
  if (jaUnificado) {
    res.status(400).json({ error: 'Cliente já possui carnê unificado ativo.' });
    return;
  }

  // Montar itens EFI: uma linha por placa (valor = do último boleto pendente daquela placa)
  const placaMap = new Map<string, { placaId: string; nome: string; valor: number }>();
  for (const carne of carnesIndividuais) {
    for (const boleto of carne.boletos) {
      if (boleto.placa && !placaMap.has(boleto.placa.id)) {
        placaMap.set(boleto.placa.id, {
          placaId: boleto.placa.id,
          nome: boleto.placa.descricao
            ? `${boleto.placa.placa} - ${boleto.placa.descricao}`
            : `Rastreamento ${boleto.placa.placa}`,
          valor: Number(boleto.valor),
        });
      }
    }
  }

  if (placaMap.size === 0) {
    res.status(400).json({ error: 'Não foi possível determinar as placas para unificação.' });
    return;
  }

  const itens = [...placaMap.values()];
  const valorMensalTotal = itens.reduce((sum, i) => sum + i.valor, 0);

  // Cancelar carnês individuais no EFI
  for (const carne of carnesIndividuais) {
    if (carne.efiCarneId) {
      try {
        await efiService.cancelarCarne(Number(carne.efiCarneId));
      } catch (err: any) {
        console.error(`Erro ao cancelar carnê ${carne.id} no EFI:`, err);
        // Continua mesmo com erro no EFI (pode já estar cancelado)
      }
    }
    await prisma.boleto.updateMany({
      where: { carneId: carne.id, status: { in: ['PENDENTE', 'ATRASADO'] } },
      data: { status: 'CANCELADO' },
    });
  }

  // Buscar configurações de multa/juros
  const configUnif = await prisma.configuracoes.findUnique({ where: { id: '1' } });
  const configurationsUnif = configUnif ? {
    fine: Number(configUnif.multaPercentual) > 0 ? Math.round(Number(configUnif.multaPercentual) * 100) : undefined,
    interest: Number(configUnif.jurosDiarios) > 0
      ? { type: 'daily', value: Math.round(Number(configUnif.jurosDiarios) * 100) }
      : undefined,
  } : undefined;

  // Validar cliente para EFI
  const erroClienteUnif = validarClienteParaCarne(cliente);
  if (erroClienteUnif) { res.status(400).json({ error: erroClienteUnif }); return; }

  // Criar carnê unificado no EFI
  let efiResult: efiService.EfiCarneResult;
  try {
    efiResult = await efiService.criarCarne({
      customer: buildEfiCustomer(cliente),
      items: itens.map((i) => ({
        name: i.nome,
        value: Math.round(i.valor * 100),
        amount: 1,
      })),
      expire_at: dataVencimento,
      repeats: Number(numeroParcelas),
      split_items: false,
      configurations: configurationsUnif?.fine || configurationsUnif?.interest ? configurationsUnif : undefined,
    });
  } catch (err: any) {
    console.error('Erro EFI ao criar carnê unificado:', err);
    res.status(502).json({ error: `Erro ao criar carnê unificado no EFI Bank: ${err.message || 'erro desconhecido'}` });
    return;
  }

  // Salvar carnê unificado no banco
  const carneUnificado = await prisma.carne.create({
    data: {
      tipo: 'UNIFICADO',
      efiCarneId: String(efiResult.carnet_id),
      efiCarneLink: efiResult.link,
      valorTotal: valorMensalTotal * Number(numeroParcelas),
      numeroParcelas: Number(numeroParcelas),
      clienteId,
      geradoPorId: req.user!.userId,
      boletos: {
        create: efiResult.charges.map((charge) => {
          const [ey, em, ed] = charge.expire_at.split('-').map(Number);
          return {
            numeroParcela: Number(charge.parcel),
            valor: valorMensalTotal,
            vencimento: new Date(ey, em - 1, ed, 12, 0, 0),
            status: 'PENDENTE' as const,
            efiChargeId: String(charge.charge_id),
            linkBoleto: charge.url,
          };
        }),
      },
    },
    include: {
      boletos: { orderBy: { numeroParcela: 'asc' } },
    },
  });

  // Criar registros BoletoPlaca para cada boleto × cada placa
  const boletoPlacaData = carneUnificado.boletos.flatMap((boleto) =>
    itens.map((item) => ({
      boletoId: boleto.id,
      placaId: item.placaId,
      valorPlaca: item.valor,
    }))
  );
  await prisma.boletoPlaca.createMany({ data: boletoPlacaData });

  // Definir vendedor dono das placas sem dono (usa vendedor do cliente como fallback)
  if (cliente.vendedorId) {
    for (const carne of carnesIndividuais) {
      for (const boleto of carne.boletos) {
        if (boleto.placa && !boleto.placa.vendedorId) {
          await prisma.placa.update({ where: { id: boleto.placa.id }, data: { vendedorId: cliente.vendedorId } });
        }
      }
    }
  }

  res.status(201).json(carneUnificado);

  // Se charge.url = link do carnê completo (não individual), corrige em background
  const urlsUnifIguais = efiResult.charges.every((c) => c.url === efiResult.link);
  if (urlsUnifIguais) {
    setImmediate(() => corrigirLinksBoletos(carneUnificado.id, efiResult.charges, dataVencimento));
  }
});

// ─── POST /api/carnes/unificar-placas — Criar boleto unificado com placas/valores explícitos ──
// Cancela qualquer carnê unificado ativo e carnês individuais das placas informadas,
// depois cria um novo carnê unificado com os valores fornecidos.
router.post('/unificar-placas', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { clienteId, placas, dataVencimento, numeroParcelas, vendedorId, descricaoBoleto } = req.body;
  // placas: Array<{ placaId: string; valor: number }>

  if (!clienteId || !Array.isArray(placas) || placas.length < 2 || !dataVencimento || !numeroParcelas) {
    res.status(400).json({ error: 'clienteId, placas (mín. 2), dataVencimento e numeroParcelas são obrigatórios.' });
    return;
  }
  if (placas.some((p: any) => !p.placaId || Number(p.valor) <= 0)) {
    res.status(400).json({ error: 'Cada placa deve ter placaId e valor positivo.' });
    return;
  }

  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: {
      id: true, nome: true, cpfCnpj: true, tipoPessoa: true, socios: true, telefone: true, email: true, vendedorId: true,
      cep: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true,
    },
  });
  if (!cliente) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  if (vendedorId && !cliente.vendedorId) {
    await prisma.cliente.update({ where: { id: clienteId }, data: { vendedorId } });
  }

  // Vendedor efetivo da cobrança: prioriza o informado, depois o do cliente
  const vendedorEfetivoUnif = vendedorId || cliente.vendedorId || null;

  const placaIds = placas.map((p: any) => p.placaId as string);
  const placasDb = await prisma.placa.findMany({
    where: { id: { in: placaIds }, clienteId, ativo: true },
    select: { id: true, placa: true, descricao: true, vendedorId: true },
  });
  if (placasDb.length !== placaIds.length) {
    res.status(400).json({ error: 'Uma ou mais placas não encontradas ou inativas.' });
    return;
  }

  // Cancelar carnê UNIFICADO ativo (se existir)
  const carneUnifExistente = await prisma.carne.findFirst({
    where: { clienteId, tipo: 'UNIFICADO', boletos: { some: { status: { in: ['PENDENTE', 'ATRASADO'] } } } },
    select: { id: true, efiCarneId: true },
  });
  if (carneUnifExistente) {
    if (carneUnifExistente.efiCarneId) {
      try { await efiService.cancelarCarne(Number(carneUnifExistente.efiCarneId)); } catch (e) { console.error('EFI cancel unif:', e); }
    }
    await prisma.boleto.updateMany({
      where: { carneId: carneUnifExistente.id, status: { in: ['PENDENTE', 'ATRASADO'] } },
      data: { status: 'CANCELADO' },
    });
  }

  // Cancelar carnês INDIVIDUAIS ativos para as placas informadas
  const carnesIndiv = await prisma.carne.findMany({
    where: {
      clienteId,
      tipo: 'INDIVIDUAL',
      boletos: { some: { placaId: { in: placaIds }, status: { in: ['PENDENTE', 'ATRASADO'] } } },
    },
    select: { id: true, efiCarneId: true },
  });
  for (const cn of carnesIndiv) {
    if (cn.efiCarneId) {
      try { await efiService.cancelarCarne(Number(cn.efiCarneId)); } catch (e) { console.error('EFI cancel indiv:', e); }
    }
    await prisma.boleto.updateMany({
      where: { carneId: cn.id, status: { in: ['PENDENTE', 'ATRASADO'] } },
      data: { status: 'CANCELADO' },
    });
  }

  // Montar itens EFI
  const itens = placas.map((p: any) => {
    const db = placasDb.find((x) => x.id === p.placaId)!;
    const nomeBase = db.descricao ? `${db.placa} - ${db.descricao}` : `Rastreamento ${db.placa}`;
    const nomeCompleto = descricaoBoleto ? `${nomeBase} - ${descricaoBoleto}` : nomeBase;
    return {
      placaId: p.placaId as string,
      nome: nomeCompleto.slice(0, 255),
      valor: Number(p.valor),
    };
  });
  const valorMensalTotal = itens.reduce((s, i) => s + i.valor, 0);

  const config = await prisma.configuracoes.findUnique({ where: { id: '1' } });
  const configurations = config ? {
    fine: Number(config.multaPercentual) > 0 ? Math.round(Number(config.multaPercentual) * 100) : undefined,
    interest: Number(config.jurosDiarios) > 0
      ? { type: 'daily', value: Math.round(Number(config.jurosDiarios) * 1000) }
      : undefined,
  } : undefined;

  const erroClientePlacas = validarClienteParaCarne(cliente);
  if (erroClientePlacas) { res.status(400).json({ error: erroClientePlacas }); return; }

  let efiResult: efiService.EfiCarneResult;
  try {
    efiResult = await efiService.criarCarne({
      customer: buildEfiCustomer(cliente),
      items: itens.map((i) => ({ name: i.nome, value: Math.round(i.valor * 100), amount: 1 })),
      expire_at: dataVencimento,
      repeats: Number(numeroParcelas),
      split_items: false,
      configurations: configurations?.fine || configurations?.interest ? configurations : undefined,
    });
  } catch (err: any) {
    console.error('Erro EFI ao criar carnê unificado (placas explícitas):', err);
    res.status(502).json({ error: `Erro ao criar carnê unificado no EFI Bank: ${err.message || 'erro desconhecido'}` });
    return;
  }

  const carneUnificado = await prisma.carne.create({
    data: {
      tipo: 'UNIFICADO',
      efiCarneId: String(efiResult.carnet_id),
      efiCarneLink: efiResult.link,
      valorTotal: valorMensalTotal * Number(numeroParcelas),
      numeroParcelas: Number(numeroParcelas),
      clienteId,
      geradoPorId: req.user!.userId,
      vendedorId: vendedorEfetivoUnif,
      boletos: {
        create: efiResult.charges.map((charge) => {
          const [ey, em, ed] = charge.expire_at.split('-').map(Number);
          return {
            numeroParcela: Number(charge.parcel),
            valor: valorMensalTotal,
            vencimento: new Date(ey, em - 1, ed, 12, 0, 0),
            status: 'PENDENTE' as const,
            efiChargeId: String(charge.charge_id),
            linkBoleto: charge.url,
          };
        }),
      },
    },
    include: { boletos: { orderBy: { numeroParcela: 'asc' } } },
  });

  const boletoPlacaData = carneUnificado.boletos.flatMap((boleto) =>
    itens.map((item) => ({ boletoId: boleto.id, placaId: item.placaId, valorPlaca: item.valor }))
  );
  await prisma.boletoPlaca.createMany({ data: boletoPlacaData });

  // Definir vendedor dono das placas que ainda não têm um
  if (vendedorEfetivoUnif) {
    for (const p of placasDb) {
      if (!p.vendedorId) {
        await prisma.placa.update({ where: { id: p.id }, data: { vendedorId: vendedorEfetivoUnif } });
      }
    }
  }

  res.status(201).json(carneUnificado);

  // Se charge.url = link do carnê completo (não individual), corrige em background
  const urlsPlacasIguais = efiResult.charges.every((c) => c.url === efiResult.link);
  if (urlsPlacasIguais) {
    setImmediate(() => corrigirLinksBoletos(carneUnificado.id, efiResult.charges, dataVencimento));
  }
});

// ─── POST /api/carnes/unificar-dispositivos — Criar boleto unificado com dispositivos explícitos ──
router.post('/unificar-dispositivos', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { clienteId, dispositivos, dataVencimento, numeroParcelas, vendedorId, descricaoBoleto } = req.body;
  // dispositivos: Array<{ dispositivoId: string; valor: number }>

  if (!clienteId || !Array.isArray(dispositivos) || dispositivos.length < 2 || !dataVencimento || !numeroParcelas) {
    res.status(400).json({ error: 'clienteId, dispositivos (mín. 2), dataVencimento e numeroParcelas são obrigatórios.' });
    return;
  }
  if (dispositivos.some((d: any) => !d.dispositivoId || Number(d.valor) <= 0)) {
    res.status(400).json({ error: 'Cada dispositivo deve ter dispositivoId e valor positivo.' });
    return;
  }

  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: {
      id: true, nome: true, cpfCnpj: true, tipoPessoa: true, socios: true, telefone: true, email: true, vendedorId: true,
      cep: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true,
    },
  });
  if (!cliente) {
    res.status(404).json({ error: 'Cliente não encontrado.' });
    return;
  }

  if (vendedorId && !cliente.vendedorId) {
    await prisma.cliente.update({ where: { id: clienteId }, data: { vendedorId } });
  }

  const vendedorEfetivoUnif = vendedorId || cliente.vendedorId || null;

  const dispositivoIds = dispositivos.map((d: any) => d.dispositivoId as string);
  const dispositivosDb = await prisma.dispositivo.findMany({
    where: { id: { in: dispositivoIds }, clienteId, ativo: true },
    select: { id: true, nome: true, identificador: true, placa: true, vendedorId: true },
  });
  if (dispositivosDb.length !== dispositivoIds.length) {
    res.status(400).json({ error: 'Um ou mais dispositivos não encontrados ou inativos.' });
    return;
  }

  // Cancelar carnê UNIFICADO ativo (se existir)
  const carneUnifExistente = await prisma.carne.findFirst({
    where: { clienteId, tipo: 'UNIFICADO', boletos: { some: { status: { in: ['PENDENTE', 'ATRASADO'] } } } },
    select: { id: true, efiCarneId: true },
  });
  if (carneUnifExistente) {
    if (carneUnifExistente.efiCarneId) {
      try { await efiService.cancelarCarne(Number(carneUnifExistente.efiCarneId)); } catch (e) { console.error('EFI cancel unif:', e); }
    }
    await prisma.boleto.updateMany({
      where: { carneId: carneUnifExistente.id, status: { in: ['PENDENTE', 'ATRASADO'] } },
      data: { status: 'CANCELADO' },
    });
  }

  // Cancelar carnês INDIVIDUAIS ativos para os dispositivos informados
  const carnesIndivDisp = await prisma.carne.findMany({
    where: {
      clienteId,
      tipo: 'INDIVIDUAL',
      boletos: { some: { dispositivoId: { in: dispositivoIds }, status: { in: ['PENDENTE', 'ATRASADO'] } } },
    },
    select: { id: true, efiCarneId: true },
  });
  for (const cn of carnesIndivDisp) {
    if (cn.efiCarneId) {
      try { await efiService.cancelarCarne(Number(cn.efiCarneId)); } catch (e) { console.error('EFI cancel indiv:', e); }
    }
    await prisma.boleto.updateMany({
      where: { carneId: cn.id, status: { in: ['PENDENTE', 'ATRASADO'] } },
      data: { status: 'CANCELADO' },
    });
  }

  // Montar itens EFI
  const itensDisp = dispositivos.map((d: any) => {
    const db = dispositivosDb.find((x) => x.id === d.dispositivoId)!;
    const base = db.placa
      ? `Rastreamento ${db.placa}`
      : `Rastreamento ${db.identificador}`;
    const nomeCompleto = descricaoBoleto ? `${base} - ${descricaoBoleto}` : base;
    return {
      dispositivoId: d.dispositivoId as string,
      nome: nomeCompleto.slice(0, 255),
      valor: Number(d.valor),
    };
  });
  const valorMensalTotalDisp = itensDisp.reduce((s, i) => s + i.valor, 0);

  const configDisp = await prisma.configuracoes.findUnique({ where: { id: '1' } });
  const configurationsDisp = configDisp ? {
    fine: Number(configDisp.multaPercentual) > 0 ? Math.round(Number(configDisp.multaPercentual) * 100) : undefined,
    interest: Number(configDisp.jurosDiarios) > 0
      ? { type: 'daily', value: Math.round(Number(configDisp.jurosDiarios) * 100) }
      : undefined,
  } : undefined;

  const erroClienteDisp = validarClienteParaCarne(cliente);
  if (erroClienteDisp) { res.status(400).json({ error: erroClienteDisp }); return; }

  let efiResultDisp: efiService.EfiCarneResult;
  try {
    efiResultDisp = await efiService.criarCarne({
      customer: buildEfiCustomer(cliente),
      items: itensDisp.map((i) => ({ name: i.nome, value: Math.round(i.valor * 100), amount: 1 })),
      expire_at: dataVencimento,
      repeats: Number(numeroParcelas),
      split_items: false,
      configurations: configurationsDisp?.fine || configurationsDisp?.interest ? configurationsDisp : undefined,
    });
  } catch (err: any) {
    console.error('Erro EFI ao criar carnê unificado (dispositivos):', err);
    res.status(502).json({ error: `Erro ao criar carnê unificado no EFI Bank: ${err.message || 'erro desconhecido'}` });
    return;
  }

  const carneUnifDisp = await prisma.carne.create({
    data: {
      tipo: 'UNIFICADO',
      efiCarneId: String(efiResultDisp.carnet_id),
      efiCarneLink: efiResultDisp.link,
      valorTotal: valorMensalTotalDisp * Number(numeroParcelas),
      numeroParcelas: Number(numeroParcelas),
      clienteId,
      geradoPorId: req.user!.userId,
      vendedorId: vendedorEfetivoUnif,
      boletos: {
        create: efiResultDisp.charges.map((charge) => {
          const [ey, em, ed] = charge.expire_at.split('-').map(Number);
          return {
            numeroParcela: Number(charge.parcel),
            valor: valorMensalTotalDisp,
            vencimento: new Date(ey, em - 1, ed, 12, 0, 0),
            status: 'PENDENTE' as const,
            efiChargeId: String(charge.charge_id),
            linkBoleto: charge.url,
          };
        }),
      },
    },
    include: { boletos: { orderBy: { numeroParcela: 'asc' } } },
  });

  const boletoDispData = carneUnifDisp.boletos.flatMap((boleto) =>
    itensDisp.map((item) => ({ boletoId: boleto.id, dispositivoId: item.dispositivoId, valorDispositivo: item.valor }))
  );
  await prisma.boletoDispositivo.createMany({ data: boletoDispData });

  // Definir vendedor dono dos dispositivos que ainda não têm um
  if (vendedorEfetivoUnif) {
    for (const d of dispositivosDb) {
      if (!d.vendedorId) {
        await prisma.dispositivo.update({ where: { id: d.id }, data: { vendedorId: vendedorEfetivoUnif } });
      }
    }
  }

  res.status(201).json(carneUnifDisp);

  const urlsDispIguais = efiResultDisp.charges.every((c) => c.url === efiResultDisp.link);
  if (urlsDispIguais) {
    setImmediate(() => corrigirLinksBoletos(carneUnifDisp.id, efiResultDisp.charges, dataVencimento));
  }
});

export default router;
