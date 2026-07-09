// CRUD de dispositivos do portal/app do cliente. Montado em /api/cliente/dispositivos.
//
// Disponível apenas quando o admin habilita `Cliente.dispositivosHabilitado` e define
// `Cliente.limiteDispositivos` (teto TOTAL de dispositivos do cliente — os associados
// pelo admin também consomem a cota).
//
// Dois tipos de dispositivo aparecem na tela do cliente:
//   • associados pelo admin  → somente leitura parcial: o cliente edita identificação e
//     veículo, mas não pode inativar, excluir, nem tocar nos campos do rastreador;
//   • criados pelo cliente   → controle total (criadoPorClienteLoginId != null).
//
// IMPORTANTE: os gates são aplicados por rota, e não com `router.use(...)`. Este router é
// montado no mesmo prefixo de rotas do clientePortalRoutes (ex.: /dispositivos/:id/apelido);
// um `router.use(gate)` responderia 403 para elas antes de o Express seguir para o próximo
// router, quebrando o portal de clientes sem a feature habilitada.
import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
  clienteAuthMiddleware,
  requireResponsavel,
  whereDispositivosDoCliente,
  ClienteRequest,
} from '../middleware/cliente-auth.middleware';
import prisma from '../utils/prisma';
import { param } from '../utils/params';
import { DISPOSITIVOS_UPLOADS_DIR } from '../utils/upload-paths';
import {
  traccarCreateDevice,
  traccarUpdateDevice,
  traccarDeleteDevice,
  traccarGetDeviceByImei,
} from '../services/traccar.service';
import { reancorarRecorrenciasSeOdometroMenor } from '../services/medidores.service';
import {
  parseOptionalKm,
  mapDispositivoResponse,
  buildTraccarDeviceSyncData,
  syncTraccarAccumulators,
} from '../utils/dispositivo-sync';

const router = Router();
router.use(clienteAuthMiddleware);

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
  manutencaoAtiva: true,
  odometroSistemaMetros: true, horimetroSistemaSegundos: true,
  imagemUrl: true,
  clienteId: true, criadoPorClienteLoginId: true,
  createdAt: true, updatedAt: true,
};

// ─── Gate: cliente habilitado pelo admin ───────────────────────────────────
async function requireGestaoDispositivos(req: ClienteRequest, res: Response, next: NextFunction): Promise<void> {
  const cliente = await prisma.cliente.findUnique({
    where: { id: req.cliente!.clienteId },
    select: { dispositivosHabilitado: true },
  });
  if (!cliente?.dispositivosHabilitado) {
    res.status(403).json({ error: 'Gestão de dispositivos não habilitada para este cliente.' });
    return;
  }
  next();
}

/** Um dispositivo é "do cliente" quando foi criado por um login do próprio cliente. */
function ehDoCliente(
  dispositivo: { criadoPorClienteLoginId: string | null; criadoPorClienteLogin?: { clienteId: string } | null },
  clienteId: string,
): boolean {
  if (!dispositivo.criadoPorClienteLoginId) return false;
  if (dispositivo.criadoPorClienteLogin) return dispositivo.criadoPorClienteLogin.clienteId === clienteId;
  return true;
}

/** Total de dispositivos que ocupam a cota do cliente (titular + vinculados). */
function contarDispositivos(clienteId: string): Promise<number> {
  return prisma.dispositivo.count({
    where: { OR: [{ clienteId }, { clientesVinculados: { some: { clienteId } } }] },
  });
}

/** Busca um dispositivo acessível ao cliente logado; null se não existir/sem acesso. */
async function buscarDispositivoAcessivel(req: ClienteRequest, id: string) {
  return prisma.dispositivo.findFirst({
    where: { AND: [{ id }, whereDispositivosDoCliente(req)] },
    include: { criadoPorClienteLogin: { select: { clienteId: true } } },
  });
}

// ─── GET /api/cliente/dispositivos ─────────────────────────────────────────
// Envelope com a cota para a tela decidir se o botão "Novo Dispositivo" cria ou avisa.
router.get('/', requireResponsavel, requireGestaoDispositivos, async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;

  const [cliente, dispositivos] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { limiteDispositivos: true } }),
    prisma.dispositivo.findMany({
      where: whereDispositivosDoCliente(req),
      select: DISPOSITIVO_SELECT,
      orderBy: { nome: 'asc' },
    }),
  ]);

  const total = await contarDispositivos(clienteId);
  const limite = cliente?.limiteDispositivos ?? 0;

  res.json({
    limite,
    total,
    podeCriar: total < limite,
    dispositivos: dispositivos.map((d) => ({
      ...mapDispositivoResponse(d),
      podeGerenciar: ehDoCliente(d, clienteId),
    })),
  });
});

// ─── GET /api/cliente/dispositivos/:id ─────────────────────────────────────
router.get('/:id', requireResponsavel, requireGestaoDispositivos, async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivo = await buscarDispositivoAcessivel(req, param(req, 'id'));
  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }

  const podeGerenciar = ehDoCliente(dispositivo, clienteId);
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { podeEditarMedidores: true },
  });

  res.json({
    ...mapDispositivoResponse(dispositivo),
    podeGerenciar,
    podeEditarOdometro: podeGerenciar || !!cliente?.podeEditarMedidores,
  });
});

// ─── POST /api/cliente/dispositivos ────────────────────────────────────────
router.post('/', requireResponsavel, requireGestaoDispositivos, upload.single('imagem'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const clienteLoginId = req.cliente!.sub;

  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { limiteDispositivos: true },
  });
  const limite = cliente?.limiteDispositivos ?? 0;
  const total = await contarDispositivos(clienteId);
  if (total >= limite) {
    res.status(400).json({
      error: `Limite de ${limite} dispositivo(s) atingido. Entre em contato com a AgilLock para ampliar o seu plano.`,
    });
    return;
  }

  const {
    nome, identificador, categoria, grupo, contato, ativo,
    modeloRastreador, telefoneRastreador, iccid, operadora,
    placa, marca, modeloVeiculo, cor, ano, renavam, chassi, combustivel, localInstalacao, instalador,
    odometro, manutencaoAtiva,
  } = req.body;

  if (!nome || !identificador) {
    res.status(400).json({ error: 'Nome e identificador são obrigatórios.' });
    return;
  }

  const identificadorLimpo = String(identificador).trim();
  const jaExiste = await prisma.dispositivo.findUnique({ where: { identificador: identificadorLimpo }, select: { id: true } });
  if (jaExiste) {
    res.status(400).json({ error: `O identificador "${identificadorLimpo}" já está em uso.` });
    return;
  }

  const odometroKm = parseOptionalKm(odometro);

  const dispositivo = await prisma.dispositivo.create({
    data: {
      nome: String(nome).trim(),
      identificador: identificadorLimpo,
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
      manutencaoAtiva: manutencaoAtiva === undefined ? true : (manutencaoAtiva === 'true' || manutencaoAtiva === true),
      odometroSistemaMetros: odometroKm != null ? Math.round(odometroKm * 1000) : null,
      imagemUrl: req.file ? `/uploads/dispositivos/${req.file.filename}` : null,
      clienteId,
      criadoPorClienteLoginId: clienteLoginId,
    },
    select: DISPOSITIVO_SELECT,
  });

  // Registrar na Traccar (best-effort — falha não bloqueia a criação)
  traccarCreateDevice(buildTraccarDeviceSyncData(dispositivo))
    .then((td) => syncTraccarAccumulators(td.id, dispositivo))
    .catch((err) => console.error('[Traccar] Falha ao criar dispositivo do cliente:', err.message));

  res.status(201).json({ ...mapDispositivoResponse(dispositivo), podeGerenciar: true });
});

// ─── PUT /api/cliente/dispositivos/:id ─────────────────────────────────────
// Campos do rastreador (identificador, ativo, modelo, telefone, iccid, operadora) só são
// aceitos em dispositivos criados pelo próprio cliente. Nos associados pelo admin eles são
// descartados silenciosamente — a tela já os apresenta desabilitados.
router.put('/:id', requireResponsavel, requireGestaoDispositivos, upload.single('imagem'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const clienteId = req.cliente!.clienteId;

  const existe = await buscarDispositivoAcessivel(req, id);
  if (!existe) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }
  const podeGerenciar = ehDoCliente(existe, clienteId);

  const {
    nome, identificador, categoria, grupo, contato, ativo,
    modeloRastreador, telefoneRastreador, iccid, operadora,
    placa, marca, modeloVeiculo, cor, ano, renavam, chassi, combustivel, localInstalacao, instalador,
    odometro, manutencaoAtiva,
  } = req.body;

  // Odômetro é um medidor: só editável nos dispositivos do cliente ou quando o admin
  // liberou `podeEditarMedidores` (mesma flag do card do mapa).
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { podeEditarMedidores: true },
  });
  const podeEditarOdometro = podeGerenciar || !!cliente?.podeEditarMedidores;
  const odometroKm = parseOptionalKm(odometro);
  const aplicarOdometro = podeEditarOdometro && odometro !== undefined;

  let novoIdentificador = existe.identificador;
  if (podeGerenciar && identificador !== undefined) {
    novoIdentificador = String(identificador).trim();
    if (novoIdentificador !== existe.identificador) {
      const emUso = await prisma.dispositivo.findUnique({ where: { identificador: novoIdentificador }, select: { id: true } });
      if (emUso) {
        res.status(400).json({ error: `O identificador "${novoIdentificador}" já está em uso.` });
        return;
      }
    }
  }

  const dispositivo = await prisma.dispositivo.update({
    where: { id },
    data: {
      ...(nome !== undefined ? { nome: String(nome).trim() } : {}),
      ...(categoria !== undefined ? { categoria: categoria || null } : {}),
      ...(grupo !== undefined ? { grupo: grupo || null } : {}),
      ...(contato !== undefined ? { contato: contato || null } : {}),
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
      ...(manutencaoAtiva !== undefined ? { manutencaoAtiva: manutencaoAtiva === 'true' || manutencaoAtiva === true } : {}),
      ...(aplicarOdometro ? { odometroSistemaMetros: odometroKm != null ? Math.round(odometroKm * 1000) : null } : {}),
      ...(req.file ? { imagemUrl: `/uploads/dispositivos/${req.file.filename}` } : {}),
      // Somente dispositivos criados pelo cliente
      ...(podeGerenciar && identificador !== undefined ? { identificador: novoIdentificador } : {}),
      ...(podeGerenciar && ativo !== undefined ? { ativo: ativo === 'true' || ativo === true } : {}),
      ...(podeGerenciar && modeloRastreador !== undefined ? { modeloRastreador: modeloRastreador || null } : {}),
      ...(podeGerenciar && telefoneRastreador !== undefined ? { telefoneRastreador: telefoneRastreador || null } : {}),
      ...(podeGerenciar && iccid !== undefined ? { iccid: iccid || null } : {}),
      ...(podeGerenciar && operadora !== undefined ? { operadora: operadora || null } : {}),
    },
    select: DISPOSITIVO_SELECT,
  });

  if (aplicarOdometro) {
    await reancorarRecorrenciasSeOdometroMenor(id, odometroKm != null ? Math.round(odometroKm * 1000) : null);
  }

  // Desativar manutenções cancela as recorrências programadas (mesma regra do admin)
  if (manutencaoAtiva !== undefined && !(manutencaoAtiva === 'true' || manutencaoAtiva === true)) {
    await prisma.manutencaoRecorrencia.updateMany({ where: { dispositivoId: id, ativa: true }, data: { ativa: false } });
    await prisma.manutencaoRecorrenciaData.updateMany({ where: { dispositivoId: id, ativa: true }, data: { ativa: false } });
  }

  // Sincronizar na Traccar (best-effort)
  const traccarData = buildTraccarDeviceSyncData(dispositivo);
  traccarGetDeviceByImei(existe.identificador)
    .then((td) => {
      if (td) {
        return traccarUpdateDevice(td.id, traccarData, td.attributes)
          .then((updated) => syncTraccarAccumulators(updated.id, dispositivo));
      }
      return traccarCreateDevice(traccarData).then((created) => syncTraccarAccumulators(created.id, dispositivo));
    })
    .catch((err) => console.error('[Traccar] Falha ao sincronizar dispositivo do cliente:', err.message));

  res.json({ ...mapDispositivoResponse(dispositivo), podeGerenciar });
});

// ─── PATCH /api/cliente/dispositivos/:id/status ────────────────────────────
router.patch('/:id/status', requireResponsavel, requireGestaoDispositivos, async (req: ClienteRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const existe = await buscarDispositivoAcessivel(req, id);
  if (!existe) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }
  if (!ehDoCliente(existe, req.cliente!.clienteId)) {
    res.status(403).json({ error: 'Este dispositivo foi cadastrado pela AgilLock e não pode ser ativado/inativado por você.' });
    return;
  }

  const dispositivo = await prisma.dispositivo.update({
    where: { id },
    data: { ativo: !existe.ativo },
    select: { id: true, nome: true, ativo: true },
  });

  res.json(dispositivo);
});

// ─── DELETE /api/cliente/dispositivos/:id ──────────────────────────────────
router.delete('/:id', requireResponsavel, requireGestaoDispositivos, async (req: ClienteRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const existe = await buscarDispositivoAcessivel(req, id);
  if (!existe) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }
  if (!ehDoCliente(existe, req.cliente!.clienteId)) {
    res.status(403).json({ error: 'Este dispositivo foi cadastrado pela AgilLock e não pode ser excluído por você.' });
    return;
  }

  const [totalBoletos, totalBoletosUnificados] = await Promise.all([
    prisma.boleto.count({ where: { dispositivoId: id } }),
    prisma.boletoDispositivo.count({ where: { dispositivoId: id } }),
  ]);
  if (totalBoletos > 0 || totalBoletosUnificados > 0) {
    res.status(400).json({ error: 'Não é possível excluir um dispositivo com boletos. Inative-o.' });
    return;
  }

  await prisma.$transaction([
    prisma.geocercaDispositivo.deleteMany({ where: { dispositivoId: id } }),
    prisma.dispositivo.delete({ where: { id } }),
  ]);

  traccarGetDeviceByImei(existe.identificador)
    .then((td) => { if (td) return traccarDeleteDevice(td.id); })
    .catch((err) => console.error('[Traccar] Falha ao excluir dispositivo do cliente:', err.message));

  res.status(204).send();
});

export default router;
