-- CreateTable
CREATE TABLE "ManutencaoRegistro" (
    "id" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "clienteLoginId" TEXT,
    "criadoPorAdminId" TEXT,
    "titulo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'preventiva',
    "descricao" TEXT,
    "dataRealizacao" TIMESTAMP(3) NOT NULL,
    "kmRealizacao" DOUBLE PRECISION,
    "custo" DECIMAL(10,2),
    "oficina" TEXT,
    "notas" TEXT,
    "fotos" JSONB NOT NULL DEFAULT '[]',
    "origem" TEXT NOT NULL DEFAULT 'CLIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManutencaoRegistro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManutencaoRecorrencia" (
    "id" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "clienteLoginId" TEXT,
    "criadoPorAdminId" TEXT,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "intervaloKm" INTEGER NOT NULL,
    "kmBase" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "alerta50Enviado" BOOLEAN NOT NULL DEFAULT false,
    "alerta25Enviado" BOOLEAN NOT NULL DEFAULT false,
    "alerta0Enviado" BOOLEAN NOT NULL DEFAULT false,
    "ultimaAlertaPostDueKm" DOUBLE PRECISION NOT NULL DEFAULT -1,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "origem" TEXT NOT NULL DEFAULT 'CLIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManutencaoRecorrencia_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ManutencaoRegistro" ADD CONSTRAINT "ManutencaoRegistro_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManutencaoRegistro" ADD CONSTRAINT "ManutencaoRegistro_clienteLoginId_fkey" FOREIGN KEY ("clienteLoginId") REFERENCES "ClienteLogin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManutencaoRegistro" ADD CONSTRAINT "ManutencaoRegistro_criadoPorAdminId_fkey" FOREIGN KEY ("criadoPorAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManutencaoRecorrencia" ADD CONSTRAINT "ManutencaoRecorrencia_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManutencaoRecorrencia" ADD CONSTRAINT "ManutencaoRecorrencia_clienteLoginId_fkey" FOREIGN KEY ("clienteLoginId") REFERENCES "ClienteLogin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManutencaoRecorrencia" ADD CONSTRAINT "ManutencaoRecorrencia_criadoPorAdminId_fkey" FOREIGN KEY ("criadoPorAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
