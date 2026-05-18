-- Permite múltiplos logins por cliente (1:N). Existem registros antigos
-- com unique(clienteId): todos eles continuam sendo o 'responsavel' do
-- respectivo cliente. Sub-usuários (tipo='vinculado') passam a coexistir.

-- 1. Remover unique constraint de ClienteLogin.clienteId, manter como índice
DROP INDEX "ClienteLogin_clienteId_key";

-- 2. Adicionar novas colunas. Defaults garantem que logins existentes
--    fiquem como 'responsavel' com permissões vazias (acesso total implícito).
ALTER TABLE "ClienteLogin"
    ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'responsavel',
    ADD COLUMN "perfil" TEXT,
    ADD COLUMN "permissoes" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "criadoPorLoginId" TEXT;

-- 3. Índice composto para listagem rápida por cliente+tipo
CREATE INDEX "ClienteLogin_clienteId_tipo_idx" ON "ClienteLogin"("clienteId", "tipo");

-- 4. FK auto-referenciada para rastrear quem criou o sub-usuário
ALTER TABLE "ClienteLogin"
    ADD CONSTRAINT "ClienteLogin_criadoPorLoginId_fkey"
    FOREIGN KEY ("criadoPorLoginId") REFERENCES "ClienteLogin"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Tabela junção: dispositivos que cada sub-usuário pode acessar
CREATE TABLE "ClienteLoginPlaca" (
    "clienteLoginId" TEXT NOT NULL,
    "dispositivoId"  TEXT NOT NULL,

    CONSTRAINT "ClienteLoginPlaca_pkey" PRIMARY KEY ("clienteLoginId", "dispositivoId")
);

CREATE INDEX "ClienteLoginPlaca_dispositivoId_idx" ON "ClienteLoginPlaca"("dispositivoId");

ALTER TABLE "ClienteLoginPlaca"
    ADD CONSTRAINT "ClienteLoginPlaca_clienteLoginId_fkey"
    FOREIGN KEY ("clienteLoginId") REFERENCES "ClienteLogin"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClienteLoginPlaca"
    ADD CONSTRAINT "ClienteLoginPlaca_dispositivoId_fkey"
    FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
