-- DropForeignKey
ALTER TABLE "Dispositivo" DROP CONSTRAINT "Dispositivo_criadoPorId_fkey";

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "dispositivosHabilitado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "limiteDispositivos" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Dispositivo" ADD COLUMN     "criadoPorClienteLoginId" TEXT,
ALTER COLUMN "criadoPorId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Dispositivo" ADD CONSTRAINT "Dispositivo_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispositivo" ADD CONSTRAINT "Dispositivo_criadoPorClienteLoginId_fkey" FOREIGN KEY ("criadoPorClienteLoginId") REFERENCES "ClienteLogin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
