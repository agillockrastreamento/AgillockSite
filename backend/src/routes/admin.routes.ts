import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';

const router = Router();
router.use(authMiddleware);

interface ClienteImport {
  nome: string;
  placas: string[];
  cpfCnpj?: string;
  email?: string;
  telefone?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
}

// POST /api/admin/importar-planilha
router.post('/admin/importar-planilha', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { clientes } = req.body as { clientes: ClienteImport[] };

  if (!Array.isArray(clientes) || clientes.length === 0) {
    res.status(400).json({ error: 'Nenhum cliente enviado.' });
    return;
  }

  const importados: string[] = [];
  const erros: { linha: number; nome: string; erro: string }[] = [];
  let placasCriadas = 0;

  for (let i = 0; i < clientes.length; i++) {
    const row = clientes[i];

    if (!row.nome?.trim()) {
      erros.push({ linha: i + 1, nome: '(sem nome)', erro: 'Nome é obrigatório' });
      continue;
    }

    try {
      const cliente = await prisma.cliente.create({
        data: {
          nome: row.nome.trim(),
          cpfCnpj: row.cpfCnpj?.trim() || null,
          email: row.email?.trim() || null,
          telefone: row.telefone?.trim() || null,
          cep: row.cep?.trim() || null,
          logradouro: row.logradouro?.trim() || null,
          numero: row.numero?.trim() || null,
          complemento: row.complemento?.trim() || null,
          bairro: row.bairro?.trim() || null,
          cidade: row.cidade?.trim() || null,
          estado: row.estado?.trim() || null,
          criadoPorId: req.user!.userId,
        },
      });

      // Cria placas (ignora duplicatas globais)
      for (const placaRaw of row.placas) {
        const placa = placaRaw.trim().toUpperCase();
        if (!placa) continue;

        const existe = await prisma.placa.findFirst({
          where: { placa: { equals: placa, mode: 'insensitive' } },
        });
        if (existe) continue;

        await prisma.placa.create({
          data: { placa, clienteId: cliente.id },
        });
        placasCriadas++;
      }

      importados.push(row.nome.trim());
    } catch (err: any) {
      erros.push({
        linha: i + 1,
        nome: row.nome?.trim() || '?',
        erro: err.message || 'Erro desconhecido',
      });
    }
  }

  res.json({
    importados: importados.length,
    placasCriadas,
    erros,
  });
});

export default router;
