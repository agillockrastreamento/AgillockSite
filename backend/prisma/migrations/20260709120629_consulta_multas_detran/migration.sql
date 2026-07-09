-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "multasHabilitado" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VeiculoMultaSituacao" (
    "id" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "renavam" TEXT,
    "uf" TEXT NOT NULL DEFAULT 'CE',
    "qtdMultas" INTEGER NOT NULL DEFAULT 0,
    "valorTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "possuiDebitoIpva" BOOLEAN NOT NULL DEFAULT false,
    "licenciamentoPendente" BOOLEAN NOT NULL DEFAULT false,
    "extratoId" TEXT,
    "pixEmv" TEXT,
    "pixQrCodeBase64" TEXT,
    "boletoArquivo" TEXT,
    "ultimaConsultaEm" TIMESTAMP(3),
    "ultimaConsultaStatus" TEXT,
    "ultimaConsultaErro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VeiculoMultaSituacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Multa" (
    "id" TEXT NOT NULL,
    "situacaoId" TEXT NOT NULL,
    "ait" TEXT NOT NULL,
    "aitOriginaria" TEXT,
    "motivo" TEXT NOT NULL,
    "dataInfracao" TEXT,
    "dataVencimento" TEXT,
    "valor" DECIMAL(10,2) NOT NULL,
    "valorAPagar" DECIMAL(10,2) NOT NULL,
    "selecaoValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Multa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultaMultaLog" (
    "id" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "inicioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fimEm" TIMESTAMP(3),
    "duracaoMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'EM_ANDAMENTO',
    "clientesConsultados" INTEGER NOT NULL DEFAULT 0,
    "veiculosConsultados" INTEGER NOT NULL DEFAULT 0,
    "veiculosComSucesso" INTEGER NOT NULL DEFAULT 0,
    "veiculosComErro" INTEGER NOT NULL DEFAULT 0,
    "multasColetadas" INTEGER NOT NULL DEFAULT 0,
    "detalhes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultaMultaLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificacaoMultaEnvio" (
    "id" TEXT NOT NULL,
    "clienteLoginId" TEXT NOT NULL,
    "ait" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "dataReferencia" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificacaoMultaEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultaJob" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "uf" TEXT NOT NULL DEFAULT 'CE',
    "placa" TEXT NOT NULL,
    "renavam" TEXT,
    "dispositivoId" TEXT,
    "aits" JSONB,
    "origem" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "resultado" JSONB,
    "erro" TEXT,
    "claimedEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultaJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerStatus" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "ultimoHeartbeat" TIMESTAMP(3),
    "online" BOOLEAN NOT NULL DEFAULT false,
    "info" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VeiculoMultaSituacao_dispositivoId_key" ON "VeiculoMultaSituacao"("dispositivoId");

-- CreateIndex
CREATE INDEX "VeiculoMultaSituacao_clienteId_idx" ON "VeiculoMultaSituacao"("clienteId");

-- CreateIndex
CREATE INDEX "Multa_situacaoId_idx" ON "Multa"("situacaoId");

-- CreateIndex
CREATE INDEX "Multa_ait_idx" ON "Multa"("ait");

-- CreateIndex
CREATE INDEX "ConsultaMultaLog_inicioEm_idx" ON "ConsultaMultaLog"("inicioEm");

-- CreateIndex
CREATE UNIQUE INDEX "NotificacaoMultaEnvio_clienteLoginId_ait_tipo_dataReferenci_key" ON "NotificacaoMultaEnvio"("clienteLoginId", "ait", "tipo", "dataReferencia");

-- CreateIndex
CREATE INDEX "ConsultaJob_status_criadoEm_idx" ON "ConsultaJob"("status", "criadoEm");

-- AddForeignKey
ALTER TABLE "VeiculoMultaSituacao" ADD CONSTRAINT "VeiculoMultaSituacao_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VeiculoMultaSituacao" ADD CONSTRAINT "VeiculoMultaSituacao_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Multa" ADD CONSTRAINT "Multa_situacaoId_fkey" FOREIGN KEY ("situacaoId") REFERENCES "VeiculoMultaSituacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificacaoMultaEnvio" ADD CONSTRAINT "NotificacaoMultaEnvio_clienteLoginId_fkey" FOREIGN KEY ("clienteLoginId") REFERENCES "ClienteLogin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
