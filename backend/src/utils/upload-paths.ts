import path from 'path';

// Mantem uploads sempre em backend/uploads, independente do diretório usado para subir o processo.
export const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'uploads');
export const DISPOSITIVOS_UPLOADS_DIR = path.join(UPLOADS_DIR, 'dispositivos');
export const CLIENTE_UPLOADS_DIR = path.join(UPLOADS_DIR, 'cliente');
export const COMPROVANTES_UPLOADS_DIR = path.join(UPLOADS_DIR, 'comprovantes');
