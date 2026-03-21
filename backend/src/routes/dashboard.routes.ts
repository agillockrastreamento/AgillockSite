import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';

const router = Router();
router.use(authMiddleware);

// GET /api/dashboard
router.get('/', requireRoles('ADMIN'), async (_req: AuthRequest, res: Response): Promise<void> => {
  // Converter para horário do Brasil (UTC-3) para calcular o "hoje" correto
  const agora = new Date();
  const agoraBRT = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const anoBRT = agoraBRT.getUTCFullYear();
  const mesBRT = agoraBRT.getUTCMonth();
  const diaBRT = agoraBRT.getUTCDate();
  // Meia-noite BRT = 03:00 UTC (BRT é UTC-3)
  const inicioDiaHoje = new Date(Date.UTC(anoBRT, mesBRT, diaBRT, 3, 0, 0));
  const fimDiaHoje    = new Date(Date.UTC(anoBRT, mesBRT, diaBRT + 1, 3, 0, 0));

  // Reverter boletos marcados incorretamente como ATRASADO mas com vencimento a partir de hoje
  await prisma.boleto.updateMany({
    where: { status: 'ATRASADO', vencimento: { gte: inicioDiaHoje } },
    data: { status: 'PENDENTE' },
  });

  // Marcar boletos vencidos como ATRASADO (somente os de dias anteriores a hoje)
  await prisma.boleto.updateMany({
    where: { status: 'PENDENTE', vencimento: { lt: inicioDiaHoje } },
    data: { status: 'ATRASADO' },
  });

  const inicioDia = inicioDiaHoje;
  const fimDia    = fimDiaHoje;

  const [totalClientesAtivos, totalPlacasAtivas, recebimentosHoje, totalAtrasados] = await Promise.all([
    prisma.cliente.count({ where: { status: 'ATIVO' } }),
    prisma.placa.count({ where: { ativo: true } }),
    prisma.boleto.aggregate({
      where: { status: 'PAGO', dataPagamento: { gte: inicioDia, lt: fimDia } },
      _sum: { valorPago: true },
    }),
    prisma.boleto.count({ where: { status: 'ATRASADO' } }),
  ]);

  res.json({
    totalClientesAtivos,
    totalPlacasAtivas,
    recebimentosHoje: Number(recebimentosHoje._sum.valorPago ?? 0),
    totalAtrasados,
  });
});

export default router;
