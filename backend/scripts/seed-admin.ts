import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  // Cria configurações padrão (singleton)
  await prisma.configuracoes.upsert({
    where: { id: '1' },
    update: {},
    create: { id: '1' },
  });

  const email = process.env.ADMIN_EMAIL;
  const senha = process.env.ADMIN_SENHA;

  if (!email || !senha) {
    console.error('❌ ADMIN_EMAIL e ADMIN_SENHA devem estar definidos no ambiente.');
    process.exit(1);
  }
  const senhaHash = await bcrypt.hash(senha, 10);

  // Busca admin existente pelo role (independente do e-mail atual)
  const adminExistente = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

  if (adminExistente) {
    if (adminExistente.email === email) {
      console.log(`Admin já está com as credenciais corretas: ${email}`);
    } else {
      await prisma.user.update({
        where: { id: adminExistente.id },
        data: { email, senhaHash },
      });
      console.log(`✓ Admin atualizado: ${adminExistente.email} → ${email}`);
    }
    return;
  }

  // Nenhum admin encontrado — cria do zero
  await prisma.user.create({
    data: {
      nome: 'Administrador',
      email,
      senhaHash,
      role: 'ADMIN',
    },
  });

  console.log('✓ Configurações padrão criadas.');
  console.log(`✓ Admin criado: ${email}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
