import { Request, Response, NextFunction } from 'express';

/**
 * Autenticação das rotas chamadas PELO worker de multas (server-to-server).
 * O worker envia `Authorization: Bearer <WORKER_API_KEY>` (ou header `x-api-key`),
 * que deve bater com WORKER_API_KEY do .env.
 */
export function workerApiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.WORKER_API_KEY;
  if (!configured) {
    res.status(503).json({ error: 'Worker de multas não configurado (WORKER_API_KEY ausente).' });
    return;
  }
  const auth = String(req.headers['authorization'] ?? '');
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : String(req.headers['x-api-key'] ?? '');
  if (!key || key !== configured) {
    res.status(401).json({ error: 'API key do worker inválida.' });
    return;
  }
  next();
}
