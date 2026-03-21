/**
 * Script diagnóstico — mostra a resposta bruta do EFI para listCharges.
 * Uso: npx tsx scripts/diagnostico-efi.ts [begin_date]
 * Ex:  npx tsx scripts/diagnostico-efi.ts 2024-01-01
 */
import 'dotenv/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EfiPay = require('sdk-node-apis-efi');
import fs from 'fs';
import path from 'path';

async function main() {
  const beginDate = process.argv[2] || '2020-01-01';
  const endDate = new Date().toISOString().split('T')[0];

  const certPath = path.resolve(process.env.EFI_CERT_PATH || './cert/certificado.p12');
  const client = new EfiPay({
    client_id:     process.env.EFI_CLIENT_ID,
    client_secret: process.env.EFI_CLIENT_SECRET,
    certificate:   fs.readFileSync(certPath),
    sandbox:       process.env.EFI_SANDBOX !== 'false',
  });

  console.log(`\n=== DIAGNÓSTICO EFI — listCharges charge_type:carnet ===`);
  console.log(`Período: ${beginDate} → ${endDate}`);
  console.log(`Sandbox: ${process.env.EFI_SANDBOX !== 'false'}\n`);

  // Fatia de 1 ano para respeitar limite da API
  const start = new Date(beginDate + 'T00:00:00');
  const end   = new Date(endDate   + 'T00:00:00');
  let cursor  = new Date(start);
  let totalCharges = 0;

  while (cursor <= end) {
    const sliceEnd = new Date(cursor);
    sliceEnd.setFullYear(sliceEnd.getFullYear() + 1);
    sliceEnd.setDate(sliceEnd.getDate() - 1);
    const effectiveEnd = sliceEnd <= end ? sliceEnd : end;

    const sliceBeginStr = cursor.toISOString().split('T')[0];
    const sliceEndStr   = effectiveEnd.toISOString().split('T')[0];

    console.log(`\n--- Fatia: ${sliceBeginStr} → ${sliceEndStr} ---`);

    let page = 1;
    let totalPaginas = 1;

    do {
      const response = await client.listCharges({
        begin_date:  sliceBeginStr,
        end_date:    sliceEndStr,
        charge_type: 'carnet',
        page,
        limit: 100,
      });

      // Mostrar estrutura completa da resposta (exceto data dos charges)
      const { data, ...meta } = response;
      console.log(`\nPágina ${page} — meta:`, JSON.stringify(meta, null, 2));
      console.log(`Charges nesta página: ${(data ?? []).length}`);

      if (data && data.length > 0) {
        console.log('\nPrimeiro charge (estrutura completa):');
        console.log(JSON.stringify(data[0], null, 2));
        if (data.length > 1) {
          console.log(`\n... + ${data.length - 1} charge(s) restante(s) nesta página`);
          console.log('Último charge (estrutura completa):');
          console.log(JSON.stringify(data[data.length - 1], null, 2));
        }
      }

      totalCharges += (data ?? []).length;
      totalPaginas = response.quantidadeDePaginas ?? response.totalPages ?? response.last_page ?? 1;
      page++;
    } while (page <= totalPaginas);

    cursor = new Date(effectiveEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  console.log(`\n=== TOTAL de charges retornados pelo EFI: ${totalCharges} ===`);
}

main()
  .catch((err) => { console.error('❌ Erro:', err.message || err); process.exit(1); });
