import { environment } from '../config/environment';
import { apiRequest } from '../services/api/apiClient';
import type { AvatarUploadResponse, ClientePerfil } from './profileTypes';

export function resolveUploadUrl(path: string | null | undefined) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;

  const apiOrigin = environment.apiUrl.replace(/\/api\/?$/i, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiOrigin}${normalizedPath}`;
}

export function getClientePerfil() {
  return apiRequest<ClientePerfil>('/cliente/perfil');
}

export function uploadClienteAvatar(asset: {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}) {
  const formData = new FormData();
  formData.append('avatar', {
    uri: asset.uri,
    name: asset.fileName ?? 'avatar.jpg',
    type: asset.mimeType ?? 'image/jpeg',
  } as unknown as Blob);

  return apiRequest<AvatarUploadResponse>('/cliente/perfil/avatar', {
    method: 'POST',
    body: formData,
  });
}

export function uploadClienteLogo(asset: {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}) {
  const formData = new FormData();
  formData.append('logo', {
    uri: asset.uri,
    name: asset.fileName ?? 'logo.jpg',
    type: asset.mimeType ?? 'image/jpeg',
  } as unknown as Blob);

  return apiRequest<{ logoUrl: string }>('/cliente/perfil/logo', {
    method: 'POST',
    body: formData,
  });
}

export function deleteClienteLogo() {
  return apiRequest<null>('/cliente/perfil/logo', { method: 'DELETE' });
}

/** Troca a senha do próprio login — vale para o titular e para o sub-usuário. */
export function alterarSenhaCliente(senhaAtual: string, novaSenha: string) {
  return apiRequest<{ ok: true }>('/cliente/perfil/senha', {
    method: 'PATCH',
    body: JSON.stringify({ senhaAtual, novaSenha }),
  });
}
