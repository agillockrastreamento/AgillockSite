-- Integração IAPRO: padrão passa a ser DESATIVADO.
-- O dispositivo só aparece no Mapa de Veículos da IAPRO quando o admin ativar explicitamente.

-- Novo padrão da coluna
ALTER TABLE "Dispositivo" ALTER COLUMN "exibirNoMapaIapro" SET DEFAULT false;

-- Dispositivos existentes foram marcados automaticamente (default true anterior),
-- não por escolha do admin. Zera todos para que o admin ative manualmente quem deve aparecer.
UPDATE "Dispositivo" SET "exibirNoMapaIapro" = false;
