/**
 * Script diagnóstico — inspeciona métodos da instância SDK EFI e testa carnês.
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
  console.log(`Sandbox: ${process.env.EFI_SANDBOX !== 'false'}`);

  // 1. Inspecionar métodos da INSTÂNCIA (gerados dinamicamente)
  console.log('\n=== MÉTODOS DA INSTÂNCIA (client) ===');
  const instanceMethods = Object.keys(client)
    .filter(k => typeof (client as any)[k] === 'function')
    .sort();
  console.log(instanceMethods.join('\n') || '(nenhum em Object.keys)');

  // 2. Tudo que existe no objeto (incluindo não-enumeráveis)
  console.log('\n=== Object.getOwnPropertyNames(client) ===');
  const ownNames = Object.getOwnPropertyNames(client)
    .filter(k => typeof (client as any)[k] === 'function')
    .sort();
  console.log(ownNames.join('\n') || '(nenhum)');

  // 3. Prototype chain completa
  console.log('\n=== TODA A PROTOTYPE CHAIN ===');
  const allMethods = new Set<string>();
  let proto = client;
  while (proto) {
    Object.getOwnPropertyNames(proto)
      .filter(k => k !== 'constructor' && typeof (client as any)[k] === 'function')
      .forEach(k => allMethods.add(k));
    proto = Object.getPrototypeOf(proto);
  }
  console.log([...allMethods].sort().join('\n'));

  // 4. Métodos com "carnet" (case-insensitive) em toda a chain
  const carnetMethods = [...allMethods].filter(m => m.toLowerCase().includes('carnet'));
  console.log('\n=== MÉTODOS COM "carnet" ===');
  console.log(carnetMethods.join('\n') || '(nenhum)');

  // 5. Testar detailCarnet com erro completo
  console.log('\n=== detailCarnet com id=29491 (erro completo) ===');
  try {
    const r = await (client as any).detailCarnet({ id: 29491 });
    console.log(JSON.stringify(r, null, 2));
  } catch (e: any) {
    console.log('Tipo:', typeof e);
    console.log('JSON:', JSON.stringify(e));
    console.log('message:', e?.message);
    console.log('code:', e?.code);
    console.log('body:', e?.body);
    console.log('response:', JSON.stringify(e?.response));
  }

  // 6. Ver o conteúdo bruto do require para entender a estrutura
  console.log('\n=== SDK package.json ===');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('sdk-node-apis-efi/package.json');
    console.log('version:', pkg.version);
    console.log('main:', pkg.main);
  } catch (e: any) { console.log(e.message); }
}

main()
  .catch((err) => { console.error('❌ Erro:', err.message || err); process.exit(1); });
