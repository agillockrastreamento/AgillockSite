// Worker de consulta de multas. Roda numa máquina da rede do cliente que
// alcança o Detran (o servidor de produção é bloqueado). Faz polling no backend:
// claim → executa o fluxo do Detran → devolve o resultado. Ver docs/multas/ARQUITETURA_WORKER.md.

import 'dotenv/config';
import {
  consultarVeiculoCompleto,
  gerarPagamento,
  consultarPontuacao,
  DadosInvalidosError,
} from './detran-ce.js';

const BACKEND_URL = process.env.BACKEND_URL;
const WORKER_API_KEY = process.env.WORKER_API_KEY;

if (!BACKEND_URL || !WORKER_API_KEY) {
  console.error('Configuração ausente: defina BACKEND_URL e WORKER_API_KEY no .env');
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${WORKER_API_KEY}`,
  'Content-Type': 'application/json',
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Job {
  id: string;
  tipo: 'CONSULTA_VEICULO' | 'GERAR_PAGAMENTO' | 'CONSULTA_PONTUACAO';
  placa: string;
  renavam: string | null;
  aits: string[] | null;
  cpf: string | null;
  numeroFormulario: string | null;
}

async function api(pathname: string, body?: unknown, timeoutMs = 120_000): Promise<any> {
  const res = await fetch(new URL(pathname, BACKEND_URL), {
    method: 'POST',
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

async function processarJob(job: Job): Promise<void> {
  const t0 = Date.now();
  try {
    let resultado: unknown;
    if (job.tipo === 'CONSULTA_VEICULO') {
      resultado = await consultarVeiculoCompleto(job.placa, job.renavam ?? '');
    } else if (job.tipo === 'GERAR_PAGAMENTO') {
      resultado = await gerarPagamento(job.placa, job.renavam ?? '', job.aits ?? undefined);
    } else if (job.tipo === 'CONSULTA_PONTUACAO') {
      resultado = await consultarPontuacao(job.cpf ?? '', job.numeroFormulario ?? '');
    } else {
      throw new Error(`Tipo de job desconhecido: ${(job as Job).tipo}`);
    }
    await api(`/api/worker/jobs/${job.id}/resultado`, { resultado });
    const alvo = job.tipo === 'CONSULTA_PONTUACAO' ? `cpf ${job.cpf}` : job.placa;
    console.log(`[${job.id}] ${job.tipo} ${alvo} → OK (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e: any) {
    const permanente = e instanceof DadosInvalidosError;
    const mensagem = e?.message ?? String(e);
    await api(`/api/worker/jobs/${job.id}/erro`, { mensagem, permanente }).catch(() => {});
    const alvo = job.tipo === 'CONSULTA_PONTUACAO' ? `cpf ${job.cpf}` : job.placa;
    console.warn(`[${job.id}] ${job.tipo} ${alvo} → ERRO${permanente ? ' (permanente)' : ''}: ${mensagem}`);
  }
}

async function loop(): Promise<void> {
  console.log(`Worker de multas conectado a ${BACKEND_URL}. Aguardando jobs...`);
  let falhasSeguidas = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // claim é long-poll (~25s) e já registra heartbeat no backend
      const { job } = await api('/api/worker/claim', undefined, 40_000);
      falhasSeguidas = 0;
      if (job) await processarJob(job as Job);
    } catch (e: any) {
      falhasSeguidas++;
      const espera = Math.min(30_000, 3_000 * falhasSeguidas);
      console.warn(`claim falhou (${falhasSeguidas}): ${e?.message ?? e}. Nova tentativa em ${espera / 1000}s`);
      await sleep(espera);
    }
  }
}

loop();
