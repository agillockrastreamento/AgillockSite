-- Consulta de multas por veículo passa a nascer habilitada (facilita a gestão).
-- Só altera o DEFAULT da coluna; os registros existentes não são tocados aqui
-- (já foram habilitados em produção via UPDATE manual).
ALTER TABLE "Dispositivo" ALTER COLUMN "multasHabilitado" SET DEFAULT true;
