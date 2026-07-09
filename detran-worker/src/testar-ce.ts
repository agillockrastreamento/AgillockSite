// Teste manual da integração Detran CE.
// Uso: npm run test:ce  [placa] [renavam]
// Padrão: OSU6H88 / 01241525924 (veículo de teste com 2 multas + IPVA).

import { writeFileSync } from 'node:fs';
import { consultarVeiculoCompleto } from './detran-ce.js';

(async () => {
  const placa = process.argv[2] ?? 'OSU6H88';
  const renavam = process.argv[3] ?? '01241525924';

  console.log(`Consultando placa ${placa} / renavam ${renavam} ...\n`);
  const t0 = Date.now();
  const r = await consultarVeiculoCompleto(placa, renavam);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('=== SITUAÇÃO ===');
  console.log(`  Multas:        ${r.situacao.qtdMultas}`);
  console.log(`  Débito IPVA:   ${r.situacao.possuiDebitoIpva ? 'SIM' : 'não'}`);
  console.log(`  Licenciamento: ${r.situacao.licenciamentoPendente ? 'PENDENTE' : 'em dia/na'}`);

  console.log(`\n=== MULTAS (${r.multas.length}) ===`);
  for (const m of r.multas) {
    console.log(
      `  ${m.ait} | ${m.motivo.slice(0, 45).padEnd(45)} | infr ${m.dataInfracao} venc ${m.dataVencimento} | R$ ${m.valor.toFixed(2)} -> R$ ${m.valorAPagar.toFixed(2)}`,
    );
  }
  const total = r.multas.reduce((s, m) => s + m.valorAPagar, 0);
  console.log(`  TOTAL a pagar: R$ ${total.toFixed(2)}`);

  console.log('\n=== PAGAMENTO (todas as multas) ===');
  if (r.pagamentoTodas) {
    console.log(`  Extrato: ${r.pagamentoTodas.extratoId}`);
    console.log(`  Pix EMV: ${r.pagamentoTodas.emv.slice(0, 55)}...`);
    console.log(`  QR base64: ${r.pagamentoTodas.qrCodeBase64.length} chars`);
  } else {
    console.log('  (sem multas)');
  }
  if (r.boletoPdfBase64) {
    const buf = Buffer.from(r.boletoPdfBase64, 'base64');
    writeFileSync('boleto_teste.pdf', buf);
    console.log(`  Boleto salvo: boleto_teste.pdf (${buf.length} bytes, magic "${buf.subarray(0, 4).toString('latin1')}")`);
  }

  console.log(`\n✅ OK em ${dt}s`);
})().catch((e) => {
  console.error(`\n❌ ERRO: ${e?.message ?? e}`);
  process.exit(1);
});
