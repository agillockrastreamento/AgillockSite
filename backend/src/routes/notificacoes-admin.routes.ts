import { Router } from 'express';
import prisma from '../utils/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireMonitoramentoAccess } from '../middleware/roles.middleware';

function tipoPreferenciaAdmin(tipoEvento: string) {
  if (tipoEvento === 'manutencaoAlerta' || tipoEvento === 'manutencaoAtrasada' || tipoEvento === 'manutencaoFeita') return 'manutencao';
  return tipoEvento;
}

const router = Router();
router.use(authMiddleware);
router.use(requireMonitoramentoAccess);

// ── Admin's own global web preferences ───────────────────────────────────────

router.get('/admin-prefs', async (req: any, res) => {
  try {
    const userId = req.user.userId;
    const row = await prisma.adminPreferencia.findUnique({ where: { userId } });
    res.json({ prefs: (row?.prefs as Record<string, boolean>) ?? {} });
  } catch {
    res.status(500).json({ message: 'Erro ao obter preferências.' });
  }
});

router.post('/admin-prefs', async (req: any, res) => {
  try {
    const userId = req.user.userId;
    const { prefs } = req.body;
    if (!prefs || typeof prefs !== 'object') {
      return res.status(400).json({ message: 'Payload inválido.' });
    }
    await prisma.adminPreferencia.upsert({
      where: { userId },
      update: { prefs },
      create: { userId, prefs },
    });
    res.json({ message: 'Preferências salvas com sucesso!' });
  } catch {
    res.status(500).json({ message: 'Erro ao salvar preferências.' });
  }
});

router.post('/admin-prefs/merge', async (req: any, res) => {
  try {
    const userId = req.user.userId;
    const { prefs: partialPrefs } = req.body;
    if (!partialPrefs || typeof partialPrefs !== 'object') {
      return res.status(400).json({ message: 'Payload inválido.' });
    }
    const row = await prisma.adminPreferencia.findUnique({ where: { userId } });
    const currentPrefs = (row?.prefs as any) || {};
    const newPrefs = { ...currentPrefs, ...partialPrefs };

    await prisma.adminPreferencia.upsert({
      where: { userId },
      update: { prefs: newPrefs },
      create: { userId, prefs: newPrefs },
    });
    res.json({ message: 'Preferências mergeadas com sucesso!', prefs: newPrefs });
  } catch {
    res.status(500).json({ message: 'Erro ao salvar preferências.' });
  }
});

// ── Client list for dropdown ──────────────────────────────────────────────────

router.get('/clientes', async (_req, res) => {
  try {
    const logins = await prisma.clienteLogin.findMany({
      where: {
        ativo: true,
        cliente: {
          OR: [
            { dispositivos:          { some: {} } },
            { dispositivosVinculados: { some: {} } },
          ],
        },
      },
      select: {
        id: true,
        email: true,
        cliente: { select: { nome: true } },
      },
      orderBy: { cliente: { nome: 'asc' } },
    });
    res.json(logins.map(l => ({ id: l.id, email: l.email, nome: l.cliente.nome })));
  } catch {
    res.status(500).json({ message: 'Erro ao listar clientes.' });
  }
});

// ── Client's devices ──────────────────────────────────────────────────────────

router.get('/clientes/:clienteLoginId/dispositivos', async (req, res) => {
  try {
    const { clienteLoginId } = req.params;
    const login = await prisma.clienteLogin.findUnique({
      where: { id: clienteLoginId },
      select: { clienteId: true },
    });
    if (!login) return res.status(404).json({ message: 'Cliente não encontrado.' });

    const [principais, vinculados] = await Promise.all([
      prisma.dispositivo.findMany({
        where: { clienteId: login.clienteId },
        select: { id: true, nome: true, placa: true },
        orderBy: { nome: 'asc' },
      }),
      prisma.dispositivoCliente.findMany({
        where: { clienteId: login.clienteId },
        include: { dispositivo: { select: { id: true, nome: true, placa: true } } },
      }),
    ]);

    const map = new Map<string, { id: string; nome: string; placa: string | null }>();
    for (const d of principais) map.set(d.id, d);
    for (const v of vinculados) map.set(v.dispositivo.id, v.dispositivo);

    res.json(Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome)));
  } catch {
    res.status(500).json({ message: 'Erro ao listar dispositivos.' });
  }
});

// ── Client notification preferences (read) ───────────────────────────────────

router.get('/clientes/:clienteLoginId/preferencias/:dispositivoId', async (req, res) => {
  try {
    const { clienteLoginId, dispositivoId } = req.params;

    const prefs = await prisma.preferenciaNotificacao.findMany({
      where: { clienteLoginId, dispositivoId },
    });

    const result: any = { preferencias: {} };
    prefs.forEach(p => {
      result.preferencias[p.tipoEvento] = { web: p.web, app: p.app, email: p.email };
      if (p.tipoEvento === 'overspeed')   result.overspeedLimit = p.overspeedLimit;
      if (p.tipoEvento === 'kmExcedida')  result.kmExcedida = { kmMaximo30Dias: p.kmMaximo30Dias, diaRenovacaoMes: p.diaRenovacaoMes };
      if (p.tipoEvento === 'kmReduzida')  result.kmReduzida = { kmMinimo7Dias: p.kmMinimo7Dias, diaSemanaRenovacao: p.diaSemanaRenovacao };
      if (p.tipoEvento === 'trocaOleo')   result.kmTrocaOleo = p.kmTrocaOleo;
    });

    res.json(result);
  } catch {
    res.status(500).json({ message: 'Erro ao obter preferências.' });
  }
});

// ── Client notification preferences (write) ──────────────────────────────────

router.post('/clientes/:clienteLoginId/preferencias', async (req, res) => {
  try {
    const { clienteLoginId } = req.params;
    const { dispositivoId, preferencias, overspeedLimit, kmExcedida, kmReduzida, kmTrocaOleo } = req.body;

    await prisma.$transaction(
      Object.keys(preferencias).map(tipo => {
        const extra: any = {};
        if (tipo === 'overspeed')  extra.overspeedLimit = overspeedLimit ?? 100;
        if (tipo === 'kmExcedida') { extra.kmMaximo30Dias = kmExcedida?.kmMaximo30Dias ?? null; extra.diaRenovacaoMes = kmExcedida?.diaRenovacaoMes ?? null; }
        if (tipo === 'kmReduzida') { extra.kmMinimo7Dias = kmReduzida?.kmMinimo7Dias ?? null; extra.diaSemanaRenovacao = kmReduzida?.diaSemanaRenovacao ?? null; }
        if (tipo === 'trocaOleo')  extra.kmTrocaOleo = kmTrocaOleo ?? null;
        return prisma.preferenciaNotificacao.upsert({
          where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: tipo } },
          update: { web: preferencias[tipo].web, app: preferencias[tipo].app, email: preferencias[tipo].email, ...extra },
          create: { clienteLoginId, dispositivoId, tipoEvento: tipo, web: preferencias[tipo].web, app: preferencias[tipo].app, email: preferencias[tipo].email, ...extra },
        });
      })
    );

    res.json({ message: 'Preferências salvas com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao salvar preferências.' });
  }
});

// ── Oil change interval for client (admin) ───────────────────────────────────

router.patch('/clientes/:clienteLoginId/km-troca-oleo/:dispositivoId', async (req, res) => {
  try {
    const { clienteLoginId, dispositivoId } = req.params;
    const { kmTrocaOleo } = req.body;
    if (!kmTrocaOleo || typeof kmTrocaOleo !== 'number' || kmTrocaOleo < 1) {
      return res.status(400).json({ message: 'Informe um intervalo válido em km.' });
    }
    await prisma.preferenciaNotificacao.upsert({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo' } },
      update: { kmTrocaOleo },
      create: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo', web: false, app: false, email: false, kmTrocaOleo },
    });
    const dispositivo = await prisma.dispositivo.findUnique({ where: { id: dispositivoId }, select: { odometroSistemaMetros: true } });
    await prisma.estadoKmNotificacao.upsert({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo' } },
      update: { kmBaseMetros: dispositivo?.odometroSistemaMetros ?? 0, dataBase: new Date(), notificacaoEnviada: false, ultimaNotificacaoKm: -9999 },
      create: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo', kmBaseMetros: dispositivo?.odometroSistemaMetros ?? 0, dataBase: new Date(), notificacaoEnviada: false, ultimaNotificacaoKm: -9999 },
    });
    res.json({ message: 'Intervalo atualizado!', kmTrocaOleo });
  } catch {
    res.status(500).json({ message: 'Erro ao atualizar intervalo.' });
  }
});

router.get('/clientes/:clienteLoginId/km-config/:dispositivoId', async (req, res) => {
  try {
    const { clienteLoginId, dispositivoId } = req.params;
    const prefOleo = await prisma.preferenciaNotificacao.findUnique({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo' } },
    });
    let trocaOleo: object | null = null;
    if (prefOleo?.kmTrocaOleo) {
      const estado = await prisma.estadoKmNotificacao.findUnique({
        where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'trocaOleo' } },
      });
      trocaOleo = { kmIntervalo: prefOleo.kmTrocaOleo, kmBaseMetros: estado?.kmBaseMetros ?? null };
    }
    res.json({ trocaOleo });
  } catch {
    res.status(500).json({ message: 'Erro ao obter configuração.' });
  }
});

// ── Admin events history ──────────────────────────────────────────────────────

router.get('/eventos', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { periodo, de, ate } = req.query as Record<string, string>;
    let dateFilter: any = {};

    const meiaNoBrasil = (offsetMs = 0) => {
      const d = new Date(Date.now() + offsetMs);
      const s = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      return new Date(s + 'T00:00:00-03:00');
    };

    if (periodo === 'hoje') {
      dateFilter = { gte: meiaNoBrasil(), lt: meiaNoBrasil(86400000) };
    } else if (periodo === 'ontem') {
      dateFilter = { gte: meiaNoBrasil(-86400000), lt: meiaNoBrasil() };
    } else if (periodo === '7dias') {
      dateFilter = { gte: meiaNoBrasil(-7 * 86400000) };
    } else if (periodo === 'custom' && de && ate) {
      const inicio = new Date(de + 'T00:00:00-03:00');
      const fim    = new Date(ate + 'T23:59:59-03:00');
      if (!isNaN(inicio.getTime()) && !isNaN(fim.getTime())) dateFilter = { gte: inicio, lte: fim };
    }

    const [adminPrefsRow, eventos] = await Promise.all([
      prisma.adminPreferencia.findUnique({ where: { userId } }),
      prisma.eventoNotificacao.findMany({
        where: { createdAt: dateFilter, OR: [{ adminEvento: true }, { origemTipo: null }] },
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: {
          dispositivo:  { select: { nome: true, placa: true } },
          boleto: { select: { id: true, numeroParcela: true, valor: true, vencimento: true, status: true, linkBoleto: true } },
          clienteLogin: { select: { cliente: { select: { nome: true } } } },
        },
      }),
    ]);
    const adminPrefs = (adminPrefsRow?.prefs as Record<string, any>) ?? {};
    const eventosPermitidos = eventos.filter(e => {
      return !!adminPrefs[tipoPreferenciaAdmin(e.tipoEvento)];
    });

    const vistos = new Set<string>();
    const eventosUnicos = eventosPermitidos.filter((e) => {
      const minuto = new Date(e.createdAt);
      minuto.setSeconds(0, 0);
      const chave = `${e.tipoEvento}|${e.dispositivoId || ''}|${e.mensagem}|${minuto.toISOString()}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });

    res.json(eventosUnicos.map(e => ({
      id:               e.id,
      dispositivoId:    e.dispositivoId,
      tipo:             e.tipoEvento,
      origemTipo:       e.origemTipo,
      origemId:         e.origemId,
      adminEvento:      e.adminEvento,
      mensagem:         e.mensagem,
      serverTime:       e.createdAt,
      lat:              e.latitude,
      lng:              e.longitude,
      endereco:         e.endereco,
      velocidade:       e.velocidade,
      dispositivoNome:  e.dispositivo?.nome ?? null,
      dispositivoPlaca: e.dispositivo?.placa ?? null,
      boleto: e.boleto ? {
        id: e.boleto.id,
        numeroParcela: e.boleto.numeroParcela,
        valor: Number(e.boleto.valor),
        vencimento: e.boleto.vencimento,
        status: e.boleto.status,
        linkBoleto: e.boleto.linkBoleto,
      } : null,
      clienteNome:      e.clienteLogin.cliente.nome,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao obter eventos.' });
  }
});

export default router;
