/*
  Warnings:

  - You are about to drop the column `motoristaId` on the `Dispositivo` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Dispositivo" DROP CONSTRAINT "Dispositivo_motoristaId_fkey";

-- AlterTable
ALTER TABLE "Dispositivo" DROP COLUMN "motoristaId";

-- CreateTable
CREATE TABLE "MotoristaDispositivo" (
    "motoristaId" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,

    CONSTRAINT "MotoristaDispositivo_pkey" PRIMARY KEY ("motoristaId","dispositivoId")
);

-- AddForeignKey
ALTER TABLE "MotoristaDispositivo" ADD CONSTRAINT "MotoristaDispositivo_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "Motorista"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotoristaDispositivo" ADD CONSTRAINT "MotoristaDispositivo_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
