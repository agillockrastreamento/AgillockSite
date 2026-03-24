-- CreateTable
CREATE TABLE "DispositivoCliente" (
    "dispositivoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,

    CONSTRAINT "DispositivoCliente_pkey" PRIMARY KEY ("dispositivoId","clienteId")
);

-- AddForeignKey
ALTER TABLE "DispositivoCliente" ADD CONSTRAINT "DispositivoCliente_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositivoCliente" ADD CONSTRAINT "DispositivoCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
