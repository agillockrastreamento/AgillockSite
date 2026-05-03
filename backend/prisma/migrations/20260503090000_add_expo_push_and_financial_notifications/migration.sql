-- App push tokens for Expo notifications
CREATE TABLE "AppPushToken" (
    "id" TEXT NOT NULL,
    "clienteLoginId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "plataforma" TEXT,
    "deviceId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoErro" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppPushToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppPushToken_token_key" ON "AppPushToken"("token");
CREATE INDEX "AppPushToken_clienteLoginId_ativo_idx" ON "AppPushToken"("clienteLoginId", "ativo");

ALTER TABLE "AppPushToken"
ADD CONSTRAINT "AppPushToken_clienteLoginId_fkey"
FOREIGN KEY ("clienteLoginId") REFERENCES "ClienteLogin"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Allow financial notifications in the same event feed without requiring a vehicle.
ALTER TABLE "EventoNotificacao" ALTER COLUMN "dispositivoId" DROP NOT NULL;
ALTER TABLE "EventoNotificacao" ADD COLUMN "boletoId" TEXT;

CREATE INDEX "EventoNotificacao_clienteLoginId_createdAt_idx" ON "EventoNotificacao"("clienteLoginId", "createdAt");
CREATE INDEX "EventoNotificacao_boletoId_idx" ON "EventoNotificacao"("boletoId");

ALTER TABLE "EventoNotificacao"
ADD CONSTRAINT "EventoNotificacao_boletoId_fkey"
FOREIGN KEY ("boletoId") REFERENCES "Boleto"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Daily idempotency for due-date and overdue boleto notifications.
CREATE TABLE "NotificacaoFinanceiraEnvio" (
    "id" TEXT NOT NULL,
    "clienteLoginId" TEXT NOT NULL,
    "boletoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "dataReferencia" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificacaoFinanceiraEnvio_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotifFin_cliente_boleto_tipo_data_key"
ON "NotificacaoFinanceiraEnvio"("clienteLoginId", "boletoId", "tipo", "dataReferencia");

CREATE INDEX "NotifFin_tipo_data_idx"
ON "NotificacaoFinanceiraEnvio"("tipo", "dataReferencia");

ALTER TABLE "NotificacaoFinanceiraEnvio"
ADD CONSTRAINT "NotificacaoFinanceiraEnvio_clienteLoginId_fkey"
FOREIGN KEY ("clienteLoginId") REFERENCES "ClienteLogin"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificacaoFinanceiraEnvio"
ADD CONSTRAINT "NotificacaoFinanceiraEnvio_boletoId_fkey"
FOREIGN KEY ("boletoId") REFERENCES "Boleto"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
