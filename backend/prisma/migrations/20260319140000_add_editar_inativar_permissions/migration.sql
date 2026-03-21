-- AddColumns: permissões de editar/inativar cliente e inativar placa
ALTER TABLE "User" ADD COLUMN "podeEditarCliente"   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "podeInativarCliente" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "podeInativarPlaca"   BOOLEAN NOT NULL DEFAULT true;
