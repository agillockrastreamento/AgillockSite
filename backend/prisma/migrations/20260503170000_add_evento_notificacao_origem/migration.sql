ALTER TABLE "EventoNotificacao" ADD COLUMN "origemTipo" TEXT;
ALTER TABLE "EventoNotificacao" ADD COLUMN "origemId" TEXT;
ALTER TABLE "EventoNotificacao" ADD COLUMN "adminEvento" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "EventoNotificacao_origemTipo_createdAt_idx" ON "EventoNotificacao"("origemTipo", "createdAt");
CREATE INDEX "EventoNotificacao_adminEvento_createdAt_idx" ON "EventoNotificacao"("adminEvento", "createdAt");
