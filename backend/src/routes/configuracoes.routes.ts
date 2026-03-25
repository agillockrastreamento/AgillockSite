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

export default router;
