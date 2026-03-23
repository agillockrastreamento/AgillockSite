-- AlterTable User: add dispositivo permissions
ALTER TABLE "User" ADD COLUMN "podeExcluirDispositivo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "podeInativarDispositivo" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable Dispositivo
CREATE TABLE "Dispositivo" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "identificador" TEXT NOT NULL,
    "categoria" TEXT,
    "grupo" TEXT,
    "contato" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "modeloRastreador" TEXT,
    "telefoneRastreador" TEXT,
    "iccid" TEXT,
    "operadora" TEXT,
    "placa" TEXT,
    "marca" TEXT,
    "modeloVeiculo" TEXT,
    "cor" TEXT,
    "ano" TEXT,
    "renavam" TEXT,
    "chassi" TEXT,
    "combustivel" TEXT,
    "localInstalacao" TEXT,
    "instalador" TEXT,
    "consumo" TEXT,
    "limiteVelocidade" DOUBLE PRECISION,
    "senha" TEXT,
    "ignorarOdometro" BOOLEAN NOT NULL DEFAULT false,
    "imagemUrl" TEXT,
    "valorPadrao" DECIMAL(10,2),
    "clienteId" TEXT,
    "vendedorId" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispositivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dispositivo_identificador_key" ON "Dispositivo"("identificador");

-- AddForeignKey Dispositivo → Cliente
ALTER TABLE "Dispositivo" ADD CONSTRAINT "Dispositivo_clienteId_fkey"
    FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey Dispositivo → User (vendedor)
ALTER TABLE "Dispositivo" ADD CONSTRAINT "Dispositivo_vendedorId_fkey"
    FOREIGN KEY ("vendedorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey Dispositivo → User (criador)
ALTER TABLE "Dispositivo" ADD CONSTRAINT "Dispositivo_criadoPorId_fkey"
    FOREIGN KEY ("criadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable BoletoDispositivo
CREATE TABLE "BoletoDispositivo" (
    "valorDispositivo" DECIMAL(10,2) NOT NULL,
    "boletoId" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,

    CONSTRAINT "BoletoDispositivo_pkey" PRIMARY KEY ("boletoId","dispositivoId")
);

-- AddForeignKey BoletoDispositivo → Boleto
ALTER TABLE "BoletoDispositivo" ADD CONSTRAINT "BoletoDispositivo_boletoId_fkey"
    FOREIGN KEY ("boletoId") REFERENCES "Boleto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey BoletoDispositivo → Dispositivo
ALTER TABLE "BoletoDispositivo" ADD CONSTRAINT "BoletoDispositivo_dispositivoId_fkey"
    FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable Boleto: add dispositivoId
ALTER TABLE "Boleto" ADD COLUMN "dispositivoId" TEXT;

-- AddForeignKey Boleto → Dispositivo
ALTER TABLE "Boleto" ADD CONSTRAINT "Boleto_dispositivoId_fkey"
    FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
