import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// PrismaPg aceita PoolConfig diretamente (sem precisar instanciar Pool separado)
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const prisma = new PrismaClient({ adapter } as any);

export default prisma;
