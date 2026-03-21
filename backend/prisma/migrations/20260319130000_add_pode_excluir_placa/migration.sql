-- AddColumn: permissão para excluir placas (colaboradores)
ALTER TABLE "User" ADD COLUMN "podeExcluirPlaca" BOOLEAN NOT NULL DEFAULT true;
