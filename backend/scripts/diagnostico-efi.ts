/**
 * Script diagnóstico — testa detailCarnet com formato correto e listCharges sem filtro.
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

async function tryCall(label: string, fn: () => Promise<any>) {
  console.log(`\n=== ${label} ===`);
  try {
    const r = await fn();
    console.log(JSON.stringify(r, null, 2));
  } catch (e: any) {
    console.log('ERRO JSON:', JSON.stringify(e));
    console.log('message:', e?.message);
    console.log('code:', e?.code);
    console.log('error:', e?.error);
    console.log('error_description:', JSON.stringify(e?.error_description));
  }
}

async function main() {
  console.log(`Sandbox: ${process.env.EFI_SANDBOX !== 'false'}\n`);

  // ID do carnê que sabemos existir (criado via API hoje)
  // Link: .../A4CL-381777-29491-LUADO9/... → id numérico = 29491
  const carnetId = 29491;

  // Testar diferentes formatos de parâmetro para detailCarnet
  await tryCall('detailCarnet { params: { id } }', () =>
    client.detailCarnet({ params: { id: carnetId } })
  );

  await tryCall('detailCarnet { params: { id: string } }', () =>
    client.detailCarnet({ params: { id: String(carnetId) } })
  );

  // listCharges sem charge_type — erro completo
  await tryCall('listCharges SEM charge_type (2026)', () =>
    client.listCharges({ begin_date: '2026-01-01', end_date: '2026-03-21', limit: 10 })
  );

  // listCharges com todos os charge_types possíveis
  for (const ct of ['billet', 'link', 'subscription']) {
    await tryCall(`listCharges charge_type:${ct} (2026)`, () =>
      client.listCharges({ begin_date: '2026-01-01', end_date: '2026-03-21', charge_type: ct, limit: 10 })
    );
  }

  // Testar se há charges de qualquer tipo em anos anteriores
  await tryCall('listCharges charge_type:billet (2024)', () =>
    client.listCharges({ begin_date: '2024-01-01', end_date: '2024-12-31', charge_type: 'billet', limit: 10 })
  );

  await tryCall('listCharges charge_type:carnet (2024)', () =>
    client.listCharges({ begin_date: '2024-01-01', end_date: '2024-12-31', charge_type: 'carnet', limit: 10 })
  );
}

main()
  .catch((err) => { console.error('❌ Erro:', err.message || err); process.exit(1); });
