-- AlterTable: pagamento pré-gerado do licenciamento em VeiculoMultaSituacao
ALTER TABLE "VeiculoMultaSituacao"
    ADD COLUMN "licenciamentoValor" DECIMAL(10,2),
    ADD COLUMN "licenciamentoItens" JSONB,
    ADD COLUMN "licenciamentoPixEmv" TEXT,
    ADD COLUMN "licenciamentoPixQrCodeBase64" TEXT,
    ADD COLUMN "licenciamentoBoletoArquivo" TEXT;
