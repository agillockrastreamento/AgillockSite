-- Integração IAPRO: controla se o dispositivo aparece no Mapa de Veículos da IAPRO
-- (cliente da IAPRO pode ter veículos na Ágil Lock que não são protegidos lá).

-- AlterTable
ALTER TABLE "Dispositivo" ADD COLUMN "exibirNoMapaIapro" BOOLEAN NOT NULL DEFAULT true;
