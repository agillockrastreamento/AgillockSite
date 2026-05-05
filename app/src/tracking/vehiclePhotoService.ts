import { apiRequest } from '../services/api/apiClient';

type UploadVehiclePhotoResponse = {
  imagemUrlCliente: string;
};

type ImageAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

export function uploadVehiclePhoto(dispositivoId: string, asset: ImageAsset) {
  const formData = new FormData();
  formData.append('foto', {
    uri: asset.uri,
    name: asset.fileName ?? 'veiculo.jpg',
    type: asset.mimeType ?? 'image/jpeg',
  } as unknown as Blob);

  return apiRequest<UploadVehiclePhotoResponse>(
    `/cliente/dispositivos/${dispositivoId}/foto`,
    {
      method: 'POST',
      body: formData,
    },
  );
}

export function deleteVehiclePhoto(dispositivoId: string) {
  return apiRequest<void>(`/cliente/dispositivos/${dispositivoId}/foto`, {
    method: 'DELETE',
  });
}
