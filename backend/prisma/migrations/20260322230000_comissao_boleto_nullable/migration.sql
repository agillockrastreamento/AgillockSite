ALTER TABLE "ComissaoVendedor" ALTER COLUMN "boletoId" DROP NOT NULL;
ALTER TABLE "ComissaoVendedor" ADD COLUMN "dataPagamento" TIMESTAMP(3);
