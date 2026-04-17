import { Request, Response, NextFunction } from 'express';
import { verifyClienteToken, ClienteJwtPayload } from '../utils/jwt';
import prisma from '../utils/prisma';

export interface ClienteRequest extends Request {
  cliente?: ClienteJwtPayload;
}

export async function clienteAuthMiddleware(
  req: ClienteRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token não informado.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  let decoded: ClienteJwtPayload;
  try {
    decoded = verifyClienteToken(token);
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado.' });
    return;
  }

  // Verifica se o login ainda está ativo no banco (força logout imediato ao inativar)
  const login = await prisma.clienteLogin.findUnique({
    where: { id: decoded.sub },
    select: { ativo: true },
  });

  if (!login || !login.ativo) {
    res.status(401).json({ error: 'Acesso inativo. Contate o administrador.' });
    return;
  }

  req.cliente = decoded;
  next();
}

/** Requer que o cliente seja do tipo responsavel */
export function requireResponsavel(
  req: ClienteRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.cliente || req.cliente.tipo !== 'responsavel') {
    res.status(403).json({ error: 'Acesso restrito ao cliente responsável pelo faturamento.' });
    return;
  }
  next();
}
