-- Periodicidade configurável da contagem de quilometragem (antes era fixa:
-- kmExcedida mensal e kmReduzida semanal). Valores: SEMANAL | QUINZENAL |
-- MENSAL | SEMESTRAL | ANUAL. NULL mantém o padrão antigo por tipo de evento.
ALTER TABLE "PreferenciaNotificacao" ADD COLUMN "kmPeriodo" TEXT;
