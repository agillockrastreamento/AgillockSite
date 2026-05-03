'use strict';

import { Router } from 'express';
import prisma from '../utils/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireMonitoramentoAccess } from '../middleware/roles.middleware';
import { broadcastTrackingEvents } from '../services/traccar.ws';

const router = Router();
router.use(authMiddleware);
router.use(requireMonitoramentoAccess);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _dispositivoIdsDoClienteLogin(clienteLoginId: string): Promise<string[]> {
  const login = await prisma.clienteLogin.findUnique({
    where: { id: clienteLoginId },
    include: {
      cliente: {
        include: {
          dispositivos: { select: { id: true } },
          dispositivosVinculados: { select: { dispositivoId: true } },
        },
      },
    },
  });
  return [
    ...(login?.cliente?.dispositivos ?? []).map(d => d.id),
    ...(login?.cliente?.dispositivosVinculados ?? []).map(dv => dv.dispositivoId),
  ];
}

async function _dispositivosDoClienteLogin(clienteLoginId: string): Promise<Array<{
  id: string;
  clienteId: string | null;
  responsavelLoginId: string | null;
}>> {
  const login = await prisma.clienteLogin.findUnique({
    where: { id: clienteLoginId },
    select: { clienteId: true },
  });
  if (!login) return [];

  const dispositivos = await prisma.dispositivo.findMany({
    where: {
      OR: [
        { clienteId: login.clienteId },
        { clientesVinculados: { some: { clienteId: login.clienteId } } },
      ],
    },
    select: {
      id: true,
      clienteId: true,
      cliente: { select: { login: { select: { id: true } } } },
    },
  });

  return dispositivos.map(d => ({
    id: d.id,
    clienteId: d.clienteId,
    responsavelLoginId: d.cliente?.login?.id ?? null,
  }));
}

async function _contextoDispositivoCliente(clienteLoginId: string, dispositivoId?: string): Promise<{
  idsPermitidos: string[];
  filtroDispositivo: string | undefined;
  responsavelLoginIds: string[];
  responsavelClienteIds: string[];
  loginCanonicalPorDispositivo: Map<string, string>;
}> {
  const dispositivos = await _dispositivosDoClienteLogin(clienteLoginId);
  const idsPermitidos = dispositivos.map(d => d.id);
  const filtroDispositivo = dispositivoId && idsPermitidos.includes(dispositivoId) ? dispositivoId : undefined;
  const alvoIds = filtroDispositivo ? [filtroDispositivo] : idsPermitidos;
  const alvo = dispositivos.filter(d => alvoIds.includes(d.id));
  return {
    idsPermitidos,
    filtroDispositivo,
    responsavelLoginIds: Array.from(new Set(alvo.map(d => d.responsavelLoginId).filter((v): v is string => !!v))),
    responsavelClienteIds: Array.from(new Set(alvo.map(d => d.clienteId).filter((v): v is string => !!v))),
    loginCanonicalPorDispositivo: new Map(dispositivos.map(d => [d.id, d.responsavelLoginId || clienteLoginId])),
  };
}

async function _ativarNotificacaoManutencao(clienteLoginId: string, dispositivoId: string) {
  try {
    await prisma.preferenciaNotificacao.upsert({
      where: {
        clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'manutencao' },
      },
      update: { web: true, app: true, email: true },
      create: { clienteLoginId, dispositivoId, tipoEvento: 'manutencao', web: true, app: true, email: true },
    });
  } catch (err) {
    console.error('Erro ao ativar notificação de manutenção:', err);
  }
}

function _deduplicarRecorrencias<T extends { titulo: string; intervaloKm: number; kmBase: number }>(recorrencias: T[]): T[] {
  const vistos = new Set<string>();
  return recorrencias.filter((rec) => {
    const chave = `${rec.titulo.trim().toLowerCase()}|${rec.intervaloKm}|${Math.round(rec.kmBase)}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

// ── Clientes e dispositivos ───────────────────────────────────────────────────

// GET /api/manutencoes-admin/clientes
router.get('/clientes', async (_req, res) => {
  try {
    const logins = await prisma.clienteLogin.findMany({
      where: { ativo: true },
      select: {
        id: true,
        email: true,
        cliente: { select: { nome: true } },
      },
      orderBy: { cliente: { nome: 'asc' } },
    });
    res.json(logins.map(l => ({ id: l.id, nome: l.cliente.nome, email: l.email })));
  } catch (err) {
    res.status(500).json({ message: 'Erro ao listar clientes.' });
  }
});

// GET /api/manutencoes-admin/clientes/:clienteLoginId/dispositivos
router.get('/clientes/:clienteLoginId/dispositivos', async (req, res) => {
  try {
    const { clienteLoginId } = req.params;
    const ids = await _dispositivoIdsDoClienteLogin(clienteLoginId);

    if (!ids.length) return res.json([]);

    const dispositivos = await prisma.dispositivo.findMany({
      where: { id: { in: ids } },
      select: { id: true, nome: true, placa: true, odometroSistemaMetros: true },
      orderBy: { nome: 'asc' },
    });

    res.json(dispositivos);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao listar dispositivos.' });
  }
});

// ── Registros ─────────────────────────────────────────────────────────────────

// GET /api/manutencoes-admin/clientes/:clienteLoginId/registros?dispositivoId=X
router.get('/clientes/:clienteLoginId/registros', async (req, res) => {
  try {
    const { clienteLoginId } = req.params;
    const { dispositivoId } = req.query as { dispositivoId?: string };

    const ctx = await _contextoDispositivoCliente(clienteLoginId, dispositivoId);
    if (!ctx.idsPermitidos.length) return res.json([]);

    const registros = await prisma.manutencaoRegistro.findMany({
      where: {
        dispositivoId: ctx.filtroDispositivo ?? { in: ctx.idsPermitidos },
        OR: [
          { origem: 'ADMIN' },
          { clienteLoginId: { in: ctx.responsavelLoginIds } },
          { clienteLogin: { clienteId: { in: ctx.responsavelClienteIds } } },
        ],
      },
      include: {
        dispositivo: { select: { nome: true, placa: true } },
      },
      orderBy: { dataRealizacao: 'desc' },
    });

    res.json(registros);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao carregar registros.' });
  }
});

// POST /api/manutencoes-admin/clientes/:clienteLoginId/registros
router.post('/clientes/:clienteLoginId/registros', async (req: any, res) => {
  try {
    const adminId: string = req.user.userId;
    const { clienteLoginId } = req.params;
    const { dispositivoId, titulo, tipo, descricao, dataRealizacao, kmRealizacao, custo, oficina, notas, fotos } = req.body;

    if (!dispositivoId || !titulo || !dataRealizacao) {
      return res.status(400).json({ message: 'Campos obrigatórios: dispositivoId, titulo, dataRealizacao.' });
    }

    const ctx = await _contextoDispositivoCliente(clienteLoginId, dispositivoId);
    if (!ctx.idsPermitidos.includes(dispositivoId)) {
      return res.status(403).json({ message: 'Dispositivo não pertence a este cliente.' });
    }
    const clienteLoginIdCanonical = ctx.loginCanonicalPorDispositivo.get(dispositivoId) || clienteLoginId;

    const registro = await prisma.manutencaoRegistro.create({
      data: {
        dispositivoId,
        clienteLoginId: clienteLoginIdCanonical,
        criadoPorAdminId: adminId,
        titulo,
        tipo: tipo || 'preventiva',
        descricao: descricao || null,
        dataRealizacao: new Date(dataRealizacao),
        kmRealizacao: kmRealizacao != null ? parseFloat(kmRealizacao) : null,
        custo: custo != null ? parseFloat(custo) : null,
        oficina: oficina || null,
        notas: notas || null,
        fotos: fotos || [],
        origem: 'ADMIN',
      },
      include: { dispositivo: { select: { nome: true, placa: true } } },
    });

    res.json(registro);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao criar registro.' });
  }
});

// DELETE /api/manutencoes-admin/registros/:id
router.delete('/registros/:id', async (_req, res) => {
  try {
    const { id } = _req.params;
    await prisma.manutencaoRegistro.delete({ where: { id } });
    res.json({ message: 'Registro excluído com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao excluir registro.' });
  }
});

// ── Recorrências ──────────────────────────────────────────────────────────────

// GET /api/manutencoes-admin/clientes/:clienteLoginId/recorrencias?dispositivoId=X
router.get('/clientes/:clienteLoginId/recorrencias', async (req, res) => {
  try {
    const { clienteLoginId } = req.params;
    const { dispositivoId } = req.query as { dispositivoId?: string };

    const ctx = await _contextoDispositivoCliente(clienteLoginId, dispositivoId);
    if (!ctx.idsPermitidos.length) return res.json([]);

    const recorrencias = await prisma.manutencaoRecorrencia.findMany({
      where: {
        dispositivoId: ctx.filtroDispositivo ?? { in: ctx.idsPermitidos },
        ativa: true,
        OR: [
          { origem: 'ADMIN' },
          { clienteLoginId: { in: ctx.responsavelLoginIds } },
          { clienteLogin: { clienteId: { in: ctx.responsavelClienteIds } } },
        ],
      },
      include: {
        dispositivo: { select: { nome: true, placa: true, odometroSistemaMetros: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(_deduplicarRecorrencias(recorrencias));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao carregar recorrências.' });
  }
});

// POST /api/manutencoes-admin/clientes/:clienteLoginId/recorrencias
router.post('/clientes/:clienteLoginId/recorrencias', async (req: any, res) => {
  try {
    const adminId: string = req.user.userId;
    const { clienteLoginId } = req.params;
    const { dispositivoId, titulo, descricao, intervaloKm } = req.body;

    if (!dispositivoId || !titulo || !intervaloKm) {
      return res.status(400).json({ message: 'Campos obrigatórios: dispositivoId, titulo, intervaloKm.' });
    }

    const ctx = await _contextoDispositivoCliente(clienteLoginId, dispositivoId);
    if (!ctx.idsPermitidos.includes(dispositivoId)) {
      return res.status(403).json({ message: 'Dispositivo não pertence a este cliente.' });
    }
    const clienteLoginIdCanonical = ctx.loginCanonicalPorDispositivo.get(dispositivoId) || clienteLoginId;

    const dispositivo = await prisma.dispositivo.findUnique({
      where: { id: dispositivoId },
      select: { odometroSistemaMetros: true },
    });
    const kmBase = (dispositivo?.odometroSistemaMetros ?? 0) / 1000;

    const recorrencia = await prisma.manutencaoRecorrencia.create({
      data: {
        dispositivoId,
        clienteLoginId: clienteLoginIdCanonical,
        criadoPorAdminId: adminId,
        titulo,
        descricao: descricao || null,
        intervaloKm: parseInt(intervaloKm),
        kmBase,
        origem: 'ADMIN',
      },
      include: { dispositivo: { select: { nome: true, placa: true, odometroSistemaMetros: true } } },
    });

    await _ativarNotificacaoManutencao(clienteLoginIdCanonical, dispositivoId);

    res.json(recorrencia);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao criar recorrência.' });
  }
});

// PUT /api/manutencoes-admin/registros/:id
router.put('/registros/:id', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { titulo, tipo, dataRealizacao, kmRealizacao, custo, oficina, notas, fotos } = req.body;
    const existing = await prisma.manutencaoRegistro.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Registro não encontrado.' });
    const updated = await prisma.manutencaoRegistro.update({
      where: { id },
      data: {
        titulo:         titulo         || existing.titulo,
        tipo:           tipo           || existing.tipo,
        dataRealizacao: dataRealizacao ? new Date(dataRealizacao) : existing.dataRealizacao,
        kmRealizacao:   kmRealizacao   !== undefined ? (kmRealizacao  != null ? parseFloat(kmRealizacao)  : null) : existing.kmRealizacao,
        custo:          custo          !== undefined ? (custo         != null ? parseFloat(custo)         : null) : existing.custo,
        oficina:        oficina        !== undefined ? (oficina       || null) : existing.oficina,
        notas:          notas          !== undefined ? (notas         || null) : existing.notas,
        fotos:          fotos          !== undefined ? fotos : (existing.fotos as any),
      },
      include: { dispositivo: { select: { nome: true, placa: true } } },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao atualizar registro.' });
  }
});

// PUT /api/manutencoes-admin/clientes/:clienteLoginId/recorrencias/:id
router.put('/clientes/:clienteLoginId/recorrencias/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, descricao, intervaloKm } = req.body;
    const existing = await prisma.manutencaoRecorrencia.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Recorrência não encontrada.' });
    const updated = await prisma.manutencaoRecorrencia.update({
      where: { id },
      data: {
        titulo:     titulo     || existing.titulo,
        descricao:  descricao  !== undefined ? (descricao  || null) : existing.descricao,
        intervaloKm: intervaloKm ? parseInt(intervaloKm) : existing.intervaloKm,
      },
      include: { dispositivo: { select: { nome: true, placa: true, odometroSistemaMetros: true } } },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao atualizar recorrência.' });
  }
});

// POST /api/manutencoes-admin/clientes/:clienteLoginId/recorrencias/:id/feito
router.post('/clientes/:clienteLoginId/recorrencias/:id/feito', async (req: any, res) => {
  try {
    const { clienteLoginId, id } = req.params;
    const adminId: string = req.user.userId;
    const { notas, fotos } = req.body;

    const recorrencia = await prisma.manutencaoRecorrencia.findFirst({
      where: { id },
      include: { dispositivo: { select: { odometroSistemaMetros: true, nome: true, placa: true, traccarId: true } } },
    });
    if (!recorrencia) return res.status(404).json({ message: 'Recorrência não encontrada.' });

    const clienteLoginIdCanonical = recorrencia.clienteLoginId || clienteLoginId;
    const kmAtual = (recorrencia.dispositivo.odometroSistemaMetros ?? 0) / 1000;

    await prisma.manutencaoRecorrencia.update({
      where: { id },
      data: { kmBase: kmAtual, alerta50Enviado: false, alerta25Enviado: false, alerta0Enviado: false, ultimaAlertaPostDueKm: -1 },
    });

    await prisma.manutencaoRegistro.create({
      data: {
        dispositivoId: recorrencia.dispositivoId,
        clienteLoginId: clienteLoginIdCanonical,
        criadoPorAdminId: adminId,
        titulo: `${recorrencia.titulo} — confirmado pelo admin`,
        tipo: 'preventiva',
        descricao: `Manutenção recorrente "${recorrencia.titulo}" confirmada como realizada pelo administrador.`,
        dataRealizacao: new Date(),
        kmRealizacao: kmAtual,
        notas: notas || null,
        fotos: fotos || [],
        origem: 'ADMIN',
      },
    });

    // Notificação verde: manutenção realizada
    const prefFeita = await prisma.preferenciaNotificacao.findUnique({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId: clienteLoginIdCanonical, dispositivoId: recorrencia.dispositivoId, tipoEvento: 'manutencao' } },
    });
    const mensagemFeita = `Manutenção "${recorrencia.titulo}" realizada! Contador reiniciado a partir de ${Math.round(kmAtual).toLocaleString('pt-BR')} km.`;
    await prisma.eventoNotificacao.create({
      data: {
        clienteLoginId: clienteLoginIdCanonical,
        dispositivoId: recorrencia.dispositivoId,
        tipoEvento: 'manutencaoFeita',
        origemTipo: 'ADMIN',
        origemId: recorrencia.id,
        adminEvento: true,
        mensagem: mensagemFeita,
        latitude: null,
        longitude: null,
        velocidade: null,
      },
    });
    broadcastTrackingEvents([{
      deviceId: recorrencia.dispositivo.traccarId,
      dispositivoId: recorrencia.dispositivoId,
      type: 'manutencaoFeita',
      tipoLabel: 'Manutenção Realizada',
      origemTipo: 'ADMIN',
      origemId: recorrencia.id,
      clienteLoginId: clienteLoginIdCanonical,
      adminEvento: true,
      serverTime: new Date().toISOString(),
      mensagem: mensagemFeita,
      lat: null,
      lng: null,
      endereco: null,
    }]);
    if (prefFeita && (prefFeita.web || prefFeita.app)) {
      await prisma.eventoNotificacao.create({
        data: {
          clienteLoginId: clienteLoginIdCanonical,
          dispositivoId: recorrencia.dispositivoId,
          tipoEvento: 'manutencaoFeita',
          origemTipo: 'ADMIN',
          origemId: recorrencia.id,
          mensagem: `Manutenção "${recorrencia.titulo}" realizada! Contador reiniciado a partir de ${Math.round(kmAtual).toLocaleString('pt-BR')} km.`,
          latitude: null,
          longitude: null,
          velocidade: null,
        },
      });
      broadcastTrackingEvents([{
        deviceId: recorrencia.dispositivo.traccarId,
        dispositivoId: recorrencia.dispositivoId,
        type: 'manutencaoFeita',
        tipoLabel: 'Manutenção Realizada',
        origemTipo: 'ADMIN',
        origemId: recorrencia.id,
        clienteLoginId: clienteLoginIdCanonical,
        adminEvento: false,
        serverTime: new Date().toISOString(),
        mensagem: mensagemFeita,
        lat: null,
        lng: null,
        endereco: null,
      }]);
    }

    res.json({ message: 'Manutenção marcada como feita pelo admin. Contador reiniciado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao confirmar manutenção.' });
  }
});

// DELETE /api/manutencoes-admin/clientes/:clienteLoginId/recorrencias/:id
router.delete('/clientes/:clienteLoginId/recorrencias/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.manutencaoRecorrencia.update({ where: { id }, data: { ativa: false } });
    res.json({ message: 'Recorrência removida com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao remover recorrência.' });
  }
});

// ── Todos os registros (visão geral) ─────────────────────────────────────────

// GET /api/manutencoes-admin/todos/registros?page=1&limit=20&tipo=&dispositivoId=&clienteLoginId=
router.get('/todos/registros', async (req, res) => {
  try {
    const { page = '1', limit = '20', tipo, dispositivoId, clienteLoginId } = req.query as Record<string, string>;
    const take = Math.min(parseInt(limit) || 20, 100);
    const skip = (parseInt(page) - 1) * take;

    const where: any = {};
    if (tipo) where.tipo = tipo;
    if (dispositivoId) where.dispositivoId = dispositivoId;
    if (clienteLoginId) where.clienteLoginId = clienteLoginId;

    const [total, registros] = await Promise.all([
      prisma.manutencaoRegistro.count({ where }),
      prisma.manutencaoRegistro.findMany({
        where,
        include: {
          dispositivo: { select: { nome: true, placa: true } },
          clienteLogin: { select: { email: true, cliente: { select: { nome: true } } } },
        },
        orderBy: { dataRealizacao: 'desc' },
        skip,
        take,
      }),
    ]);

    res.json({ total, registros });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao carregar registros.' });
  }
});

// ── Criação em massa de recorrências ─────────────────────────────────────────

// POST /api/manutencoes-admin/bulk/recorrencias
// Body: { clienteLoginIds: [id,...], dispositivoId: id | null, titulo, descricao, intervaloKm }
// Se dispositivoId for null → aplica a TODOS os dispositivos de CADA cliente
router.post('/bulk/recorrencias', async (req: any, res) => {
  try {
    const adminId: string = req.user.userId;
    const { clienteLoginIds, dispositivoId, titulo, descricao, intervaloKm } = req.body;

    if (!clienteLoginIds?.length || !titulo || !intervaloKm) {
      return res.status(400).json({ message: 'Campos obrigatórios: clienteLoginIds, titulo, intervaloKm.' });
    }

    const criados: string[] = [];
    const erros: string[] = [];

    for (const loginId of clienteLoginIds as string[]) {
      try {
        const ctx = await _contextoDispositivoCliente(loginId, dispositivoId || undefined);
        const alvoIds = dispositivoId && ctx.idsPermitidos.includes(dispositivoId) ? [dispositivoId] : ctx.idsPermitidos;

        for (const devId of alvoIds) {
          const clienteLoginIdCanonical = ctx.loginCanonicalPorDispositivo.get(devId) || loginId;
          const dispositivo = await prisma.dispositivo.findUnique({
            where: { id: devId },
            select: { odometroSistemaMetros: true },
          });
          const kmBase = (dispositivo?.odometroSistemaMetros ?? 0) / 1000;

          await prisma.manutencaoRecorrencia.create({
            data: {
              dispositivoId: devId,
              clienteLoginId: clienteLoginIdCanonical,
              criadoPorAdminId: adminId,
              titulo,
              descricao: descricao || null,
              intervaloKm: parseInt(intervaloKm),
              kmBase,
              origem: 'ADMIN',
            },
          });

          await _ativarNotificacaoManutencao(clienteLoginIdCanonical, devId);
          criados.push(`${clienteLoginIdCanonical}/${devId}`);
        }
      } catch (e) {
        erros.push(loginId);
      }
    }

    res.json({ message: `${criados.length} recorrência(s) criada(s).`, erros });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao criar recorrências em massa.' });
  }
});

export default router;
