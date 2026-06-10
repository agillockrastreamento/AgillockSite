import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import { query } from '../utils/params';
import prisma from '../utils/prisma';
import {
  listarClientesIapro,
  resumoIapro,
  contadorSemRastreamento,
  compartilharComIapro,
} from '../services/iapro.service';

/**
 * Rotas do painel admin para a tela IAPRO. Montadas em /api/iapro.
 */
const router = Router();
router.use(authMiddleware);

// Períodos pré-definidos do filtro de data (hoje, ontem, 7 dias, personalizado).
function resolverPeriodo(periodo?: string, de?: string, ate?: string): { de?: Date; ate?: Date } {
  const inicioDoDia = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const fimDoDia = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  const hoje = new Date();

  switch (periodo) {
    case 'hoje':
      return { de: inicioDoDia(hoje), ate: fimDoDia(hoje) };
    case 'ontem': {
      const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
      return { de: inicioDoDia(ontem), ate: fimDoDia(ontem) };
    }
    case '7dias': {
      const seteDias = new Date(hoje); seteDias.setDate(seteDias.getDate() - 7);
      return { de: inicioDoDia(seteDias), ate: fimDoDia(hoje) };
    }
    case 'personalizado':
      return {
        de: de ? inicioDoDia(new Date(`${de}T00:00:00`)) : undefined,
        ate: ate ? fimDoDia(new Date(`${ate}T00:00:00`)) : undefined,
      };
    default:
      return {};
  }
}

// ─── GET /api/iapro/resumo — contadores + fatura mensal ────────────────────
router.get('/resumo', requireRoles('ADMIN', 'COLABORADOR'), async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json(await resumoIapro());
});

// ─── GET /api/iapro/badge — veículos IAPRO sem rastreador (sidebar) ────────
router.get('/badge', requireRoles('ADMIN', 'COLABORADOR'), async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ semRastreamento: await contadorSemRastreamento() });
});

// ─── GET /api/iapro/clientes — lista (1 linha por veículo IAPRO) ───────────
router.get('/clientes', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const periodo = resolverPeriodo(query(req.query.periodo), query(req.query.de), query(req.query.ate));
  const linhas = await listarClientesIapro({
    busca: query(req.query.busca),
    status: query(req.query.status),
    de: periodo.de,
    ate: periodo.ate,
  });
  res.json(linhas);
});

// ─── GET /api/iapro/clientes/:id/dispositivos — veículos p/ o modal de compartilhar ──
router.get('/clientes/:id/dispositivos', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const clienteId = String(req.params.id);
  const dispositivos = await prisma.dispositivo.findMany({
    where: {
      ativo: true,
      OR: [{ clienteId }, { clientesVinculados: { some: { clienteId } } }],
    },
    select: { id: true, nome: true, placa: true, marca: true, modeloVeiculo: true, cor: true, ano: true },
    orderBy: { nome: 'asc' },
  });
  res.json(dispositivos);
});

// ─── POST /api/iapro/compartilhar — envia cliente+veículo para a IAPRO ─────
router.post('/compartilhar', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { clienteId, dispositivoId } = req.body || {};
  if (!clienteId || !dispositivoId) {
    res.status(400).json({ error: 'clienteId e dispositivoId são obrigatórios.' });
    return;
  }
  try {
    const resultado = await compartilharComIapro(clienteId, dispositivoId);
    res.json(resultado);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao compartilhar com a IAPRO.';
    res.status(400).json({ error: msg });
  }
});

export default router;
