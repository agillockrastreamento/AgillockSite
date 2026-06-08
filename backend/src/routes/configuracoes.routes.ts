import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';

const router = Router();
router.use(authMiddleware);

// GET /api/configuracoes
router.get('/', requireRoles('ADMIN', 'VENDEDOR'), async (_req: AuthRequest, res: Response): Promise<void> => {
  const config = await prisma.configuracoes.findUnique({ where: { id: '1' } });
  if (!config) {
    res.status(404).json({ error: 'Configurações não encontradas.' });
    return;
  }
  res.json(config);
});

// PUT /api/configuracoes
router.put('/', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { percentualMenor, percentualMaior, valorReferencia, multaPercentual, jurosDiarios,
          representanteNome, representanteEmail, representanteTelefone, representanteCpf } = req.body;

  if (percentualMenor === undefined && percentualMaior === undefined && valorReferencia === undefined
      && multaPercentual === undefined && jurosDiarios === undefined
      && representanteNome === undefined && representanteEmail === undefined
      && representanteTelefone === undefined && representanteCpf === undefined) {
    res.status(400).json({ error: 'Informe ao menos um campo para atualizar.' });
    return;
  }

  const data: Record<string, number | string | null> = {};
  if (percentualMenor !== undefined) data.percentualMenor = Number(percentualMenor);
  if (percentualMaior !== undefined) data.percentualMaior = Number(percentualMaior);
  if (valorReferencia !== undefined) data.valorReferencia = Number(valorReferencia);
  if (multaPercentual !== undefined) data.multaPercentual = Number(multaPercentual);
  if (jurosDiarios !== undefined)    data.jurosDiarios    = Number(jurosDiarios);
  if (representanteNome !== undefined)     data.representanteNome     = representanteNome;
  if (representanteEmail !== undefined)    data.representanteEmail    = representanteEmail;
  if (representanteTelefone !== undefined) data.representanteTelefone = representanteTelefone;
  if (representanteCpf !== undefined)      data.representanteCpf      = representanteCpf;

  const config = await prisma.configuracoes.update({
    where: { id: '1' },
    data,
  });
  res.json(config);
});

// ─── Tabela de comissões por valor exato (RegraComissao) ──────────────────────

// GET /api/configuracoes/regras — lista as regras de comissão
router.get('/regras', requireRoles('ADMIN', 'VENDEDOR'), async (_req: AuthRequest, res: Response): Promise<void> => {
  const regras = await prisma.regraComissao.findMany({ orderBy: { valor: 'asc' } });
  res.json(regras);
});

// PUT /api/configuracoes/regras — substitui a lista inteira de regras (somente ADMIN)
// Body: { regras: [{ valor: number, percentual: number }, ...] }
router.put('/regras', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  const lista = Array.isArray(req.body?.regras) ? req.body.regras : null;
  if (!lista) {
    res.status(400).json({ error: 'Envie um array "regras".' });
    return;
  }

  const vistos = new Set<number>();
  const data: { valor: number; percentual: number }[] = [];
  for (const r of lista) {
    const valor = Number(r?.valor);
    const percentual = Number(r?.percentual);
    if (!Number.isFinite(valor) || valor <= 0) {
      res.status(400).json({ error: 'Valor de referência inválido (deve ser maior que zero).' });
      return;
    }
    if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
      res.status(400).json({ error: 'Percentual inválido (deve estar entre 0 e 100).' });
      return;
    }
    const cents = Math.round(valor * 100);
    if (vistos.has(cents)) {
      res.status(400).json({ error: `Valor de referência duplicado: R$ ${valor.toFixed(2)}.` });
      return;
    }
    vistos.add(cents);
    data.push({ valor, percentual });
  }

  await prisma.$transaction([
    prisma.regraComissao.deleteMany({}),
    ...(data.length > 0 ? [prisma.regraComissao.createMany({ data })] : []),
  ]);

  const regras = await prisma.regraComissao.findMany({ orderBy: { valor: 'asc' } });
  res.json(regras);
});

export default router;
