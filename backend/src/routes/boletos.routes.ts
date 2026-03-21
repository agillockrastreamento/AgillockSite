import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { param } from '../utils/params';
import * as efiService from '../services/efi.service';
import { registrarComissoes } from '../services/comissao.service';

const router = Router();
router.use(authMiddleware);

// ─── GET /api/boletos — Listar todos os boletos com filtros ─────────────────
router.get('/', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { busca, dataVencDe, dataVencAte, status, tipo } = req.query as Record<string, string>;

  const andConditions: any[] = [];

  if (status === 'hoje') {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);
    andConditions.push({ vencimento: { gte: hoje, lt: amanha } });
    andConditions.push({ status: { in: ['PENDENTE', 'ATRASADO'] } });
  } else if (status === 'aberto') {
    andConditions.push({ status: { in: ['PENDENTE', 'ATRASADO'] } });
  } else if (status) {
    andConditions.push({ status });
  }

  if (dataVencDe) {
    const [y, m, d] = dataVencDe.split('-').map(Number);
    andConditions.push({ vencimento: { gte: new Date(y, m - 1, d, 0, 0, 0) } });
  }
  if (dataVencAte) {
    const [y, m, d] = dataVencAte.split('-').map(Number);
    andConditions.push({ vencimento: { lte: new Date(y, m - 1, d, 23, 59, 59) } });
  }

  if (tipo) {
    andConditions.push({ carne: { tipo } });
  }

  if (busca) {
    const b = busca.replace(/^#/, '').trim();
    const bDigits = b.replace(/\D/g, '');
    const orSearch: any[] = [
      { carne: { cliente: { nome: { contains: b, mode: 'insensitive' } } } },
      { carne: { id: { contains: b, mode: 'insensitive' } } },
    ];
    if (bDigits.length >= 3) {
      orSearch.push({ carne: { cliente: { cpfCnpj: { contains: bDigits } } } });
    }
    andConditions.push({ OR: orSearch });
  }

  const where = andConditions.length > 0 ? { AND: andConditions } : {};

  const boletos = await prisma.boleto.findMany({
    where,
    orderBy: { vencimento: 'asc' },
    take: 500,
    include: {
      carne: {
        select: {
          id: true,
          tipo: true,
          numeroParcelas: true,
          cliente: { select: { id: true, nome: true, cpfCnpj: true, telefone: true } },
        },
      },
      placa: { select: { id: true, placa: true } },
      placasUnificadas: {
        include: { placa: { select: { id: true, placa: true } } },
      },
    },
  });

  res.json(boletos);
});

// ─── GET /api/boletos/:id — Detalhe do boleto (inclui link para o boleto) ────
router.get('/:id', requireRoles('ADMIN', 'COLABORADOR', 'VENDEDOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const boleto = await prisma.boleto.findUnique({
    where: { id },
    include: {
      carne: {
        select: {
          id: true,
          tipo: true,
          cliente: { select: { id: true, nome: true, vendedorId: true } },
        },
      },
      placa: { select: { id: true, placa: true, descricao: true } },
      placasUnificadas: {
        include: { placa: { select: { id: true, placa: true, descricao: true } } },
      },
    },
  });

  if (!boleto) {
    res.status(404).json({ error: 'Boleto não encontrado.' });
    return;
  }

  // VENDEDOR só pode ver boletos de clientes associados a ele
  if (req.user!.role === 'VENDEDOR') {
    if (boleto.carne.cliente.vendedorId !== req.user!.userId) {
      res.status(403).json({ error: 'Acesso negado.' });
      return;
    }
  }

  res.json(boleto);
});

// ─── PATCH /api/boletos/:id/editar — Alterar data de vencimento ──────────────
// Nota: EFI Bank não permite editar o valor de boletos já gerados.
router.patch('/:id/editar', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeAlterarVencimento) {
    res.status(403).json({ error: 'Sem permissão para alterar vencimento.' });
    return;
  }
  const id = param(req, 'id');
  const { dataVencimento } = req.body;

  if (!dataVencimento) {
    res.status(400).json({ error: 'Informe dataVencimento.' });
    return;
  }

  const boleto = await prisma.boleto.findUnique({
    where: { id },
    include: { carne: { select: { efiCarneId: true } } },
  });

  if (!boleto) {
    res.status(404).json({ error: 'Boleto não encontrado.' });
    return;
  }
  if (boleto.status !== 'PENDENTE' && boleto.status !== 'ATRASADO') {
    res.status(400).json({ error: 'Só é possível editar boletos com status PENDENTE ou ATRASADO.' });
    return;
  }

  // Atualizar vencimento no EFI
  if (boleto.carne.efiCarneId) {
    try {
      await efiService.atualizarParcela(
        Number(boleto.carne.efiCarneId),
        boleto.numeroParcela,
        dataVencimento
      );
    } catch (err: any) {
      console.error('Erro EFI ao atualizar parcela:', err);
      res.status(502).json({ error: `Erro ao atualizar no EFI Bank: ${err.message || 'erro desconhecido'}` });
      return;
    }
  }

  // Usar meio-dia local para evitar problema de fuso (new Date("YYYY-MM-DD") seria UTC midnight)
  const [y, m, d] = dataVencimento.split('-').map(Number);
  const atualizado = await prisma.boleto.update({
    where: { id },
    data: { vencimento: new Date(y, m - 1, d, 12, 0, 0) },
  });

  res.json(atualizado);
});

// ─── PATCH /api/boletos/:id/baixa — Dar baixa manual ────────────────────────
router.patch('/:id/baixa', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeBaixaManual) {
    res.status(403).json({ error: 'Sem permissão para dar baixa manual.' });
    return;
  }
  const id = param(req, 'id');

  const boleto = await prisma.boleto.findUnique({
    where: { id },
    include: {
      carne: {
        select: { efiCarneId: true },
      },
    },
  });

  if (!boleto) {
    res.status(404).json({ error: 'Boleto não encontrado.' });
    return;
  }
  if (boleto.status === 'PAGO') {
    res.status(400).json({ error: 'Boleto já está pago.' });
    return;
  }
  if (boleto.status === 'CANCELADO') {
    res.status(400).json({ error: 'Boleto cancelado não pode receber baixa.' });
    return;
  }
  if (boleto.status === 'REEMBOLSADO') {
    res.status(400).json({ error: 'Boleto reembolsado não pode receber baixa.' });
    return;
  }

  // Dar baixa no EFI
  if (boleto.carne.efiCarneId) {
    try {
      await efiService.liquidarParcela(
        Number(boleto.carne.efiCarneId),
        boleto.numeroParcela
      );
    } catch (sdkErr: any) {
      console.error('Erro SDK ao dar baixa no EFI:', sdkErr);
      // O SDK do EFI pode crashar com TypeError mesmo quando a chamada ao EFI
      // foi bem-sucedida (bug na leitura da resposta HTTP). Verificamos o status
      // real da parcela no EFI antes de decidir se é um erro real.
      if (boleto.efiChargeId) {
        try {
          const detalhe = await efiService.obterDetalheCharge(Number(boleto.efiChargeId));
          const statusEfi: string = detalhe?.status ?? '';
          if (statusEfi === 'settled' || statusEfi === 'paid') {
            // EFI confirmou — segue marcando como PAGO localmente
            console.log(`[baixa] EFI confirmou status="${statusEfi}" para charge ${boleto.efiChargeId} após crash do SDK`);
          } else {
            res.status(502).json({ error: `Erro ao dar baixa no EFI Bank: ${sdkErr.message || 'erro desconhecido'}` });
            return;
          }
        } catch {
          res.status(502).json({ error: `Erro ao dar baixa no EFI Bank: ${sdkErr.message || 'erro desconhecido'}` });
          return;
        }
      } else {
        res.status(502).json({ error: `Erro ao dar baixa no EFI Bank: ${sdkErr.message || 'erro desconhecido'}` });
        return;
      }
    }
  }

  // Atualizar no banco
  const atualizado = await prisma.boleto.update({
    where: { id },
    data: {
      status: 'PAGO',
      dataPagamento: new Date(),
      valorPago: boleto.valor,
    },
  });

  // Calcular comissão por placa (cada placa tem seu vendedor dono)
  await registrarComissoes(id);

  res.json(atualizado);
});

// ─── PATCH /api/boletos/:id/cancelar — Cancelar boleto individual ────────────
router.patch('/:id/cancelar', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeCancelarCarne) {
    res.status(403).json({ error: 'Sem permissão para cancelar boletos.' });
    return;
  }
  const id = param(req, 'id');

  const boleto = await prisma.boleto.findUnique({
    where: { id },
    include: { carne: { select: { efiCarneId: true } } },
  });

  if (!boleto) {
    res.status(404).json({ error: 'Boleto não encontrado.' });
    return;
  }
  if (boleto.status === 'CANCELADO') {
    res.status(400).json({ error: 'Boleto já está cancelado.' });
    return;
  }
  if (boleto.status === 'PAGO') {
    res.status(400).json({ error: 'Boleto já pago não pode ser cancelado.' });
    return;
  }
  if (boleto.status === 'REEMBOLSADO') {
    res.status(400).json({ error: 'Boleto reembolsado não pode ser cancelado.' });
    return;
  }

  // Cancelar parcela no EFI
  if (boleto.carne.efiCarneId) {
    try {
      await efiService.cancelarParcela(Number(boleto.carne.efiCarneId), boleto.numeroParcela);
    } catch (err: any) {
      console.error('Erro EFI ao cancelar parcela:', err);
      res.status(502).json({ error: `Erro ao cancelar no EFI Bank: ${err.message || 'erro desconhecido'}` });
      return;
    }
  }

  const atualizado = await prisma.boleto.update({
    where: { id },
    data: { status: 'CANCELADO' },
  });

  res.json(atualizado);
});

export default router;
