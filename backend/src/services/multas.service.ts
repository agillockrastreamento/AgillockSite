// Orquestração da consulta de multas (Detran). A consulta em si roda no worker
// (docs/multas/ARQUITETURA_WORKER.md); aqui ficam a fila de jobs, o processamento
// dos resultados devolvidos pelo worker e a saúde do worker.

import fs from 'fs';
import path from 'path';
import prisma from '../utils/prisma';
import { UPLOADS_DIR } from '../utils/upload-paths';

const MULTAS_DIR = path.join(UPLOADS_DIR, 'multas');
const MAX_TENTATIVAS = 5;
const TRAVADO_MIN = 10; // job PROCESSANDO parado há mais de X min = worker travou

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
export interface ConsultaResult {
  placa: string;
  renavam: string;
  situacao: { qtdMultas: number; possuiDebitoIpva: boolean; licenciamentoPendente: boolean };
  multas: MultaResult[];
  pagamentoTodas: PagamentoResult | null;
  boletoPdfBase64: string | null;
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
  await prisma.consultaJob.updateMany({
    where: { status: 'PROCESSANDO', claimedEm: { lt: limite }, tentativas: { gte: MAX_TENTATIVAS } },
    data: { status: 'ERRO', erro: 'Excedeu tentativas (worker travou?)' },
  });
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
    await persistirConsulta(job.dispositivoId, job.uf, resultado as ConsultaResult);
    // não guardamos o PDF em base64 no job (fica em VeiculoMultaSituacao.boletoArquivo)
    const r = resultado as ConsultaResult;
    resultadoFinal = { ...r, boletoPdfBase64: r.boletoPdfBase64 ? '[salvo]' : null };
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
    // registra o status de falha na situação do veículo (mantém o último dado bom)
    await prisma.veiculoMultaSituacao.updateMany({
      where: { dispositivoId: job.dispositivoId },
      data: {
        ultimaConsultaEm: new Date(),
        ultimaConsultaStatus: permanente ? 'DADOS_INVALIDOS' : 'ERRO',
        ultimaConsultaErro: mensagem.slice(0, 500),
      },
    });
  }

  await prisma.consultaJob.update({
    where: { id: jobId },
    data: encerrar ? { status: 'ERRO', erro: mensagem } : { status: 'PENDENTE', erro: mensagem },
  });
}

// ─────────────────────────── Persistência da consulta ───────────────────────────

async function persistirConsulta(dispositivoId: string | null, uf: string, r: ConsultaResult): Promise<void> {
  if (!dispositivoId) throw new Error('Job de consulta sem dispositivoId');
  const disp = await prisma.dispositivo.findUnique({
    where: { id: dispositivoId },
    select: { id: true, clienteId: true },
  });
  if (!disp?.clienteId) throw new Error('Dispositivo sem cliente para a situação de multas');

  let boletoArquivo: string | null = null;
  if (r.boletoPdfBase64 && r.pagamentoTodas) {
    boletoArquivo = salvarBoleto(dispositivoId, `Extrato_${r.pagamentoTodas.extratoId}.pdf`, r.boletoPdfBase64);
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
  // TODO(Fase 5): detectar AITs novas (diff) e disparar notificações.
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
