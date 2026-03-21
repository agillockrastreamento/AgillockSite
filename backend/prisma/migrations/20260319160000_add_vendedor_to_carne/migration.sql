-- AlterTable
ALTER TABLE "Carne" ADD COLUMN "vendedorId" TEXT;

-- AddForeignKey
ALTER TABLE "Carne" ADD CONSTRAINT "Carne_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
