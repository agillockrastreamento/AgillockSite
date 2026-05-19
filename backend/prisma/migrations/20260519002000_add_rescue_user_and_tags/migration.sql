-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'RESGATE';

-- DropIndex
DROP INDEX "ManutencaoRecorrenciaData_dataReferencia_ativa_idx";

-- DropIndex
DROP INDEX "ManutencaoRecorrenciaData_dispositivoId_ativa_idx";

-- AlterTable
ALTER TABLE "Dispositivo" ADD COLUMN     "enderecoMac" TEXT;

-- CreateTable
CREATE TABLE "TagBLE" (
    "id" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "apelido" TEXT,
    "mac" TEXT,
    "nomeBleAdvertised" TEXT,
    "manufacturerCompanyId" INTEGER,
    "manufacturerDataHex" TEXT,
    "serviceUuids" JSONB,
    "txPowerCalibrado" INTEGER,
    "iosPeripheralUuidCache" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagBLE_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsuarioResgateDispositivo" (
    "usuarioId" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "tagId" TEXT,

    CONSTRAINT "UsuarioResgateDispositivo_pkey" PRIMARY KEY ("usuarioId","dispositivoId")
);

-- CreateIndex
CREATE INDEX "TagBLE_dispositivoId_idx" ON "TagBLE"("dispositivoId");

-- CreateIndex
CREATE UNIQUE INDEX "TagBLE_dispositivoId_mac_key" ON "TagBLE"("dispositivoId", "mac");

-- CreateIndex
CREATE INDEX "UsuarioResgateDispositivo_dispositivoId_idx" ON "UsuarioResgateDispositivo"("dispositivoId");

-- CreateIndex
CREATE INDEX "UsuarioResgateDispositivo_tagId_idx" ON "UsuarioResgateDispositivo"("tagId");

-- AddForeignKey
ALTER TABLE "TagBLE" ADD CONSTRAINT "TagBLE_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioResgateDispositivo" ADD CONSTRAINT "UsuarioResgateDispositivo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioResgateDispositivo" ADD CONSTRAINT "UsuarioResgateDispositivo_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioResgateDispositivo" ADD CONSTRAINT "UsuarioResgateDispositivo_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "TagBLE"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "NotifFin_cliente_boleto_tipo_data_key" RENAME TO "NotificacaoFinanceiraEnvio_clienteLoginId_boletoId_tipo_dat_key";

-- RenameIndex
ALTER INDEX "NotifFin_tipo_data_idx" RENAME TO "NotificacaoFinanceiraEnvio_tipo_dataReferencia_idx";
