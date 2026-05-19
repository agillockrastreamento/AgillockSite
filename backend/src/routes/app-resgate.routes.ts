import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';

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
    res.json(dispositivos);
  }
);

export default router;
