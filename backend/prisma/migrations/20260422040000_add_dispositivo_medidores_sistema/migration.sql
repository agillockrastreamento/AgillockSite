ALTER TABLE "Dispositivo"
ADD COLUMN "odometroSistemaMetros" DOUBLE PRECISION,
ADD COLUMN "horimetroSistemaSegundos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "telemetriaUltimaPosicaoEm" TIMESTAMP(3),
ADD COLUMN "telemetriaUltimaLatitude" DOUBLE PRECISION,
ADD COLUMN "telemetriaUltimaLongitude" DOUBLE PRECISION,
ADD COLUMN "telemetriaUltimaIgnicao" BOOLEAN;
