ALTER TABLE "Dispositivo"
ADD COLUMN IF NOT EXISTS "traccarId" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "Dispositivo_traccarId_key" ON "Dispositivo"("traccarId");
