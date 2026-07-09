// Rotas chamadas PELO worker de multas (server-to-server, autenticadas por WORKER_API_KEY).
// Montadas em /api/worker. Ver docs/multas/ARQUITETURA_WORKER.md.

import { Router, Request, Response } from 'express';
import { workerApiKeyMiddleware } from '../middleware/worker-api-key.middleware';
import {
  recuperarJobsTravados,
  claimProximoJob,
  concluirJobComResultado,
  registrarErroJob,
  registrarHeartbeat,
} from '../services/multas.service';

const router = Router();
router.use(workerApiKeyMiddleware);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LONGPOLL_MS = 25_000;
const POLL_INTERVALO_MS = 1_500;

// ─── POST /api/worker/claim — long-poll pelo próximo job ─────────────────────
// Responde assim que houver um job PENDENTE (ou { job: null } após ~25s).
router.post('/claim', async (_req: Request, res: Response): Promise<void> => {
  try {
    await recuperarJobsTravados();
    const ate = Date.now() + LONGPOLL_MS;
    // registra atividade do worker (também serve de heartbeat)
    await registrarHeartbeat();
    while (Date.now() < ate) {
      const job = await claimProximoJob();
      if (job) {
        res.json({ job });
        return;
      }
      if (res.writableEnded) return; // worker desconectou
      await sleep(POLL_INTERVALO_MS);
    }
    res.json({ job: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro no claim.';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/worker/jobs/:id/resultado — worker devolve o resultado ────────
router.post('/jobs/:id/resultado', async (req: Request, res: Response): Promise<void> => {
  try {
    await concluirJobComResultado(String(req.params.id), req.body?.resultado ?? req.body);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao processar resultado.';
    res.status(400).json({ error: msg });
  }
});

// ─── POST /api/worker/jobs/:id/erro — worker reporta falha ───────────────────
router.post('/jobs/:id/erro', async (req: Request, res: Response): Promise<void> => {
  try {
    const mensagem = String(req.body?.mensagem ?? 'Erro no worker');
    const permanente = req.body?.permanente === true;
    await registrarErroJob(String(req.params.id), mensagem, permanente);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao registrar falha.';
    res.status(400).json({ error: msg });
  }
});

// ─── POST /api/worker/heartbeat — sinal de vida ──────────────────────────────
router.post('/heartbeat', async (req: Request, res: Response): Promise<void> => {
  try {
    await registrarHeartbeat(req.body?.info);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro no heartbeat.';
    res.status(500).json({ error: msg });
  }
});

export default router;
