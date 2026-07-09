/**
 * Permissões granulares do sub-usuário cliente. Mantido em sincronia com
 * `backend/src/utils/cliente-permissoes.ts` e `AgillockSite/js/auth-guard-cliente.js`.
 */
export type PermissoesRastreamento = {
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
};

export type PermissoesManutencao = {
  ver: boolean;
  criar: boolean;
  editar: boolean;
  excluir: boolean;
  criarRecorrencia: boolean;
  editarRecorrencia: boolean;
  marcarFeita: boolean;
};

export type PermissoesRelatorio = {
  ver: boolean;
  exportar: boolean;
};

export type PermissoesCliente = {
  rastreamento: PermissoesRastreamento;
  manutencao: PermissoesManutencao;
  relatorio: PermissoesRelatorio;
};

export type PermKey =
  | `rastreamento.${keyof PermissoesRastreamento}`
  | `manutencao.${keyof PermissoesManutencao}`
  | `relatorio.${keyof PermissoesRelatorio}`;

export type MePermissoes = {
  tipo: 'responsavel' | 'vinculado';
  nome: string;
  clienteId: string;
  permissoes: PermissoesCliente;
  dispositivoIdsPermitidos: string[] | null;
  multasHabilitado?: boolean;
};

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
  };
}

export function pode(perms: PermissoesCliente, key: PermKey): boolean {
  const [tela, acao] = key.split('.') as [keyof PermissoesCliente, string];
  const grupo = perms[tela] as unknown as Record<string, boolean> | undefined;
  return !!grupo && grupo[acao] === true;
}

export function podeAcessarDispositivo(
  me: MePermissoes | null,
  dispositivoId: string,
): boolean {
  if (!me) return false;
  if (me.dispositivoIdsPermitidos === null) return true;
  return me.dispositivoIdsPermitidos.includes(dispositivoId);
}
