-- CreateTable
CREATE TABLE "PreferenciaNotificacao" (
    "id" TEXT NOT NULL,
    "clienteLoginId" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "tipoEvento" TEXT NOT NULL,
    "web" BOOLEAN NOT NULL DEFAULT false,
    "app" BOOLEAN NOT NULL DEFAULT false,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "overspeedLimit" INTEGER DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreferenciaNotificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoNotificacao" (
    "id" TEXT NOT NULL,
    "clienteLoginId" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "tipoEvento" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "velocidade" DOUBLE PRECISION,
    "lido" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoNotificacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PreferenciaNotificacao_clienteLoginId_dispositivoId_tipoEve_key" ON "PreferenciaNotificacao"("clienteLoginId", "dispositivoId", "tipoEvento");

-- AddForeignKey
ALTER TABLE "PreferenciaNotificacao" ADD CONSTRAINT "PreferenciaNotificacao_clienteLoginId_fkey" FOREIGN KEY ("clienteLoginId") REFERENCES "ClienteLogin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenciaNotificacao" ADD CONSTRAINT "PreferenciaNotificacao_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoNotificacao" ADD CONSTRAINT "EventoNotificacao_clienteLoginId_fkey" FOREIGN KEY ("clienteLoginId") REFERENCES "ClienteLogin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoNotificacao" ADD CONSTRAINT "EventoNotificacao_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
