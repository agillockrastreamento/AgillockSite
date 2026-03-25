import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET!;
const EXPIRES_IN = '8h';

export interface JwtPayload {
  userId: string;
  role: string;
  nome: string;
  // Permissões granulares — presentes apenas para COLABORADOR
  podeExcluirCliente?: boolean;
  podeEditarCliente?: boolean;
  podeInativarCliente?: boolean;
  podeExcluirPlaca?: boolean;
  podeInativarPlaca?: boolean;
  podeExcluirDispositivo?: boolean;
  podeInativarDispositivo?: boolean;
  podeCriarDispositivo?: boolean;
  podeEditarDispositivo?: boolean;
  podeDesvincularDispositivo?: boolean;
  podeBaixaManual?: boolean;
  podeCancelarCarne?: boolean;
  podeAlterarVencimento?: boolean;
  podeCriarContrato?: boolean;
  podeEditarContrato?: boolean;
  podeExcluirContrato?: boolean;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}
