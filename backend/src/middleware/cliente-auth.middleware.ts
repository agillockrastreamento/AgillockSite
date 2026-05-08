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
    res.status(401).json({ error: 'Token nao informado.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  let decoded: ClienteJwtPayload;
  try {
    decoded = verifyClienteToken(token);
  } catch {
    res.status(401).json({ error: 'Token invalido ou expirado.' });
    return;
  }

  const login = await prisma.clienteLogin.findUnique({
    where: { id: decoded.sub },
    select: { ativo: true, cliente: { select: { status: true } } },
  });

  if (!login || !login.ativo || login.cliente.status !== 'ATIVO') {
    res.status(401).json({ error: 'Acesso inativo. Contate o administrador.' });
    return;
  }

  req.cliente = decoded;
  next();
}

export function requireResponsavel(
  req: ClienteRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.cliente) {
    res.status(403).json({ error: 'Acesso restrito ao cliente responsavel pelo faturamento.' });
    return;
  }

  prisma.dispositivo
    .count({ where: { clienteId: req.cliente.clienteId, ativo: true } })
    .then((count) => {
      if (count <= 0) {
        res.status(403).json({ error: 'Acesso restrito ao cliente responsavel pelo faturamento.' });
        return;
      }
      next();
    })
    .catch(next);
}
