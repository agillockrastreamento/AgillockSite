/**
 * Estrutura única de permissões granulares dos sub-usuários do cliente.
 *
 * Convenção: o login do tipo 'responsavel' SEMPRE tem todas as permissões
 * e acesso a todos os dispositivos do cliente (a estrutura abaixo é ignorada
 * para ele). Sub-usuários 'vinculado' são restringidos pelo JSON salvo em
 * ClienteLogin.permissoes + lista de ClienteLoginPlaca.
 */
export interface PermissoesRastreamento {
  ver: boolean;
  bloquear: boolean;
  desbloquear: boolean;
  criarCerca: boolean;
  verCerca: boolean;
  verEventos: boolean;
  marcarManutencaoRecorrenteFeita: boolean;
  marcarRecorrenciaDataFeita: boolean;
  uploadFoto: boolean;
  editarIdentificacao: boolean;
}

export interface PermissoesManutencao {
  ver: boolean;
  criar: boolean;
  editar: boolean;
  excluir: boolean;
  criarRecorrencia: boolean;
  editarRecorrencia: boolean;
  marcarFeita: boolean;
}

export interface PermissoesRelatorio {
  ver: boolean;
  exportar: boolean;
}

export interface PermissoesMultas {
  ver: boolean;
  pagar: boolean;
}

export interface PermissoesCliente {
  rastreamento: PermissoesRastreamento;
  manutencao: PermissoesManutencao;
  relatorio: PermissoesRelatorio;
  multas: PermissoesMultas;
}

export type PermKey =
  | `rastreamento.${keyof PermissoesRastreamento}`
  | `manutencao.${keyof PermissoesManutencao}`
  | `relatorio.${keyof PermissoesRelatorio}`
  | `multas.${keyof PermissoesMultas}`;

export function permissoesVazias(): PermissoesCliente {
  return {
    rastreamento: {
      ver: false, bloquear: false, desbloquear: false,
      criarCerca: false, verCerca: false, verEventos: false,
      marcarManutencaoRecorrenteFeita: false,
      marcarRecorrenciaDataFeita: false,
      uploadFoto: false, editarIdentificacao: false,
    },
    manutencao: {
      ver: false, criar: false, editar: false, excluir: false,
      criarRecorrencia: false, editarRecorrencia: false, marcarFeita: false,
    },
    relatorio: { ver: false, exportar: false },
    multas: { ver: false, pagar: false },
  };
}

export function permissoesTotais(): PermissoesCliente {
  return {
    rastreamento: {
      ver: true, bloquear: true, desbloquear: true,
      criarCerca: true, verCerca: true, verEventos: true,
      marcarManutencaoRecorrenteFeita: true,
      marcarRecorrenciaDataFeita: true,
      uploadFoto: true, editarIdentificacao: true,
    },
    manutencao: {
      ver: true, criar: true, editar: true, excluir: true,
      criarRecorrencia: true, editarRecorrencia: true, marcarFeita: true,
    },
    relatorio: { ver: true, exportar: true },
    multas: { ver: true, pagar: true },
  };
}

// Sanitiza um JSON arbitrário recebido do cliente para o formato canônico.
export function normalizarPermissoes(input: unknown): PermissoesCliente {
  const base = permissoesVazias() as unknown as Record<string, Record<string, boolean>>;
  if (!input || typeof input !== 'object') return base as unknown as PermissoesCliente;
  const src = input as Record<string, Record<string, unknown>>;

  for (const tela of ['rastreamento', 'manutencao', 'relatorio', 'multas'] as const) {
    const grupo = src[tela];
    if (!grupo || typeof grupo !== 'object') continue;
    for (const acao of Object.keys(base[tela])) {
      base[tela][acao] = grupo[acao] === true;
    }
  }
  return base as unknown as PermissoesCliente;
}

// Indexa por "tela.acao" para checagens rápidas no middleware.
export function pode(perms: PermissoesCliente, key: PermKey): boolean {
  const [tela, acao] = key.split('.') as [keyof PermissoesCliente, string];
  const grupo = (perms as unknown as Record<string, Record<string, boolean> | undefined>)[tela];
  return !!grupo && grupo[acao] === true;
}
