/**
 * Script de teste — simula pagamento de uma parcela no EFI Sandbox.
 * Uso: npx tsx scripts/settle-test.ts [carneId] [parcela]
 *
 * Se não passar argumentos, usa o carnê mais recente do banco (parcela 1).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const EfiPay = require('sdk-node-apis-efi');
import fs from 'fs';
import path from 'path';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const argCarneId = process.argv[2] ? Number(process.argv[2]) : null;
  const argParcela = process.argv[3] ? Number(process.argv[3]) : 1;

  let efiCarneId: number;
  let parcela: number = argParcela;

  if (argCarneId) {
    efiCarneId = argCarneId;
  } else {
    // Busca o boleto mais recente com efiCargeId e status PENDENTE
    const boleto = await prisma.boleto.findFirst({
      where: { efiChargeId: { not: null }, status: 'PENDENTE' },
      orderBy: { createdAt: 'desc' },
      select: { efiChargeId: true, numeroParcela: true, carne: { select: { efiCarneId: true } } },
    });

    if (!boleto) {
      console.error('❌ Nenhum boleto PENDENTE com efiChargeId encontrado no banco.');
      process.exit(1);
    }

    if (!boleto.carne.efiCarneId) {
      console.error('❌ O carnê não tem efiCarneId registrado. Provavelmente foi importado.');
      process.exit(1);
    }

    efiCarneId = boleto.carne.efiCarneId;
    parcela = boleto.numeroParcela;
    console.log(`→ Usando carnê EFI ID: ${efiCarneId}, parcela: ${parcela}`);
    console.log(`→ efiChargeId da parcela: ${boleto.efiChargeId}`);
  }

  const certPath = path.resolve(process.env.EFI_CERT_PATH || './cert/certificado.p12');
  const client = new EfiPay({
    client_id:     process.env.EFI_CLIENT_ID,
    client_secret: process.env.EFI_CLIENT_SECRET,
    certificate:   fs.readFileSync(certPath),
    sandbox:       process.env.EFI_SANDBOX !== 'false',
  });

  console.log(`\n→ Chamando settleCarnetParcel({ id: ${efiCarneId}, parcel: ${parcela} })...`);
  const response = await client.settleCarnetParcel({ id: efiCarneId, parcel: String(parcela) });
  console.log('✓ Resposta EFI:', JSON.stringify(response, null, 2));
  console.log('\nAguarde alguns segundos e verifique nos logs do backend se o webhook foi disparado.');
}

main()
  .catch((err) => { console.error('❌ Erro:', err.message || err); process.exit(1); })
  .finally(() => prisma.$disconnect());
