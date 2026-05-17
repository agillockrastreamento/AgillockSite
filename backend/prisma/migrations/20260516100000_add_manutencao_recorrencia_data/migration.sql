-- CreateTable
CREATE TABLE "ManutencaoRecorrenciaData" (
    "id" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "clienteLoginId" TEXT,
    "criadoPorAdminId" TEXT,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "tipoRecorrencia" TEXT NOT NULL DEFAULT 'AVULSA',
    "dataReferencia" TIMESTAMP(3) NOT NULL,
    "intervaloDias" INTEGER,
    "diasSemana" JSONB,
    "diaDoMes" INTEGER,
    "mesDoAno" INTEGER,
    "alerta7dEnviado" BOOLEAN NOT NULL DEFAULT false,
    "alerta4dEnviado" BOOLEAN NOT NULL DEFAULT false,
    "alerta2dEnviado" BOOLEAN NOT NULL DEFAULT false,
    "alerta1dEnviado" BOOLEAN NOT NULL DEFAULT false,
    "alertaDiaEnviado" BOOLEAN NOT NULL DEFAULT false,
    "ultimoAlertaPosDue" TIMESTAMP(3),
    "ciclosCompletos" INTEGER NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "origem" TEXT NOT NULL DEFAULT 'CLIENTE',
    "canalNotificacao" TEXT NOT NULL DEFAULT 'todos',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManutencaoRecorrenciaData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManutencaoRecorrenciaData_dispositivoId_ativa_idx" ON "ManutencaoRecorrenciaData"("dispositivoId", "ativa");

-- CreateIndex
CREATE INDEX "ManutencaoRecorrenciaData_dataReferencia_ativa_idx" ON "ManutencaoRecorrenciaData"("dataReferencia", "ativa");

-- AddForeignKey
ALTER TABLE "ManutencaoRecorrenciaData" ADD CONSTRAINT "ManutencaoRecorrenciaData_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManutencaoRecorrenciaData" ADD CONSTRAINT "ManutencaoRecorrenciaData_clienteLoginId_fkey" FOREIGN KEY ("clienteLoginId") REFERENCES "ClienteLogin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManutencaoRecorrenciaData" ADD CONSTRAINT "ManutencaoRecorrenciaData_criadoPorAdminId_fkey" FOREIGN KEY ("criadoPorAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
