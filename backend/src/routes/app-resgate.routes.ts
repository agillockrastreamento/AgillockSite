import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { param, query } from '../utils/params';
import { reverseGeocode } from '../utils/reverse-geocode';
import {
  traccarGetDeviceByImei,
  traccarSendCommand,
} from '../services/traccar.service';

const router = Router();
router.use(authMiddleware);

// GET /api/app/resgate/dispositivos
// Lista os dispositivos atribuídos ao usuário de resgate logado, incluindo a tag BLE associada.
router.get(
  '/app/resgate/dispositivos',
  requireRoles('RESGATE'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const atribuicoes = await prisma.usuarioResgateDispositivo.findMany({
      where: { usuarioId: userId },
      select: {
        dispositivoId: true,
        dispositivo: {
          select: {
            id: true,
            traccarId: true,
            nome: true,
            identificador: true,
            categoria: true,
            placa: true,
            marca: true,
            modeloVeiculo: true,
            cor: true,
            ano: true,
            enderecoMac: true,
            telemetriaUltimaLatitude: true,
            telemetriaUltimaLongitude: true,
            telemetriaUltimaPosicaoEm: true,
            telemetriaUltimaIgnicao: true,
          },
        },
        tag: {
          select: {
            id: true,
            apelido: true,
            mac: true,
            nomeBleAdvertised: true,
            manufacturerCompanyId: true,
            manufacturerDataHex: true,
            serviceUuids: true,
            txPowerCalibrado: true,
            iosPeripheralUuidCache: true,
          },
        },
      },
    });

    res.json(
      atribuicoes.map((a) => ({
        ...a.dispositivo,
        tag: a.tag,
      }))
    );
  }
);

// GET /api/app/resgate/geocode/reverse?lat=&lon=
// Geocodificação reversa para o app de resgate. Espelha a rota /cliente/...
// mas aceita JWT de role RESGATE.
router.get(
  '/app/resgate/geocode/reverse',
  requireRoles('RESGATE'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const lat = Number(query(req.query.lat));
    const lon = Number(query(req.query.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: 'Latitude e longitude inválidas.' });
      return;
    }
    try {
      const endereco = await reverseGeocode(lat, lon);
      res.json({ endereco });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  }
);

// POST /api/app/resgate/dispositivos/:id/comandos
// Envia comando (bloquear/desbloquear motor, etc.) a um dispositivo,
// mas só se o dispositivo estiver atribuído ao usuário de resgate logado.
router.post(
  '/app/resgate/dispositivos/:id/comandos',
  requireRoles('RESGATE'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const id = param(req, 'id');
    const userId = req.user!.userId;
    const { tipo, atributos } = req.body as {
      tipo?: string;
      atributos?: Record<string, unknown>;
    };

    if (!tipo) {
      res.status(400).json({ error: 'Campo "tipo" é obrigatório.' });
      return;
    }

    // Verifica que o dispositivo está atribuído ao usuário de resgate logado
    const atribuicao = await prisma.usuarioResgateDispositivo.findUnique({
      where: { usuarioId_dispositivoId: { usuarioId: userId, dispositivoId: id } },
      select: { dispositivo: { select: { id: true, identificador: true } } },
    });
    if (!atribuicao) {
      res.status(403).json({
        error: 'Você não tem acesso a este dispositivo.',
      });
      return;
    }

    const traccarDevice = await traccarGetDeviceByImei(
      atribuicao.dispositivo.identificador,
    ).catch(() => null);
    if (!traccarDevice) {
      res.status(404).json({ error: 'Dispositivo não sincronizado.' });
      return;
    }

    try {
      await traccarSendCommand(traccarDevice.id, tipo, atributos || {});
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Erro ao enviar comando: ${msg}` });
    }
  }
);

// GET /api/app/admin/dispositivos-pareamento
// Para admin no app: lista todos dispositivos pra fazer pareamento de tags.
router.get(
  '/app/admin/dispositivos-pareamento',
  requireRoles('ADMIN'),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    const dispositivos = await prisma.dispositivo.findMany({
      where: { ativo: true },
      select: {
        id: true,
        nome: true,
        placa: true,
        identificador: true,
        marca: true,
        modeloVeiculo: true,
        enderecoMac: true,
        tagsBle: {
          select: {
            id: true,
            apelido: true,
            mac: true,
            nomeBleAdvertised: true,
          },
        },
      },
      orderBy: { nome: 'asc' },
    });
    // Normaliza `tagsBle` → `tags` para o frontend
    res.json(
      dispositivos.map((d) => {
        const { tagsBle, ...rest } = d;
        return { ...rest, tags: tagsBle };
      })
    );
  }
);

export default router;
