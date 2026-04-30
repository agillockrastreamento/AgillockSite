-- CreateTable
CREATE TABLE "Geocerca" (
    "id" TEXT NOT NULL,
    "traccarId" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "area" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'circulo',
    "origemTipo" TEXT NOT NULL,
    "clienteId" TEXT,
    "visivelCliente" BOOLEAN NOT NULL DEFAULT false,
    "notificarCliente" BOOLEAN NOT NULL DEFAULT false,
    "sistemasNotif" JSONB,
    "dataInicio" TIMESTAMP(3),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Geocerca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeocercaDispositivo" (
    "geocercaId" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,

    CONSTRAINT "GeocercaDispositivo_pkey" PRIMARY KEY ("geocercaId","dispositivoId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Geocerca_traccarId_key" ON "Geocerca"("traccarId");

-- AddForeignKey
ALTER TABLE "Geocerca" ADD CONSTRAINT "Geocerca_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeocercaDispositivo" ADD CONSTRAINT "GeocercaDispositivo_geocercaId_fkey" FOREIGN KEY ("geocercaId") REFERENCES "Geocerca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeocercaDispositivo" ADD CONSTRAINT "GeocercaDispositivo_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
