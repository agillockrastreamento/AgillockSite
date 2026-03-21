-- AlterTable
ALTER TABLE "Configuracoes" ADD COLUMN     "jurosDiarios" DECIMAL(5,2) NOT NULL DEFAULT 0.33,
ADD COLUMN     "multaPercentual" DECIMAL(5,2) NOT NULL DEFAULT 5.00;
