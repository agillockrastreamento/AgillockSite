import { Request, Response, NextFunction } from 'express';

/**
 * Autenticação da integração externa da pontuação de CNH (hoje o SafeLock).
 * Bearer `SAFELOCK_API_KEY` (ou header `x-api-key`), distinta da WORKER_API_KEY
 * (aquela é do worker puxando jobs). Sem a chave, o endpoint responde 503.
 */
export function safelockApiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.SAFELOCK_API_KEY;
  if (!configured) {
    res.status(503).json({ erro: { codigo: 'INTEGRACAO_DESLIGADA', mensagem: 'Serviço de pontuação não configurado.' } });
    return;
  }
  const auth = String(req.headers['authorization'] ?? '');
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : String(req.headers['x-api-key'] ?? '');
  if (!key || key !== configured) {
    res.status(401).json({ erro: { codigo: 'CHAVE_INVALIDA', mensagem: 'Chave de integração inválida.' } });
    return;
  }
  next();
}
