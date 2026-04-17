-- AlterTable: add permission fields to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "podeCriarLoginCliente"    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "podeEditarLoginCliente"   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "podeInativarLoginCliente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "podeExcluirLoginCliente"  BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: add imagemUrlCliente to Dispositivo
ALTER TABLE "Dispositivo" ADD COLUMN IF NOT EXISTS "imagemUrlCliente" TEXT;

-- CreateTable: ClienteLogin
CREATE TABLE IF NOT EXISTS "ClienteLogin" (
    "id"        TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "email"     TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "ativo"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClienteLogin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClienteLogin_clienteId_key" ON "ClienteLogin"("clienteId");
CREATE UNIQUE INDEX IF NOT EXISTS "ClienteLogin_email_key" ON "ClienteLogin"("email");

-- AddForeignKey
ALTER TABLE "ClienteLogin" ADD CONSTRAINT "ClienteLogin_clienteId_fkey"
    FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
