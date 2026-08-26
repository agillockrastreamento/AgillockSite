// Serviço de pontuação de CNH para consumidores EXTERNOS (hoje o SafeLock).
// Montado em /api/v1/detran (mesmo path que o backend do Raposo expõe, para o
// gateway do SafeLock chamar o MESMO endereço nos dois — Raposo primário, este de
// fallback). Auth por SAFELOCK_API_KEY. Espelha o padrão pull do worker de multas:
// enfileira um ConsultaJob CONSULTA_PONTUACAO e o worker on-premise o executa.
//
//   POST /api/v1/detran/pontuacao {cpf, numeroFormulario}
//     · 503 WORKER_OFFLINE  → o SafeLock já sabe cair no fallback
//     · 200 {status:"concluido", resultado}
//     · 200 {status:"erro", erro}
//     · 202 {status:"processando", jobId}  → poll no GET
//   GET /api/v1/detran/pontuacao/:jobId → mesmo envelope.

import { Router, Request, Response } from 'express';
import { safelockApiKeyMiddleware } from '../middleware/safelock-api-key.middleware';
import { criarJobPontuacao, getEstadoJob, getWorkerStatus } from '../services/multas.service';

const router = Router();
router.use(safelockApiKeyMiddleware);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ESPERA_MS = 25_000; // long-poll: a consulta leva ~0,6s; o resto é fila
const INTERVALO_MS = 500;

async function responderEstado(res: Response, jobId: string): Promise<void> {
  const estado = await getEstadoJob(jobId);
  if (!estado) {
    res.status(404).json({ erro: { codigo: 'JOB_NAO_ENCONTRADO', mensagem: 'Consulta não encontrada.' } });
    return;
  }
  if (estado.status === 'CONCLUIDO') {
    res.json({ status: 'concluido', jobId, resultado: estado.resultado });
    return;
  }
  if (estado.status === 'ERRO') {
    res.json({ status: 'erro', jobId, erro: estado.erro ?? 'Falha na consulta ao Detran.' });
    return;
  }
  res.status(202).json({ status: 'processando', jobId });
}

router.post('/pontuacao', async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as { cpf?: unknown; numeroFormulario?: unknown };
  const cpf = String(body.cpf ?? '').replace(/\D/g, '');
  const numeroFormulario = String(body.numeroFormulario ?? '').replace(/\D/g, '');
  if (cpf.length !== 11) {
    res.status(422).json({ erro: { codigo: 'CPF_INVALIDO', mensagem: 'CPF deve ter 11 dígitos.' } });
    return;
  }
  if (numeroFormulario.length < 9 || numeroFormulario.length > 11) {
    res.status(422).json({ erro: { codigo: 'CNH_INVALIDA', mensagem: 'Número da CNH inválido (esperado ~10 dígitos).' } });
    return;
  }

  // Worker offline → responde já para o SafeLock cair no fallback em vez de esperar 25s.
  const status = await getWorkerStatus();
  if (!status.online) {
    res.status(503).json({ erro: { codigo: 'WORKER_OFFLINE', mensagem: 'Worker do Detran indisponível.' } });
    return;
  }

  const jobId = await criarJobPontuacao(cpf, numeroFormulario);
  const ate = Date.now() + ESPERA_MS;
  while (Date.now() < ate) {
    if (res.writableEnded) return; // cliente desconectou
    const estado = await getEstadoJob(jobId);
    if (estado && (estado.status === 'CONCLUIDO' || estado.status === 'ERRO')) {
      await responderEstado(res, jobId);
      return;
    }
    await sleep(INTERVALO_MS);
  }
  res.status(202).json({ status: 'processando', jobId });
});

router.get('/pontuacao/:jobId', async (req: Request, res: Response): Promise<void> => {
  await responderEstado(res, String(req.params.jobId));
});

export default router;
