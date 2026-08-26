// Orquestração da consulta de multas (Detran). A consulta em si roda no worker
// (docs/multas/ARQUITETURA_WORKER.md); aqui ficam a fila de jobs, o processamento
// dos resultados devolvidos pelo worker e a saúde do worker.

import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UPLOADS_DIR } from '../utils/upload-paths';
import ExpoPushService from './expo-push.service';
import EmailService from './email.service';
import { broadcastTrackingEvents } from './traccar.ws';

const MULTAS_DIR = path.join(UPLOADS_DIR, 'multas');
const MAX_TENTATIVAS = 5;
const TRAVADO_MIN = 10; // job PROCESSANDO parado há mais de X min = worker travou
const LOTE_TIMEOUT_MIN = 120; // lote EM_ANDAMENTO por mais de X min = worker nunca pegou os jobs

// ─────────────────────────── Tipos do resultado do worker ───────────────────────────

interface MultaResult {
  ait: string;
  aitOriginaria: string | null;
  motivo: string;
  dataInfracao: string | null;
  dataVencimento: string | null;
  valor: number;
  valorAPagar: number;
  selecaoValue: string;
}
interface PagamentoResult {
  extratoId: string;
  emv: string;
  qrCodeBase64: string;
}
interface LicenciamentoItemResult {
  ano: string;
  orgao: string | null;
  descricao: string;
  valor: number;
  valorAPagar: number;
}
interface PagamentoLicenciamentoResult {
  itens: LicenciamentoItemResult[];
  total: number;
  emv: string;
  qrCodeBase64: string;
}
export interface ConsultaResult {
  placa: string;
  renavam: string;
  situacao: { qtdMultas: number; possuiDebitoIpva: boolean; licenciamentoPendente: boolean };
  multas: MultaResult[];
  pagamentoTodas: PagamentoResult | null;
  boletoPdfBase64: string | null;
  pagamentoLicenciamento: PagamentoLicenciamentoResult | null;
  boletoLicenciamentoPdfBase64: string | null;
}
interface PagamentoJobResult {
  pagamento: PagamentoResult;
  boletoPdfBase64: string;
}

// ─────────────────────────── Arquivos (boleto PDF) ───────────────────────────

function salvarBoleto(subdir: string, nome: string, base64: string): string {
  const dir = path.join(MULTAS_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, nome), Buffer.from(base64, 'base64'));
  return `/uploads/multas/${subdir}/${nome}`;
}

// ─────────────────────────── Fila de jobs (lado do worker) ───────────────────────────

/** Re-enfileira jobs que ficaram PROCESSANDO tempo demais (worker caiu no meio). */
export async function recuperarJobsTravados(): Promise<void> {
  const limite = new Date(Date.now() - TRAVADO_MIN * 60_000);
  await prisma.consultaJob.updateMany({
    where: { status: 'PROCESSANDO', claimedEm: { lt: limite }, tentativas: { lt: MAX_TENTATIVAS } },
    data: { status: 'PENDENTE' },
  });

  // Excedeu as tentativas: encerra em ERRO — mas um a um, porque cada job precisa ser
  // contabilizado no log do seu lote. Sem isso o log fica preso em EM_ANDAMENTO e o
  // resumo nunca chega ao admin.
  const desistidos = await prisma.consultaJob.findMany({
    where: { status: 'PROCESSANDO', claimedEm: { lt: limite }, tentativas: { gte: MAX_TENTATIVAS } },
    select: { id: true, logId: true, placa: true },
  });
  for (const job of desistidos) {
    const upd = await prisma.consultaJob.updateMany({
      where: { id: job.id, status: 'PROCESSANDO' },
      data: { status: 'ERRO', erro: 'Excedeu tentativas (worker travou?)' },
    });
    if (upd.count === 1 && job.logId) await contabilizarNoLog(job.logId, false, 0, 1, false, [
      { placa: job.placa, status: 'ERRO', erro: 'Excedeu tentativas (worker travou?)' },
    ]);
  }
}

/**
 * Fecha lotes parados em EM_ANDAMENTO há tempo demais. Com o worker offline os jobs
 * nunca são reivindicados, então nada os contabiliza: sem este fechamento o log fica
 * aberto para sempre e o admin não recebe o resumo de que a consulta não aconteceu.
 */
export async function fecharLotesExpirados(): Promise<void> {
  const limite = new Date(Date.now() - LOTE_TIMEOUT_MIN * 60_000);
  const lotes = await prisma.consultaMultaLog.findMany({
    where: { status: 'EM_ANDAMENTO', inicioEm: { lt: limite } },
    select: { id: true },
  });
  const msgExpirado = `Lote expirado após ${LOTE_TIMEOUT_MIN} min (worker offline?)`;
  for (const lote of lotes) {
    // Busca as placas dos órfãos ANTES de marcá-los como ERRO, para o detalhe do histórico.
    const orfaosJobs = await prisma.consultaJob.findMany({
      where: { logId: lote.id, status: { in: ['PENDENTE', 'PROCESSANDO'] } },
      select: { placa: true },
    });
    await prisma.consultaJob.updateMany({
      where: { logId: lote.id, status: { in: ['PENDENTE', 'PROCESSANDO'] } },
      data: { status: 'ERRO', erro: msgExpirado },
    });
    await contabilizarNoLog(lote.id, false, 0, orfaosJobs.length, true,
      orfaosJobs.map((j) => ({ placa: j.placa, status: 'ERRO', erro: msgExpirado })));
  }
}

/** Reivindica o próximo job PENDENTE de forma atômica. Retorna null se não houver. */
export async function claimProximoJob() {
  const pend = await prisma.consultaJob.findFirst({
    where: { status: 'PENDENTE' },
    orderBy: { criadoEm: 'asc' },
  });
  if (!pend) return null;
  const upd = await prisma.consultaJob.updateMany({
    where: { id: pend.id, status: 'PENDENTE' },
    data: { status: 'PROCESSANDO', claimedEm: new Date(), tentativas: { increment: 1 } },
  });
  if (upd.count === 0) return null; // outro claim pegou antes
  return prisma.consultaJob.findUnique({ where: { id: pend.id } });
}

/** Processa o resultado devolvido pelo worker (job concluído com sucesso). */
export async function concluirJobComResultado(jobId: string, resultado: unknown): Promise<void> {
  const job = await prisma.consultaJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error('Job não encontrado');

  let resultadoFinal: unknown = resultado;

  if (job.tipo === 'CONSULTA_VEICULO') {
    const r = resultado as ConsultaResult;
    await persistirConsulta(job.dispositivoId, job.uf, r);
    // não guardamos o PDF em base64 no job (fica em VeiculoMultaSituacao.boletoArquivo)
    resultadoFinal = { ...r, boletoPdfBase64: r.boletoPdfBase64 ? '[salvo]' : null };
    if (job.logId) await contabilizarNoLog(job.logId, true, r.multas?.length ?? 0, 1, false, [
      { placa: job.placa, status: 'OK', qtdMultas: r.multas?.length ?? 0 },
    ]);
  } else if (job.tipo === 'GERAR_PAGAMENTO') {
    const r = resultado as PagamentoJobResult;
    let boletoUrl: string | null = null;
    if (r?.boletoPdfBase64) {
      const nome = `Extrato_${r.pagamento?.extratoId ?? job.id}.pdf`;
      boletoUrl = salvarBoleto('pagamentos', nome, r.boletoPdfBase64);
    }
    resultadoFinal = { pagamento: r?.pagamento ?? null, boletoUrl };
  }

  await prisma.consultaJob.update({
    where: { id: jobId },
    data: { status: 'CONCLUIDO', resultado: resultadoFinal as object, erro: null },
  });
}

/** Registra erro reportado pelo worker. `permanente` = não re-tentar (ex.: dados inválidos). */
export async function registrarErroJob(jobId: string, mensagem: string, permanente = false): Promise<void> {
  const job = await prisma.consultaJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  const encerrar = permanente || job.tentativas >= MAX_TENTATIVAS;

  if (encerrar && job.tipo === 'CONSULTA_VEICULO' && job.dispositivoId) {
    // Registra o status de falha na situação do veículo. UPSERT (não updateMany): se a
    // PRIMEIRA consulta do veículo falha e ainda não existe situação, criamos uma já com o
    // erro — senão o veículo ficaria preso em "aguardando" e nunca apareceria no seletor de
    // multas (site/app). Assim ele aparece com o motivo (ex.: "Veículo não encontrado").
    const disp = await prisma.dispositivo.findUnique({
      where: { id: job.dispositivoId },
      select: { clienteId: true, placa: true },
    });
    if (disp?.clienteId) {
      const falha = {
        ultimaConsultaEm: new Date(),
        ultimaConsultaStatus: permanente ? 'DADOS_INVALIDOS' : 'ERRO',
        ultimaConsultaErro: mensagem.slice(0, 500),
      };
      await prisma.veiculoMultaSituacao.upsert({
        where: { dispositivoId: job.dispositivoId },
        update: falha,
        create: {
          dispositivoId: job.dispositivoId,
          clienteId: disp.clienteId,
          placa: disp.placa ?? job.placa,
          renavam: job.renavam,
          uf: job.uf,
          ...falha,
        },
      });
    }
  }

  await prisma.consultaJob.update({
    where: { id: jobId },
    data: encerrar ? { status: 'ERRO', erro: mensagem } : { status: 'PENDENTE', erro: mensagem },
  });

  if (encerrar && job.logId) await contabilizarNoLog(job.logId, false, 0, 1, false, [
    { placa: job.placa, status: permanente ? 'DADOS_INVALIDOS' : 'ERRO', erro: mensagem.slice(0, 500) },
  ]);
}

// ─────────────────────────── Persistência da consulta ───────────────────────────

async function persistirConsulta(dispositivoId: string | null, uf: string, r: ConsultaResult): Promise<void> {
  if (!dispositivoId) throw new Error('Job de consulta sem dispositivoId');
  const disp = await prisma.dispositivo.findUnique({
    where: { id: dispositivoId },
    select: { id: true, clienteId: true },
  });
  if (!disp?.clienteId) throw new Error('Dispositivo sem cliente para a situação de multas');

  // Estado anterior (para detectar multas novas + transição do licenciamento) antes de substituir.
  const sitAntes = await prisma.veiculoMultaSituacao.findUnique({
    where: { dispositivoId },
    select: { licenciamentoPendente: true, multas: { select: { ait: true } } },
  });
  const primeiraConsulta = !sitAntes;
  const aitsAntigos = new Set((sitAntes?.multas ?? []).map((m) => m.ait));
  const licenciamentoPendenteAntes = sitAntes?.licenciamentoPendente ?? false;

  let boletoArquivo: string | null = null;
  if (r.boletoPdfBase64 && r.pagamentoTodas) {
    boletoArquivo = salvarBoleto(dispositivoId, `Extrato_${r.pagamentoTodas.extratoId}.pdf`, r.boletoPdfBase64);
  }
  let licenciamentoBoletoArquivo: string | null = null;
  if (r.boletoLicenciamentoPdfBase64 && r.situacao.licenciamentoPendente) {
    licenciamentoBoletoArquivo = salvarBoleto(dispositivoId, `Licenciamento_${r.placa}.pdf`, r.boletoLicenciamentoPdfBase64);
  }
  const valorTotal = (r.multas ?? []).reduce((s, m) => s + Number(m.valorAPagar ?? 0), 0);

  const dados = {
    placa: r.placa,
    renavam: r.renavam || null,
    uf,
    qtdMultas: r.situacao.qtdMultas,
    valorTotal,
    possuiDebitoIpva: r.situacao.possuiDebitoIpva,
    licenciamentoPendente: r.situacao.licenciamentoPendente,
    extratoId: r.pagamentoTodas?.extratoId ?? null,
    pixEmv: r.pagamentoTodas?.emv ?? null,
    pixQrCodeBase64: r.pagamentoTodas?.qrCodeBase64 ?? null,
    boletoArquivo,
    // Licenciamento (limpo quando não pendente para não deixar dado velho)
    licenciamentoValor: r.pagamentoLicenciamento?.total ?? null,
    licenciamentoItens: r.pagamentoLicenciamento
      ? (r.pagamentoLicenciamento.itens as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull,
    licenciamentoPixEmv: r.pagamentoLicenciamento?.emv ?? null,
    licenciamentoPixQrCodeBase64: r.pagamentoLicenciamento?.qrCodeBase64 ?? null,
    licenciamentoBoletoArquivo,
    ultimaConsultaEm: new Date(),
    ultimaConsultaStatus: 'OK',
    ultimaConsultaErro: null,
  };

  await prisma.$transaction(async (tx) => {
    const sit = await tx.veiculoMultaSituacao.upsert({
      where: { dispositivoId },
      create: { dispositivoId, clienteId: disp.clienteId!, ...dados },
      update: dados,
    });
    await tx.multa.deleteMany({ where: { situacaoId: sit.id } });
    if (r.multas?.length) {
      await tx.multa.createMany({
        data: r.multas.map((m) => ({
          situacaoId: sit.id,
          ait: m.ait,
          aitOriginaria: m.aitOriginaria ?? null,
          motivo: m.motivo,
          dataInfracao: m.dataInfracao ?? null,
          dataVencimento: m.dataVencimento ?? null,
          valor: m.valor,
          valorAPagar: m.valorAPagar,
          selecaoValue: m.selecaoValue,
        })),
      });
    }
  });

  await notificarConsultaCliente(disp.clienteId, dispositivoId, r, aitsAntigos, primeiraConsulta, licenciamentoPendenteAntes);
}

// ─────────────────────────── Saúde do worker (heartbeat) ───────────────────────────

const HEARTBEAT_ONLINE_MIN = 3;

export async function registrarHeartbeat(info?: unknown): Promise<void> {
  await prisma.workerStatus.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ultimoHeartbeat: new Date(), online: true, info: (info as object) ?? undefined },
    update: { ultimoHeartbeat: new Date(), online: true, info: (info as object) ?? undefined },
  });
}

export async function getWorkerStatus() {
  const st = await prisma.workerStatus.findUnique({ where: { id: 'singleton' } });
  const online =
    !!st?.ultimoHeartbeat && Date.now() - new Date(st.ultimoHeartbeat).getTime() < HEARTBEAT_ONLINE_MIN * 60_000;
  return { online, ultimoHeartbeat: st?.ultimoHeartbeat ?? null, info: st?.info ?? null };
}

// ─────────────────────────── Lote agendado + histórico (ConsultaMultaLog) ───────────────────────────

/**
 * Um veículo só entra na consulta de multas quando o CLIENTE está habilitado
 * (Cliente.multasHabilitado) E o próprio veículo está habilitado pelo admin
 * (Dispositivo.multasHabilitado, padrão desligado) — assim um cliente com 10
 * veículos pode ter só 3 consultados. Mesmo recorte usado nas telas do cliente.
 */
export const WHERE_VEICULO_MULTAS = {
  ativo: true,
  placa: { not: null },
  multasHabilitado: true,
  cliente: { is: { multasHabilitado: true } },
} satisfies Prisma.DispositivoWhereInput;

/**
 * Cria um lote de consulta: 1 job CONSULTA_VEICULO por veículo habilitado
 * (com placa + renavam/chassi). Veículos habilitados SEM renavam/chassi são ignorados
 * (não dá para consultar no Detran). Ver docs/multas/SCHEDULER.md.
 */
export async function iniciarConsultaLote(
  origem: 'AGENDADA' | 'MANUAL_ADMIN',
): Promise<{ logId: string; elegiveis: number; ignorados: number }> {
  const dispositivos = await prisma.dispositivo.findMany({
    where: {
      ...WHERE_VEICULO_MULTAS,
      OR: [{ renavam: { not: null } }, { chassi: { not: null } }],
    },
    select: { id: true, clienteId: true, placa: true, renavam: true, chassi: true },
  });

  // Veículos habilitados que NÃO podem ser consultados por falta de renavam/chassi.
  const ignorados = await prisma.dispositivo.count({
    where: { ...WHERE_VEICULO_MULTAS, renavam: null, chassi: null },
  });

  const clientesDistintos = new Set(dispositivos.map((d) => d.clienteId)).size;
  const log = await prisma.consultaMultaLog.create({
    data: {
      origem,
      status: 'EM_ANDAMENTO',
      clientesConsultados: clientesDistintos,
      veiculosConsultados: dispositivos.length,
    },
  });

  if (dispositivos.length === 0) {
    // Nada a consultar: fecha pelo mesmo caminho dos demais lotes, para o admin ser
    // avisado de que a rodada aconteceu sem veículos elegíveis.
    await fecharLog(log);
    return { logId: log.id, elegiveis: 0, ignorados };
  }

  await prisma.consultaJob.createMany({
    data: dispositivos.map((d) => ({
      tipo: 'CONSULTA_VEICULO',
      uf: 'CE',
      placa: d.placa ?? '',
      renavam: d.renavam ?? d.chassi ?? null,
      dispositivoId: d.id,
      origem,
      logId: log.id,
    })),
  });
  return { logId: log.id, elegiveis: dispositivos.length, ignorados };
}

/** Veículos habilitados que estão sem renavam/chassi (não consultáveis). */
export async function listarVeiculosIncompletos() {
  const disp = await prisma.dispositivo.findMany({
    where: { ...WHERE_VEICULO_MULTAS, renavam: null, chassi: null },
    select: { id: true, placa: true, cliente: { select: { nome: true } } },
    orderBy: { placa: 'asc' },
  });
  return disp.map((d) => ({ dispositivoId: d.id, placa: d.placa, clienteNome: d.cliente?.nome ?? '' }));
}

/**
 * Contabiliza veículo(s) no log do lote e fecha o log (+ notifica o admin) quando todos
 * terminam. `quantidade` > 1 e `forcarFechamento` servem ao fechamento por expiração,
 * onde vários jobs órfãos caem de uma vez e o lote fecha mesmo incompleto.
 */
/** Detalhe por veículo, anexado ao `detalhes` do log (visível no histórico expansível do admin). */
type DetalheVeiculo = { placa: string | null; status: string; qtdMultas?: number; erro?: string };

async function contabilizarNoLog(
  logId: string,
  sucesso: boolean,
  multasCount: number,
  quantidade = 1,
  forcarFechamento = false,
  detalhes?: DetalheVeiculo[],
): Promise<void> {
  if (quantidade > 0) {
    await prisma.consultaMultaLog.update({
      where: { id: logId },
      data: {
        veiculosComSucesso: sucesso ? { increment: quantidade } : undefined,
        veiculosComErro: sucesso ? undefined : { increment: quantidade },
        multasColetadas: sucesso && multasCount ? { increment: multasCount } : undefined,
      },
    });
  }

  // Anexa o detalhe por veículo de forma atômica (concatenação jsonb, segura sob concorrência
  // — vários jobs do mesmo lote podem concluir ao mesmo tempo).
  if (detalhes && detalhes.length) {
    await prisma.$executeRaw`
      UPDATE "ConsultaMultaLog"
      SET detalhes = COALESCE(detalhes, '[]'::jsonb) || ${JSON.stringify(detalhes)}::jsonb
      WHERE id = ${logId}
    `;
  }

  const log = await prisma.consultaMultaLog.findUnique({ where: { id: logId } });
  if (!log) return;
  if (!forcarFechamento && log.veiculosComSucesso + log.veiculosComErro < log.veiculosConsultados) return;
  await fecharLog(log);
}

/** Fecha o log do lote e notifica o admin. O guard EM_ANDAMENTO → status garante 1 notificação. */
async function fecharLog(log: LogResumo & { id: string }): Promise<void> {
  const status = log.veiculosComErro === 0 ? 'OK' : log.veiculosComSucesso === 0 ? 'ERRO' : 'PARCIAL';
  const fimEm = new Date();
  const duracaoMs = fimEm.getTime() - new Date(log.inicioEm).getTime();
  const upd = await prisma.consultaMultaLog.updateMany({
    where: { id: log.id, status: 'EM_ANDAMENTO' },
    data: { status, fimEm, duracaoMs },
  });
  if (upd.count === 1) await notificarResumoAdmin({ ...log, status, duracaoMs });
}

// ─────────────────────────── Notificações ───────────────────────────

function inicioDiaBrasil(d = new Date()): Date {
  const iso = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return new Date(`${iso}T00:00:00-03:00`);
}
function parseDataBr(s: string | null): Date | null {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00-03:00`) : null;
}
function diasAte(venc: Date, hoje: Date): number {
  return Math.round((venc.getTime() - hoje.getTime()) / 86_400_000);
}

/** Notifica o cliente: multa nova (só a partir da 2ª consulta) + vencimento (7 dias / hoje). */
async function notificarConsultaCliente(
  clienteId: string,
  dispositivoId: string,
  r: ConsultaResult,
  aitsAntigos: Set<string>,
  primeiraConsulta: boolean,
  licenciamentoPendenteAntes: boolean,
): Promise<void> {
  const login = await prisma.clienteLogin.findFirst({
    where: { clienteId, tipo: 'responsavel', ativo: true },
    select: { id: true },
  });
  if (!login) return;
  const hoje = inicioDiaBrasil();

  if (primeiraConsulta) {
    // 1ª consulta (logo após habilitar): uma notificação consolidada por veículo
    // informando quantas multas já existem — sem tratar cada uma como "nova".
    const todas = r.multas ?? [];
    if (todas.length) {
      const qtd = todas.length;
      await notificarClienteMulta(
        login.id,
        dispositivoId,
        todas.map((m) => m.ait),
        'multaNova',
        hoje,
        {
          title: 'Multas encontradas',
          body: `${qtd} multa${qtd > 1 ? 's' : ''} encontrada${qtd > 1 ? 's' : ''} para ${r.placa}.`,
          mensagem: `${qtd} multa${qtd > 1 ? 's' : ''} encontrada${qtd > 1 ? 's' : ''} para ${r.placa} (Detran).`,
        },
      );
    }
  } else {
    // A partir da 2ª consulta: notifica apenas AITs que ainda não existiam.
    const novas = (r.multas ?? []).filter((m) => !aitsAntigos.has(m.ait));
    if (novas.length) {
      const qtd = novas.length;
      await notificarClienteMulta(
        login.id,
        dispositivoId,
        novas.map((m) => m.ait),
        'multaNova',
        hoje,
        {
          title: 'Nova multa',
          body: `${r.placa}: ${qtd} nova${qtd > 1 ? 's' : ''} autuação${qtd > 1 ? 'ões' : ''}.`,
          mensagem: `Nova multa: ${r.placa} — ${qtd} nova${qtd > 1 ? 's' : ''} autuação${qtd > 1 ? 'ões' : ''} (Detran).`,
        },
      );
    }
  }

  // Vencimento: 7 dias antes e no dia.
  for (const m of r.multas ?? []) {
    const venc = parseDataBr(m.dataVencimento);
    if (!venc) continue;
    const d = diasAte(venc, hoje);
    if (d === 7) {
      await notificarClienteMulta(login.id, dispositivoId, [m.ait], 'multaVencimento7dias', hoje, {
        title: 'Multa a vencer',
        body: `${r.placa}: autuação vence em 7 dias (${m.dataVencimento}).`,
        mensagem: `Multa a vencer: ${r.placa} — vence em 7 dias (${m.dataVencimento}), R$ ${Number(m.valorAPagar).toFixed(2)}.`,
      });
    } else if (d === 0) {
      await notificarClienteMulta(login.id, dispositivoId, [m.ait], 'multaVencimentoHoje', hoje, {
        title: 'Multa vence hoje',
        body: `${r.placa}: autuação vence hoje.`,
        mensagem: `Multa vence hoje: ${r.placa} — R$ ${Number(m.valorAPagar).toFixed(2)}. Pague para evitar acréscimos.`,
      });
    }
  }

  // Licenciamento pendente: notifica só na transição (não-pendente → pendente) ou na
  // 1ª consulta se já vier pendente. Sem lembrete de vencimento (o Detran não informa data).
  if (r.situacao.licenciamentoPendente && (primeiraConsulta || !licenciamentoPendenteAntes)) {
    const ano = r.pagamentoLicenciamento?.itens?.[0]?.ano || String(new Date().getFullYear());
    const valor = r.pagamentoLicenciamento?.total;
    const valorTxt = typeof valor === 'number' && valor > 0 ? ` (R$ ${valor.toFixed(2)})` : '';
    await notificarClienteMulta(
      login.id,
      dispositivoId,
      [`LIC:${ano}`],
      'licenciamentoPendente',
      hoje,
      {
        title: 'Licenciamento pendente',
        body: `${r.placa}: licenciamento ${ano} pendente${valorTxt}.`,
        mensagem: `Licenciamento pendente: ${r.placa} — licenciamento ${ano}${valorTxt} (Detran).`,
      },
      'licenciamento',
    );
  }
}

/**
 * Cria o evento + push ao cliente, com dedup por (login, ait, tipo, dia).
 * O evento carrega `dispositivoId` (associa ao veículo, e sub-usuários passam a ver)
 * e `origemTipo='multa'` + `origemId=<AIT(s)>` (permite achar/filtrar a notificação por AIT).
 */
async function notificarClienteMulta(
  clienteLoginId: string,
  dispositivoId: string,
  aits: string[],
  tipo: 'multaNova' | 'multaVencimento7dias' | 'multaVencimentoHoje' | 'licenciamentoPendente',
  dataReferencia: Date,
  payload: { title: string; body: string; mensagem: string },
  origemTipo: 'multa' | 'licenciamento' = 'multa',
): Promise<void> {
  // Canais escolhidos pelo cliente para o tipo "multa". Quem nunca abriu a tela
  // de notificações não tem registro: mantém o comportamento anterior (web+app),
  // senão desligaríamos o aviso de todo mundo de uma vez.
  const pref = await prisma.preferenciaNotificacao.findUnique({
    where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId, tipoEvento: 'multa' } },
    select: { web: true, app: true, email: true },
  });
  const canais = pref ?? { web: true, app: true, email: false };
  if (!canais.web && !canais.app && !canais.email) return;

  let algumNovo = false;
  for (const ait of aits) {
    try {
      await prisma.notificacaoMultaEnvio.create({ data: { clienteLoginId, ait, tipo, dataReferencia } });
      algumNovo = true;
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err; // P2002 = já enviado (dedup)
    }
  }
  if (!algumNovo) return;

  const disp = await prisma.dispositivo.findUnique({
    where: { id: dispositivoId },
    select: { traccarId: true, eventosAdminHabilitado: true },
  });

  if (canais.web) {
    const evento = await prisma.eventoNotificacao.create({
      data: {
        clienteLoginId,
        dispositivoId,
        tipoEvento: tipo,
        origemTipo,
        origemId: aits.join(','),
        mensagem: payload.mensagem,
      },
    });

    // Portal do cliente aberto recebe na hora (o push cobre só o app).
    if (disp?.traccarId) {
      broadcastTrackingEvents([
        {
          deviceId: disp.traccarId,
          type: tipo,
          tipoLabel: payload.title,
          serverTime: evento.createdAt.toISOString(),
          mensagem: payload.mensagem,
          origemTipo,
          origemId: aits.join(','),
          adminEvento: false,
          eventosAdminHabilitado: disp.eventosAdminHabilitado !== false,
        },
      ]);
    }
  }

  if (canais.app) {
    await ExpoPushService.enviarParaCliente(clienteLoginId, {
      title: payload.title,
      body: payload.body,
      data: { tipo, ait: aits.join(',') },
    });
  }

  if (canais.email) {
    const login = await prisma.clienteLogin.findUnique({
      where: { id: clienteLoginId },
      select: { email: true },
    });
    if (login?.email) {
      await EmailService.enviarEmail(
        login.email,
        payload.title,
        `<p>${payload.mensagem}</p>`,
      ).catch((err: any) => console.error('[Multas] Falha ao enviar e-mail:', err?.message || err));
    }
  }
}

interface LogResumo {
  inicioEm: Date;
  status: string;
  duracaoMs: number | null;
  clientesConsultados: number;
  veiculosConsultados: number;
  veiculosComSucesso: number;
  veiculosComErro: number;
  multasColetadas: number;
}

/** Evento de resumo ao admin: grava no histórico e envia em tempo real pelo WS. */
async function notificarResumoAdmin(log: LogResumo): Promise<void> {
  const ref = await prisma.clienteLogin.findFirst({
    where: { tipo: 'responsavel' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!ref) {
    // EventoNotificacao.clienteLoginId é obrigatório e serve de âncora; sem nenhum
    // login de cliente no sistema não há onde ancorar o resumo.
    console.warn('[Multas] Resumo do lote não notificado: nenhum login de cliente para ancorar o evento.');
    return;
  }

  const hora = new Date(log.inicioEm).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
  const dur = log.duracaoMs ? `${Math.round(log.duracaoMs / 1000)}s` : '—';

  let tipoEvento: string;
  let mensagem: string;
  if (log.status === 'ERRO') {
    tipoEvento = 'consultaMultasErro';
    mensagem = `Consulta de multas (${hora}): FALHOU — ${log.veiculosComErro} veículo(s) com erro.`;
  } else if (log.veiculosConsultados === 0) {
    tipoEvento = 'consultaMultasConcluida';
    mensagem = `Consulta de multas (${hora}): concluída — nenhum veículo habilitado para consulta.`;
  } else {
    tipoEvento = 'consultaMultasConcluida';
    const rot = log.status === 'PARCIAL' ? 'parcial' : 'concluída';
    mensagem = `Consulta de multas (${hora}): ${rot} — ${log.multasColetadas} multas de ${log.clientesConsultados} cliente(s) (${log.veiculosConsultados} veículos: ${log.veiculosComSucesso} ok, ${log.veiculosComErro} erro) em ${dur}.`;
  }

  const evento = await prisma.eventoNotificacao.create({
    data: { clienteLoginId: ref.id, tipoEvento, adminEvento: true, origemTipo: 'consultaMultas', mensagem },
  });

  // Sem o broadcast o admin só via o resumo ao recarregar a tela de rastreamento.
  // Evento sem deviceId: o filtro por dispositivo do WS o entrega apenas ao admin.
  broadcastTrackingEvents([
    {
      type: tipoEvento,
      tipoLabel: tipoEvento === 'consultaMultasErro' ? 'Falha na Consulta de Multas' : 'Consulta de Multas (Detran)',
      serverTime: evento.createdAt.toISOString(),
      mensagem,
      origemTipo: 'consultaMultas',
      adminEvento: true,
    },
  ]);
}

// ─────────────────────────── Helpers para a API (jobs sob demanda + leitura) ───────────────────────────

const _sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DispositivoConsulta {
  id: string;
  placa: string | null;
  renavam: string | null;
  chassi: string | null;
}

/** Cria um job CONSULTA_VEICULO (sob demanda). Retorna o id do job. */
export async function criarJobConsulta(
  disp: DispositivoConsulta,
  origem: 'MANUAL_ADMIN' | 'CLIENTE',
): Promise<string> {
  const job = await prisma.consultaJob.create({
    data: {
      tipo: 'CONSULTA_VEICULO',
      uf: 'CE',
      placa: disp.placa ?? '',
      renavam: disp.renavam ?? disp.chassi ?? null,
      dispositivoId: disp.id,
      origem,
    },
  });
  return job.id;
}

/** Cria um job GERAR_PAGAMENTO (sob demanda). aits vazio = todas. */
export async function criarJobPagamento(
  disp: DispositivoConsulta,
  aits: string[] | undefined,
  origem: 'MANUAL_ADMIN' | 'CLIENTE',
): Promise<string> {
  const job = await prisma.consultaJob.create({
    data: {
      tipo: 'GERAR_PAGAMENTO',
      uf: 'CE',
      placa: disp.placa ?? '',
      renavam: disp.renavam ?? disp.chassi ?? null,
      dispositivoId: disp.id,
      aits: aits && aits.length ? aits : undefined,
      origem,
    },
  });
  return job.id;
}

/**
 * Cria um job CONSULTA_PONTUACAO (pontuação de CNH — sem veículo). Consumido por
 * integrações externas (SafeLock). Idempotente por (cpf, numeroFormulario) enquanto
 * houver job aberto. `placa` fica vazia (a fila exige a coluna, mas não se aplica aqui).
 */
export async function criarJobPontuacao(
  cpf: string,
  numeroFormulario: string,
  origem: 'MANUAL_ADMIN' | 'CLIENTE' = 'CLIENTE',
): Promise<string> {
  const aberto = await prisma.consultaJob.findFirst({
    where: { tipo: 'CONSULTA_PONTUACAO', cpf, numeroFormulario, status: { in: ['PENDENTE', 'PROCESSANDO'] } },
    select: { id: true },
  });
  if (aberto) return aberto.id;
  const job = await prisma.consultaJob.create({
    data: { tipo: 'CONSULTA_PONTUACAO', uf: 'CE', placa: '', cpf, numeroFormulario, origem },
    select: { id: true },
  });
  return job.id;
}

/** Estado + resultado de um job (para o consumidor externo poll-ar a pontuação). */
export async function getEstadoJob(
  jobId: string,
): Promise<{ status: string; resultado: unknown; erro: string | null } | null> {
  const job = await prisma.consultaJob.findUnique({
    where: { id: jobId },
    select: { status: true, resultado: true, erro: true },
  });
  if (!job) return null;
  return {
    status: job.status,
    resultado: job.status === 'CONCLUIDO' ? job.resultado : null,
    erro: job.status === 'ERRO' ? job.erro : null,
  };
}

/** Aguarda um job terminar (CONCLUIDO/ERRO) por até timeoutMs. Retorna o job (pode estar ainda em andamento). */
export async function aguardarJob(jobId: string, timeoutMs = 40_000) {
  const ate = Date.now() + timeoutMs;
  while (Date.now() < ate) {
    const job = await prisma.consultaJob.findUnique({ where: { id: jobId } });
    if (!job || job.status === 'CONCLUIDO' || job.status === 'ERRO') return job;
    await _sleep(1000);
  }
  return prisma.consultaJob.findUnique({ where: { id: jobId } });
}

/** Detalhe de um veículo (situação + multas + pix/boleto) para as telas. */
export async function getDetalheVeiculo(dispositivoId: string) {
  const sit = await prisma.veiculoMultaSituacao.findUnique({
    where: { dispositivoId },
    include: { multas: { orderBy: { dataVencimento: 'asc' } } },
  });
  if (!sit) return null;
  return {
    dispositivoId: sit.dispositivoId,
    placa: sit.placa,
    renavam: sit.renavam,
    uf: sit.uf,
    qtdMultas: sit.qtdMultas,
    valorTotal: Number(sit.valorTotal),
    possuiDebitoIpva: sit.possuiDebitoIpva,
    licenciamentoPendente: sit.licenciamentoPendente,
    ultimaConsultaEm: sit.ultimaConsultaEm,
    ultimaConsultaStatus: sit.ultimaConsultaStatus,
    multas: sit.multas.map((m) => ({
      ait: m.ait,
      aitOriginaria: m.aitOriginaria,
      motivo: m.motivo,
      dataInfracao: m.dataInfracao,
      dataVencimento: m.dataVencimento,
      valor: Number(m.valor),
      valorAPagar: Number(m.valorAPagar),
    })),
    pix: sit.pixEmv ? { emv: sit.pixEmv, qrCodeBase64: sit.pixQrCodeBase64 } : null,
    boletoUrl: sit.boletoArquivo,
    licenciamento: {
      pendente: sit.licenciamentoPendente,
      valor: sit.licenciamentoValor != null ? Number(sit.licenciamentoValor) : null,
      itens: (sit.licenciamentoItens as unknown as
        | { ano: string; orgao: string | null; descricao: string; valor: number; valorAPagar: number }[]
        | null) ?? null,
      pix: sit.licenciamentoPixEmv
        ? { emv: sit.licenciamentoPixEmv, qrCodeBase64: sit.licenciamentoPixQrCodeBase64 }
        : null,
      boletoUrl: sit.licenciamentoBoletoArquivo,
    },
  };
}
