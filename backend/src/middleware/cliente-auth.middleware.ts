import { Request, Response, NextFunction } from 'express';
import { verifyClienteToken, ClienteJwtPayload } from '../utils/jwt';
import prisma from '../utils/prisma';
import {
  PermissoesCliente,
  PermKey,
  normalizarPermissoes,
  permissoesTotais,
  pode,
} from '../utils/cliente-permissoes';

export interface ClienteContexto extends ClienteJwtPayload {
  // Lista de dispositivoIds que o sub-usuário pode acessar.
  // null = sem restrição (responsavel — acesso a todos do cliente).
  dispositivoIdsPermitidos: string[] | null;
  permissoes: PermissoesCliente;
}

export interface ClienteRequest extends Request {
  cliente?: ClienteContexto;
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

  // Revogação imediata: consulta o estado atual do login a cada request.
  const login = await prisma.clienteLogin.findUnique({
    where: { id: decoded.sub },
    select: {
      ativo: true,
      tipo: true,
      permissoes: true,
      cliente: { select: { status: true } },
      placasPermitidas: { select: { dispositivoId: true } },
    },
  });

  if (!login || !login.ativo || login.cliente.status !== 'ATIVO') {
    res.status(401).json({ error: 'Acesso inativo. Contate o administrador.' });
    return;
  }

  const isResponsavel = login.tipo === 'responsavel';

  req.cliente = {
    ...decoded,
    tipo: isResponsavel ? 'responsavel' : 'vinculado',
    dispositivoIdsPermitidos: isResponsavel
      ? null
      : login.placasPermitidas.map((p) => p.dispositivoId),
    permissoes: isResponsavel
      ? permissoesTotais()
      : normalizarPermissoes(login.permissoes),
  };
  next();
}

/**
 * Bloqueia o acesso para sub-usuários vinculados.
 * Use nas rotas que só fazem sentido para o titular do cliente
 * (pagamentos, notificações financeiras, CRUD de sub-usuários).
 */
export function requireResponsavel(
  req: ClienteRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.cliente || req.cliente.tipo !== 'responsavel') {
    res.status(403).json({ error: 'Acesso restrito ao cliente responsavel pelo faturamento.' });
    return;
  }
  next();
}

/**
 * Cria um middleware que exige uma permissão granular específica.
 * Responsável sempre passa (permissoesTotais).
 */
export function requirePermission(key: PermKey) {
  return (req: ClienteRequest, res: Response, next: NextFunction): void => {
    if (!req.cliente) {
      res.status(401).json({ error: 'Não autenticado.' });
      return;
    }
    if (!pode(req.cliente.permissoes, key)) {
      res.status(403).json({ error: 'Sem permissão para esta ação.' });
      return;
    }
    next();
  };
}

/**
 * Verifica se o cliente atual pode acessar um dispositivo específico.
 * Use em handlers que recebem dispositivoId como parâmetro.
 */
export function podeAcessarDispositivo(req: ClienteRequest, dispositivoId: string): boolean {
  if (!req.cliente) return false;
  if (req.cliente.dispositivoIdsPermitidos === null) return true;
  return req.cliente.dispositivoIdsPermitidos.includes(dispositivoId);
}

/**
 * Constrói a cláusula Prisma `where` que devolve apenas dispositivos
 * acessíveis ao cliente logado:
 *   - pertencem ao seu cliente (direto ou via DispositivoCliente);
 *   - e, se for sub-usuário 'vinculado', estão na lista explícita de placas permitidas.
 *
 * Use espalhando em outros `where` — preserva filtros como `ativo` e `id: 'X'`
 * usados em buscas pontuais (Prisma combina os filtros com AND implícito).
 */
export function whereDispositivosDoCliente(req: ClienteRequest): object {
  const clienteId = req.cliente!.clienteId;
  const ors: object[] = [
    {
      OR: [
        { clienteId },
        { clientesVinculados: { some: { clienteId } } },
      ],
    },
  ];
  const ids = req.cliente!.dispositivoIdsPermitidos;
  if (ids !== null) {
    ors.push({ id: { in: ids } });
  }
  return { AND: ors };
}
