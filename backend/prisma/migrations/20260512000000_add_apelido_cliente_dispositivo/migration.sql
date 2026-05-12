-- AlterTable: add customer-facing device nickname used in the client tracking cards
ALTER TABLE "Dispositivo" ADD COLUMN IF NOT EXISTS "apelidoCliente" TEXT;
