import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { param } from '../utils/params';

const router = Router();
router.use(authMiddleware);

const TAG_SELECT = {
  id: true,
  dispositivoId: true,
  apelido: true,
  mac: true,
  nomeBleAdvertised: true,
  manufacturerCompanyId: true,
  manufacturerDataHex: true,
  serviceUuids: true,
  txPowerCalibrado: true,
  iosPeripheralUuidCache: true,
  createdAt: true,
  updatedAt: true,
} as const;

// GET /api/dispositivos/:id/tags — lista tags do dispositivo
router.get(
  '/dispositivos/:id/tags',
  requireRoles('ADMIN', 'RESGATE'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const id = param(req, 'id');

    // Auto-sync: se o dispositivo tem enderecoMac mas nenhuma TagBLE
    // com aquele MAC (pode ter sido cadastrado antes da feature de tags),
    // cria a TagBLE principal agora — assim os dispositivos legados aparecem
    // corretamente na atribuição ao resgate. Upsert evita race condition.
    const dispositivo = await prisma.dispositivo.findUnique({
      where: { id },
      select: { id: true, enderecoMac: true },
    });
    if (dispositivo?.enderecoMac) {
      const mac = dispositivo.enderecoMac.toUpperCase().trim();
      if (mac) {
        await prisma.tagBLE.upsert({
          where: { dispositivoId_mac: { dispositivoId: id, mac } },
          update: {},
          create: { dispositivoId: id, mac, apelido: 'Tag principal' },
        });
      }
    }

    const tags = await prisma.tagBLE.findMany({
      where: { dispositivoId: id },
      select: TAG_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    res.json(tags);
  }
);

// POST /api/dispositivos/:id/tags — cria tag (manual ou via pareamento)
router.post(
  '/dispositivos/:id/tags',
  requireRoles('ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const dispositivoId = param(req, 'id');
    const {
      apelido,
      mac,
      nomeBleAdvertised,
      manufacturerCompanyId,
      manufacturerDataHex,
      serviceUuids,
      txPowerCalibrado,
      iosPeripheralUuid, // se vier, popula cache pra este device
      iosDeviceId,
    } = req.body as {
      apelido?: string;
      mac?: string | null;
      nomeBleAdvertised?: string | null;
      manufacturerCompanyId?: number | null;
      manufacturerDataHex?: string | null;
      serviceUuids?: string[] | null;
      txPowerCalibrado?: number | null;
      iosPeripheralUuid?: string | null;
      iosDeviceId?: string | null;
    };

    const dispositivo = await prisma.dispositivo.findUnique({
      where: { id: dispositivoId },
      select: { id: true },
    });
    if (!dispositivo) {
      res.status(404).json({ error: 'Dispositivo não encontrado.' });
      return;
    }

    const iosCache: Record<string, string> = {};
    if (iosPeripheralUuid && iosDeviceId) {
      iosCache[iosDeviceId] = iosPeripheralUuid;
    }

    const tag = await prisma.tagBLE.create({
      data: {
        dispositivoId,
        apelido: apelido ?? null,
        mac: mac ?? null,
        nomeBleAdvertised: nomeBleAdvertised ?? null,
        manufacturerCompanyId: manufacturerCompanyId ?? null,
        manufacturerDataHex: manufacturerDataHex ?? null,
        serviceUuids: serviceUuids ?? undefined,
        txPowerCalibrado: txPowerCalibrado ?? null,
        iosPeripheralUuidCache: iosCache,
      },
      select: TAG_SELECT,
    });
    res.status(201).json(tag);
  }
);

// PUT /api/tags/:id — atualiza fingerprint após (re)pareamento
router.put(
  '/tags/:id',
  requireRoles('ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const id = param(req, 'id');
    const {
      apelido,
      mac,
      nomeBleAdvertised,
      manufacturerCompanyId,
      manufacturerDataHex,
      serviceUuids,
      txPowerCalibrado,
      iosPeripheralUuid,
      iosDeviceId,
    } = req.body as {
      apelido?: string;
      mac?: string | null;
      nomeBleAdvertised?: string | null;
      manufacturerCompanyId?: number | null;
      manufacturerDataHex?: string | null;
      serviceUuids?: string[] | null;
      txPowerCalibrado?: number | null;
      iosPeripheralUuid?: string | null;
      iosDeviceId?: string | null;
    };

    const existente = await prisma.tagBLE.findUnique({
      where: { id },
      select: { iosPeripheralUuidCache: true },
    });
    if (!existente) {
      res.status(404).json({ error: 'Tag não encontrada.' });
      return;
    }

    const data: Record<string, unknown> = {};
    if (apelido !== undefined) data.apelido = apelido;
    if (mac !== undefined) data.mac = mac;
    if (nomeBleAdvertised !== undefined) data.nomeBleAdvertised = nomeBleAdvertised;
    if (manufacturerCompanyId !== undefined) data.manufacturerCompanyId = manufacturerCompanyId;
    if (manufacturerDataHex !== undefined) data.manufacturerDataHex = manufacturerDataHex;
    if (serviceUuids !== undefined) data.serviceUuids = serviceUuids;
    if (txPowerCalibrado !== undefined) data.txPowerCalibrado = txPowerCalibrado;

    // Atualiza cache iOS preservando outros devices
    if (iosPeripheralUuid && iosDeviceId) {
      const cacheAtual = (existente.iosPeripheralUuidCache as Record<string, string>) ?? {};
      data.iosPeripheralUuidCache = { ...cacheAtual, [iosDeviceId]: iosPeripheralUuid };
    }

    const tag = await prisma.tagBLE.update({
      where: { id },
      data,
      select: TAG_SELECT,
    });
    res.json(tag);
  }
);

// DELETE /api/tags/:id
router.delete(
  '/tags/:id',
  requireRoles('ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const id = param(req, 'id');
    const existe = await prisma.tagBLE.findUnique({ where: { id }, select: { id: true } });
    if (!existe) {
      res.status(404).json({ error: 'Tag não encontrada.' });
      return;
    }
    await prisma.tagBLE.delete({ where: { id } });
    res.status(204).send();
  }
);

export default router;
