import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import { param } from '../utils/params';
import prisma from '../utils/prisma';
import { 
  traccarCreateDriver, 
  traccarUpdateDriver, 
  traccarDeleteDriver, 
  traccarLinkDriverToDevice, 
  traccarUnlinkDriverFromDevice,
  traccarGetDeviceByImei 
} from '../services/traccar.service';

const router = Router();
router.use(authMiddleware);

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
router.post('/', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { nome, identificador, cnh, telefone, dispositivoId } = req.body as {
    nome: string; identificador?: string; cnh?: string; telefone?: string; dispositivoId?: string;
  };
  if (!nome?.trim()) { res.status(400).json({ error: 'Nome é obrigatório.' }); return; }

  // 1. Criar no banco local
  const motorista = await prisma.motorista.create({
    data: {
      nome: nome.trim(),
      identificador: identificador?.trim() || null,
      cnh: cnh?.trim() || null,
      telefone: telefone?.trim() || null,
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
router.put('/:id', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const { nome, identificador, cnh, telefone, ativo } = req.body as {
    nome?: string; identificador?: string; cnh?: string; telefone?: string; ativo?: boolean;
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
router.patch('/:id/status', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
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
router.delete('/:id', requireRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
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
