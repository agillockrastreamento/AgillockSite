/**
 * Seed de DADOS DE TESTE para a feature de comissão por valor exato.
 * NÃO usar em produção — cria cliente/placa/boletos fictícios e as 4 regras
 * de exemplo solicitadas pelo cliente.
 *
 * Rodar: npx tsx scripts/seed-teste-comissao.ts
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import prisma from '../src/utils/prisma';
import { registrarComissoes } from '../src/services/comissao.service';

const NOME_CLIENTE = 'Cliente Teste Comissão';

async function limparTesteAnterior() {
  const cliente = await prisma.cliente.findFirst({ where: { nome: NOME_CLIENTE } });
  if (!cliente) return;
  const carnes = await prisma.carne.findMany({ where: { clienteId: cliente.id }, select: { id: true } });
  const carneIds = carnes.map((c) => c.id);
  const boletos = await prisma.boleto.findMany({ where: { carneId: { in: carneIds } }, select: { id: true } });
  const boletoIds = boletos.map((b) => b.id);
  await prisma.comissaoVendedor.deleteMany({ where: { boletoId: { in: boletoIds } } });
  await prisma.boleto.deleteMany({ where: { id: { in: boletoIds } } });
  await prisma.carne.deleteMany({ where: { id: { in: carneIds } } });
  await prisma.placa.deleteMany({ where: { clienteId: cliente.id } });
  await prisma.cliente.delete({ where: { id: cliente.id } });
  console.log('• Dados de teste anteriores removidos.');
}

async function main() {
  // ── Regras de comissão (exemplos solicitados) ──────────────────────────────
  const REGRAS = [
    { valor: 9.9, percentual: 40 },
    { valor: 19.9, percentual: 45 },
    { valor: 14.9, percentual: 16.44 },
    { valor: 13.5, percentual: 12.96 },
  ];
  await prisma.regraComissao.deleteMany({});
  await prisma.regraComissao.createMany({ data: REGRAS });
  console.log(`✓ ${REGRAS.length} regras de comissão criadas.`);

  // ── Admin (já criado pelo seed-admin) ──────────────────────────────────────
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) throw new Error('Admin não encontrado. Rode o seed-admin primeiro.');

  // ── Vendedor de teste ──────────────────────────────────────────────────────
  const senhaHash = await bcrypt.hash('venda123', 10);
  const vendedor = await prisma.user.upsert({
    where: { email: 'vendedor.teste@agillock.com.br' },
    update: { senhaHash, ativo: true },
    create: { nome: 'Vendedor Teste', email: 'vendedor.teste@agillock.com.br', senhaHash, role: 'VENDEDOR' },
  });
  console.log(`✓ Vendedor de teste: ${vendedor.email} (senha: venda123)`);

  await limparTesteAnterior();

  // ── Cliente + placa ────────────────────────────────────────────────────────
  const cliente = await prisma.cliente.create({
    data: {
      nome: NOME_CLIENTE,
      telefone: '11999998888',
      tipoPessoa: 'PF',
      criadoPorId: admin.id,
      vendedorId: vendedor.id,
    },
  });
  const placa = await prisma.placa.create({
    data: { placa: 'TST-0001', clienteId: cliente.id, vendedorId: vendedor.id },
  });

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const venGarantido = new Date(y, m, 5);
  const venFuturo = new Date(y, m, 25);
  const venAtrasado = new Date(y, m, 3);

  // Helper para criar um boleto individual
  async function criarBoleto(valor: number, vencimento: Date, status: 'PAGO' | 'PENDENTE' | 'ATRASADO', dataPagamento?: Date) {
    const carne = await prisma.carne.create({
      data: {
        tipo: 'INDIVIDUAL',
        valorTotal: valor,
        numeroParcelas: 1,
        clienteId: cliente.id,
        geradoPorId: admin.id,
        vendedorId: vendedor.id,
      },
    });
    return prisma.boleto.create({
      data: {
        numeroParcela: 1,
        valor,
        vencimento,
        status,
        dataPagamento: dataPagamento ?? null,
        carneId: carne.id,
        placaId: placa.id,
      },
    });
  }

  // ── GARANTIDO: boletos pagos no mês (geram comissão registrada) ─────────────
  const pagos = [9.9, 19.9, 14.9];
  for (const v of pagos) {
    const b = await criarBoleto(v, venGarantido, 'PAGO', now);
    await registrarComissoes(b.id);
  }
  console.log(`✓ ${pagos.length} boletos PAGOS + comissões registradas.`);

  // ── FUTURO: boletos pendentes a vencer ──────────────────────────────────────
  for (const v of [13.5, 9.9]) await criarBoleto(v, venFuturo, 'PENDENTE');
  console.log('✓ 2 boletos PENDENTES (futuro).');

  // ── ATRASADO: boleto vencido ────────────────────────────────────────────────
  await criarBoleto(19.9, venAtrasado, 'ATRASADO');
  console.log('✓ 1 boleto ATRASADO.');

  console.log('\n✅ Seed de teste concluído. Vendedor:', vendedor.id);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
