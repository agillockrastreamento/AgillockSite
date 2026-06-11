import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { query } from '../utils/params';
import { iaproApiKeyMiddleware } from '../middleware/iapro-api-key.middleware';
import { upsertClienteIapro, IaproClientePayload } from '../services/iapro.service';
import { traccarGetDevices, traccarGetPositions } from '../services/traccar.service';
import {
  DISPOSITIVO_MEDIDORES_SELECT,
  sincronizarDispositivosComPosicoes,
  decorarPosicaoComMedidores,
} from '../services/medidores.service';
import { reverseGeocode } from './rastreamento.routes';

/**
 * Rotas chamadas PELA IAPRO (server-to-server, autenticadas por API key).
 * Montadas em /api/integracao/iapro.
 */
const router = Router();
router.use(iaproApiKeyMiddleware);

// ─── POST /api/integracao/iapro/clientes — upsert cliente + veículo ─────────
router.post('/clientes', async (req: Request, res: Response): Promise<void> => {
  try {
    const resultado = await upsertClienteIapro(req.body as IaproClientePayload);
    res.status(201).json(resultado);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao sincronizar cliente.';
    res.status(400).json({ error: msg });
  }
});

// ─── GET /api/integracao/iapro/posicoes — snapshot dos veículos da IAPRO ────
// Mesmo formato de /api/rastreamento/posicoes, filtrado aos clientes da IAPRO.
router.get('/posicoes', async (_req: Request, res: Response): Promise<void> => {
  const [dispoResult, traccarResult] = await Promise.allSettled([
    prisma.dispositivo.findMany({
      where: {
        ativo: true,
        OR: [
          { cliente: { origemIapro: true } },
          { clientesVinculados: { some: { cliente: { origemIapro: true } } } },
          { iaproVeiculos: { some: {} } },
        ],
      },
      select: {
        id: true, nome: true, identificador: true, placa: true,
        categoria: true, marca: true, modeloVeiculo: true, cor: true, limiteVelocidade: true, imagemUrl: true,
        telefoneRastreador: true, operadora: true, mapa: true,
        ...DISPOSITIVO_MEDIDORES_SELECT,
        cliente: { select: { id: true, nome: true, iaproClienteId: true } },
        clientesVinculados: {
          select: { cliente: { select: { id: true, nome: true, iaproClienteId: true } } },
        },
      },
    }),
    traccarGetDevices(),
  ]);

  if (dispoResult.status === 'rejected') {
    res.status(500).json({ error: 'Erro ao buscar dispositivos.' });
    return;
  }
  const dispositivos = dispoResult.value;
  if (!dispositivos.length) { res.json([]); return; }

  if (traccarResult.status === 'rejected') {
    res.status(502).json({ error: 'Servidor de rastreamento indisponível.' });
    return;
  }
  const traccarDevices = traccarResult.value;
  const traccarByImei = new Map(traccarDevices.map(d => [d.uniqueId, d]));

  let posicoes: Awaited<ReturnType<typeof traccarGetPositions>> = [];
  try { posicoes = await traccarGetPositions(); } catch { /* sem posições */ }

  const posicaoPorDeviceId = new Map(posicoes.map(p => [p.deviceId, p]));
  const posicaoPorIdentificador = new Map<string, Awaited<ReturnType<typeof traccarGetPositions>>[number]>();
  for (const dispositivo of dispositivos) {
    const traccar = traccarByImei.get(dispositivo.identificador);
    const posicao = traccar ? posicaoPorDeviceId.get(traccar.id) : undefined;
    if (posicao) posicaoPorIdentificador.set(dispositivo.identificador, posicao);
  }
  const estadosAtualizados = await sincronizarDispositivosComPosicoes(dispositivos, posicaoPorIdentificador);

  const resultado = dispositivos.map(d => {
    const traccar = traccarByImei.get(d.identificador);
    const posicao = traccar ? posicaoPorDeviceId.get(traccar.id) : undefined;
    const estado = estadosAtualizados.get(d.identificador) ?? d;

    return {
      dispositivoId: d.id,
      nome: d.nome,
      placa: d.placa,
      identificador: d.identificador,
      categoria: d.categoria,
      imagemUrl: d.imagemUrl,
      marca: d.marca,
      modeloVeiculo: d.modeloVeiculo,
      cor: d.cor,
      telefoneRastreador: d.telefoneRastreador,
      operadora: d.operadora,
      limiteVelocidade: d.limiteVelocidade,
      // Cliente exibido: o responsável principal — mas se ele não for da IAPRO e houver um
      // cliente da IAPRO entre os vínculos extras do dispositivo, usa esse (é o caso de
      // dispositivo de frota/terceiro compartilhado com o cliente protegido pela IAPRO).
      cliente: (() => {
        const principal = d.cliente;
        if (principal?.iaproClienteId) return { id: principal.id, nome: principal.nome, iaproClienteId: principal.iaproClienteId };
        const vinculadoIapro = d.clientesVinculados?.map((cv) => cv.cliente).find((c) => c?.iaproClienteId) ?? null;
        const escolhido = vinculadoIapro ?? principal;
        return escolhido ? { id: escolhido.id, nome: escolhido.nome, iaproClienteId: escolhido.iaproClienteId } : null;
      })(),
      traccarId: traccar?.id ?? null,
      status: traccar?.status ?? 'unknown',
      lastUpdate: traccar?.lastUpdate ?? null,
      posicao: posicao ? decorarPosicaoComMedidores(estado, posicao) : null,
    };
  });

  res.json(resultado);
});

// ─── GET /api/integracao/iapro/geocode/reverse — endereço por lat/lon ───────
router.get('/geocode/reverse', async (req: Request, res: Response): Promise<void> => {
  const lat = Number(query(req.query.lat));
  const lon = Number(query(req.query.lon));
  try {
    const endereco = await reverseGeocode(lat, lon);
    res.json({ endereco });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

export default router;
