import { Router, Response, Request } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { param, query } from '../utils/params';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { DISPOSITIVOS_UPLOADS_DIR } from '../utils/upload-paths';
import {
  traccarCreateDevice,
  traccarUpdateDevice,
  traccarUpdateDeviceAccumulators,
  traccarDeleteDevice,
  traccarGetDeviceByImei,
  type TraccarDeviceSyncData,
} from '../services/traccar.service';
import { notificarIaproVinculoDispositivo } from '../services/iapro.service';

const router = Router();
router.use(authMiddleware);

// Multer para imagem do dispositivo
const uploadDir = DISPOSITIVOS_UPLOADS_DIR;
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const DISPOSITIVO_SELECT = {
  id: true, nome: true, identificador: true, categoria: true, grupo: true,
  contato: true, ativo: true,
  modeloRastreador: true, telefoneRastreador: true, iccid: true, operadora: true,
  placa: true, marca: true, modeloVeiculo: true, cor: true, ano: true,
  renavam: true, chassi: true, combustivel: true, localInstalacao: true, instalador: true,
  consumo: true, limiteVelocidade: true, senha: true, ignorarOdometro: true, manutencaoAtiva: true,
  odometroSistemaMetros: true, horimetroSistemaSegundos: true,
  telemetriaUltimaPosicaoEm: true, telemetriaUltimaLatitude: true, telemetriaUltimaLongitude: true, telemetriaUltimaIgnicao: true,
  imagemUrl: true, valorPadrao: true,
  mapa: true,
  enderecoMac: true,
  exibirNoMapaIapro: true,
  clienteId: true, vendedorId: true, criadoPorId: true,
  createdAt: true, updatedAt: true,
};

const CLIENTES_VINCULADOS_INCLUDE = {
  clientesVinculados: {
    include: { cliente: { select: { id: true, nome: true } } },
  },
  motoristasVinculados: {
    include: { motorista: { select: { id: true, nome: true } } },
  },
};

function parseOptionalKm(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const numero = Number(value);
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

function mapDispositivoResponse(dispositivo: Record<string, unknown>) {
  return {
    ...dispositivo,
    odometro: typeof dispositivo.odometroSistemaMetros === 'number' ? Math.round(dispositivo.odometroSistemaMetros) / 1000 : null,
    horimetro: typeof dispositivo.horimetroSistemaSegundos === 'number' ? Math.round((dispositivo.horimetroSistemaSegundos / 3600) * 10) / 10 : 0,
  };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Sincroniza a TagBLE principal do dispositivo com o campo enderecoMac.
 * SÓ cria a tag se não houver nenhuma cadastrada para o dispositivo —
 * assim, tags deletadas manualmente pelo admin não são recriadas
 * silenciosamente em edições posteriores do dispositivo.
 */
async function syncTagPrincipal(dispositivoId: string, enderecoMac: string | null): Promise<void> {
  if (!enderecoMac) return;
  const macNormalizado = enderecoMac.toUpperCase().trim();
  if (!macNormalizado) return;
  const existemTags = await prisma.tagBLE.count({ where: { dispositivoId } });
  if (existemTags > 0) return;
  await prisma.tagBLE.create({
    data: {
      dispositivoId,
      mac: macNormalizado,
      apelido: 'Tag principal',
    },
  });
}

function buildTraccarAccumulatorData(dispositivo: Record<string, unknown>) {
  const odometroMetros = numberOrNull(dispositivo.odometroSistemaMetros);
  const horimetroSegundos = numberOrNull(dispositivo.horimetroSistemaSegundos);
  return {
    odometroMetros,
    horimetroMilissegundos: horimetroSegundos != null ? horimetroSegundos * 1000 : null,
  };
}

async function syncTraccarAccumulators(traccarId: number, dispositivo: Record<string, unknown>): Promise<void> {
  const { odometroMetros, horimetroMilissegundos } = buildTraccarAccumulatorData(dispositivo);
  if (odometroMetros == null) return;
  await traccarUpdateDeviceAccumulators(traccarId, odometroMetros, horimetroMilissegundos);
}

function buildTraccarDeviceSyncData(dispositivo: Record<string, unknown>): TraccarDeviceSyncData {
  const odometroMetros = numberOrNull(dispositivo.odometroSistemaMetros);
  const limiteVelocidade = numberOrNull(dispositivo.limiteVelocidade);
  return {
    name: (() => {
      const nome = String(dispositivo.nome || '').trim();
      const placa = dispositivo.placa ? String(dispositivo.placa).trim() : '';
      return placa ? `${nome} (${placa})` : nome;
    })(),
    uniqueId: String(dispositivo.identificador || '').trim(),
    category: dispositivo.categoria ? String(dispositivo.categoria) : 'car',
    model: dispositivo.modeloRastreador ? String(dispositivo.modeloRastreador) : null,
    phone: dispositivo.telefoneRastreador ? String(dispositivo.telefoneRastreador) : null,
    attributes: {
      iccid: dispositivo.iccid || null,
      operadoraChip: dispositivo.operadora || null,
      odometroAtualKm: odometroMetros != null ? Math.round((odometroMetros / 1000) * 10) / 10 : null,
      consumo: dispositivo.consumo || null,
      limiteVelocidadeKmh: limiteVelocidade,
      speedLimit: limiteVelocidade,
      senha: dispositivo.senha || null,
    },
  };
}

// ─── GET /api/dispositivos ─────────────────────────────────────────────────
router.get('/', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const busca = query(req.query.busca);
  const clienteId = query(req.query.clienteId);
  const ativo = query(req.query.ativo);

  const dispositivos = await prisma.dispositivo.findMany({
    where: {
      ...(clienteId ? { clienteId } : {}),
      ...(ativo !== undefined ? { ativo: ativo === 'true' } : {}),
      ...(busca ? {
        OR: [
          { nome: { contains: busca, mode: 'insensitive' } },
          { identificador: { contains: busca, mode: 'insensitive' } },
          { placa: { contains: busca, mode: 'insensitive' } },
        ],
      } : {}),
    },
    include: {
      cliente: { select: { id: true, nome: true } },
      vendedor: { select: { id: true, nome: true } },
      _count: { select: { clientesVinculados: true, motoristasVinculados: true } },
      clientesVinculados: {
        take: 1,
        include: { cliente: { select: { id: true, nome: true } } },
      },
      motoristasVinculados: {
        include: { motorista: { select: { id: true, nome: true } } },
      },
    },
    orderBy: { nome: 'asc' },
  });

  res.json(dispositivos.map(mapDispositivoResponse));
});

// ─── GET /api/dispositivos/:id ─────────────────────────────────────────────
router.get('/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    include: {
      cliente: { select: { id: true, nome: true } },
      vendedor: { select: { id: true, nome: true } },
      criadoPor: { select: { id: true, nome: true } },
      ...CLIENTES_VINCULADOS_INCLUDE,
    },
  });

  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }

  res.json(mapDispositivoResponse(dispositivo));
});

// ─── POST /api/dispositivos ────────────────────────────────────────────────
router.post('/', requireRoles('ADMIN', 'COLABORADOR'), upload.single('imagem'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeCriarDispositivo) {
    res.status(403).json({ error: 'Sem permissão para criar dispositivos.' });
    return;
  }
  const {
    nome, identificador, categoria, grupo, contato, ativo,
    modeloRastreador, telefoneRastreador, iccid, operadora,
    placa, marca, modeloVeiculo, cor, ano, renavam, chassi, combustivel, localInstalacao, instalador,
    consumo, limiteVelocidade, senha, ignorarOdometro, manutencaoAtiva,
    odometro, enderecoMac, mapa, exibirNoMapaIapro,
    valorPadrao, clienteId, vendedorId,
  } = req.body;

  const odometroKm = parseOptionalKm(odometro);
  const mapaNumero = (() => {
    const n = Number(mapa);
    return n === 2 ? 2 : 1;
  })();

  if (!nome || !identificador) {
    res.status(400).json({ error: 'Nome e identificador são obrigatórios.' });
    return;
  }

  const jaExiste = await prisma.dispositivo.findUnique({ where: { identificador: String(identificador).trim() }, select: { id: true } });
  if (jaExiste) {
    res.status(400).json({ error: `O identificador "${identificador}" já está em uso.` });
    return;
  }

  if (clienteId) {
    const clienteExiste = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
    if (!clienteExiste) {
      res.status(404).json({ error: 'Cliente não encontrado.' });
      return;
    }
  }

  const imagemUrl = req.file ? `/uploads/dispositivos/${req.file.filename}` : null;

  const dispositivo = await prisma.dispositivo.create({
    data: {
      nome: String(nome).trim(),
      identificador: String(identificador).trim(),
      categoria: categoria || null,
      grupo: grupo || null,
      contato: contato || null,
      ativo: ativo === undefined ? true : (ativo === 'true' || ativo === true),
      modeloRastreador: modeloRastreador || null,
      telefoneRastreador: telefoneRastreador || null,
      iccid: iccid || null,
      operadora: operadora || null,
      placa: placa ? String(placa).toUpperCase().trim() : null,
      marca: marca || null,
      modeloVeiculo: modeloVeiculo || null,
      cor: cor || null,
      ano: ano || null,
      renavam: renavam || null,
      chassi: chassi || null,
      combustivel: combustivel || null,
      localInstalacao: localInstalacao || null,
      instalador: instalador || null,
      consumo: consumo || null,
      limiteVelocidade: limiteVelocidade ? Number(limiteVelocidade) : null,
      senha: senha || null,
      ignorarOdometro: ignorarOdometro === 'true' || ignorarOdometro === true,
      manutencaoAtiva: manutencaoAtiva === undefined ? true : (manutencaoAtiva === 'true' || manutencaoAtiva === true),
      odometroSistemaMetros: odometroKm != null ? Math.round(odometroKm * 1000) : null,
      imagemUrl,
      valorPadrao: valorPadrao ? Number(valorPadrao) : null,
      mapa: mapaNumero,
      enderecoMac: enderecoMac ? String(enderecoMac).toUpperCase().trim() : null,
      exibirNoMapaIapro: exibirNoMapaIapro === undefined ? true : (exibirNoMapaIapro === 'true' || exibirNoMapaIapro === true),
      clienteId: clienteId || null,
      vendedorId: vendedorId || null,
      criadoPorId: req.user!.userId,
    },
    include: {
      cliente: { select: { id: true, nome: true } },
    },
  });

  // Sincronizar clientes extras (junction)
  const clientesExtrasRaw = req.body.clientesExtras;
  if (clientesExtrasRaw) {
    let extras: string[] = [];
    try { extras = JSON.parse(clientesExtrasRaw); } catch { extras = []; }
    if (extras.length) {
      await prisma.dispositivoCliente.createMany({
        data: extras.map((cId: string) => ({ dispositivoId: dispositivo.id, clienteId: cId })),
        skipDuplicates: true,
      });
    }
  }

  // Garante que existe uma TagBLE associada ao MAC informado (para resgate)
  await syncTagPrincipal(dispositivo.id, dispositivo.enderecoMac);

  // Registrar na Traccar (best-effort — falha não bloqueia criação)
  traccarCreateDevice(buildTraccarDeviceSyncData(dispositivo))
    .then(td => syncTraccarAccumulators(td.id, dispositivo))
    .catch(err => console.error('[Traccar] Falha ao criar dispositivo:', err.message));

  // Integração IAPRO: dispositivo já nasce vinculado a cliente → notifica (best-effort)
  if (dispositivo.clienteId || clientesExtrasRaw) {
    void notificarIaproVinculoDispositivo(dispositivo.id);
  }

  res.status(201).json(mapDispositivoResponse(dispositivo));
});

// ─── PUT /api/dispositivos/:id ─────────────────────────────────────────────
router.put('/:id', requireRoles('ADMIN', 'COLABORADOR'), upload.single('imagem'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeEditarDispositivo) {
    res.status(403).json({ error: 'Sem permissão para editar dispositivos.' });
    return;
  }
  const id = param(req, 'id');

  const existe = await prisma.dispositivo.findUnique({ where: { id }, select: { id: true, nome: true, identificador: true, imagemUrl: true, clienteId: true } });
  if (!existe) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }

  const {
    nome, identificador, categoria, grupo, contato, ativo,
    modeloRastreador, telefoneRastreador, iccid, operadora,
    placa, marca, modeloVeiculo, cor, ano, renavam, chassi, combustivel, localInstalacao, instalador,
    consumo, limiteVelocidade, senha, ignorarOdometro, manutencaoAtiva,
    odometro, enderecoMac, mapa, exibirNoMapaIapro,
    valorPadrao, clienteId, vendedorId,
  } = req.body;
  const odometroKm = parseOptionalKm(odometro);
  const mapaNumeroPut = (() => {
    if (mapa === undefined) return undefined;
    const n = Number(mapa);
    return n === 2 ? 2 : 1;
  })();

  // Verificar unicidade do identificador (se mudou)
  const novoIdentificador = identificador ? String(identificador).trim() : existe.identificador;
  if (novoIdentificador !== existe.identificador) {
    const jaExiste = await prisma.dispositivo.findUnique({ where: { identificador: novoIdentificador }, select: { id: true } });
    if (jaExiste) {
      res.status(400).json({ error: `O identificador "${novoIdentificador}" já está em uso.` });
      return;
    }
  }

  // Verificar permissão de inativar (impede alterar campo ativo via PUT)
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeInativarDispositivo && ativo !== undefined) {
    res.status(403).json({ error: 'Sem permissão para inativar/ativar dispositivos.' });
    return;
  }

  // Verificar permissão de desvincular (impede remover clienteId via PUT)
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeDesvincularDispositivo) {
    const novoClienteId = clienteId === '' || clienteId === null || clienteId === undefined ? null : clienteId;
    if (existe.clienteId && novoClienteId === null) {
      res.status(403).json({ error: 'Sem permissão para desvincular dispositivos de clientes.' });
      return;
    }
  }

  // Imagem nova substitui a anterior
  let novaImagemUrl = existe.imagemUrl;
  if (req.file) {
    novaImagemUrl = `/uploads/dispositivos/${req.file.filename}`;
  }

  const dispositivo = await prisma.dispositivo.update({
    where: { id },
    data: {
      ...(nome !== undefined ? { nome: String(nome).trim() } : {}),
      ...(identificador !== undefined ? { identificador: novoIdentificador } : {}),
      ...(categoria !== undefined ? { categoria: categoria || null } : {}),
      ...(grupo !== undefined ? { grupo: grupo || null } : {}),
      ...(contato !== undefined ? { contato: contato || null } : {}),
      ...(ativo !== undefined ? { ativo: ativo === 'true' || ativo === true } : {}),
      ...(modeloRastreador !== undefined ? { modeloRastreador: modeloRastreador || null } : {}),
      ...(telefoneRastreador !== undefined ? { telefoneRastreador: telefoneRastreador || null } : {}),
      ...(iccid !== undefined ? { iccid: iccid || null } : {}),
      ...(operadora !== undefined ? { operadora: operadora || null } : {}),
      ...(placa !== undefined ? { placa: placa ? String(placa).toUpperCase().trim() : null } : {}),
      ...(marca !== undefined ? { marca: marca || null } : {}),
      ...(modeloVeiculo !== undefined ? { modeloVeiculo: modeloVeiculo || null } : {}),
      ...(cor !== undefined ? { cor: cor || null } : {}),
      ...(ano !== undefined ? { ano: ano || null } : {}),
      ...(renavam !== undefined ? { renavam: renavam || null } : {}),
      ...(chassi !== undefined ? { chassi: chassi || null } : {}),
      ...(combustivel !== undefined ? { combustivel: combustivel || null } : {}),
      ...(localInstalacao !== undefined ? { localInstalacao: localInstalacao || null } : {}),
      ...(instalador !== undefined ? { instalador: instalador || null } : {}),
      ...(consumo !== undefined ? { consumo: consumo || null } : {}),
      ...(limiteVelocidade !== undefined ? { limiteVelocidade: limiteVelocidade ? Number(limiteVelocidade) : null } : {}),
      ...(senha !== undefined ? { senha: senha || null } : {}),
      ...(ignorarOdometro !== undefined ? { ignorarOdometro: ignorarOdometro === 'true' || ignorarOdometro === true } : {}),
      ...(manutencaoAtiva !== undefined ? { manutencaoAtiva: manutencaoAtiva === 'true' || manutencaoAtiva === true } : {}),
      ...(odometro !== undefined ? { odometroSistemaMetros: odometroKm != null ? Math.round(odometroKm * 1000) : null } : {}),
      ...(enderecoMac !== undefined ? { enderecoMac: enderecoMac ? String(enderecoMac).toUpperCase().trim() : null } : {}),
      ...(exibirNoMapaIapro !== undefined ? { exibirNoMapaIapro: exibirNoMapaIapro === 'true' || exibirNoMapaIapro === true } : {}),
      ...(req.file ? { imagemUrl: novaImagemUrl } : {}),
      ...(valorPadrao !== undefined ? { valorPadrao: valorPadrao ? Number(valorPadrao) : null } : {}),
      ...(mapaNumeroPut !== undefined ? { mapa: mapaNumeroPut } : {}),
      ...(clienteId !== undefined ? { clienteId: clienteId || null } : {}),
      ...(vendedorId !== undefined ? { vendedorId: vendedorId || null } : {}),
    },
    include: {
      cliente: { select: { id: true, nome: true } },
    },
  });

  // Garante TagBLE associada ao MAC quando este foi atualizado
  if (enderecoMac !== undefined) {
    await syncTagPrincipal(dispositivo.id, dispositivo.enderecoMac);
  }

  // Se manutencaoAtiva foi desativado, cancela todas as recorrências ativas do dispositivo
  if (manutencaoAtiva !== undefined && !(manutencaoAtiva === 'true' || manutencaoAtiva === true)) {
    await prisma.manutencaoRecorrencia.updateMany({
      where: { dispositivoId: id, ativa: true },
      data: { ativa: false },
    });
    await prisma.manutencaoRecorrenciaData.updateMany({
      where: { dispositivoId: id, ativa: true },
      data: { ativa: false },
    });
  }

  // Desativa recorrências CLIENTE do responsável antigo ao trocar a titularidade via PUT
  if (clienteId !== undefined) {
    const novoClienteIdPut = clienteId || null;
    if (existe.clienteId && existe.clienteId !== novoClienteIdPut) {
      await prisma.manutencaoRecorrencia.updateMany({
        where: { dispositivoId: id, ativa: true, origem: 'CLIENTE', clienteLogin: { clienteId: existe.clienteId } },
        data: { ativa: false },
      });
      await prisma.manutencaoRecorrenciaData.updateMany({
        where: { dispositivoId: id, ativa: true, origem: 'CLIENTE', clienteLogin: { clienteId: existe.clienteId } },
        data: { ativa: false },
      });
    }
  }

  // Sincronizar clientes extras (junction) — substitui todos
  const clientesExtrasRaw = req.body.clientesExtras;
  if (clientesExtrasRaw !== undefined) {
    let extras: string[] = [];
    try { extras = JSON.parse(clientesExtrasRaw); } catch { extras = []; }
    await prisma.dispositivoCliente.deleteMany({ where: { dispositivoId: id } });
    if (extras.length) {
      await prisma.dispositivoCliente.createMany({
        data: extras.map((cId: string) => ({ dispositivoId: id, clienteId: cId })),
        skipDuplicates: true,
      });
    }
  }

  // Integração IAPRO: titularidade ou vínculos extras alterados → notifica (best-effort)
  if ((clienteId !== undefined && clienteId) || clientesExtrasRaw !== undefined) {
    void notificarIaproVinculoDispositivo(id);
  }

  // Atualizar na Traccar — se não existir, cria (best-effort)
  const traccarData = buildTraccarDeviceSyncData(dispositivo);
  traccarGetDeviceByImei(existe.identificador)
    .then(td => {
      if (td) {
        return traccarUpdateDevice(td.id, traccarData, td.attributes)
          .then(updated => syncTraccarAccumulators(updated.id, dispositivo));
      }
      return traccarCreateDevice(traccarData)
        .then(created => syncTraccarAccumulators(created.id, dispositivo));
    })
    .catch(err => console.error('[Traccar] Falha ao sincronizar dispositivo:', err.message));

  res.json(mapDispositivoResponse(dispositivo));
});

// ─── PATCH /api/dispositivos/:id/status — Toggle ativo ────────────────────
router.patch('/:id/status', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeInativarDispositivo) {
    res.status(403).json({ error: 'Sem permissão para inativar/ativar dispositivos.' });
    return;
  }
  const id = param(req, 'id');

  const existe = await prisma.dispositivo.findUnique({ where: { id }, select: { id: true, ativo: true } });
  if (!existe) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }

  const dispositivo = await prisma.dispositivo.update({
    where: { id },
    data: { ativo: !existe.ativo },
    select: { id: true, nome: true, ativo: true },
  });

  res.json(dispositivo);
});

// ─── PATCH /api/dispositivos/:id/vincular — Vincular/desvincular cliente ──
router.patch('/:id/vincular', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const { clienteId } = req.body; // null = desvincular

  if (req.user!.role === 'COLABORADOR' && !clienteId && !req.user!.podeDesvincularDispositivo) {
    res.status(403).json({ error: 'Sem permissão para desvincular dispositivos de clientes.' });
    return;
  }

  const existe = await prisma.dispositivo.findUnique({ where: { id }, select: { id: true, clienteId: true } });
  if (!existe) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }

  if (clienteId) {
    const clienteExiste = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
    if (!clienteExiste) {
      res.status(404).json({ error: 'Cliente não encontrado.' });
      return;
    }
  }

  const novoClienteId = clienteId || null;
  const dispositivo = await prisma.dispositivo.update({
    where: { id },
    data: { clienteId: novoClienteId },
    select: { id: true, nome: true, clienteId: true, ativo: true },
  });

  // Desativa recorrências CLIENTE do responsável antigo ao trocar a titularidade
  if (existe.clienteId && existe.clienteId !== novoClienteId) {
    await prisma.manutencaoRecorrencia.updateMany({
      where: { dispositivoId: id, ativa: true, origem: 'CLIENTE', clienteLogin: { clienteId: existe.clienteId } },
      data: { ativa: false },
    });
    await prisma.manutencaoRecorrenciaData.updateMany({
      where: { dispositivoId: id, ativa: true, origem: 'CLIENTE', clienteLogin: { clienteId: existe.clienteId } },
      data: { ativa: false },
    });
  }

  // Integração IAPRO: vinculado a um cliente (responsável) → notifica (best-effort)
  if (novoClienteId) {
    void notificarIaproVinculoDispositivo(id);
  }

  res.json(dispositivo);
});

// ─── POST /api/dispositivos/:id/clientes — Vincular cliente extra ──────────
router.post('/:id/clientes', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const dispositivoId = param(req, 'id');
  const { clienteId } = req.body;

  if (!clienteId) {
    res.status(400).json({ error: 'clienteId é obrigatório.' });
    return;
  }

  const [existe, clienteExiste] = await Promise.all([
    prisma.dispositivo.findUnique({ where: { id: dispositivoId }, select: { id: true } }),
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } }),
  ]);
  if (!existe) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }
  if (!clienteExiste) { res.status(404).json({ error: 'Cliente não encontrado.' }); return; }

  await prisma.dispositivoCliente.upsert({
    where: { dispositivoId_clienteId: { dispositivoId, clienteId } },
    create: { dispositivoId, clienteId },
    update: {},
  });

  // Integração IAPRO: vínculo extra com cliente → notifica (best-effort)
  void notificarIaproVinculoDispositivo(dispositivoId);

  res.status(201).json({ dispositivoId, clienteId });
});

// ─── DELETE /api/dispositivos/:id/clientes/:clienteId — Desvincular extra ──
router.delete('/:id/clientes/:clienteId', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeDesvincularDispositivo) {
    res.status(403).json({ error: 'Sem permissão para desvincular dispositivos de clientes.' });
    return;
  }
  const dispositivoId = param(req, 'id');
  const clienteId = param(req, 'clienteId');

  await prisma.dispositivoCliente.deleteMany({
    where: { dispositivoId, clienteId },
  });

  res.status(204).send();
});

// ─── PATCH /api/dispositivos/:id/valor — Definir valorPadrao ──────────────
router.patch('/:id/valor', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const { valor } = req.body;

  if (valor === undefined || valor === null || isNaN(Number(valor)) || Number(valor) < 0) {
    res.status(400).json({ error: 'valor deve ser um número >= 0.' });
    return;
  }

  const existe = await prisma.dispositivo.findUnique({ where: { id }, select: { id: true } });
  if (!existe) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }

  const dispositivo = await prisma.dispositivo.update({
    where: { id },
    data: { valorPadrao: Number(valor) > 0 ? Number(valor) : null },
    select: { id: true, valorPadrao: true },
  });

  res.json(dispositivo);
});

// ─── DELETE /api/dispositivos/:id ─────────────────────────────────────────
router.delete('/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeExcluirDispositivo) {
    res.status(403).json({ error: 'Sem permissão para excluir dispositivos.' });
    return;
  }
  const id = param(req, 'id');

  const existe = await prisma.dispositivo.findUnique({ where: { id }, select: { id: true, identificador: true } });
  if (!existe) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }

  const totalBoletos = await prisma.boleto.count({ where: { dispositivoId: id } });
  if (totalBoletos > 0) {
    res.status(400).json({ error: 'Não é possível excluir um dispositivo com boletos. Inative-o.' });
    return;
  }

  await prisma.dispositivo.delete({ where: { id } });

  // Remover da Traccar (best-effort)
  traccarGetDeviceByImei(existe.identificador)
    .then(td => { if (td) return traccarDeleteDevice(td.id); })
    .catch(err => console.error('[Traccar] Falha ao excluir dispositivo:', err.message));

  res.status(204).send();
});

export default router;
