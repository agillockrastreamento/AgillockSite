import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { query } from '../utils/params';

const router = Router();
router.use(authMiddleware);
router.use(requireRoles('VENDEDOR', 'ADMIN'));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMes(mes: string | undefined): { inicio: Date; fim: Date; mesStr: string } {
  const agora = new Date();
  const str = mes || `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const [ano, mesNum] = str.split('-').map(Number);
  return {
    inicio: new Date(ano, mesNum - 1, 1),
    fim: new Date(ano, mesNum, 1),
    mesStr: str,
  };
}

// Calcula comissão teórica de um boleto (para modos "atrasado" e "futuro")
function calcularComissaoTeorica(
  valor: number,
  placasUnificadas: Array<{ valorPlaca: unknown }>,
  configs: { valorReferencia: unknown; percentualMenor: unknown; percentualMaior: unknown }
) {
  const ref = Number(configs.valorReferencia);
  const pMenor = Number(configs.percentualMenor);
  const pMaior = Number(configs.percentualMaior);
  let valor12 = 0;
  let valor18 = 0;

  if (placasUnificadas.length > 0) {
    for (const bp of placasUnificadas) {
      const v = Number(bp.valorPlaca);
      if (v >= ref) valor18 += Math.round(v * pMaior) / 100;
      else valor12 += Math.round(v * pMenor) / 100;
    }
  } else {
    if (valor >= ref) valor18 = Math.round(valor * pMaior) / 100;
    else valor12 = Math.round(valor * pMenor) / 100;
  }
  return { valor12, valor18 };
}

// ─── GET /api/vendedor/carteira ───────────────────────────────────────────────
// Retorna os três totais de uma vez: garantido, atrasado e futuro
router.get('/carteira', async (req: AuthRequest, res: Response): Promise<void> => {
  const rawVendedorId = query(req.query.vendedorId);
  const vendedorId = (req.user!.role === 'ADMIN' && rawVendedorId) ? rawVendedorId : req.user!.userId;
  const { inicio, fim, mesStr } = parseMes(query(req.query.mes));

  // Mover boletos vencidos para ATRASADO (somente os de dias anteriores a hoje)
  const _inicioDiaHoje1 = new Date(); _inicioDiaHoje1.setHours(0, 0, 0, 0);
  await prisma.boleto.updateMany({
    where: { status: 'PENDENTE', vencimento: { lt: _inicioDiaHoje1 } },
    data: { status: 'ATRASADO' },
  });

  const configs = await prisma.configuracoes.findUnique({ where: { id: '1' } });

  // ── Garantido: comissões registradas de boletos pagos no mês ──────────────
  let garantido12 = 0;
  let garantido18 = 0;
  {
    const comissoes = await prisma.comissaoVendedor.findMany({
      where: {
        vendedorId,
        boleto: { dataPagamento: { gte: inicio, lt: fim } },
      },
    });
    const limitePercentual = Number(configs?.percentualMenor ?? 12.5);
    for (const c of comissoes) {
      const percentual = Number(c.percentualAplicado);
      const valor = Number(c.valorComissao);
      if (percentual <= limitePercentual) garantido12 += valor;
      else garantido18 += valor;
    }
  }

  // ── Atrasado: comissão teórica de boletos em atraso com vencimento no mês ─
  // Filtra por placa.vendedorId (individual) ou BoletoPlaca.placa.vendedorId (unificado)
  let atrasado12 = 0;
  let atrasado18 = 0;
  if (configs) {
    const boletos = await prisma.boleto.findMany({
      where: {
        status: 'ATRASADO',
        vencimento: { gte: inicio, lt: fim },
        OR: [
          { placa: { vendedorId }, placasUnificadas: { none: {} } },
          { placasUnificadas: { some: { placa: { vendedorId } } } },
        ],
      },
      include: { placasUnificadas: { where: { placa: { vendedorId } }, select: { valorPlaca: true } } },
    });
    for (const b of boletos) {
      const { valor12, valor18 } = calcularComissaoTeorica(Number(b.valor), b.placasUnificadas, configs);
      atrasado12 += valor12;
      atrasado18 += valor18;
    }
  }

  // ── Futuro: comissão teórica de boletos pendentes com vencimento no mês ───
  let futuro12 = 0;
  let futuro18 = 0;
  if (configs) {
    const boletos = await prisma.boleto.findMany({
      where: {
        status: 'PENDENTE',
        vencimento: { gte: inicio, lt: fim },
        OR: [
          { placa: { vendedorId }, placasUnificadas: { none: {} } },
          { placasUnificadas: { some: { placa: { vendedorId } } } },
        ],
      },
      include: { placasUnificadas: { where: { placa: { vendedorId } }, select: { valorPlaca: true } } },
    });
    for (const b of boletos) {
      const { valor12, valor18 } = calcularComissaoTeorica(Number(b.valor), b.placasUnificadas, configs);
      futuro12 += valor12;
      futuro18 += valor18;
    }
  }

  const r = (n: number) => Math.round(n * 100) / 100;

  res.json({
    mes: mesStr,
    garantido: {
      total: r(garantido12 + garantido18),
      pct12: r(garantido12),
      pct18: r(garantido18),
    },
    atrasado: {
      total: r(atrasado12 + atrasado18),
      pct12: r(atrasado12),
      pct18: r(atrasado18),
    },
    futuro: {
      total: r(futuro12 + futuro18),
      pct12: r(futuro12),
      pct18: r(futuro18),
    },
  });
});

// ─── GET /api/vendedor/carteira/detalhes ──────────────────────────────────────
router.get('/carteira/detalhes', async (req: AuthRequest, res: Response): Promise<void> => {
  const rawVendedorIdD = query(req.query.vendedorId);
  const vendedorId = (req.user!.role === 'ADMIN' && rawVendedorIdD) ? rawVendedorIdD : req.user!.userId;
  const toggle = (query(req.query.toggle) || 'garantido') as 'garantido' | 'atrasado' | 'futuro';
  const { inicio, fim, mesStr } = parseMes(query(req.query.mes));
  const busca = query(req.query.busca);
  const percentualFiltro = query(req.query.percentual); // "12" ou "18"

  // Mover boletos vencidos para ATRASADO (somente os de dias anteriores a hoje)
  const _inicioDiaHoje2 = new Date(); _inicioDiaHoje2.setHours(0, 0, 0, 0);
  await prisma.boleto.updateMany({
    where: { status: 'PENDENTE', vencimento: { lt: _inicioDiaHoje2 } },
    data: { status: 'ATRASADO' },
  });

  const configs = await prisma.configuracoes.findUnique({ where: { id: '1' } });
  const limitePercentual = Number(configs?.percentualMenor ?? 12.5);

  type ItemCarteira = {
    boletoId: string;
    cliente: string;
    telefone: string | null;
    placa: string;
    vencimento: Date;
    dataPagamento: Date | null;
    valorBoleto: number;
    comissao: number;
    percentual: number;
    linkBoleto: string | null;
  };

  const itens: ItemCarteira[] = [];

  if (toggle === 'garantido') {
    const comissoes = await prisma.comissaoVendedor.findMany({
      where: {
        vendedorId,
        boleto: { dataPagamento: { gte: inicio, lt: fim } },
      },
      include: {
        boleto: {
          include: {
            carne: { include: { cliente: { select: { nome: true, telefone: true } } } },
            placa: { select: { placa: true } },
            placasUnificadas: { include: { placa: { select: { placa: true } } } },
          },
        },
      },
      orderBy: { boleto: { dataPagamento: 'desc' } },
    });

    // Agrupa por boletoId + tier de percentual (menor/maior).
    // Boleto unificado com placas mistas gera até 2 linhas — uma por tier.
    const porTier = new Map<string, ItemCarteira>();
    for (const c of comissoes) {
      const b = c.boleto;
      const percentual = Number(c.percentualAplicado);
      const isMinor = percentual <= limitePercentual;
      const key = `${b.id}:${isMinor ? 'menor' : 'maior'}`;
      const isUnificado = b.placasUnificadas.length > 0;
      const placaNome = isUnificado ? 'Boleto Unificado' : (b.placa?.placa || '—');

      const existing = porTier.get(key);
      if (existing) {
        existing.comissao += Number(c.valorComissao);
      } else {
        porTier.set(key, {
          boletoId: b.id,
          cliente: b.carne.cliente.nome,
          telefone: b.carne.cliente.telefone,
          placa: placaNome,
          vencimento: b.vencimento,
          dataPagamento: b.dataPagamento,
          valorBoleto: Number(b.valor),
          comissao: Number(c.valorComissao),
          percentual,
          linkBoleto: b.linkBoleto,
        });
      }
    }
    itens.push(...porTier.values());

  } else {
    // Atrasado ou Futuro: calcula comissão teórica on-the-fly
    // Filtra por placa.vendedorId; para unificados, só inclui as placas deste vendedor
    const statusFiltro = toggle === 'atrasado' ? 'ATRASADO' : 'PENDENTE';
    const boletos = await prisma.boleto.findMany({
      where: {
        status: statusFiltro,
        vencimento: { gte: inicio, lt: fim },
        OR: [
          { placa: { vendedorId }, placasUnificadas: { none: {} } },
          { placasUnificadas: { some: { placa: { vendedorId } } } },
        ],
      },
      include: {
        carne: { include: { cliente: { select: { nome: true, telefone: true } } } },
        placa: { select: { placa: true } },
        placasUnificadas: {
          where: { placa: { vendedorId } },
          include: { placa: { select: { placa: true } } },
        },
      },
      orderBy: { vencimento: 'asc' },
    });

    if (configs) {
      for (const b of boletos) {
        const { valor12, valor18 } = calcularComissaoTeorica(Number(b.valor), b.placasUnificadas, configs);
        const isUnificado = b.placasUnificadas.length > 0;
        const placaNome = isUnificado ? 'Boleto Unificado' : (b.placa?.placa || '—');
        const base = {
          boletoId: b.id,
          cliente: b.carne.cliente.nome,
          telefone: b.carne.cliente.telefone,
          placa: placaNome,
          vencimento: b.vencimento,
          dataPagamento: null as Date | null,
          valorBoleto: Number(b.valor),
          linkBoleto: b.linkBoleto,
        };
        // Emite até 2 linhas: uma por tier de percentual que tenha comissão
        if (valor12 > 0) {
          itens.push({ ...base, comissao: valor12, percentual: Number(configs.percentualMenor) });
        }
        if (valor18 > 0) {
          itens.push({ ...base, comissao: valor18, percentual: Number(configs.percentualMaior) });
        }
      }
    }
  }

  // Filtros opcionais
  let resultado = itens;
  if (busca) {
    const q = busca.toLowerCase();
    resultado = resultado.filter(
      (i) => i.cliente.toLowerCase().includes(q) || i.placa.toLowerCase().includes(q)
    );
  }
  if (percentualFiltro) {
    resultado = resultado.filter((i) =>
      i.percentual <= limitePercentual ? percentualFiltro === '12' : percentualFiltro === '18'
    );
  }

  res.json({ mes: mesStr, toggle, total: resultado.length, itens: resultado });
});

// ─── GET /api/vendedor/carteira/exportar ──────────────────────────────────────
router.get('/carteira/exportar', async (req: AuthRequest, res: Response): Promise<void> => {
  const rawVendedorIdE = query(req.query.vendedorId);
  const vendedorId = (req.user!.role === 'ADMIN' && rawVendedorIdE) ? rawVendedorIdE : req.user!.userId;
  const toggle = (query(req.query.toggle) || 'garantido') as 'garantido' | 'atrasado' | 'futuro';
  const { inicio, fim, mesStr } = parseMes(query(req.query.mes));

  const _inicioDiaHoje3 = new Date(); _inicioDiaHoje3.setHours(0, 0, 0, 0);
  await prisma.boleto.updateMany({
    where: { status: 'PENDENTE', vencimento: { lt: _inicioDiaHoje3 } },
    data: { status: 'ATRASADO' },
  });

  const configs = await prisma.configuracoes.findUnique({ where: { id: '1' } });
  const limitePercentualE = Number(configs?.percentualMenor ?? 12.5);
  const pMenorLabel = String(configs?.percentualMenor ?? 12.5).replace('.', ',');
  const pMaiorLabel = String(configs?.percentualMaior ?? 18).replace('.', ',');

  const linhas: string[][] = [
    ['Cliente', 'Telefone', 'Placa', 'Vencimento', 'Data Pagamento', 'Valor Boleto (R$)',
     `Comissão ${pMenorLabel}%`, `Comissão ${pMaiorLabel}%`, 'Total'],
  ];

  if (toggle === 'garantido') {
    const comissoes = await prisma.comissaoVendedor.findMany({
      where: { vendedorId, boleto: { dataPagamento: { gte: inicio, lt: fim } } },
      include: {
        boleto: {
          include: {
            carne: { include: { cliente: { select: { nome: true, telefone: true } } } },
            placa: { select: { placa: true } },
            placasUnificadas: { include: { placa: { select: { placa: true } } } },
          },
        },
      },
    });

    const porBoleto = new Map<string, { linha: string[]; comissao12: number; comissao18: number }>();
    for (const c of comissoes) {
      const b = c.boleto;
      const placa = b.placa?.placa || b.placasUnificadas.map((bp) => bp.placa.placa).join(' + ') || '—';
      const percentual = Number(c.percentualAplicado);
      const isMinor = percentual <= limitePercentualE;
      const existing = porBoleto.get(b.id);
      if (existing) {
        if (isMinor) existing.comissao12 += Number(c.valorComissao);
        else existing.comissao18 += Number(c.valorComissao);
      } else {
        porBoleto.set(b.id, {
          comissao12: isMinor ? Number(c.valorComissao) : 0,
          comissao18: isMinor ? 0 : Number(c.valorComissao),
          linha: [
            b.carne.cliente.nome,
            b.carne.cliente.telefone || '',
            placa,
            b.vencimento.toISOString().split('T')[0],
            b.dataPagamento?.toISOString().split('T')[0] || '',
            Number(b.valor).toFixed(2),
            '', '', '', // comissao12, comissao18, total preenchidos abaixo
          ],
        });
      }
    }
    for (const { linha, comissao12, comissao18 } of porBoleto.values()) {
      linha[6] = comissao12.toFixed(2);
      linha[7] = comissao18.toFixed(2);
      linha[8] = (comissao12 + comissao18).toFixed(2);
      linhas.push(linha);
    }
  } else {
    // Atrasado ou Futuro — filtra por placa.vendedorId; inclui só placas deste vendedor nos unificados
    const statusFiltro = toggle === 'atrasado' ? 'ATRASADO' : 'PENDENTE';
    const boletos = await prisma.boleto.findMany({
      where: {
        status: statusFiltro,
        vencimento: { gte: inicio, lt: fim },
        OR: [
          { placa: { vendedorId }, placasUnificadas: { none: {} } },
          { placasUnificadas: { some: { placa: { vendedorId } } } },
        ],
      },
      include: {
        carne: { include: { cliente: { select: { nome: true, telefone: true } } } },
        placa: { select: { placa: true } },
        placasUnificadas: {
          where: { placa: { vendedorId } },
          include: { placa: { select: { placa: true } } },
        },
      },
    });
    if (configs) {
      for (const b of boletos) {
        const { valor12, valor18 } = calcularComissaoTeorica(Number(b.valor), b.placasUnificadas, configs);
        const placa = b.placa?.placa || b.placasUnificadas.map((bp) => bp.placa.placa).join(' + ') || '—';
        linhas.push([
          b.carne.cliente.nome,
          b.carne.cliente.telefone || '',
          placa,
          b.vencimento.toISOString().split('T')[0],
          '',
          Number(b.valor).toFixed(2),
          valor12.toFixed(2),
          valor18.toFixed(2),
          (valor12 + valor18).toFixed(2),
        ]);
      }
    }
  }

  const csv = linhas.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const filename = `carteira-${mesStr}-${toggle}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv); // BOM para Excel reconhecer UTF-8
});

export default router;
