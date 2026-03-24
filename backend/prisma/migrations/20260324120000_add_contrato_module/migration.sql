-- AlterTable User: add contrato permissions
ALTER TABLE "User" ADD COLUMN     "podeCriarContrato" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN     "podeEditarContrato" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN     "podeExcluirContrato" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable Configuracoes: add representante fields
ALTER TABLE "Configuracoes" ADD COLUMN     "representanteCpf" TEXT;
ALTER TABLE "Configuracoes" ADD COLUMN     "representanteEmail" TEXT;
ALTER TABLE "Configuracoes" ADD COLUMN     "representanteNome" TEXT;
ALTER TABLE "Configuracoes" ADD COLUMN     "representanteTelefone" TEXT;

-- CreateTable
CREATE TABLE "Contrato" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "fiadores" JSONB,
    "testemunhas" JSONB NOT NULL,
    "htmlConteudo" TEXT NOT NULL,
    "metodoAutenticacao" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "clicksignEnvelopeId" TEXT,
    "clicksignDocumentoId" TEXT,
    "signatarios" JSONB,
    "criadoPorId" TEXT NOT NULL,
    "assinadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contrato_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
