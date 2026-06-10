import { Request, Response, NextFunction } from 'express';

/**
 * Autenticação por API key das rotas de integração chamadas pela IAPRO.
 * A IAPRO envia o header `x-api-key`, que deve bater com IAPRO_WEBHOOK_KEY do .env.
 */
export function iaproApiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.IAPRO_WEBHOOK_KEY;
  if (!configured) {
    res.status(503).json({ error: 'Integração IAPRO não configurada (IAPRO_WEBHOOK_KEY ausente).' });
    return;
  }
  const key = req.headers['x-api-key'];
  if (!key || key !== configured) {
    res.status(401).json({ error: 'API key inválida.' });
    return;
  }
  next();
}
