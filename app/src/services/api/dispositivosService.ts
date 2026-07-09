// Gestão de dispositivos do cliente (tela "Dispositivos"), espelhando o portal web.
// Disponível apenas quando o admin habilita `dispositivosHabilitado` para o cliente.
import { apiRequest } from './apiClient';

export type DispositivoCliente = {
  id: string;
  nome: string;
  identificador: string;
  categoria: string | null;
  grupo: string | null;
  contato: string | null;
  ativo: boolean;
  modeloRastreador: string | null;
  telefoneRastreador: string | null;
  iccid: string | null;
  operadora: string | null;
  placa: string | null;
  marca: string | null;
  modeloVeiculo: string | null;
  cor: string | null;
  ano: string | null;
  renavam: string | null;
  chassi: string | null;
  combustivel: string | null;
  localInstalacao: string | null;
  instalador: string | null;
  manutencaoAtiva: boolean;
  odometro: number | null;
  imagemUrl: string | null;
  /** false = dispositivo associado pela AgilLock: não pode inativar/excluir nem editar o rastreador. */
  podeGerenciar: boolean;
  /** Só vem no detalhe (GET /:id). */
  podeEditarOdometro?: boolean;
};

export type ListaDispositivos = {
  limite: number;
  total: number;
  podeCriar: boolean;
  dispositivos: DispositivoCliente[];
};

export type ImageAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

export function listarDispositivos() {
  return apiRequest<ListaDispositivos>('/cliente/dispositivos');
}

export function buscarDispositivo(id: string) {
  return apiRequest<DispositivoCliente>(`/cliente/dispositivos/${id}`);
}

export function alternarStatusDispositivo(id: string) {
  return apiRequest<{ id: string; ativo: boolean }>(`/cliente/dispositivos/${id}/status`, {
    method: 'PATCH',
  });
}

export function excluirDispositivo(id: string) {
  return apiRequest<void>(`/cliente/dispositivos/${id}`, { method: 'DELETE' });
}

/** Campos aceitos pelo backend; os do rastreador são ignorados nos dispositivos da AgilLock. */
export type DispositivoPayload = Record<string, string>;

export function salvarDispositivo(
  campos: DispositivoPayload,
  imagem: ImageAsset | null,
  id?: string,
) {
  const formData = new FormData();
  Object.entries(campos).forEach(([chave, valor]) => formData.append(chave, valor));
  if (imagem) {
    formData.append('imagem', {
      uri: imagem.uri,
      name: imagem.fileName ?? 'dispositivo.jpg',
      type: imagem.mimeType ?? 'image/jpeg',
    } as unknown as Blob);
  }

  return apiRequest<DispositivoCliente>(
    id ? `/cliente/dispositivos/${id}` : '/cliente/dispositivos',
    { method: id ? 'PUT' : 'POST', body: formData },
  );
}
