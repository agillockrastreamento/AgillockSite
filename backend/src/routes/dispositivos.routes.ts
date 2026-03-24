import { Router, Response, Request } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { param, query } from '../utils/params';
import path from 'path';
import fs from 'fs';
import multer from 'multer';

const router = Router();
router.use(authMiddleware);

// Multer para imagem do dispositivo
const uploadDir = path.resolve(process.cwd(), 'uploads', 'dispositivos');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const DISPOSITIVO_SELECT = {
  id: true, nome: true, identificador: true, categoria: true, grupo: true,
  contato: true, ativo: true,
  modeloRastreador: true, telefoneRastreador: true, iccid: true, operadora: true,
  placa: true, marca: true, modeloVeiculo: true, cor: true, ano: true,
  renavam: true, chassi: true, combustivel: true, localInstalacao: true, instalador: true,
  consumo: true, limiteVelocidade: true, senha: true, ignorarOdometro: true,
  imagemUrl: true, valorPadrao: true,
  clienteId: true, vendedorId: true, criadoPorId: true,
  createdAt: true, updatedAt: true,
};

const CLIENTES_VINCULADOS_INCLUDE = {
  clientesVinculados: {
    include: { cliente: { select: { id: true, nome: true } } },
  },
};

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
      _count: { select: { clientesVinculados: true } },
    },
    orderBy: { nome: 'asc' },
  });

  res.json(dispositivos);
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

  res.json(dispositivo);
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
    consumo, limiteVelocidade, senha, ignorarOdometro,
    valorPadrao, clienteId, vendedorId,
  } = req.body;

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
      imagemUrl,
      valorPadrao: valorPadrao ? Number(valorPadrao) : null,
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

  res.status(201).json(dispositivo);
});

// ─── PUT /api/dispositivos/:id ─────────────────────────────────────────────
router.put('/:id', requireRoles('ADMIN', 'COLABORADOR'), upload.single('imagem'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeEditarDispositivo) {
    res.status(403).json({ error: 'Sem permissão para editar dispositivos.' });
    return;
  }
  const id = param(req, 'id');

  const existe = await prisma.dispositivo.findUnique({ where: { id }, select: { id: true, identificador: true, imagemUrl: true, clienteId: true } });
  if (!existe) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }

  const {
    nome, identificador, categoria, grupo, contato, ativo,
    modeloRastreador, telefoneRastreador, iccid, operadora,
    placa, marca, modeloVeiculo, cor, ano, renavam, chassi, combustivel, localInstalacao, instalador,
    consumo, limiteVelocidade, senha, ignorarOdometro,
    valorPadrao, clienteId, vendedorId,
  } = req.body;

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
      ...(req.file ? { imagemUrl: novaImagemUrl } : {}),
      ...(valorPadrao !== undefined ? { valorPadrao: valorPadrao ? Number(valorPadrao) : null } : {}),
      ...(clienteId !== undefined ? { clienteId: clienteId || null } : {}),
      ...(vendedorId !== undefined ? { vendedorId: vendedorId || null } : {}),
    },
    include: {
      cliente: { select: { id: true, nome: true } },
    },
  });

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

  res.json(dispositivo);
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

  const existe = await prisma.dispositivo.findUnique({ where: { id }, select: { id: true } });
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

  const dispositivo = await prisma.dispositivo.update({
    where: { id },
    data: { clienteId: clienteId || null },
    select: { id: true, nome: true, clienteId: true, ativo: true },
  });

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

  res.status(201).json({ dispositivoId, clienteId });
});

// ─── DELETE /api/dispositivos/:id/clientes/:clienteId — Desvincular extra ──
router.delete('/:id/clientes/:clienteId', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeDesvincularDispositivo) {
    res.status(403).json({ error: 'Sem permissão para desvincular dispositivos de clientes.' });
    return;
  }
  const dispositivoId = param(req, 'id');
  const clienteId = req.params.clienteId;

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

  const existe = await prisma.dispositivo.findUnique({ where: { id }, select: { id: true } });
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
  res.status(204).send();
});

export default router;
