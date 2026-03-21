/**
 * Script diagnóstico — testa listCarnets e listCharges do EFI.
 * Uso: npx tsx scripts/diagnostico-efi.ts [begin_date]
 * Ex:  npx tsx scripts/diagnostico-efi.ts 2006-01-01
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

function slices(beginDate: string, endDate: string): Array<[string, string]> {
  const start = new Date(beginDate + 'T00:00:00');
  const end   = new Date(endDate   + 'T00:00:00');
  const result: Array<[string, string]> = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const sliceEnd = new Date(cursor);
    sliceEnd.setFullYear(sliceEnd.getFullYear() + 1);
    sliceEnd.setDate(sliceEnd.getDate() - 1);
    const effectiveEnd = sliceEnd <= end ? sliceEnd : end;
    result.push([
      cursor.toISOString().split('T')[0],
      effectiveEnd.toISOString().split('T')[0],
    ]);
    cursor = new Date(effectiveEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

async function testarListCarnets(beginDate: string, endDate: string) {
  console.log('\n\n======================================================');
  console.log('=== TESTE 1: listCarnets (carnês criados no painel) ===');
  console.log('======================================================');

  let totalCarnets = 0;

  for (const [s, e] of slices(beginDate, endDate)) {
    console.log(`\n--- Fatia: ${s} → ${e} ---`);
    let page = 1;
    let totalPaginas = 1;

    do {
      try {
        const response = await client.listCarnets({
          begin_date: s,
          end_date:   e,
          page,
          limit: 100,
        });

        const { data, ...meta } = response;
        console.log(`Página ${page} — meta:`, JSON.stringify(meta, null, 2));
        console.log(`Carnês nesta página: ${(data ?? []).length}`);

        if (data && data.length > 0) {
          console.log('\nPrimeiro carnê:');
          console.log(JSON.stringify(data[0], null, 2));
        }

        totalCarnets += (data ?? []).length;
        totalPaginas = response.quantidadeDePaginas ?? response.totalPages ?? response.last_page ?? 1;
      } catch (err: any) {
        console.log(`❌ Erro na fatia ${s}→${e} página ${page}:`, err.message || err);
        break;
      }
      page++;
    } while (page <= totalPaginas);
  }

  console.log(`\n=== TOTAL listCarnets: ${totalCarnets} ===`);
}

async function testarListCharges(beginDate: string, endDate: string) {
  console.log('\n\n==========================================================');
  console.log('=== TESTE 2: listCharges charge_type:carnet (via API) ===');
  console.log('==========================================================');

  let totalCharges = 0;

  for (const [s, e] of slices(beginDate, endDate)) {
    let page = 1;
    let totalPaginas = 1;
    do {
      const response = await client.listCharges({
        begin_date:  s,
        end_date:    e,
        charge_type: 'carnet',
        page,
        limit: 100,
      });
      const { data, ...meta } = response;
      if ((data ?? []).length > 0) {
        console.log(`\nFatia ${s}→${e} página ${page} — meta:`, JSON.stringify(meta, null, 2));
        console.log(`Charges: ${(data ?? []).length}`);
      }
      totalCharges += (data ?? []).length;
      totalPaginas = response.quantidadeDePaginas ?? response.totalPages ?? response.last_page ?? 1;
      page++;
    } while (page <= totalPaginas);
  }

  console.log(`\n=== TOTAL listCharges carnet: ${totalCharges} ===`);
}

async function main() {
  const beginDate = process.argv[2] || '2006-01-01';
  const endDate = new Date().toISOString().split('T')[0];

  console.log(`Sandbox: ${process.env.EFI_SANDBOX !== 'false'}`);
  console.log(`Período: ${beginDate} → ${endDate}`);

  await testarListCarnets(beginDate, endDate);
  await testarListCharges(beginDate, endDate);
}

main()
  .catch((err) => { console.error('❌ Erro:', err.message || err); process.exit(1); });
