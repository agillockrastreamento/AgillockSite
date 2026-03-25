-- DropForeignKey
ALTER TABLE "ComissaoVendedor" DROP CONSTRAINT "ComissaoVendedor_boletoId_fkey";

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "emailCobranca" TEXT,
ADD COLUMN     "nirc" TEXT,
ADD COLUMN     "socios" JSONB,
ADD COLUMN     "tipoPessoa" TEXT NOT NULL DEFAULT 'PF';

-- AddForeignKey
ALTER TABLE "ComissaoVendedor" ADD CONSTRAINT "ComissaoVendedor_boletoId_fkey" FOREIGN KEY ("boletoId") REFERENCES "Boleto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
