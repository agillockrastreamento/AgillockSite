-- CreateTable
CREATE TABLE "GeocodeCache" (
    "chave" TEXT NOT NULL,
    "endereco" TEXT NOT NULL,
    "provedor" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeocodeCache_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE INDEX "GeocodeCache_criadoEm_idx" ON "GeocodeCache"("criadoEm");

-- CreateIndex
CREATE INDEX "GeocodeCache_provedor_idx" ON "GeocodeCache"("provedor");
