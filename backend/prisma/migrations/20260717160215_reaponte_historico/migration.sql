-- CreateTable
CREATE TABLE "ReaponteHistorico" (
    "id" TEXT NOT NULL,
    "clienteNome" TEXT NOT NULL,
    "clienteId" TEXT,
    "comando" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "ok" INTEGER NOT NULL,
    "erro" INTEGER NOT NULL,
    "itens" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" TEXT NOT NULL,

    CONSTRAINT "ReaponteHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReaponteHistorico_clienteNome_idx" ON "ReaponteHistorico"("clienteNome");

-- CreateIndex
CREATE INDEX "ReaponteHistorico_clienteId_idx" ON "ReaponteHistorico"("clienteId");

-- CreateIndex
CREATE INDEX "ReaponteHistorico_createdAt_idx" ON "ReaponteHistorico"("createdAt");

-- AddForeignKey
ALTER TABLE "ReaponteHistorico" ADD CONSTRAINT "ReaponteHistorico_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReaponteHistorico" ADD CONSTRAINT "ReaponteHistorico_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
