// Rotas de multas do painel admin (ADMIN/COLABORADOR). Montadas em /api/multas.
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import prisma from '../utils/prisma';
import {
  iniciarConsultaLote,
  getWorkerStatus,
  criarJobConsulta,
  criarJobPagamento,
  aguardarJob,
  getDetalheVeiculo,
} from '../services/multas.service';

const router = Router();
router.use(authMiddleware);

// ─── GET /api/multas/worker-status ───────────────────────────────────────────
router.get('/worker-status', async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json(await getWorkerStatus());
});

// ─── GET /api/multas/historico ───────────────────────────────────────────────
router.get('/historico', async (req: AuthRequest, res: Response): Promise<void> => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '30'), 10) || 30));
  const where: Record<string, unknown> = {};
  if (req.query.origem) where.origem = String(req.query.origem);
  if (req.query.status) where.status = String(req.query.status);
  const [itens, total] = await Promise.all([
    prisma.consultaMultaLog.findMany({ where, orderBy: { inicioEm: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.consultaMultaLog.count({ where }),
  ]);
  res.json({ itens, total, page });
});

// ─── POST /api/multas/consultar-todos — dispara o lote manualmente ───────────
router.post('/consultar-todos', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const logId = await iniciarConsultaLote('MANUAL_ADMIN');
    res.json({ ok: true, logId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro ao iniciar consulta.' });
  }
});

// ─── GET /api/multas — lista de situações (filtros + paginação) ──────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '30'), 10) || 30));
  const busca = String(req.query.busca ?? '').trim();

  const where: any = {};
  if (req.query.clienteId) where.clienteId = String(req.query.clienteId);
  if (req.query.status) where.ultimaConsultaStatus = String(req.query.status);
  if (req.query.comMultas === 'true') where.qtdMultas = { gt: 0 };
  if (busca) {
    where.OR = [
      { placa: { contains: busca, mode: 'insensitive' } },
      { cliente: { is: { nome: { contains: busca, mode: 'insensitive' } } } },
      { cliente: { is: { cpfCnpj: { contains: busca.replace(/\D/g, '') } } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.veiculoMultaSituacao.findMany({
      where,
      orderBy: [{ qtdMultas: 'desc' }, { ultimaConsultaEm: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: { cliente: { select: { id: true, nome: true, cpfCnpj: true } } },
    }),
    prisma.veiculoMultaSituacao.count({ where }),
  ]);

  res.json({
    itens: rows.map((s) => ({
      dispositivoId: s.dispositivoId,
      placa: s.placa,
      clienteId: s.clienteId,
      clienteNome: s.cliente.nome,
      qtdMultas: s.qtdMultas,
      valorTotal: Number(s.valorTotal),
      possuiDebitoIpva: s.possuiDebitoIpva,
      licenciamentoPendente: s.licenciamentoPendente,
      ultimaConsultaEm: s.ultimaConsultaEm,
      ultimaConsultaStatus: s.ultimaConsultaStatus,
    })),
    total,
    page,
  });
});

// ─── GET /api/multas/:dispositivoId — detalhe ────────────────────────────────
router.get('/:dispositivoId', async (req: AuthRequest, res: Response): Promise<void> => {
  const detalhe = await getDetalheVeiculo(String(req.params.dispositivoId));
  if (!detalhe) {
    res.status(404).json({ error: 'Sem consulta para este veículo.' });
    return;
  }
  res.json(detalhe);
});

// ─── POST /api/multas/:dispositivoId/consultar — consulta sob demanda ────────
router.post('/:dispositivoId/consultar', async (req: AuthRequest, res: Response): Promise<void> => {
  const dispositivoId = String(req.params.dispositivoId);
  const disp = await prisma.dispositivo.findUnique({
    where: { id: dispositivoId },
    select: { id: true, placa: true, renavam: true, chassi: true },
  });
  if (!disp) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }
  const jobId = await criarJobConsulta(disp, 'MANUAL_ADMIN');
  const job = await aguardarJob(jobId);
  if (job?.status === 'ERRO') {
    res.status(502).json({ error: job.erro ?? 'Falha na consulta.', jobId });
    return;
  }
  if (job?.status !== 'CONCLUIDO') {
    res.status(202).json({ status: 'processando', jobId });
    return;
  }
  res.json(await getDetalheVeiculo(dispositivoId));
});

// ─── POST /api/multas/:dispositivoId/pagamento — gera Pix/boleto das selecionadas ──
router.post('/:dispositivoId/pagamento', async (req: AuthRequest, res: Response): Promise<void> => {
  const dispositivoId = String(req.params.dispositivoId);
  const aits = Array.isArray(req.body?.aits) ? (req.body.aits as string[]) : undefined;
  const disp = await prisma.dispositivo.findUnique({
    where: { id: dispositivoId },
    select: { id: true, placa: true, renavam: true, chassi: true },
  });
  if (!disp) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }
  const jobId = await criarJobPagamento(disp, aits, 'MANUAL_ADMIN');
  const job = await aguardarJob(jobId);
  if (job?.status === 'ERRO') {
    res.status(502).json({ error: job.erro ?? 'Falha ao gerar pagamento.', jobId });
    return;
  }
  if (job?.status !== 'CONCLUIDO') {
    res.status(202).json({ status: 'processando', jobId });
    return;
  }
  res.json(job.resultado);
});

export default router;
