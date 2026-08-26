import { Request, Response, NextFunction } from 'express';

/**
 * Autenticação por API key da integração de WhatsApp (VozChat → AgilLock, server-to-server).
 * O VozChat envia o header `x-api-key` (ou Authorization: Bearer <key>), que deve bater com
 * WHATSAPP_API_KEY do .env. Mesmo padrão da integração Raposo / IAPRO / SafeLock.
 */
export function whatsappApiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.WHATSAPP_API_KEY;
  if (!configured) {
    res.status(503).json({ error: 'Integração WhatsApp não configurada (WHATSAPP_API_KEY ausente).' });
    return;
  }
  const header = req.headers['x-api-key'];
  const bearer = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const key = (typeof header === 'string' && header) || bearer;
  if (!key || key !== configured) {
    res.status(401).json({ error: 'API key inválida.' });
    return;
  }
  next();
}
