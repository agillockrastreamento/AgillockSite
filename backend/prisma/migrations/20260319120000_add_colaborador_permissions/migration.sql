-- AddColumn: permissões granulares para colaboradores
ALTER TABLE "User" ADD COLUMN "podeExcluirCliente"    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "podeBaixaManual"        BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "podeCancelarCarne"      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "podeAlterarVencimento"  BOOLEAN NOT NULL DEFAULT true;
