-- CreateTable
CREATE TABLE "PagamentoComissao" (
    "id" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "mes" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "pago" BOOLEAN NOT NULL DEFAULT false,
    "comprovante" TEXT,
    "comprovanteMime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PagamentoComissao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PagamentoComissao_vendedorId_mes_key" ON "PagamentoComissao"("vendedorId", "mes");

-- AddForeignKey
ALTER TABLE "PagamentoComissao" ADD CONSTRAINT "PagamentoComissao_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
