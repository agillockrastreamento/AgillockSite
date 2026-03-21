/**
 * Script diagnóstico — inspeciona métodos do SDK EFI e testa endpoints de carnê.
 * Uso: npx tsx scripts/diagnostico-efi.ts
 */
import 'dotenv/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EfiPay = require('sdk-node-apis-efi');
import fs from 'fs';
import path from 'path';

const certPath = path.resolve(process.env.EFI_CERT_PATH || './cert/certificado.p12');
const client = new EfiPay({
  client_id:     process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate:   fs.readFileSync(certPath),
  sandbox:       process.env.EFI_SANDBOX !== 'false',
});

async function main() {
  console.log(`\nSandbox: ${process.env.EFI_SANDBOX !== 'false'}`);

  // 1. Listar todos os métodos disponíveis no SDK
  console.log('\n=== MÉTODOS DISPONÍVEIS NO SDK ===');
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(client))
    .filter(m => m !== 'constructor' && typeof (client as any)[m] === 'function')
    .sort();
  console.log(methods.join('\n'));

  // 2. Testar métodos que contenham "carnet" no nome
  console.log('\n=== MÉTODOS COM "carnet" NO NOME ===');
  const carnetMethods = methods.filter(m => m.toLowerCase().includes('carnet'));
  console.log(carnetMethods.join('\n') || '(nenhum)');

  // 3. Testar detailCarnet para o carnê que sabemos existir (id extraído do link)
  // link: .../A4CL-381777-29491-LUADO9/... → carnet id numérico?
  // Tentar listar via método correto com período curto
  console.log('\n=== TENTATIVA: getCarnet / detailCarnet / showCarnet ===');
  for (const m of ['getCarnet', 'detailCarnet', 'showCarnet', 'retrieveCarnet']) {
    if (typeof (client as any)[m] === 'function') {
      console.log(`\n→ ${m} existe! Testando...`);
      try {
        const r = await (client as any)[m]({ id: 29491 });
        console.log(JSON.stringify(r, null, 2));
      } catch (e: any) {
        console.log(`  Erro: ${e.message}`);
      }
    }
  }

  // 4. Tentar listCharges sem charge_type para ver TODOS os tipos
  console.log('\n=== listCharges SEM charge_type (todos os tipos) — só 2026 ===');
  try {
    const r = await client.listCharges({
      begin_date: '2026-01-01',
      end_date:   '2026-03-21',
      limit: 100,
    });
    const { data, ...meta } = r;
    console.log('meta:', JSON.stringify(meta, null, 2));
    console.log(`Total charges: ${(data ?? []).length}`);
    if (data?.length > 0) {
      console.log('Tipos encontrados:', [...new Set((data as any[]).map((c: any) => c.payment?.payment_method))]);
      console.log('Primeiro:', JSON.stringify(data[0], null, 2));
    }
  } catch (e: any) {
    console.log('Erro:', e.message);
  }

  // 5. Tentar listCharges com charge_type: 'billet' para ver boletos avulsos
  console.log('\n=== listCharges charge_type:billet — só 2026 ===');
  try {
    const r = await client.listCharges({
      begin_date:  '2026-01-01',
      end_date:    '2026-03-21',
      charge_type: 'billet',
      limit: 100,
    });
    const { data, ...meta } = r;
    console.log('meta:', JSON.stringify(meta, null, 2));
    console.log(`Total: ${(data ?? []).length}`);
  } catch (e: any) {
    console.log('Erro:', e.message);
  }
}

main()
  .catch((err) => { console.error('❌ Erro:', err.message || err); process.exit(1); });
