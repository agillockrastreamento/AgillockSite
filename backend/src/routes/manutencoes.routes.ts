'use strict';

import { Router } from 'express';
import prisma from '../utils/prisma';
import { clienteAuthMiddleware } from '../middleware/cliente-auth.middleware';
import { broadcastTrackingEvents } from '../services/traccar.ws';
import { traccarGetDeviceByImei, traccarGetPositions } from '../services/traccar.service';
import ExpoPushService from '../services/expo-push.service';

const router = Router();
router.use(clienteAuthMiddleware);

// ── Helpers ───────────────────────────────────────────────────────────────────

type DispositivoAcessivel = {
  id: string;
  clienteId: string | null;
};

async function _dispositivosDoCliente(clienteLoginId: string): Promise<{
  clienteId: string | null;
  dispositivos: DispositivoAcessivel[];
}> {
  const login = await prisma.clienteLogin.findUnique({
    where: { id: clienteLoginId },
    select: { clienteId: true },
  });
  if (!login?.clienteId) return { clienteId: null, dispositivos: [] };

  const dispositivos = await prisma.dispositivo.findMany({
    where: {
      OR: [
        { clienteId: login.clienteId },
        { clientesVinculados: { some: { clienteId: login.clienteId } } },
      ],
    },
    select: { id: true, clienteId: true },
  });

  return { clienteId: login.clienteId, dispositivos };
}

async function _dispositivoIdsDoCliente(clienteLoginId: string): Promise<string[]> {
  const dados = await _dispositivosDoCliente(clienteLoginId);
  return dados.dispositivos.map(d => d.id);
}

async function _podeGerenciarManutencao(clienteLoginId: string, dispositivoId: string): Promise<boolean> {
  const dados = await _dispositivosDoCliente(clienteLoginId);
  return dados.dispositivos.some(d => d.id === dispositivoId && d.clienteId === dados.clienteId);
}

function _filtroManutencoesVisiveis(dispositivos: DispositivoAcessivel[], filtroDispositivo?: string) {
  const idsPermitidos = dispositivos.map(d => d.id);
  const idsAlvo = filtroDispositivo ? [filtroDispositivo] : idsPermitidos;
  const clienteIdsResponsaveis = Array.from(new Set(
    dispositivos
      .filter(d => idsAlvo.includes(d.id) && d.clienteId)
      .map(d => d.clienteId as string)
  ));

  return {
    dispositivoId: filtroDispositivo ?? { in: idsPermitidos },
    OR: [
      { origem: 'ADMIN' },
      { clienteLogin: { clienteId: { in: clienteIdsResponsaveis } } },
    ],
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

async function _ativarNotificacaoRecorrenciaData(clienteLoginId: string, dispositivoId: string) {
  try {
    await prisma.preferenciaNotificacao.upsert({
      where: {
        clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'recorrenciaData' },
      },
      update: { web: true, app: true, email: true },
      create: { clienteLoginId, dispositivoId, tipoEvento: 'recorrenciaData', web: true, app: true, email: true },
    });
  } catch (err) {
    console.error('Erro ao ativar notificação de recorrência por data:', err);
  }
}

async function _kmAtualDoDispositivo(identificador: string, traccarId?: number | null, odometroSistemaMetros?: number | null): Promise<number> {
  if (odometroSistemaMetros != null) return odometroSistemaMetros / 1000;
  try {
    const deviceId = traccarId ?? (await traccarGetDeviceByImei(identificador))?.id;
    if (!deviceId) return 0;
    const posicoes = await traccarGetPositions([deviceId]);
    return (posicoes[0]?.attributes?.totalDistance ?? 0) / 1000;
  } catch {
    return 0;
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

// ── Registros ─────────────────────────────────────────────────────────────────

// GET /api/cliente/manutencoes/registros?dispositivoId=X
router.get('/registros', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { dispositivoId } = req.query as { dispositivoId?: string };

    const { dispositivos } = await _dispositivosDoCliente(clienteLoginId);
    const idsPermitidos = dispositivos.map(d => d.id);
    if (!idsPermitidos.length) return res.json([]);

    const filtroDispositivo = dispositivoId && idsPermitidos.includes(dispositivoId)
      ? dispositivoId
      : undefined;

    const registros = await prisma.manutencaoRegistro.findMany({
      where: _filtroManutencoesVisiveis(dispositivos, filtroDispositivo),
      include: { dispositivo: { select: { nome: true, placa: true } } },
      orderBy: { dataRealizacao: 'desc' },
    });

    res.json(registros);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao carregar registros.' });
  }
});

// POST /api/cliente/manutencoes/registros
router.post('/registros', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { dispositivoId, titulo, tipo, descricao, dataRealizacao, kmRealizacao, custo, oficina, notas, fotos } = req.body;

    if (!dispositivoId || !titulo || !dataRealizacao) {
      return res.status(400).json({ message: 'Campos obrigatórios: dispositivoId, titulo, dataRealizacao.' });
    }

    if (!await _podeGerenciarManutencao(clienteLoginId, dispositivoId)) {
      return res.status(403).json({ message: 'Apenas o responsavel pelo faturamento pode gerenciar manutencoes deste dispositivo.' });
    }

    const dispCheck = await prisma.dispositivo.findUnique({ where: { id: dispositivoId }, select: { manutencaoAtiva: true } });
    if (!dispCheck?.manutencaoAtiva) {
      return res.status(403).json({ message: 'Manutenções desativadas para este dispositivo.' });
    }

    const registro = await prisma.manutencaoRegistro.create({
      data: {
        dispositivoId,
        clienteLoginId,
        titulo,
        tipo: tipo || 'preventiva',
        descricao: descricao || null,
        dataRealizacao: new Date(dataRealizacao),
        kmRealizacao: kmRealizacao != null ? parseFloat(kmRealizacao) : null,
        custo: custo != null ? parseFloat(custo) : null,
        oficina: oficina || null,
        notas: notas || null,
        fotos: fotos || [],
        origem: 'CLIENTE',
      },
      include: { dispositivo: { select: { nome: true, placa: true } } },
    });

    res.json(registro);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao criar registro.' });
  }
});

// DELETE /api/cliente/manutencoes/registros/:id
router.delete('/registros/:id', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { id } = req.params;

    const registro = await prisma.manutencaoRegistro.findFirst({
      where: { id, clienteLoginId, origem: 'CLIENTE' },
    });
    if (!registro) return res.status(404).json({ message: 'Registro não encontrado ou não pode ser excluído.' });

    if (!await _podeGerenciarManutencao(clienteLoginId, registro.dispositivoId)) {
      return res.status(403).json({ message: 'Apenas o responsavel pelo faturamento pode gerenciar manutencoes deste dispositivo.' });
    }

    await prisma.manutencaoRegistro.delete({ where: { id } });
    res.json({ message: 'Registro excluído com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao excluir registro.' });
  }
});

// ── Recorrências ──────────────────────────────────────────────────────────────

// GET /api/cliente/manutencoes/recorrencias?dispositivoId=X
router.get('/recorrencias', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { dispositivoId } = req.query as { dispositivoId?: string };

    const { dispositivos } = await _dispositivosDoCliente(clienteLoginId);
    const idsPermitidos = dispositivos.map(d => d.id);
    if (!idsPermitidos.length) return res.json([]);

    const filtroDispositivo = dispositivoId && idsPermitidos.includes(dispositivoId)
      ? dispositivoId
      : undefined;

    const recorrencias = await prisma.manutencaoRecorrencia.findMany({
      where: {
        ..._filtroManutencoesVisiveis(dispositivos, filtroDispositivo),
        ativa: true,
      },
      include: {
        dispositivo: {
          select: { nome: true, placa: true, odometroSistemaMetros: true, clienteId: true },
        },
        clienteLogin: {
          select: { clienteId: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Exclui recorrências CLIENTE cujo criador não é mais o responsável atual do dispositivo
    const filtradas = recorrencias.filter(r => {
      if (r.origem === 'ADMIN') return true;
      return r.clienteLogin?.clienteId === r.dispositivo.clienteId;
    });

    res.json(_deduplicarRecorrencias(filtradas));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao carregar recorrências.' });
  }
});

// POST /api/cliente/manutencoes/recorrencias
router.post('/recorrencias', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { dispositivoId, titulo, descricao, intervaloKm } = req.body;

    if (!dispositivoId || !titulo || !intervaloKm) {
      return res.status(400).json({ message: 'Campos obrigatórios: dispositivoId, titulo, intervaloKm.' });
    }

    if (!await _podeGerenciarManutencao(clienteLoginId, dispositivoId)) {
      return res.status(403).json({ message: 'Apenas o responsavel pelo faturamento pode gerenciar manutencoes deste dispositivo.' });
    }

    const dispositivo = await prisma.dispositivo.findUnique({
      where: { id: dispositivoId },
      select: { odometroSistemaMetros: true, identificador: true, traccarId: true, manutencaoAtiva: true },
    });
    if (!dispositivo?.manutencaoAtiva) {
      return res.status(403).json({ message: 'Manutenções desativadas para este dispositivo.' });
    }
    const kmBase = await _kmAtualDoDispositivo(
      dispositivo?.identificador ?? '',
      dispositivo?.traccarId,
      dispositivo?.odometroSistemaMetros,
    );

    const recorrencia = await prisma.manutencaoRecorrencia.create({
      data: {
        dispositivoId,
        clienteLoginId,
        titulo,
        descricao: descricao || null,
        intervaloKm: parseInt(intervaloKm),
        kmBase,
        origem: 'CLIENTE',
      },
      include: { dispositivo: { select: { nome: true, placa: true, odometroSistemaMetros: true } } },
    });

    // Garante que as notificações de manutenção estão ativas para este dispositivo
    await _ativarNotificacaoManutencao(clienteLoginId, dispositivoId);

    res.json(recorrencia);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao criar recorrência.' });
  }
});

// POST /api/cliente/manutencoes/recorrencias/:id/feito
router.post('/recorrencias/:id/feito', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { id } = req.params;
    const { notas, fotos } = req.body ?? {};

    const recorrencia = await prisma.manutencaoRecorrencia.findFirst({
      where: {
        id,
        OR: [
          { origem: 'ADMIN' },
          { clienteLogin: { clienteId: req.cliente.clienteId } },
        ],
      },
      include: {
        dispositivo: { select: { odometroSistemaMetros: true, nome: true, placa: true, traccarId: true, identificador: true, manutencaoAtiva: true } },
      },
    });
    if (!recorrencia) return res.status(404).json({ message: 'Recorrência não encontrada.' });

    if (!await _podeGerenciarManutencao(clienteLoginId, recorrencia.dispositivoId)) {
      return res.status(403).json({ message: 'Apenas o responsavel pelo faturamento pode confirmar manutencoes deste dispositivo.' });
    }

    if (!recorrencia.dispositivo.manutencaoAtiva) {
      return res.status(403).json({ message: 'Manutenções desativadas para este dispositivo.' });
    }

    const kmAtual = await _kmAtualDoDispositivo(
      recorrencia.dispositivo.identificador,
      recorrencia.dispositivo.traccarId,
      recorrencia.dispositivo.odometroSistemaMetros,
    );

    await prisma.manutencaoRecorrencia.update({
      where: { id },
      data: { kmBase: kmAtual, alerta50Enviado: false, alerta25Enviado: false, alerta0Enviado: false, ultimaAlertaPostDueKm: -1 },
    });

    await prisma.manutencaoRegistro.create({
      data: {
        dispositivoId: recorrencia.dispositivoId,
        clienteLoginId,
        titulo: `${recorrencia.titulo} — confirmado`,
        tipo: 'recorrencia',
        descricao: `Manutenção recorrente "${recorrencia.titulo}" confirmada como realizada.`,
        dataRealizacao: new Date(),
        kmRealizacao: kmAtual,
        notas: notas || null,
        fotos: fotos || [],
        origem: 'CLIENTE',
      },
    });

    // Notificação verde: manutenção realizada
    const prefFeita = await prisma.preferenciaNotificacao.findUnique({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: recorrencia.dispositivoId, tipoEvento: 'manutencao' } },
    });
    const mensagemFeita = `Manutenção "${recorrencia.titulo}" realizada! Contador reiniciado a partir de ${Math.round(kmAtual).toLocaleString('pt-BR')} km.`;

    // Evento admin (sempre criado para histórico do admin)
    await prisma.eventoNotificacao.create({
      data: {
        clienteLoginId,
        dispositivoId: recorrencia.dispositivoId,
        tipoEvento: 'manutencaoFeita',
        origemTipo: recorrencia.origem,
        origemId: recorrencia.id,
        adminEvento: true,
        mensagem: mensagemFeita,
        latitude: null,
        longitude: null,
        velocidade: null,
      },
    });

    // Evento cliente (criado apenas se o cliente tem preferência habilitada)
    if (prefFeita && (prefFeita.web || prefFeita.app)) {
      await prisma.eventoNotificacao.create({
        data: {
          clienteLoginId,
          dispositivoId: recorrencia.dispositivoId,
          tipoEvento: 'manutencaoFeita',
          origemTipo: recorrencia.origem,
          origemId: recorrencia.id,
          adminEvento: false,
          mensagem: mensagemFeita,
          latitude: null,
          longitude: null,
          velocidade: null,
        },
      });
    }
    if (prefFeita?.app) {
      await ExpoPushService.enviarParaCliente(clienteLoginId, {
        title: 'Manutenção Realizada',
        body: mensagemFeita,
        data: { tipo: 'manutencaoFeita', dispositivoId: recorrencia.dispositivoId },
      });
    }

    // Broadcast único — evita que o frontend exiba a notificação em duplicata
    broadcastTrackingEvents([{
      deviceId: recorrencia.dispositivo.traccarId,
      dispositivoId: recorrencia.dispositivoId,
      type: 'manutencaoFeita',
      tipoLabel: 'Manutenção Realizada',
      origemTipo: recorrencia.origem,
      origemId: recorrencia.id,
      clienteLoginId,
      clienteId: req.cliente.clienteId,
      adminEvento: true,
      serverTime: new Date().toISOString(),
      mensagem: mensagemFeita,
      lat: null,
      lng: null,
      endereco: null,
    }]);

    res.json({ message: 'Manutenção marcada como feita. Contador reiniciado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao confirmar manutenção.' });
  }
});

// PUT /api/cliente/manutencoes/registros/:id
router.put('/registros/:id', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { id } = req.params;
    const { titulo, tipo, dataRealizacao, kmRealizacao, custo, oficina, notas, fotos } = req.body;
    const existing = await prisma.manutencaoRegistro.findFirst({
      where: { id, clienteLoginId, origem: 'CLIENTE' },
    });
    if (!existing) return res.status(404).json({ message: 'Registro não encontrado.' });
    if (!await _podeGerenciarManutencao(clienteLoginId, existing.dispositivoId)) {
      return res.status(403).json({ message: 'Apenas o responsavel pelo faturamento pode gerenciar manutencoes deste dispositivo.' });
    }
    const dispCheckReg = await prisma.dispositivo.findUnique({ where: { id: existing.dispositivoId }, select: { manutencaoAtiva: true } });
    if (!dispCheckReg?.manutencaoAtiva) {
      return res.status(403).json({ message: 'Manutenções desativadas para este dispositivo.' });
    }
    const updated = await prisma.manutencaoRegistro.update({
      where: { id },
      data: {
        titulo:        titulo        || existing.titulo,
        tipo:          tipo          || existing.tipo,
        dataRealizacao: dataRealizacao ? new Date(dataRealizacao) : existing.dataRealizacao,
        kmRealizacao:  kmRealizacao  !== undefined ? (kmRealizacao  != null ? parseFloat(kmRealizacao)  : null) : existing.kmRealizacao,
        custo:         custo         !== undefined ? (custo         != null ? parseFloat(custo)         : null) : existing.custo,
        oficina:       oficina       !== undefined ? (oficina       || null) : existing.oficina,
        notas:         notas         !== undefined ? (notas         || null) : existing.notas,
        fotos:         fotos         !== undefined ? fotos : (existing.fotos as any),
      },
      include: { dispositivo: { select: { nome: true, placa: true } } },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao atualizar registro.' });
  }
});

// PUT /api/cliente/manutencoes/recorrencias/:id
router.put('/recorrencias/:id', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { id } = req.params;
    const { titulo, descricao, intervaloKm } = req.body;
    const existing = await prisma.manutencaoRecorrencia.findFirst({
      where: { id, clienteLoginId, origem: 'CLIENTE' },
    });
    if (!existing) return res.status(404).json({ message: 'Recorrência não encontrada.' });
    if (!await _podeGerenciarManutencao(clienteLoginId, existing.dispositivoId)) {
      return res.status(403).json({ message: 'Apenas o responsavel pelo faturamento pode gerenciar manutencoes deste dispositivo.' });
    }
    const dispCheckRec = await prisma.dispositivo.findUnique({ where: { id: existing.dispositivoId }, select: { manutencaoAtiva: true } });
    if (!dispCheckRec?.manutencaoAtiva) {
      return res.status(403).json({ message: 'Manutenções desativadas para este dispositivo.' });
    }
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

// DELETE /api/cliente/manutencoes/recorrencias/:id
router.delete('/recorrencias/:id', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { id } = req.params;

    const recorrencia = await prisma.manutencaoRecorrencia.findFirst({
      where: { id, clienteLoginId, origem: 'CLIENTE' },
    });
    if (!recorrencia) return res.status(404).json({ message: 'Recorrência não encontrada ou não pode ser excluída.' });

    await prisma.manutencaoRecorrencia.update({ where: { id }, data: { ativa: false } });
    res.json({ message: 'Recorrência removida com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao remover recorrência.' });
  }
});

// ── Recorrências por Data ─────────────────────────────────────────────────────

// GET /api/cliente/manutencoes/recorrencias-data?dispositivoId=X
router.get('/recorrencias-data', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { dispositivoId } = req.query as { dispositivoId?: string };

    const { dispositivos } = await _dispositivosDoCliente(clienteLoginId);
    const idsPermitidos = dispositivos.map(d => d.id);
    if (!idsPermitidos.length) return res.json([]);

    const filtroDispositivo = dispositivoId && idsPermitidos.includes(dispositivoId) ? dispositivoId : undefined;

    const recorrencias = await prisma.manutencaoRecorrenciaData.findMany({
      where: {
        ..._filtroManutencoesVisiveis(dispositivos, filtroDispositivo),
        ativa: true,
      },
      include: {
        dispositivo: { select: { nome: true, placa: true, clienteId: true } },
        clienteLogin: { select: { clienteId: true } },
      },
      orderBy: { dataReferencia: 'asc' },
    });

    const filtradas = recorrencias.filter(r => {
      if (r.origem === 'ADMIN') return true;
      return r.clienteLogin?.clienteId === r.dispositivo.clienteId;
    });

    res.json(filtradas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao carregar recorrências por data.' });
  }
});

// POST /api/cliente/manutencoes/recorrencias-data
router.post('/recorrencias-data', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { dispositivoId, titulo, descricao, tipoRecorrencia, dataReferencia, intervaloDias, diasSemana, diaDoMes, mesDoAno, canalNotificacao } = req.body;

    if (!dispositivoId || !titulo || !tipoRecorrencia || !dataReferencia) {
      return res.status(400).json({ message: 'Campos obrigatórios: dispositivoId, titulo, tipoRecorrencia, dataReferencia.' });
    }

    if (!await _podeGerenciarManutencao(clienteLoginId, dispositivoId)) {
      return res.status(403).json({ message: 'Apenas o responsavel pelo faturamento pode gerenciar recorrências deste dispositivo.' });
    }

    const dispCheck = await prisma.dispositivo.findUnique({ where: { id: dispositivoId }, select: { manutencaoAtiva: true } });
    if (!dispCheck?.manutencaoAtiva) {
      return res.status(403).json({ message: 'Manutenções desativadas para este dispositivo.' });
    }

    _validarCamposRecorrenciaData(tipoRecorrencia, intervaloDias, diasSemana, diaDoMes, mesDoAno);

    const recorrencia = await prisma.manutencaoRecorrenciaData.create({
      data: {
        dispositivoId,
        clienteLoginId,
        titulo,
        descricao: descricao || null,
        tipoRecorrencia,
        dataReferencia: new Date(dataReferencia),
        intervaloDias: intervaloDias ? parseInt(intervaloDias) : null,
        diasSemana: diasSemana || null,
        diaDoMes: diaDoMes ? parseInt(diaDoMes) : null,
        mesDoAno: mesDoAno ? parseInt(mesDoAno) : null,
        canalNotificacao: canalNotificacao || 'todos',
        origem: 'CLIENTE',
      },
      include: { dispositivo: { select: { nome: true, placa: true } } },
    });

    await _ativarNotificacaoRecorrenciaData(clienteLoginId, dispositivoId);

    res.json(recorrencia);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Erro ao criar recorrência por data.' });
  }
});

// PUT /api/cliente/manutencoes/recorrencias-data/:id
router.put('/recorrencias-data/:id', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { id } = req.params;
    const { titulo, descricao, tipoRecorrencia, dataReferencia, intervaloDias, diasSemana, diaDoMes, mesDoAno, canalNotificacao } = req.body;

    const existing = await prisma.manutencaoRecorrenciaData.findFirst({
      where: { id, clienteLoginId, origem: 'CLIENTE' },
    });
    if (!existing) return res.status(404).json({ message: 'Recorrência não encontrada.' });
    if (!await _podeGerenciarManutencao(clienteLoginId, existing.dispositivoId)) {
      return res.status(403).json({ message: 'Apenas o responsavel pelo faturamento pode gerenciar recorrências deste dispositivo.' });
    }
    const dispCheck = await prisma.dispositivo.findUnique({ where: { id: existing.dispositivoId }, select: { manutencaoAtiva: true } });
    if (!dispCheck?.manutencaoAtiva) {
      return res.status(403).json({ message: 'Manutenções desativadas para este dispositivo.' });
    }

    const novoTipo = tipoRecorrencia || existing.tipoRecorrencia;
    const novaData = dataReferencia ? new Date(dataReferencia) : existing.dataReferencia;

    const updated = await prisma.manutencaoRecorrenciaData.update({
      where: { id },
      data: {
        titulo: titulo || existing.titulo,
        descricao: descricao !== undefined ? (descricao || null) : existing.descricao,
        tipoRecorrencia: novoTipo,
        dataReferencia: novaData,
        intervaloDias: intervaloDias !== undefined ? (intervaloDias ? parseInt(intervaloDias) : null) : existing.intervaloDias,
        diasSemana: diasSemana !== undefined ? (diasSemana || null) : existing.diasSemana,
        diaDoMes: diaDoMes !== undefined ? (diaDoMes ? parseInt(diaDoMes) : null) : existing.diaDoMes,
        mesDoAno: mesDoAno !== undefined ? (mesDoAno ? parseInt(mesDoAno) : null) : existing.mesDoAno,
        canalNotificacao: canalNotificacao || existing.canalNotificacao,
        // Reseta alertas ao alterar data
        ...(dataReferencia ? { alerta7dEnviado: false, alerta4dEnviado: false, alerta2dEnviado: false, alerta1dEnviado: false, alertaDiaEnviado: false, ultimoAlertaPosDue: null } : {}),
      },
      include: { dispositivo: { select: { nome: true, placa: true } } },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao atualizar recorrência por data.' });
  }
});

// POST /api/cliente/manutencoes/recorrencias-data/:id/feito
router.post('/recorrencias-data/:id/feito', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { id } = req.params;
    const { notas } = req.body ?? {};

    const recorrencia = await prisma.manutencaoRecorrenciaData.findFirst({
      where: {
        id,
        OR: [
          { origem: 'ADMIN' },
          { clienteLogin: { clienteId: req.cliente.clienteId } },
        ],
      },
      include: {
        dispositivo: { select: { nome: true, placa: true, traccarId: true, manutencaoAtiva: true } },
      },
    });
    if (!recorrencia) return res.status(404).json({ message: 'Recorrência não encontrada.' });

    if (!await _podeGerenciarManutencao(clienteLoginId, recorrencia.dispositivoId)) {
      return res.status(403).json({ message: 'Apenas o responsavel pelo faturamento pode confirmar recorrências deste dispositivo.' });
    }
    if (!recorrencia.dispositivo.manutencaoAtiva) {
      return res.status(403).json({ message: 'Manutenções desativadas para este dispositivo.' });
    }

    const agora = new Date();
    const novoCiclos = recorrencia.ciclosCompletos + 1;

    // Calcula próxima data para tipos recorrentes
    let novaData: Date | null = null;
    if (recorrencia.tipoRecorrencia !== 'AVULSA') {
      novaData = _calcularProximaData(recorrencia as any, agora);
    }

    if (novaData) {
      await prisma.manutencaoRecorrenciaData.update({
        where: { id },
        data: {
          dataReferencia: novaData,
          ciclosCompletos: novoCiclos,
          alerta7dEnviado: false,
          alerta4dEnviado: false,
          alerta2dEnviado: false,
          alerta1dEnviado: false,
          alertaDiaEnviado: false,
          ultimoAlertaPosDue: null,
        },
      });
    } else {
      // AVULSA: desativa após conclusão
      await prisma.manutencaoRecorrenciaData.update({
        where: { id },
        data: { ativa: false, ciclosCompletos: novoCiclos },
      });
    }

    await prisma.manutencaoRegistro.create({
      data: {
        dispositivoId: recorrencia.dispositivoId,
        clienteLoginId,
        titulo: `${recorrencia.titulo} — confirmado`,
        tipo: 'recorrenciaData',
        descricao: `Recorrência por data "${recorrencia.titulo}" confirmada como realizada.`,
        dataRealizacao: agora,
        notas: notas || null,
        fotos: [],
        origem: 'CLIENTE',
      },
    });

    const nome = recorrencia.dispositivo.nome;
    const pl = recorrencia.dispositivo.placa ? ` (${recorrencia.dispositivo.placa})` : '';
    const mensagem = `Recorrência "${recorrencia.titulo}" no veículo ${nome}${pl} marcada como realizada!${novaData ? ` Próxima ocorrência: ${novaData.toLocaleDateString('pt-BR')}.` : ''}`;

    let pref = await prisma.preferenciaNotificacao.findUnique({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: recorrencia.dispositivoId, tipoEvento: 'recorrenciaData' } },
    });
    if (!pref) {
      pref = await prisma.preferenciaNotificacao.findUnique({
        where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: recorrencia.dispositivoId, tipoEvento: 'manutencao' } },
      });
    }

    await prisma.eventoNotificacao.create({
      data: { clienteLoginId, dispositivoId: recorrencia.dispositivoId, tipoEvento: 'recorrenciaDataFeita', origemTipo: recorrencia.origem, origemId: recorrencia.id, adminEvento: true, mensagem, latitude: null, longitude: null, velocidade: null },
    });

    if (pref && (pref.web || pref.app)) {
      await prisma.eventoNotificacao.create({
        data: { clienteLoginId, dispositivoId: recorrencia.dispositivoId, tipoEvento: 'recorrenciaDataFeita', origemTipo: recorrencia.origem, origemId: recorrencia.id, adminEvento: false, mensagem, latitude: null, longitude: null, velocidade: null },
      });
    }
    if (pref?.app) {
      await ExpoPushService.enviarParaCliente(clienteLoginId, {
        title: 'Recorrência Realizada',
        body: mensagem,
        data: { tipo: 'recorrenciaDataFeita', dispositivoId: recorrencia.dispositivoId },
      });
    }

    const { broadcastTrackingEvents } = await import('../services/traccar.ws');
    broadcastTrackingEvents([{
      deviceId: recorrencia.dispositivo.traccarId,
      dispositivoId: recorrencia.dispositivoId,
      type: 'recorrenciaDataFeita',
      tipoLabel: 'Recorrência Realizada',
      origemTipo: recorrencia.origem,
      origemId: recorrencia.id,
      clienteLoginId,
      clienteId: req.cliente.clienteId,
      adminEvento: true,
      serverTime: agora.toISOString(),
      mensagem,
      lat: null,
      lng: null,
      endereco: null,
    }]);

    res.json({ message: 'Recorrência por data marcada como feita.', proximaData: novaData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao confirmar recorrência por data.' });
  }
});

// DELETE /api/cliente/manutencoes/recorrencias-data/:id
router.delete('/recorrencias-data/:id', async (req: any, res) => {
  try {
    const clienteLoginId: string = req.cliente.sub;
    const { id } = req.params;

    const recorrencia = await prisma.manutencaoRecorrenciaData.findFirst({
      where: { id, clienteLoginId, origem: 'CLIENTE' },
    });
    if (!recorrencia) return res.status(404).json({ message: 'Recorrência não encontrada ou não pode ser excluída.' });

    await prisma.manutencaoRecorrenciaData.update({ where: { id }, data: { ativa: false } });
    res.json({ message: 'Recorrência por data removida com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao remover recorrência por data.' });
  }
});

// ── Helpers para recorrência por data ─────────────────────────────────────────

function _validarCamposRecorrenciaData(tipo: string, intervaloDias: any, diasSemana: any, diaDoMes: any, mesDoAno: any) {
  if (tipo === 'INTERVALO' && (!intervaloDias || parseInt(intervaloDias) < 1)) {
    throw new Error('Intervalo de dias inválido.');
  }
  if (tipo === 'SEMANAL' && (!diasSemana || !Array.isArray(diasSemana) || diasSemana.length === 0)) {
    throw new Error('Selecione ao menos um dia da semana.');
  }
  if (tipo === 'MENSAL' && (!diaDoMes || parseInt(diaDoMes) < 1 || parseInt(diaDoMes) > 31)) {
    throw new Error('Dia do mês inválido.');
  }
  if (tipo === 'ANUAL' && (!diaDoMes || !mesDoAno || parseInt(mesDoAno) < 1 || parseInt(mesDoAno) > 12)) {
    throw new Error('Mês ou dia inválido para recorrência anual.');
  }
}

function _calcularProximaData(rec: { tipoRecorrencia: string; dataReferencia: Date; intervaloDias?: number | null; diasSemana?: any; diaDoMes?: number | null; mesDoAno?: number | null }, base: Date): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);

  switch (rec.tipoRecorrencia) {
    case 'INTERVALO': {
      const n = rec.intervaloDias ?? 7;
      d.setDate(d.getDate() + n);
      return d;
    }
    case 'SEMANAL': {
      const dias: number[] = Array.isArray(rec.diasSemana) ? rec.diasSemana : [1];
      const diaAtual = d.getDay();
      const diasOrdenados = [...dias].sort((a, b) => a - b);
      let proximoDia = diasOrdenados.find(dia => dia > diaAtual);
      if (proximoDia === undefined) proximoDia = diasOrdenados[0];
      const diff = proximoDia > diaAtual ? proximoDia - diaAtual : 7 - diaAtual + proximoDia;
      d.setDate(d.getDate() + diff);
      return d;
    }
    case 'MENSAL': {
      const diaAlvo = rec.diaDoMes ?? 1;
      d.setMonth(d.getMonth() + 1);
      const diasNoMes = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(diaAlvo, diasNoMes));
      return d;
    }
    case 'ANUAL': {
      const diaAlvo = rec.diaDoMes ?? 1;
      const mesAlvo = (rec.mesDoAno ?? 1) - 1;
      d.setFullYear(d.getFullYear() + 1);
      d.setMonth(mesAlvo);
      const diasNoMes = new Date(d.getFullYear(), mesAlvo + 1, 0).getDate();
      d.setDate(Math.min(diaAlvo, diasNoMes));
      return d;
    }
    default:
      return d;
  }
}

export { _calcularProximaData };

export default router;
