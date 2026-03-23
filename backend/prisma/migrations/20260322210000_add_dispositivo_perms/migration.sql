-- AlterTable
ALTER TABLE "User" ADD COLUMN "podeCriarDispositivo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "podeEditarDispositivo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "podeDesvincularDispositivo" BOOLEAN NOT NULL DEFAULT true;
