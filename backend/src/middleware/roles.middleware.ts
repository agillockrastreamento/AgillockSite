import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';

export function requireRoles(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Acesso negado.' });
      return;
    }
    next();
  };
}

export function requireMonitoramentoAccess(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Token nÃ£o informado.' });
    return;
  }
  if (req.user.role === 'ADMIN') {
    next();
    return;
  }
  if (req.user.role === 'COLABORADOR' && req.user.podeAcessarMonitoramento === true) {
    next();
    return;
  }
  res.status(403).json({ error: 'Sem permissÃ£o para acessar a Ã¡rea de monitoramento.' });
}
