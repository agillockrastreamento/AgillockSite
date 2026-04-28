import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET!;
const EXPIRES_IN = '8h';
const CLIENTE_EXPIRES_IN = '7d';

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
  podeCriarLoginCliente?: boolean;
  podeEditarLoginCliente?: boolean;
  podeInativarLoginCliente?: boolean;
  podeExcluirLoginCliente?: boolean;
}

export interface ClienteJwtPayload {
  sub: string;       // clienteLoginId
  clienteId: string;
  role: 'CLIENTE';
  tipo: 'responsavel' | 'vinculado';
  nome: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}

export function signClienteToken(payload: ClienteJwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: CLIENTE_EXPIRES_IN });
}

export function verifyClienteToken(token: string): ClienteJwtPayload {
  const decoded = jwt.verify(token, SECRET) as ClienteJwtPayload;
  if (decoded.role !== 'CLIENTE') throw new Error('Token inválido para portal do cliente.');
  return decoded;
}

export interface ShareTokenPayload {
  type: 'share';
  dispositivoId: string;
}

export function signShareToken(dispositivoId: string): string {
  return jwt.sign({ type: 'share', dispositivoId }, SECRET, { expiresIn: '24h' });
}

export function verifyShareToken(token: string): ShareTokenPayload {
  const decoded = jwt.verify(token, SECRET) as ShareTokenPayload;
  if (decoded.type !== 'share') throw new Error('Token de compartilhamento inválido.');
  return decoded;
}
