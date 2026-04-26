-- AlterTable: add km fields to PreferenciaNotificacao
ALTER TABLE "PreferenciaNotificacao" ADD COLUMN "kmMaximo30Dias"     INTEGER;
ALTER TABLE "PreferenciaNotificacao" ADD COLUMN "diaRenovacaoMes"    INTEGER;
ALTER TABLE "PreferenciaNotificacao" ADD COLUMN "kmMinimo7Dias"      INTEGER;
ALTER TABLE "PreferenciaNotificacao" ADD COLUMN "diaSemanaRenovacao" INTEGER;
ALTER TABLE "PreferenciaNotificacao" ADD COLUMN "kmTrocaOleo"        INTEGER;

-- CreateTable: EstadoKmNotificacao
CREATE TABLE "EstadoKmNotificacao" (
    "id"                 TEXT NOT NULL,
    "clienteLoginId"     TEXT NOT NULL,
    "dispositivoId"      TEXT NOT NULL,
    "tipoEvento"         TEXT NOT NULL,
    "kmBaseMetros"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataBase"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notificacaoEnviada" BOOLEAN NOT NULL DEFAULT false,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EstadoKmNotificacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EstadoKmNotificacao_clienteLoginId_dispositivoId_tipoEvento_key"
    ON "EstadoKmNotificacao"("clienteLoginId", "dispositivoId", "tipoEvento");

-- AddForeignKey
ALTER TABLE "EstadoKmNotificacao" ADD CONSTRAINT "EstadoKmNotificacao_clienteLoginId_fkey"
    FOREIGN KEY ("clienteLoginId") REFERENCES "ClienteLogin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EstadoKmNotificacao" ADD CONSTRAINT "EstadoKmNotificacao_dispositivoId_fkey"
    FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
