-- AlterTable: vendedor dono da placa (o primeiro que gerar cobrança para ela)
ALTER TABLE "Placa" ADD COLUMN IF NOT EXISTS "vendedorId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Placa_vendedorId_fkey') THEN
    ALTER TABLE "Placa" ADD CONSTRAINT "Placa_vendedorId_fkey"
      FOREIGN KEY ("vendedorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
