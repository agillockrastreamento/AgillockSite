-- AlterTable
ALTER TABLE "Motorista" ADD COLUMN "clienteId" TEXT;

-- CreateIndex
CREATE INDEX "Motorista_clienteId_idx" ON "Motorista"("clienteId");

-- AddForeignKey
ALTER TABLE "Motorista" ADD CONSTRAINT "Motorista_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: motoristas que já têm dispositivos vinculados entram na empresa (cliente)
-- desses dispositivos, reaproveitando os vínculos existentes. Quando os dispositivos
-- de um motorista pertencem a clientes diferentes, escolhe o cliente com mais
-- dispositivos vinculados àquele motorista (empate resolvido arbitrariamente).
UPDATE "Motorista" m
SET "clienteId" = sub."clienteId"
FROM (
  SELECT md."motoristaId",
         d."clienteId",
         ROW_NUMBER() OVER (PARTITION BY md."motoristaId" ORDER BY COUNT(*) DESC) AS rn
  FROM "MotoristaDispositivo" md
  JOIN "Dispositivo" d ON d."id" = md."dispositivoId"
  WHERE d."clienteId" IS NOT NULL
  GROUP BY md."motoristaId", d."clienteId"
) sub
WHERE sub."motoristaId" = m."id" AND sub."rn" = 1 AND m."clienteId" IS NULL;
