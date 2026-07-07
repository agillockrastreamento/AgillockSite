import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireMonitoramentoAccess, requireRoles } from '../middleware/roles.middleware';
import { param } from '../utils/params';
import prisma from '../utils/prisma';
import {
  traccarCreateDriver,
  traccarUpdateDriver,
  traccarDeleteDriver,
  traccarLinkDriverToDevice,
  traccarUnlinkDriverFromDevice,
  traccarGetDeviceByImei,
  traccarGetPositionHistory,
  cartaoDaPosicao,
} from '../services/traccar.service';
import { carregarResolvedorMotoristas } from '../services/motoristas.service';

const router = Router();
router.use(authMiddleware);
router.use(requireMonitoramentoAccess);

// ── GET /api/motoristas ────────────────────────────────────────────────────────
router.get('/', requireRoles('ADMIN', 'COLABORADOR'), async (_req: AuthRequest, res: Response): Promise<void> => {
  const motoristas = await prisma.motorista.findMany({
    orderBy: { nome: 'asc' },
    include: {
      dispositivosVinculados: {
        include: {
          dispositivo: { select: { id: true, nome: true, placa: true, identificador: true } }
        }
      },
    },
  });
  
  // Mapear para manter o formato esperado pelo frontend
  const result = motoristas.map(m => ({
    ...m,
    dispositivos: m.dispositivosVinculados.map(dv => dv.dispositivo)
  }));

  res.json(result);
});

// ── GET /api/motoristas/empresas ───────────────────────────────────────────────
// Nível 1 da tela: empresas (clientes) que possuem motoristas, com contagens.
// Inclui um balde "Sem empresa" (clienteId null) para motoristas não atribuídos.
router.get('/empresas', requireRoles('ADMIN', 'COLABORADOR'), async (_req: AuthRequest, res: Response): Promise<void> => {
  const grupos = await prisma.motorista.groupBy({
    by: ['clienteId'],
    _count: { _all: true },
  });
  const clienteIds = grupos.map(g => g.clienteId).filter((x): x is string => !!x);
  const [clientes, dispPorCliente] = await Promise.all([
    prisma.cliente.findMany({ where: { id: { in: clienteIds } }, select: { id: true, nome: true, cpfCnpj: true } }),
    prisma.dispositivo.groupBy({ by: ['clienteId'], where: { clienteId: { in: clienteIds }, ativo: true }, _count: { _all: true } }),
  ]);
  const clientePorId = new Map(clientes.map(c => [c.id, c]));
  const dispCount = new Map(dispPorCliente.map(d => [d.clienteId, d._count._all]));

  const empresas = grupos
    .filter(g => g.clienteId)
    .map(g => ({
      clienteId: g.clienteId as string,
      nome: clientePorId.get(g.clienteId as string)?.nome ?? '—',
      cpfCnpj: clientePorId.get(g.clienteId as string)?.cpfCnpj ?? null,
      qtdMotoristas: g._count._all,
      qtdDispositivos: dispCount.get(g.clienteId as string) ?? 0,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const semEmpresa = grupos.find(g => g.clienteId === null);
  if (semEmpresa) {
    empresas.push({ clienteId: 'sem-empresa', nome: 'Sem empresa', cpfCnpj: null, qtdMotoristas: semEmpresa._count._all, qtdDispositivos: 0 });
  }
  res.json(empresas);
});

// ── GET /api/motoristas/empresa/:clienteId ─────────────────────────────────────
// Nível 2 da tela: motoristas + dispositivos + matriz de vínculos de uma empresa.
router.get('/empresa/:clienteId', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const raw = param(req, 'clienteId');
  const semEmpresa = raw === 'sem-empresa';
  const clienteId = semEmpresa ? null : raw;

  const cliente = semEmpresa ? null : await prisma.cliente.findUnique({ where: { id: clienteId! }, select: { id: true, nome: true, cpfCnpj: true } });
  if (!semEmpresa && !cliente) { res.status(404).json({ error: 'Empresa não encontrada.' }); return; }

  const motoristas = await prisma.motorista.findMany({
    where: { clienteId: clienteId },
    orderBy: { nome: 'asc' },
    select: {
      id: true, nome: true, identificador: true, cnh: true, telefone: true, ativo: true,
      dispositivosVinculados: { select: { dispositivoId: true } },
    },
  });

  // Dispositivos disponíveis para a matriz: da empresa (ativos) ou, no balde
  // "Sem empresa", os que já estão vinculados a esses motoristas (para dar contexto).
  let dispositivos: { id: string; nome: string; placa: string | null; identificador: string }[];
  if (semEmpresa) {
    const idsVinculados = [...new Set(motoristas.flatMap(m => m.dispositivosVinculados.map(dv => dv.dispositivoId)))];
    dispositivos = idsVinculados.length
      ? await prisma.dispositivo.findMany({ where: { id: { in: idsVinculados } }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, placa: true, identificador: true } })
      : [];
  } else {
    dispositivos = await prisma.dispositivo.findMany({
      where: { clienteId: clienteId!, ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, placa: true, identificador: true },
    });
  }

  const dispIds = new Set(dispositivos.map(d => d.id));
  const vinculos: { motoristaId: string; dispositivoId: string }[] = [];
  for (const m of motoristas) {
    for (const dv of m.dispositivosVinculados) {
      if (dispIds.has(dv.dispositivoId)) vinculos.push({ motoristaId: m.id, dispositivoId: dv.dispositivoId });
    }
  }

  res.json({
    cliente: cliente ?? { id: 'sem-empresa', nome: 'Sem empresa', cpfCnpj: null },
    motoristas: motoristas.map(m => ({ id: m.id, nome: m.nome, identificador: m.identificador, cnh: m.cnh, telefone: m.telefone, ativo: m.ativo })),
    dispositivos,
    vinculos,
  });
});

// ── POST /api/motoristas/vincular-massa ────────────────────────────────────────
// Vincula (ou desvincula) várias combinações motorista×dispositivo de uma vez.
router.post('/vincular-massa', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { motoristaIds, dispositivoIds, vincular } = req.body as {
    motoristaIds?: string[]; dispositivoIds?: string[]; vincular?: boolean;
  };
  if (!Array.isArray(motoristaIds) || !Array.isArray(dispositivoIds) || !motoristaIds.length || !dispositivoIds.length) {
    res.status(400).json({ error: 'Informe ao menos um motorista e um dispositivo.' }); return;
  }
  const ligar = vincular !== false; // default: vincular

  const pares: { motoristaId: string; dispositivoId: string }[] = [];
  for (const mId of motoristaIds) for (const dId of dispositivoIds) pares.push({ motoristaId: mId, dispositivoId: dId });

  // 1. Banco local
  if (ligar) {
    await prisma.motoristaDispositivo.createMany({ data: pares, skipDuplicates: true });
  } else {
    await prisma.motoristaDispositivo.deleteMany({ where: { OR: pares } });
  }

  // 2. Traccar (best-effort — não bloqueia a resposta em caso de falha)
  try {
    const [motoristas, dispositivos] = await Promise.all([
      prisma.motorista.findMany({ where: { id: { in: motoristaIds }, traccarId: { not: null } }, select: { traccarId: true } }),
      prisma.dispositivo.findMany({ where: { id: { in: dispositivoIds } }, select: { identificador: true } }),
    ]);
    const traccarDeviceIds: number[] = [];
    for (const d of dispositivos) {
      const tDev = await traccarGetDeviceByImei(d.identificador).catch(() => null);
      if (tDev) traccarDeviceIds.push(tDev.id);
    }
    for (const m of motoristas) {
      if (!m.traccarId) continue;
      for (const tDevId of traccarDeviceIds) {
        if (ligar) await traccarLinkDriverToDevice(m.traccarId, tDevId).catch(() => {});
        else await traccarUnlinkDriverFromDevice(m.traccarId, tDevId).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Erro ao sincronizar vínculos em massa no Traccar:', err);
  }

  res.json({ ok: true, pares: pares.length, vinculados: ligar });
});

// ── GET /api/motoristas/dispositivos/:id/ultimo-cartao ─────────────────────────
// Último cartão RFID lido por um dispositivo. O leitor só envia o cartão no
// login/logout da jornada (posições esparsas), então varre o histórico recente
// e pega a leitura mais recente. Ajuda a cadastrar o identificador no formato
// exato que o Traccar recebe (número do cartão no atributo `serial`).
router.get('/dispositivos/:id/ultimo-cartao', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const disp = await prisma.dispositivo.findUnique({ where: { id }, select: { identificador: true } });
  if (!disp) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const tDev = await traccarGetDeviceByImei(disp.identificador).catch(() => null);
  if (!tDev) { res.json({ cartaoId: null, motorista: null, lidoEm: null, inicio: null }); return; }

  const ate = new Date();
  const de = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const historico = await traccarGetPositionHistory([tDev.id], de, ate).catch(() => []);

  let melhor: { t: number; cartao: string; inicio: boolean; lidoEm: string | null } | null = null;
  for (const pos of historico) {
    const cartao = cartaoDaPosicao(pos.attributes);
    if (!cartao) continue;
    const lidoEm = pos.deviceTime || pos.fixTime || pos.serverTime || null;
    const t = lidoEm ? new Date(lidoEm).getTime() : 0;
    if (!melhor || t > melhor.t) melhor = { t, cartao: cartao.cartao, inicio: cartao.inicio, lidoEm };
  }

  if (!melhor) { res.json({ cartaoId: null, motorista: null, lidoEm: null, inicio: null }); return; }
  const resolver = await carregarResolvedorMotoristas();
  res.json({ cartaoId: melhor.cartao, motorista: resolver(melhor.cartao), lidoEm: melhor.lidoEm, inicio: melhor.inicio });
});

// ── GET /api/motoristas/:id ────────────────────────────────────────────────────
router.get('/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const motorista = await prisma.motorista.findUnique({
    where: { id },
    include: {
      dispositivosVinculados: {
        include: {
          dispositivo: { select: { id: true, nome: true, placa: true, identificador: true } }
        }
      },
    },
  });
  if (!motorista) { res.status(404).json({ error: 'Motorista não encontrado.' }); return; }
  
  const result = {
    ...motorista,
    dispositivos: motorista.dispositivosVinculados.map(dv => dv.dispositivo)
  };
  
  res.json(result);
});

// ── POST /api/motoristas ───────────────────────────────────────────────────────
router.post('/', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { nome, identificador, cnh, telefone, dispositivoId, clienteId } = req.body as {
    nome: string; identificador?: string; cnh?: string; telefone?: string; dispositivoId?: string; clienteId?: string | null;
  };
  if (!nome?.trim()) { res.status(400).json({ error: 'Nome é obrigatório.' }); return; }

  // 1. Criar no banco local
  const motorista = await prisma.motorista.create({
    data: {
      nome: nome.trim(),
      identificador: identificador?.trim() || null,
      cnh: cnh?.trim() || null,
      telefone: telefone?.trim() || null,
      clienteId: clienteId || null,
      ...(dispositivoId ? {
        dispositivosVinculados: {
          create: { dispositivoId: dispositivoId }
        }
      } : {}),
    },
    include: {
      dispositivosVinculados: {
        include: {
          dispositivo: { select: { id: true, nome: true, placa: true, identificador: true } }
        }
      },
    },
  });

  // 2. Sincronizar com Traccar (se tiver identificador)
  if (identificador?.trim()) {
    try {
      const tDriver = await traccarCreateDriver(nome.trim(), identificador.trim());
      await prisma.motorista.update({
        where: { id: motorista.id },
        data: { traccarId: tDriver.id }
      });

      // Se vinculou a um dispositivo, vincular também no Traccar
      if (dispositivoId) {
        const disp = await prisma.dispositivo.findUnique({ where: { id: dispositivoId } });
        if (disp) {
          const tDevice = await traccarGetDeviceByImei(disp.identificador).catch(() => null);
          if (tDevice) {
            await traccarLinkDriverToDevice(tDriver.id, tDevice.id).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error('Erro ao sincronizar motorista com Traccar:', err);
    }
  }

  const result = {
    ...motorista,
    dispositivos: motorista.dispositivosVinculados.map(dv => dv.dispositivo)
  };
  res.status(201).json(result);
});

// ── PUT /api/motoristas/:id ────────────────────────────────────────────────────
router.put('/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const { nome, identificador, cnh, telefone, ativo, clienteId } = req.body as {
    nome?: string; identificador?: string; cnh?: string; telefone?: string; ativo?: boolean; clienteId?: string | null;
  };

  const existe = await prisma.motorista.findUnique({ where: { id } });
  if (!existe) { res.status(404).json({ error: 'Motorista não encontrado.' }); return; }

  const motorista = await prisma.motorista.update({
    where: { id },
    data: {
      ...(nome !== undefined ? { nome: nome.trim() } : {}),
      ...(identificador !== undefined ? { identificador: identificador.trim() || null } : {}),
      ...(cnh !== undefined ? { cnh: cnh.trim() || null } : {}),
      ...(telefone !== undefined ? { telefone: telefone.trim() || null } : {}),
      ...(ativo !== undefined ? { ativo } : {}),
      ...(clienteId !== undefined ? { clienteId: clienteId || null } : {}),
    },
    include: {
      dispositivosVinculados: {
        include: {
          dispositivo: { select: { id: true, nome: true, placa: true, identificador: true } }
        }
      },
    },
  });

  // Sincronizar com Traccar
  if (motorista.traccarId) {
    try {
      await traccarUpdateDriver(motorista.traccarId, motorista.nome, motorista.identificador || '');
    } catch (err) {
      console.error('Erro ao atualizar motorista no Traccar:', err);
    }
  } else if (motorista.identificador) {
    try {
      const tDriver = await traccarCreateDriver(motorista.nome, motorista.identificador);
      await prisma.motorista.update({
        where: { id: motorista.id },
        data: { traccarId: tDriver.id }
      });
    } catch (err) {}
  }

  const result = {
    ...motorista,
    dispositivos: motorista.dispositivosVinculados.map(dv => dv.dispositivo)
  };
  res.json(result);
});

// ── PATCH /api/motoristas/:id/status ──────────────────────────────────────────
router.patch('/:id/status', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const motorista = await prisma.motorista.findUnique({ where: { id } });
  if (!motorista) { res.status(404).json({ error: 'Motorista não encontrado.' }); return; }
  const updated = await prisma.motorista.update({
    where: { id },
    data: { ativo: !motorista.ativo },
  });
  res.json(updated);
});

// ── DELETE /api/motoristas/:id ─────────────────────────────────────────────────
router.delete('/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const motorista = await prisma.motorista.findUnique({ where: { id } });
  if (!motorista) { res.status(404).json({ error: 'Motorista não encontrado.' }); return; }

  if (motorista.traccarId) {
    try {
      await traccarDeleteDriver(motorista.traccarId);
    } catch (err) {
      console.error('Erro ao deletar motorista no Traccar:', err);
    }
  }

  // Com onDelete: Cascade, o MotoristaDispositivo será removido automaticamente
  await prisma.motorista.delete({ where: { id } });
  res.json({ ok: true });
});

// ── POST /api/motoristas/:id/vincular ─────────────────────────────────────────
router.post('/:id/vincular', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const { dispositivoId } = req.body as { dispositivoId: string };
  if (!dispositivoId) { res.status(400).json({ error: 'dispositivoId é obrigatório.' }); return; }

  const [motorista, dispositivo] = await Promise.all([
    prisma.motorista.findUnique({ where: { id } }),
    prisma.dispositivo.findUnique({ where: { id: dispositivoId } }),
  ]);
  if (!motorista) { res.status(404).json({ error: 'Motorista não encontrado.' }); return; }
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  // 1. Vincular localmente (Many-to-Many)
  await prisma.motoristaDispositivo.upsert({
    where: {
      motoristaId_dispositivoId: {
        motoristaId: id,
        dispositivoId: dispositivoId
      }
    },
    update: {},
    create: {
      motoristaId: id,
      dispositivoId: dispositivoId
    }
  });

  // 2. Vincular no Traccar
  if (motorista.traccarId) {
    try {
      const tDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
      if (tDevice) {
        await traccarLinkDriverToDevice(motorista.traccarId, tDevice.id);
      }
    } catch (err) {
      console.error('Erro ao vincular motorista no Traccar:', err);
    }
  }

  res.json({ ok: true });
});

// ── DELETE /api/motoristas/:id/vincular/:dispositivoId ────────────────────────
router.delete('/:id/vincular/:dispositivoId', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const motoristaId = param(req, 'id');
  const dispositivoId = param(req, 'dispositivoId');
  
  const [motorista, dispositivo] = await Promise.all([
    prisma.motorista.findUnique({ where: { id: motoristaId } }),
    prisma.dispositivo.findUnique({ where: { id: dispositivoId } }),
  ]);

  // 1. Desvincular localmente
  await prisma.motoristaDispositivo.delete({
    where: {
      motoristaId_dispositivoId: {
        motoristaId: motoristaId,
        dispositivoId: dispositivoId
      }
    }
  }).catch(() => {});

  // 2. Desvincular no Traccar
  if (motorista?.traccarId && dispositivo) {
    try {
      const tDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
      if (tDevice) {
        await traccarUnlinkDriverFromDevice(motorista.traccarId, tDevice.id);
      }
    } catch (err) {}
  }

  res.json({ ok: true });
});

export default router;
