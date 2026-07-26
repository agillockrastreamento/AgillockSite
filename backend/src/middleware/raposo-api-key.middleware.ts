import { Request, Response, NextFunction } from 'express';

/**
 * Autenticação por API key da integração do Raposo Motors (server-to-server).
 * O Raposo envia o header `x-api-key`, que deve bater com RAPOSO_API_KEY do .env.
 * Mesmo padrão da integração IAPRO / worker de multas.
 */
export function raposoApiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.RAPOSO_API_KEY;
  if (!configured) {
    res.status(503).json({ error: 'Integração Raposo não configurada (RAPOSO_API_KEY ausente).' });
    return;
  }
  const key = req.headers['x-api-key'];
  if (!key || key !== configured) {
    res.status(401).json({ error: 'API key inválida.' });
    return;
  }
  next();
}
