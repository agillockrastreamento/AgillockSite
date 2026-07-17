-- Recorte por veículo da consulta de multas (padrão desligado) e chave para
-- silenciar os eventos de um dispositivo apenas para o admin (padrão ligado).
ALTER TABLE "Dispositivo" ADD COLUMN "multasHabilitado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Dispositivo" ADD COLUMN "eventosAdminHabilitado" BOOLEAN NOT NULL DEFAULT true;
