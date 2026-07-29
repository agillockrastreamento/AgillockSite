-- CreateTable
CREATE TABLE "LimpezaAnteriorHistorico" (
    "id" TEXT NOT NULL,
    "usuarioAnteriorId" INTEGER,
    "clienteNome" TEXT NOT NULL,
    "clienteId" TEXT,
    "modo" TEXT NOT NULL,
    "dispositivos" INTEGER NOT NULL DEFAULT 0,
    "motoristas" INTEGER NOT NULL DEFAULT 0,
    "geocercas" INTEGER NOT NULL DEFAULT 0,
    "usuarioExcluido" BOOLEAN NOT NULL DEFAULT false,
    "erro" INTEGER NOT NULL DEFAULT 0,
    "itens" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" TEXT NOT NULL,

    CONSTRAINT "LimpezaAnteriorHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LimpezaAnteriorHistorico_clienteNome_idx" ON "LimpezaAnteriorHistorico"("clienteNome");

-- CreateIndex
CREATE INDEX "LimpezaAnteriorHistorico_clienteId_idx" ON "LimpezaAnteriorHistorico"("clienteId");

-- CreateIndex
CREATE INDEX "LimpezaAnteriorHistorico_createdAt_idx" ON "LimpezaAnteriorHistorico"("createdAt");

-- AddForeignKey
ALTER TABLE "LimpezaAnteriorHistorico" ADD CONSTRAINT "LimpezaAnteriorHistorico_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LimpezaAnteriorHistorico" ADD CONSTRAINT "LimpezaAnteriorHistorico_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
