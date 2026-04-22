/*
  Warnings:

  - A unique constraint covering the columns `[identificador]` on the table `Motorista` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Motorista" ADD COLUMN     "identificador" TEXT,
ADD COLUMN     "traccarId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Motorista_identificador_key" ON "Motorista"("identificador");
