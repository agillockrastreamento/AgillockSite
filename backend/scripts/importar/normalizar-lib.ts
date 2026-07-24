/**
 * Compat: a lógica de normalização agora mora em `src/utils/normalizar-dispositivo.ts`
 * (para ser compartilhada com a rota de importação). Este arquivo só re-exporta,
 * mantendo o import do script `normalizar-dispositivos.ts` funcionando.
 */
export * from '../../src/utils/normalizar-dispositivo';
