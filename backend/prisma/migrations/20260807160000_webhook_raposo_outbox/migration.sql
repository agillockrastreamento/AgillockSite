-- Outbox dos eventos empurrados ao Raposo Motors (webhook em tempo real).
--
-- Migração ADITIVA: só cria. Nenhuma coluna existente é alterada ou removida, e
-- nada no sistema passa a depender desta tabela — com o webhook desligado
-- (RAPOSO_WEBHOOK_ATIVO != 'true') ela simplesmente fica vazia e a Ágil Lock se
-- comporta exatamente como antes. O rollback é desligar a variável.
CREATE TABLE IF NOT EXISTS "WebhookRaposoEvento" (
  "id"                 TEXT NOT NULL,
  "tipo"               TEXT NOT NULL,
  "payload"            JSONB NOT NULL,
  "tentativas"         INTEGER NOT NULL DEFAULT 0,
  "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "entregueEm"         TIMESTAMP(3),
  "desistiuEm"         TIMESTAMP(3),
  "ultimoErro"         TEXT,
  "criadoEm"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebhookRaposoEvento_pkey" PRIMARY KEY ("id")
);

-- O índice que o worker usa a cada rodada: "o que ainda não entreguei, não
-- desisti, e já passou da hora de tentar de novo".
CREATE INDEX IF NOT EXISTS "WebhookRaposoEvento_entregueEm_desistiuEm_proximaTentativaEm_idx"
  ON "WebhookRaposoEvento" ("entregueEm", "desistiuEm", "proximaTentativaEm");

CREATE INDEX IF NOT EXISTS "WebhookRaposoEvento_criadoEm_idx"
  ON "WebhookRaposoEvento" ("criadoEm");
