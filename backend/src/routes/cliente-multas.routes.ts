// Rotas de multas do portal/app do cliente. Montadas em /api/cliente/multas.
// Disponível apenas se o cliente tiver multasHabilitado = true.
import { Router, Response, NextFunction } from 'express';
import { clienteAuthMiddleware, podeAcessarDispositivo, ClienteRequest } from '../middleware/cliente-auth.middleware';
import prisma from '../utils/prisma';
import { criarJobPagamento, aguardarJob } from '../services/multas.service';

const router = Router();
router.use(clienteAuthMiddleware);

// Gate: só passa se o cliente estiver habilitado para consulta de multas.
async function requireMultasHabilitado(req: ClienteRequest, res: Response, next: NextFunction): Promise<void> {
  const cliente = await prisma.cliente.findUnique({
    where: { id: req.cliente!.clienteId },
    select: { multasHabilitado: true },
  });
  if (!cliente?.multasHabilitado) {
    res.status(403).json({ error: 'Consulta de multas não habilitada para este cliente.' });
    return;
  }
  next();
}
router.use(requireMultasHabilitado);

// ─── GET /api/cliente/multas — situação de multas dos veículos do cliente ────
router.get('/', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const sits = await prisma.veiculoMultaSituacao.findMany({
    where: { clienteId },
    include: {
      multas: { orderBy: { dataVencimento: 'asc' } },
      dispositivo: { select: { apelidoCliente: true, nome: true } },
    },
  });

  const acessiveis = sits.filter((s) => podeAcessarDispositivo(req, s.dispositivoId));
  const atualizadoEm = acessiveis.reduce<Date | null>((max, s) => {
    if (s.ultimaConsultaEm && (!max || s.ultimaConsultaEm > max)) return s.ultimaConsultaEm;
    return max;
  }, null);

  res.json({
    habilitado: true,
    atualizadoEm,
    veiculos: acessiveis.map((s) => ({
      dispositivoId: s.dispositivoId,
      placa: s.placa,
      apelido: s.dispositivo?.apelidoCliente ?? s.dispositivo?.nome ?? null,
      qtdMultas: s.qtdMultas,
      valorTotal: Number(s.valorTotal),
      possuiDebitoIpva: s.possuiDebitoIpva,
      licenciamentoPendente: s.licenciamentoPendente,
      ultimaConsultaEm: s.ultimaConsultaEm,
      ultimaConsultaStatus: s.ultimaConsultaStatus,
      multas: s.multas.map((m) => ({
        ait: m.ait,
        motivo: m.motivo,
        dataInfracao: m.dataInfracao,
        dataVencimento: m.dataVencimento,
        valor: Number(m.valor),
        valorAPagar: Number(m.valorAPagar),
      })),
      pix: s.pixEmv ? { emv: s.pixEmv, qrCodeBase64: s.pixQrCodeBase64 } : null,
      boletoUrl: s.boletoArquivo,
    })),
  });
});

// ─── POST /api/cliente/multas/:dispositivoId/pagamento — gera Pix/boleto ─────
// Body: { aits?: string[] } (vazio/omitido = todas). Regenera com valor atual (worker).
router.post('/:dispositivoId/pagamento', async (req: ClienteRequest, res: Response): Promise<void> => {
  const dispositivoId = String(req.params.dispositivoId);
  if (!podeAcessarDispositivo(req, dispositivoId)) {
    res.status(403).json({ error: 'Sem acesso a este veículo.' });
    return;
  }
  const disp = await prisma.dispositivo.findFirst({
    where: { id: dispositivoId, clienteId: req.cliente!.clienteId },
    select: { id: true, placa: true, renavam: true, chassi: true },
  });
  if (!disp) {
    res.status(404).json({ error: 'Veículo não encontrado.' });
    return;
  }
  const aits = Array.isArray(req.body?.aits) ? (req.body.aits as string[]) : undefined;
  const jobId = await criarJobPagamento(disp, aits, 'CLIENTE');
  const job = await aguardarJob(jobId);
  if (job?.status === 'ERRO') {
    res.status(502).json({ error: 'Não foi possível gerar o pagamento agora. Tente novamente.', jobId });
    return;
  }
  if (job?.status !== 'CONCLUIDO') {
    res.status(202).json({ status: 'processando', jobId });
    return;
  }
  res.json(job.resultado);
});

export default router;
