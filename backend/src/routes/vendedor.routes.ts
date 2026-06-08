import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { query, param } from '../utils/params';
import { verifyToken } from '../utils/jwt';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { COMPROVANTES_UPLOADS_DIR, UPLOADS_DIR } from '../utils/upload-paths';
import { comissaoPorPercentual, RegraLike } from '../utils/comissao';

// ─── Configuração multer (upload de comprovantes) ─────────────────────────────
const uploadDir = COMPROVANTES_UPLOADS_DIR;
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato inválido. Use PDF, JPG ou PNG.'));
  },
});

const router = Router();

function resolveComprovantePath(comprovante: string): string {
  const normalizado = String(comprovante || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizado) return '';
  if (normalizado.startsWith('uploads/')) {
    return path.join(UPLOADS_DIR, normalizado.replace(/^uploads\//, ''));
  }
  return path.join(UPLOADS_DIR, 'comprovantes', path.basename(normalizado));
}

// ─── GET /api/vendedor/comprovante/:id — ANTES do authMiddleware global ───────
// Aceita JWT via header Authorization OU query param ?token= (para abrir em nova aba)
router.get('/comprovante/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  // Tenta autenticar via header primeiro, depois via query param
  const authHeader = req.headers.authorization;
  let tokenStr: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    tokenStr = authHeader.split(' ')[1];
  } else {
    tokenStr = query(req.query.token);
  }
  if (!tokenStr) {
    res.status(401).json({ error: 'Token não informado.' });
    return;
  }
  try {
    req.user = verifyToken(tokenStr);
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado.' });
    return;
  }

  const id = param(req, 'id');
  const pagamento = await prisma.pagamentoComissao.findUnique({ where: { id } });
  if (!pagamento) {
    res.status(404).json({ error: 'Pagamento não encontrado.' });
    return;
  }

  // Vendedor só pode ver o seu próprio comprovante
  if (req.user!.role === 'VENDEDOR' && pagamento.vendedorId !== req.user!.userId) {
    res.status(403).json({ error: 'Acesso negado.' });
    return;
  }

  if (!pagamento.comprovante) {
    res.status(404).json({ error: 'Comprovante não disponível.' });
    return;
  }

  const filePath = resolveComprovantePath(pagamento.comprovante);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Arquivo não encontrado.' });
    return;
  }

  res.setHeader('Content-Type', pagamento.comprovanteMime || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(filePath);
});

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

const r2 = (n: number) => Math.round(n * 100) / 100;

// Converte um Map<percentual, valor> num array ordenado por percentual,
// pronto para o frontend renderizar um card por percentual.
function mapParaArray(m: Map<number, number>): Array<{ percentual: number; valor: number }> {
  return Array.from(m.entries())
    .map(([percentual, valor]) => ({ percentual, valor: r2(valor) }))
    .filter((e) => e.valor > 0)
    .sort((a, b) => a.percentual - b.percentual);
}

// Compara dois percentuais com tolerância de centésimos (Decimal(5,2)).
function mesmoPercentual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
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

  const regras: RegraLike[] = await prisma.regraComissao.findMany({ where: { ativo: true } });

  // Acumula um valor de comissão num mapa percentual → total.
  const acc = (m: Map<number, number>, percentual: number, valor: number) =>
    m.set(percentual, (m.get(percentual) || 0) + valor);

  // ── Garantido: comissões registradas de boletos pagos no mês ──────────────
  const garantidoMap = new Map<number, number>();
  {
    const comissoes = await prisma.comissaoVendedor.findMany({
      where: {
        vendedorId,
        OR: [
          { boletoId: { not: null }, boleto: { dataPagamento: { gte: inicio, lt: fim } } },
          { boletoId: null, dataPagamento: { gte: inicio, lt: fim } },
        ],
      },
    });
    for (const c of comissoes) {
      acc(garantidoMap, Number(c.percentualAplicado), Number(c.valorComissao));
    }
  }

  // Helper para somar comissão teórica de boletos por status.
  const totalTeorico = async (status: 'ATRASADO' | 'PENDENTE'): Promise<Map<number, number>> => {
    const m = new Map<number, number>();
    const boletos = await prisma.boleto.findMany({
      where: {
        status,
        vencimento: { gte: inicio, lt: fim },
        OR: [
          { placa: { vendedorId }, placasUnificadas: { none: {} } },
          { placasUnificadas: { some: { placa: { vendedorId } } } },
          { dispositivo: { vendedorId } },
          { dispositivosUnificados: { some: { dispositivo: { vendedorId } } } },
        ],
      },
      include: {
        placasUnificadas: { where: { placa: { vendedorId } }, select: { valorPlaca: true } },
        dispositivosUnificados: { where: { dispositivo: { vendedorId } }, select: { valorDispositivo: true } },
      },
    });
    for (const b of boletos) {
      const porPct = comissaoPorPercentual(Number(b.valor), b.placasUnificadas, regras, b.dispositivosUnificados);
      for (const [pct, v] of porPct) acc(m, pct, v);
    }
    return m;
  };

  const atrasadoMap = await totalTeorico('ATRASADO');
  const futuroMap   = await totalTeorico('PENDENTE');

  const totalDe = (m: Map<number, number>) =>
    r2(Array.from(m.values()).reduce((s, v) => s + v, 0));

  res.json({
    mes: mesStr,
    garantido: { total: totalDe(garantidoMap), porPercentual: mapParaArray(garantidoMap) },
    atrasado:  { total: totalDe(atrasadoMap),  porPercentual: mapParaArray(atrasadoMap) },
    futuro:    { total: totalDe(futuroMap),    porPercentual: mapParaArray(futuroMap) },
  });
});

// ─── GET /api/vendedor/carteira/detalhes ──────────────────────────────────────
router.get('/carteira/detalhes', async (req: AuthRequest, res: Response): Promise<void> => {
  const rawVendedorIdD = query(req.query.vendedorId);
  const vendedorId = (req.user!.role === 'ADMIN' && rawVendedorIdD) ? rawVendedorIdD : req.user!.userId;
  const toggle = (query(req.query.toggle) || 'garantido') as 'garantido' | 'atrasado' | 'futuro';
  const { inicio, fim, mesStr } = parseMes(query(req.query.mes));
  const busca = query(req.query.busca);
  const percentualFiltro = query(req.query.percentual); // percentual exato (ex.: "40")

  // Mover boletos vencidos para ATRASADO (somente os de dias anteriores a hoje)
  const _inicioDiaHoje2 = new Date(); _inicioDiaHoje2.setHours(0, 0, 0, 0);
  await prisma.boleto.updateMany({
    where: { status: 'PENDENTE', vencimento: { lt: _inicioDiaHoje2 } },
    data: { status: 'ATRASADO' },
  });

  const regras: RegraLike[] = await prisma.regraComissao.findMany({ where: { ativo: true } });

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
        OR: [
          { boletoId: { not: null }, boleto: { dataPagamento: { gte: inicio, lt: fim } } },
          { boletoId: null, dataPagamento: { gte: inicio, lt: fim } },
        ],
      },
      include: {
        boleto: {
          include: {
            carne: { include: { cliente: { select: { nome: true, telefone: true } } } },
            placa: { select: { placa: true } },
            dispositivo: { select: { nome: true, placa: true } },
            placasUnificadas: { include: { placa: { select: { placa: true } } } },
            dispositivosUnificados: { include: { dispositivo: { select: { nome: true, placa: true } } } },
          },
        },
      },
    });
    comissoes.sort((a, b) => {
      const da = a.boleto?.dataPagamento ?? a.dataPagamento ?? new Date(0);
      const db2 = b.boleto?.dataPagamento ?? b.dataPagamento ?? new Date(0);
      return db2.getTime() - da.getTime();
    });

    // Agrupa por boletoId (ou commissionId para orfãs) + percentual aplicado.
    const porTier = new Map<string, ItemCarteira>();
    for (const c of comissoes) {
      if (!c.boleto) {
        // Comissão órfã: cliente foi excluído
        const key = `${c.id}:orphan`;
        const existing = porTier.get(key);
        if (existing) { existing.comissao += Number(c.valorComissao); }
        else {
          porTier.set(key, {
            boletoId: c.id,
            cliente: '(cliente excluído)',
            telefone: null,
            placa: '—',
            vencimento: c.dataPagamento!,
            dataPagamento: c.dataPagamento,
            valorBoleto: Number(c.valorReferencia),
            comissao: Number(c.valorComissao),
            percentual: Number(c.percentualAplicado),
            linkBoleto: null,
          });
        }
        continue;
      }
      const b = c.boleto;
      const percentual = Number(c.percentualAplicado);
      const key = `${b.id}:${Math.round(percentual * 100)}`;
      const isUnificado = b.placasUnificadas.length > 0 || b.dispositivosUnificados.length > 0;
      let placaNome: string;
      if (isUnificado) {
        placaNome = 'Boleto Unificado';
      } else if (b.dispositivo) {
        placaNome = b.dispositivo.placa ? `${b.dispositivo.nome} — ${b.dispositivo.placa}` : b.dispositivo.nome;
      } else {
        placaNome = b.placa?.placa || '—';
      }

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
    const statusFiltro = toggle === 'atrasado' ? 'ATRASADO' : 'PENDENTE';
    const boletos = await prisma.boleto.findMany({
      where: {
        status: statusFiltro,
        vencimento: { gte: inicio, lt: fim },
        OR: [
          { placa: { vendedorId }, placasUnificadas: { none: {} } },
          { placasUnificadas: { some: { placa: { vendedorId } } } },
          { dispositivo: { vendedorId } },
          { dispositivosUnificados: { some: { dispositivo: { vendedorId } } } },
        ],
      },
      include: {
        carne: { include: { cliente: { select: { nome: true, telefone: true } } } },
        placa: { select: { placa: true } },
        dispositivo: { select: { nome: true, placa: true } },
        placasUnificadas: {
          where: { placa: { vendedorId } },
          include: { placa: { select: { placa: true } } },
        },
        dispositivosUnificados: {
          where: { dispositivo: { vendedorId } },
          include: { dispositivo: { select: { nome: true, placa: true } } },
        },
      },
      orderBy: { vencimento: 'asc' },
    });

    for (const b of boletos) {
      const porPct = comissaoPorPercentual(Number(b.valor), b.placasUnificadas, regras, b.dispositivosUnificados);
      const isUnificado = b.placasUnificadas.length > 0 || b.dispositivosUnificados.length > 0;
      let placaNome: string;
      if (isUnificado) {
        placaNome = 'Boleto Unificado';
      } else if (b.dispositivo) {
        placaNome = b.dispositivo.placa ? `${b.dispositivo.nome} — ${b.dispositivo.placa}` : b.dispositivo.nome;
      } else {
        placaNome = b.placa?.placa || '—';
      }
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
      for (const [pct, valor] of porPct) {
        if (valor > 0) itens.push({ ...base, comissao: valor, percentual: pct });
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
    const alvo = Number(percentualFiltro);
    resultado = resultado.filter((i) => mesmoPercentual(i.percentual, alvo));
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

  const regras: RegraLike[] = await prisma.regraComissao.findMany({ where: { ativo: true } });

  const fmtPctCsv = (p: number) => String(p).replace('.', ',');

  const linhas: string[][] = [
    ['Cliente', 'Telefone', 'Dispositivo', 'Vencimento', 'Data Pagamento', 'Valor Boleto (R$)',
     'Percentual (%)', 'Comissão (R$)'],
  ];

  if (toggle === 'garantido') {
    const comissoes = await prisma.comissaoVendedor.findMany({
      where: {
        vendedorId,
        OR: [
          { boletoId: { not: null }, boleto: { dataPagamento: { gte: inicio, lt: fim } } },
          { boletoId: null, dataPagamento: { gte: inicio, lt: fim } },
        ],
      },
      include: {
        boleto: {
          include: {
            carne: { include: { cliente: { select: { nome: true, telefone: true } } } },
            placa: { select: { placa: true } },
            dispositivo: { select: { nome: true, placa: true } },
            placasUnificadas: { include: { placa: { select: { placa: true } } } },
            dispositivosUnificados: { include: { dispositivo: { select: { nome: true, placa: true } } } },
          },
        },
      },
    });

    // Uma linha por (boleto, percentual), somando comissões do mesmo percentual.
    type LinhaCsv = { base: string[]; percentual: number; comissao: number };
    const porChave = new Map<string, LinhaCsv>();
    for (const c of comissoes) {
      const percentual = Number(c.percentualAplicado);
      if (!c.boleto) {
        // Comissão órfã (cliente excluído)
        const key = `${c.id}:${Math.round(percentual * 100)}`;
        const existing = porChave.get(key);
        if (existing) { existing.comissao += Number(c.valorComissao); continue; }
        porChave.set(key, {
          percentual,
          comissao: Number(c.valorComissao),
          base: [
            '(cliente excluído)', '', '—',
            c.dataPagamento?.toISOString().split('T')[0] || '',
            c.dataPagamento?.toISOString().split('T')[0] || '',
            Number(c.valorReferencia).toFixed(2),
          ],
        });
        continue;
      }
      const b = c.boleto;
      let placa: string;
      if (b.placasUnificadas.length > 0 || b.dispositivosUnificados.length > 0) {
        placa = 'Boleto Unificado';
      } else if (b.dispositivo) {
        placa = b.dispositivo.placa ? `${b.dispositivo.nome} — ${b.dispositivo.placa}` : b.dispositivo.nome;
      } else {
        placa = b.placa?.placa || '—';
      }
      const key = `${b.id}:${Math.round(percentual * 100)}`;
      const existing = porChave.get(key);
      if (existing) { existing.comissao += Number(c.valorComissao); continue; }
      porChave.set(key, {
        percentual,
        comissao: Number(c.valorComissao),
        base: [
          b.carne.cliente.nome,
          b.carne.cliente.telefone || '',
          placa,
          b.vencimento.toISOString().split('T')[0],
          b.dataPagamento?.toISOString().split('T')[0] || '',
          Number(b.valor).toFixed(2),
        ],
      });
    }
    for (const { base, percentual, comissao } of porChave.values()) {
      linhas.push([...base, fmtPctCsv(percentual), comissao.toFixed(2)]);
    }
  } else {
    // Atrasado ou Futuro
    const statusFiltro = toggle === 'atrasado' ? 'ATRASADO' : 'PENDENTE';
    const boletos = await prisma.boleto.findMany({
      where: {
        status: statusFiltro,
        vencimento: { gte: inicio, lt: fim },
        OR: [
          { placa: { vendedorId }, placasUnificadas: { none: {} } },
          { placasUnificadas: { some: { placa: { vendedorId } } } },
          { dispositivo: { vendedorId } },
          { dispositivosUnificados: { some: { dispositivo: { vendedorId } } } },
        ],
      },
      include: {
        carne: { include: { cliente: { select: { nome: true, telefone: true } } } },
        placa: { select: { placa: true } },
        dispositivo: { select: { nome: true, placa: true } },
        placasUnificadas: {
          where: { placa: { vendedorId } },
          include: { placa: { select: { placa: true } } },
        },
        dispositivosUnificados: {
          where: { dispositivo: { vendedorId } },
          include: { dispositivo: { select: { nome: true, placa: true } } },
        },
      },
    });
    for (const b of boletos) {
      const porPct = comissaoPorPercentual(Number(b.valor), b.placasUnificadas, regras, b.dispositivosUnificados);
      let identificador: string;
      if (b.placasUnificadas.length > 0 || b.dispositivosUnificados.length > 0) {
        identificador = 'Boleto Unificado';
      } else if (b.dispositivo) {
        identificador = b.dispositivo.placa ? `${b.dispositivo.nome} — ${b.dispositivo.placa}` : b.dispositivo.nome;
      } else {
        identificador = b.placa?.placa || '—';
      }
      for (const [pct, valor] of porPct) {
        if (valor <= 0) continue;
        linhas.push([
          b.carne.cliente.nome,
          b.carne.cliente.telefone || '',
          identificador,
          b.vencimento.toISOString().split('T')[0],
          '',
          Number(b.valor).toFixed(2),
          fmtPctCsv(pct),
          valor.toFixed(2),
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

// ─── GET /api/vendedor/pagamentos — status de pagamento de comissão ───────────
// Aceita token via Authorization header ou query param ?token= (para download em nova aba)
router.get('/pagamentos', async (req: AuthRequest, res: Response): Promise<void> => {
  const rawVendedorId = query(req.query.vendedorId);
  const mes = query(req.query.mes);
  const vendedorId = (req.user!.role === 'ADMIN' && rawVendedorId) ? rawVendedorId : req.user!.userId;

  if (!mes) {
    res.status(400).json({ error: 'Parâmetro mes é obrigatório (YYYY-MM).' });
    return;
  }

  const pagamento = await prisma.pagamentoComissao.findUnique({
    where: { vendedorId_mes: { vendedorId, mes } },
  });

  res.json(pagamento || null);
});

// ─── POST /api/vendedor/pagamentos — registrar pagamento de comissão (ADMIN) ──
router.post('/pagamentos', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { vendedorId, mes, valor } = req.body;

  if (!vendedorId || !mes || valor === undefined) {
    res.status(400).json({ error: 'vendedorId, mes e valor são obrigatórios.' });
    return;
  }

  const pagamento = await prisma.pagamentoComissao.upsert({
    where: { vendedorId_mes: { vendedorId, mes } },
    create: { vendedorId, mes, valor: Number(valor), pago: true },
    update: { valor: Number(valor), pago: true },
  });

  res.json(pagamento);
});

// ─── POST /api/vendedor/pagamentos/:id/comprovante — upload de comprovante (ADMIN) ──
router.post(
  '/pagamentos/:id/comprovante',
  requireRoles('ADMIN'),
  upload.single('comprovante'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const id = param(req, 'id');
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'Arquivo não enviado.' });
      return;
    }

    const pagamento = await prisma.pagamentoComissao.findUnique({ where: { id } });
    if (!pagamento) {
      fs.unlinkSync(file.path);
      res.status(404).json({ error: 'Pagamento não encontrado.' });
      return;
    }

    // Remove arquivo anterior se existir
    if (pagamento.comprovante) {
      const oldPath = resolveComprovantePath(pagamento.comprovante);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const relativePath = path.join('uploads', 'comprovantes', path.basename(file.path)).replace(/\\/g, '/');
    const updated = await prisma.pagamentoComissao.update({
      where: { id },
      data: { comprovante: relativePath, comprovanteMime: file.mimetype },
    });

    res.json(updated);
  }
);

export default router;
