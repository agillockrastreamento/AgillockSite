import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import * as efiService from '../services/efi.service';
import { registrarComissoes } from '../services/comissao.service';

const router = Router();

// ─── POST /api/efi/webhook — Receber notificação de pagamento EFI ─────────────
// Não usa authMiddleware (chamado pelo EFI Bank, não pelo frontend)
router.post('/efi/webhook', async (req: Request, res: Response): Promise<void> => {
  // EFI envia o token no campo "notification" (API v1)
  const token = req.body?.notification || req.body?.notification_token;

  if (!token) {
    res.status(400).json({ error: 'notification token ausente.' });
    return;
  }

  // Responde 200 imediatamente para EFI não retentar
  res.json({ ok: true });

  // Processa em background (sem bloquear a resposta)
  setImmediate(async () => {
    try {
      const notificacoes = await efiService.getNotification(token);

      for (const notif of notificacoes) {
        const chargeId = notif.identifiers?.charge_id ? String(notif.identifiers.charge_id) : null;
        const statusAtual = notif.status?.current;
        if (!chargeId) continue;
        if (statusAtual === 'paid' || statusAtual === 'settled') {
          await processarPagamento(chargeId);
        } else if (statusAtual === 'canceled') {
          await processarCancelamento(chargeId);
        } else if (statusAtual === 'refunded') {
          await processarReembolso(chargeId);
        }
      }
    } catch (err) {
      console.error('Erro ao processar webhook EFI:', err);
    }
  });
});

async function processarPagamento(efiChargeId: string): Promise<void> {
  const boleto = await prisma.boleto.findUnique({
    where: { efiChargeId },
    include: {
      carne: {
        select: { id: true },
      },
    },
  });

  if (!boleto || boleto.status === 'PAGO') return;

  await prisma.boleto.update({
    where: { id: boleto.id },
    data: {
      status: 'PAGO',
      dataPagamento: new Date(),
      valorPago: boleto.valor,
    },
  });

  // Calcular comissão por placa (cada placa tem seu vendedor dono)
  await registrarComissoes(boleto.id);

  console.log(`Boleto ${boleto.id} (EFI charge ${efiChargeId}) marcado como PAGO.`);
}

async function processarCancelamento(efiChargeId: string): Promise<void> {
  const boleto = await prisma.boleto.findUnique({
    where: { efiChargeId },
    select: { id: true, status: true },
  });

  if (!boleto || boleto.status === 'CANCELADO') return;

  await prisma.boleto.update({
    where: { id: boleto.id },
    data: { status: 'CANCELADO' },
  });

  console.log(`Boleto ${boleto.id} (EFI charge ${efiChargeId}) marcado como CANCELADO via webhook.`);
}

async function processarReembolso(efiChargeId: string): Promise<void> {
  const boleto = await prisma.boleto.findUnique({
    where: { efiChargeId },
    select: { id: true, status: true },
  });

  if (!boleto || boleto.status === 'REEMBOLSADO') return;

  await prisma.boleto.update({
    where: { id: boleto.id },
    data: { status: 'REEMBOLSADO' },
  });

  console.log(`Boleto ${boleto.id} (EFI charge ${efiChargeId}) marcado como REEMBOLSADO via webhook.`);
}

// ─── GET /api/segunda-via — Busca pública de boletos por CPF ou placa ─────────
// Endpoint público (sem auth) — usado pela landing page
router.get('/segunda-via', async (req: Request, res: Response): Promise<void> => {
  const busca = String(req.query.busca || '').trim();

  if (!busca) {
    res.status(400).json({ error: 'Informe um CPF ou placa para buscar.' });
    return;
  }

  // Normaliza placa: remove espaços e converte para maiúsculas
  const placaNorm = busca.replace(/\s/g, '').toUpperCase();
  // Normaliza CPF/CNPJ: apenas dígitos
  const docNorm = busca.replace(/\D/g, '');
  const isCpf  = docNorm.length === 11;
  const isCnpj = docNorm.length === 14;

  const _hoje = new Date();
  const _inicioDiaHoje = new Date(_hoje.getFullYear(), _hoje.getMonth(), _hoje.getDate());
  // Reverter incorretamente marcados
  await prisma.boleto.updateMany({
    where: { status: 'ATRASADO', vencimento: { gte: _inicioDiaHoje } },
    data: { status: 'PENDENTE' },
  });
  // Marcar atrasados de dias anteriores a hoje
  await prisma.boleto.updateMany({
    where: { status: 'PENDENTE', vencimento: { lt: _inicioDiaHoje } },
    data: { status: 'ATRASADO' },
  });

  const boletos = await prisma.boleto.findMany({
    where: {
      status: { in: ['PENDENTE', 'ATRASADO'] },
      OR: [
        // Busca por placa individual
        { placa: { placa: placaNorm } },
        // Busca por placa em carnê unificado
        { placasUnificadas: { some: { placa: { placa: placaNorm } } } },
        // Busca por CPF ou CNPJ do cliente (campo cpfCnpj)
        ...(isCpf || isCnpj ? [{ carne: { cliente: { cpfCnpj: docNorm } } }] : []),
      ],
    },
    select: {
      id: true,
      vencimento: true,
      valor: true,
      status: true,
      linkBoleto: true,
    },
    orderBy: { vencimento: 'asc' },
    take: 10,
  });

  const resultado = boletos.map((b) => ({
    id: b.id,
    vencimento: b.vencimento.toISOString().split('T')[0],
    valor: Number(b.valor).toFixed(2),
    status: b.status,
    linkBoleto: b.linkBoleto,
  }));

  res.json({ boletos: resultado });
});

// ─── GET /api/admin/migrar-efi/preview — Pré-visualizar importação ────────────
// listCharges retorna uma entrada por parcela. Agrupamos pelo link do carnê
// (mesmo link = mesmo carnê). Para cada grupo novo, buscamos os itens via
// detailCharge para extrair os números de placa.
router.get('/admin/migrar-efi/preview', authMiddleware, requireRoles('ADMIN'), async (req: Request, res: Response): Promise<void> => {
  const hoje = new Date();
  const endDate   = hoje.toISOString().split('T')[0];
  const vinte = new Date(hoje); vinte.setFullYear(vinte.getFullYear() - 20);
  const beginDate = (req.query.begin_date as string) || vinte.toISOString().split('T')[0];

  let allCharges: efiService.EfiChargeListItem[];
  try {
    allCharges = await efiService.listarCarnetCharges({ begin_date: beginDate, end_date: endDate });
  } catch (err: any) {
    res.status(502).json({ error: `Erro ao consultar EFI: ${err.message}` });
    return;
  }

  // Agrupar parcelas pelo link do carnê (mesmo link = mesmo carnê)
  const grupos = await agruparChargesPorCarnet(allCharges);

  const resultado = {
    begin_date:    beginDate,
    end_date:      endDate,
    total_efi:     grupos.size,
    novos:         0,
    ja_importados: 0,
    carnets:       [] as Array<{
      link:         string;
      status_efi:   string;
      cliente_nome: string;
      cliente_doc:  string | null;
      placas:       string[];
      num_parcelas: number;
      valor_mensal: number;
    }>,
  };

  for (const [link, charges] of grupos) {
    // Idempotência: se qualquer charge do grupo já está no banco, grupo foi importado
    const jaExiste = await prisma.boleto.findFirst({
      where: { efiChargeId: String(charges[0].id) },
      select: { id: true },
    });

    if (jaExiste) {
      resultado.ja_importados++;
      continue;
    }

    const customer    = charges[0].customer;
    const cpfLimpo    = customer?.cpf?.replace(/\D/g, '')  || null;
    const cnpjLimpo   = customer?.cnpj?.replace(/\D/g, '') || null;
    const docLimpo    = cpfLimpo || cnpjLimpo || null;
    const nomeCliente = customer?.name || customer?.corporate_name || 'Desconhecido';
    const valorMensal = charges[0].total / 100;

    let placas: string[] = [];
    try {
      const detalhe = await efiService.obterDetalheCharge(charges[0].id);
      placas = ((detalhe?.items || []) as Array<{ name: string }>)
        .map((i) => parsePlacaFromNome(i.name).placa);
    } catch { /* continua sem placas */ }

    // Status representativo: se alguma parcela está 'waiting'/'paid', usa a mais recente
    const statusGrupo = charges.find((c) => c.status === 'waiting')?.status
      || charges[0].status;

    const carnetLink = charges[0].payment?.carnet?.link
      ? carnetLinkFromChargeLink(charges[0].payment.carnet.link)
      : link;

    resultado.carnets.push({
      link:         carnetLink,
      status_efi:   statusGrupo,
      cliente_nome: nomeCliente,
      cliente_doc:  docLimpo,
      placas,
      num_parcelas: charges.length,
      valor_mensal: valorMensal,
    });
    resultado.novos++;
  }

  res.json(resultado);
});

// ─── POST /api/admin/migrar-efi — Migração de dados históricos do EFI ───────
// Importa todos os carnês existentes no EFI para o banco local.
// Idempotente: grupos cujos charge_ids já existem em Boleto são ignorados.
// Body opcional: { "begin_date": "YYYY-MM-DD" } (default: "2020-01-01")
router.post('/admin/migrar-efi', authMiddleware, requireRoles('ADMIN'), async (req: Request, res: Response): Promise<void> => {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', ativo: true },
    select: { id: true },
  });
  if (!admin) {
    res.status(500).json({ error: 'Nenhum usuário ADMIN encontrado no sistema.' });
    return;
  }

  const hoje = new Date();
  const endDate   = hoje.toISOString().split('T')[0];
  const vinte = new Date(hoje); vinte.setFullYear(vinte.getFullYear() - 20);
  const beginDate = (req.body?.begin_date as string) || vinte.toISOString().split('T')[0];

  let allCharges: efiService.EfiChargeListItem[];
  try {
    allCharges = await efiService.listarCarnetCharges({ begin_date: beginDate, end_date: endDate });
  } catch (err: any) {
    res.status(502).json({ error: `Erro ao consultar EFI: ${err.message}` });
    return;
  }

  const grupos = await agruparChargesPorCarnet(allCharges);

  const resultado = {
    begin_date:  beginDate,
    end_date:    endDate,
    total_efi:   grupos.size,
    importados:  0,
    ignorados:   0,
    erros:       [] as Array<{ chave: string; erro: string }>,
  };

  console.log(`[migrar-efi] ${grupos.size} carnê(s) encontrado(s) no EFI entre ${beginDate} e ${endDate}`);

  for (const [link, charges] of grupos) {
    try {
      const importado = await importarGrupoCarnet(charges, link, admin.id);
      if (importado) {
        resultado.importados++;
        console.log(`[migrar-efi] link=${link} (${charges.length} parcelas) → importado`);
      } else {
        resultado.ignorados++;
        console.log(`[migrar-efi] link=${link} → já existia, ignorado`);
      }
    } catch (err: any) {
      console.error(`[migrar-efi] link=${link} → ERRO: ${err.message}`);
      resultado.erros.push({ chave: link, erro: err.message });
    }
  }

  // Após importar: corrige links PDF e registra webhooks nos boletos ativos
  const correcao = await corrigirLinksEWebhooks(allCharges);
  console.log(`[migrar-efi] correção pós-importação: links=${correcao.links_atualizados} webhooks=${correcao.webhooks_atualizados}`);

  res.json({ ...resultado, ...correcao });
});

// ─── POST /api/admin/corrigir-links-efi — mantido para uso manual ────────────
router.post('/admin/corrigir-links-efi', authMiddleware, requireRoles('ADMIN'), async (req: Request, res: Response): Promise<void> => {
  const hoje = new Date();
  const endDate   = hoje.toISOString().split('T')[0];
  const vinte2 = new Date(hoje); vinte2.setFullYear(vinte2.getFullYear() - 20);
  const beginDate = (req.body?.begin_date as string) || vinte2.toISOString().split('T')[0];

  let allCharges: efiService.EfiChargeListItem[];
  try {
    allCharges = await efiService.listarCarnetCharges({ begin_date: beginDate, end_date: endDate });
  } catch (err: any) {
    res.status(502).json({ error: `Erro ao consultar EFI: ${err.message}` });
    return;
  }

  const resultado = await corrigirLinksEWebhooks(allCharges);
  res.json(resultado);
});

// ─── Helper: corrige links PDF e registra webhooks nos boletos ativos ────────
async function corrigirLinksEWebhooks(allCharges: efiService.EfiChargeListItem[]): Promise<{
  links_atualizados: number;
  webhooks_atualizados: number;
}> {
  // Mapa efiChargeId → link individual da parcela
  const linkPorCharge = new Map<string, string>();
  for (const charge of allCharges) {
    if (charge.payment?.carnet?.link) {
      linkPorCharge.set(String(charge.id), charge.payment.carnet.link);
    }
  }

  // Corrige links PDF
  const boletos = await prisma.boleto.findMany({
    where: { efiChargeId: { not: null } },
    select: { id: true, efiChargeId: true, linkBoleto: true, carne: { select: { efiCarneLink: true } } },
  });
  const aCorrigir = boletos.filter((b) => {
    if (!b.linkBoleto) return true;
    const carneLink = b.carne?.efiCarneLink;
    return carneLink ? b.linkBoleto === carneLink : false;
  });
  let linksAtualizados = 0;
  for (const b of aCorrigir) {
    const link = linkPorCharge.get(b.efiChargeId!);
    if (link) {
      await prisma.boleto.update({ where: { id: b.id }, data: { linkBoleto: link } });
      linksAtualizados++;
    }
  }

  // Registra notification_url nos boletos PENDENTE/ATRASADO
  const webhookUrl = process.env.WEBHOOK_URL;
  let webhooksAtualizados = 0;
  if (webhookUrl) {
    const boletosAtivos = await prisma.boleto.findMany({
      where: { efiChargeId: { not: null }, status: { in: ['PENDENTE', 'ATRASADO'] } },
      select: { efiChargeId: true },
    });
    for (const b of boletosAtivos) {
      const chargeEfi = allCharges.find((c) => String(c.id) === b.efiChargeId);
      if (chargeEfi && (chargeEfi.status === 'waiting' || chargeEfi.status === 'unpaid')) {
        try {
          await efiService.atualizarNotificacaoCharge(chargeEfi.id, webhookUrl);
          webhooksAtualizados++;
        } catch (err: any) {
          console.warn(`[corrigir] Não foi possível atualizar webhook do charge ${chargeEfi.id}: ${err.message}`);
        }
      }
    }
  }

  return { links_atualizados: linksAtualizados, webhooks_atualizados: webhooksAtualizados };
}

// ─── Helpers da migração ──────────────────────────────────────────────────────

/**
 * Agrupa parcelas retornadas por listCharges pelo carnê ao qual pertencem.
 *
 * O link de cada parcela é único, mas todas as parcelas do mesmo carnê
 * compartilham o penúltimo segmento da URL (pasta do carnê).
 * Ex: https://.../emissao/381777_62_MALSI8/A4CL-381777-220-RRADRA8/381777-220-RRADRA8
 *                                           ^^^^^^^^^^^^^^^^^^^^^^^^ ← chave compartilhada
 *
 * Charges sem payment.carnet.link (ex: criados manualmente no painel EFI) são
 * enriquecidos via detailCharge para obter o link. Delay de 100ms entre essas
 * chamadas para evitar rate-limit.
 *
 * Retorna Map<carnetFolder, charges[]>
 */
async function agruparChargesPorCarnet(
  charges: efiService.EfiChargeListItem[],
): Promise<Map<string, efiService.EfiChargeListItem[]>> {
  const grupos = new Map<string, efiService.EfiChargeListItem[]>();
  let semLink = 0;
  let enriquecidos = 0;
  for (const charge of charges) {
    let link = charge.payment?.carnet?.link;

    // Fallback: busca link via detailCharge para charges sem payment.carnet.link
    if (!link) {
      try {
        await new Promise((r) => setTimeout(r, 100)); // evita rate-limit EFI
        const detalhe = await efiService.obterDetalheCharge(charge.id);
        link = detalhe?.payment?.banking_billet?.link
          || detalhe?.link
          || detalhe?.payment?.carnet?.link;
        if (link) {
          enriquecidos++;
          console.log(`[agrupar] charge ${charge.id} enriquecido via detailCharge → link: ${link.slice(-40)}`);
        } else {
          // Log do detalhe para diagnóstico quando link ainda não encontrado
          console.warn(`[agrupar] charge ${charge.id} sem link mesmo via detailCharge. payment:`, JSON.stringify(detalhe?.payment));
        }
      } catch (err: any) {
        console.warn(`[agrupar] falha ao buscar detalhe do charge ${charge.id}: ${err.message}`);
      }
    }

    if (!link) {
      semLink++;
      continue;
    }
    // Extrai penúltimo segmento da URL como chave do carnê
    const parts = link.split('/');
    const chave = parts.length >= 2 ? parts[parts.length - 2] : link;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave)!.push(charge);
  }
  if (semLink > 0) {
    console.warn(`[agrupar] ${semLink} charge(s) descartados (sem link mesmo via detailCharge)`);
  }
  console.log(`[agrupar] total: ${charges.length} charges | enriquecidos: ${enriquecidos} | agrupados: ${grupos.size} carnê(s) | descartados: ${semLink}`);
  return grupos;
}

/**
 * Reconstrói o link do carnê (sem o segmento da parcela no final).
 * Ex: https://.../emissao/381777_62/A4CL-381777-220-RRADRA8/381777-220-RRADRA8
 *  →  https://.../emissao/381777_62/A4CL-381777-220-RRADRA8
 */
function carnetLinkFromChargeLink(link: string): string {
  const parts = link.split('/');
  return parts.slice(0, -1).join('/');
}

/**
 * Converte expire_at da API EFI (pode ser "YYYY-MM-DD HH:MM:SS" ou "YYYY-MM-DD")
 * para um objeto Date válido.
 */
function parseExpireAt(expireAt: string | null | undefined): Date {
  if (!expireAt) return new Date(2099, 0, 1, 12, 0, 0);
  // Extrai apenas a parte da data (antes do espaço ou T)
  const datePart = expireAt.split(/[ T]/)[0];
  const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(2099, 0, 1, 12, 0, 0);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
}

/**
 * Extrai número da placa e descrição a partir do nome do item no EFI.
 * Formatos esperados (gerados pelo nosso sistema):
 *   "Rastreamento ABC1234"
 *   "ABC1234 - Carro preto Honda Civic"
 */
function parsePlacaFromNome(nome: string): { placa: string; descricao: string | null } {
  let resto = nome.trim();
  if (resto.startsWith('Placa ')) {
    resto = resto.slice(13).trim();
  }
  const dashIdx = resto.indexOf(' - ');
  let placa      = dashIdx > 0 ? resto.slice(0, dashIdx).trim() : resto.trim();
  const descricao = dashIdx > 0 ? resto.slice(dashIdx + 3).trim() || null : null;
  placa = placa.replace(/\s/g, '').toUpperCase() || 'IMPORTADA';
  return { placa, descricao };
}

/**
 * Mapeia o status do EFI para o StatusBoleto interno.
 * EFI: waiting | paid | unpaid | cancelled | settled
 */
function mapEfiStatus(
  chargeStatus: string,
  vencimento: Date,
): 'PENDENTE' | 'PAGO' | 'ATRASADO' | 'CANCELADO' | 'REEMBOLSADO' {
  if (chargeStatus === 'paid' || chargeStatus === 'settled') return 'PAGO';
  if (chargeStatus === 'canceled') return 'CANCELADO';
  if (chargeStatus === 'refunded') return 'REEMBOLSADO';
  if (chargeStatus === 'unpaid') return 'ATRASADO';
  // 'waiting' → verificar se já venceu
  const hoje = new Date();
  const inicioDiaHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return vencimento < inicioDiaHoje ? 'ATRASADO' : 'PENDENTE';
}

/**
 * Importa um grupo de parcelas (= um carnê) do EFI para o banco.
 * Retorna true se importado, false se já existia (ignorado).
 *
 * Estratégia:
 * - efiCarneId = null (listCharges não retorna carnet_id)
 * - efiCarneLink = link do carnê (mesmo para todas as parcelas)
 * - efiChargeId = charge.id de cada parcela (para o webhook funcionar)
 * - Itens/placas extraídos via detailCharge da primeira parcela
 */
async function importarGrupoCarnet(
  charges: efiService.EfiChargeListItem[],
  link: string,
  adminId: string,
): Promise<boolean> {
  // Idempotência: se a primeira parcela já existe no banco, grupo foi importado
  const jaExiste = await prisma.boleto.findUnique({
    where: { efiChargeId: String(charges[0].id) },
    select: { id: true },
  });
  if (jaExiste) return false;

  // Buscar itens (nomes de placa) via detailCharge da primeira parcela
  let items: Array<{ name: string; value: number; amount: number }> = [];
  try {
    const detalhe = await efiService.obterDetalheCharge(charges[0].id);
    items = (detalhe?.items || []) as Array<{ name: string; value: number; amount: number }>;
  } catch (err) {
    console.warn(`[migrar-efi] Não foi possível obter itens do charge ${charges[0].id}:`, err);
  }

  // Dados do cliente a partir da primeira parcela (todas têm o mesmo customer)
  const customer    = charges[0].customer;
  const cpfLimpo    = customer?.cpf?.replace(/\D/g, '')  || null;
  const cnpjLimpo   = customer?.cnpj?.replace(/\D/g, '') || null;
  const docLimpo    = cpfLimpo || cnpjLimpo || null;
  const nomeCliente = customer?.name || customer?.corporate_name || 'Cliente Importado';

  // 1. Encontrar ou criar Cliente
  let cliente = docLimpo
    ? await prisma.cliente.findFirst({
        where:   { cpfCnpj: docLimpo },
        orderBy: { createdAt: 'asc' },   // determinístico: usa o cliente mais antigo
      })
    : null;

  if (!cliente) {
    cliente = await prisma.cliente.create({
      data: {
        nome:        nomeCliente,
        cpfCnpj:    docLimpo,
        telefone:    customer?.phone_number?.replace(/\D/g, '') || null,
        email:       customer?.email || null,
        criadoPorId: adminId,
      },
    });
  }

  // 2. Encontrar ou criar Placa para cada item
  const itens: Array<{ placaId: string; valor: number }> = [];

  if (items.length > 0) {
    for (const item of items) {
      const { placa: numPlaca, descricao } = parsePlacaFromNome(item.name);
      // Valor por placa: usa value do item se disponível, senão divide igualmente
      const valorItem = item.value > 0 ? item.value / 100 : charges[0].total / 100 / items.length;

      let placa = await prisma.placa.findFirst({
        where: { placa: numPlaca, clienteId: cliente.id },
        select: { id: true },
      });
      if (!placa) {
        placa = await prisma.placa.create({
          data: { placa: numPlaca, descricao, clienteId: cliente.id },
          select: { id: true },
        });
      }
      itens.push({ placaId: placa.id, valor: valorItem });
    }
  } else {
    // Fallback: sem itens → cria placa genérica
    const placa = await prisma.placa.create({
      data: { placa: 'IMPORTADA', clienteId: cliente.id },
      select: { id: true },
    });
    itens.push({ placaId: placa.id, valor: charges[0].total / 100 });
  }

  const tipo: 'INDIVIDUAL' | 'UNIFICADO' = itens.length === 1 ? 'INDIVIDUAL' : 'UNIFICADO';
  const valorMensal = itens.reduce((s, i) => s + i.valor, 0);

  // Ordenar parcelas pelo número da parcela
  const sortedCharges = [...charges].sort(
    (a, b) => (a.payment?.carnet?.parcel ?? 0) - (b.payment?.carnet?.parcel ?? 0),
  );
  const numeroParcelas = sortedCharges.length;

  // 3. Criar Carne + Boletos
  const carneCriado = await prisma.carne.create({
    data: {
      tipo,
      efiCarneId:    null,   // listCharges não retorna carnet_id
      efiCarneLink:  charges[0].payment?.carnet?.link
        ? carnetLinkFromChargeLink(charges[0].payment.carnet.link)
        : null,
      valorTotal:    valorMensal * numeroParcelas,
      numeroParcelas,
      clienteId:    cliente.id,
      geradoPorId:  adminId,
      boletos: {
        create: sortedCharges.map((charge) => {
          const vencimento = parseExpireAt(charge.payment?.carnet?.expire_at);
          const status     = mapEfiStatus(charge.status, vencimento);
          const valorParcela = charge.total / 100;
          return {
            numeroParcela: charge.payment?.carnet?.parcel ?? (sortedCharges.indexOf(charge) + 1),
            valor:         valorParcela,
            vencimento,
            status,
            efiChargeId:   String(charge.id),
            linkBoleto:    charge.payment?.carnet?.link ?? null,
            dataPagamento: status === 'PAGO' && charge.payment?.paid_at
              ? new Date(charge.payment.paid_at)
              : null,
            valorPago:     status === 'PAGO' ? valorParcela : null,
            ...(tipo === 'INDIVIDUAL' ? { placaId: itens[0].placaId } : {}),
          };
        }),
      },
    },
    include: { boletos: { select: { id: true } } },
  });

  // 4. Para UNIFICADO: criar registros BoletoPlaca (boleto × placa)
  if (tipo === 'UNIFICADO') {
    const boletoPlacaData = carneCriado.boletos.flatMap((boleto) =>
      itens.map((item) => ({
        boletoId:   boleto.id,
        placaId:    item.placaId,
        valorPlaca: item.valor,
      }))
    );
    await prisma.boletoPlaca.createMany({ data: boletoPlacaData });
  }

  // 5. Registrar notification_url em cada boleto PENDENTE/ATRASADO no EFI
  const webhookUrl = process.env.WEBHOOK_URL;
  if (webhookUrl) {
    for (const charge of charges) {
      if (charge.status === 'waiting' || charge.status === 'unpaid') {
        try {
          await efiService.atualizarNotificacaoCharge(charge.id, webhookUrl);
        } catch (err: any) {
          console.warn(`[migrar-efi] Não foi possível atualizar notification_url do charge ${charge.id}: ${err.message}`);
        }
      }
    }
  }

  return true;
}

export default router;
