// Rotas de multas do portal/app do cliente. Montadas em /api/cliente/multas.
// Disponível apenas se o cliente tiver multasHabilitado = true.
import { Router, Response, NextFunction } from 'express';
import {
  clienteAuthMiddleware,
  podeAcessarDispositivo,
  requirePermission,
  ClienteRequest,
} from '../middleware/cliente-auth.middleware';
import { pode } from '../utils/cliente-permissoes';
import prisma from '../utils/prisma';
import { criarJobConsulta, criarJobPagamento, aguardarJob } from '../services/multas.service';

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
// Sub-usuário precisa da permissão multas.ver (responsável sempre passa).
//
// Além das situações já consultadas, devolve:
//   • incompletos — veículos sem renavam E sem chassi (o Detran não pode ser consultado);
//   • aguardando  — veículos já com documento, mas ainda sem a primeira consulta.
router.get('/', requirePermission('multas.ver'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const [sits, dispositivos] = await Promise.all([
    prisma.veiculoMultaSituacao.findMany({
      where: { clienteId },
      include: {
        multas: { orderBy: { dataVencimento: 'asc' } },
        dispositivo: { select: { apelidoCliente: true, nome: true } },
      },
    }),
    prisma.dispositivo.findMany({
      where: { clienteId, ativo: true, placa: { not: null } },
      select: {
        id: true, placa: true, apelidoCliente: true, nome: true,
        renavam: true, chassi: true,
        veiculoMultaSituacao: { select: { id: true } },
      },
      orderBy: { placa: 'asc' },
    }),
  ]);

  const acessiveis = sits.filter((s) => podeAcessarDispositivo(req, s.dispositivoId));
  const atualizadoEm = acessiveis.reduce<Date | null>((max, s) => {
    if (s.ultimaConsultaEm && (!max || s.ultimaConsultaEm > max)) return s.ultimaConsultaEm;
    return max;
  }, null);

  const dispAcessiveis = dispositivos.filter((d) => podeAcessarDispositivo(req, d.id));
  const mapDisp = (d: (typeof dispAcessiveis)[number]) => ({
    dispositivoId: d.id,
    placa: d.placa,
    apelido: d.apelidoCliente ?? d.nome ?? null,
  });

  res.json({
    habilitado: true,
    atualizadoEm,
    // Preencher renavam/chassi é permissão granular (responsável sempre tem).
    podeEditarDocumentos: pode(req.cliente!.permissoes, 'multas.editarDocumentos'),
    incompletos: dispAcessiveis.filter((d) => !d.renavam && !d.chassi).map(mapDisp),
    aguardando: dispAcessiveis
      .filter((d) => (d.renavam || d.chassi) && !d.veiculoMultaSituacao)
      .map(mapDisp),
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

// ─── PATCH /api/cliente/multas/:dispositivoId/documentos ─────────────────────
// Body: { renavam?, chassi? } (ao menos um). Grava no cadastro do dispositivo — é
// de lá que a consulta ao Detran lê os dados — e já enfileira a 1ª consulta.
// Sub-usuário precisa da permissão multas.editarDocumentos (responsável sempre passa).
router.patch('/:dispositivoId/documentos', requirePermission('multas.editarDocumentos'), async (req: ClienteRequest, res: Response): Promise<void> => {
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

  const renavam = String(req.body?.renavam ?? '').replace(/\D/g, '');
  const chassi = String(req.body?.chassi ?? '').trim().toUpperCase();

  if (!renavam && !chassi) {
    res.status(400).json({ error: 'Informe o RENAVAM e/ou o chassi.' });
    return;
  }
  if (renavam && !/^\d{9,11}$/.test(renavam)) {
    res.status(400).json({ error: 'RENAVAM inválido: deve ter de 9 a 11 dígitos.' });
    return;
  }
  if (chassi && !/^[A-HJ-NPR-Z0-9]{17}$/.test(chassi)) {
    res.status(400).json({ error: 'Chassi inválido: deve ter 17 caracteres (sem as letras I, O e Q).' });
    return;
  }

  const atualizado = await prisma.dispositivo.update({
    where: { id: dispositivoId },
    data: {
      ...(renavam ? { renavam } : {}),
      ...(chassi ? { chassi } : {}),
    },
    select: { id: true, placa: true, renavam: true, chassi: true },
  });

  // Com o documento em mãos, já busca as multas (best-effort: falha aqui não
  // desfaz o cadastro — o lote agendado pega o veículo na próxima rodada).
  let consultaEnfileirada = false;
  try {
    await criarJobConsulta(atualizado, 'CLIENTE');
    consultaEnfileirada = true;
  } catch (err) {
    console.error('[Multas] Falha ao enfileirar consulta do cliente:', err);
  }

  res.json({ ...atualizado, dispositivoId: atualizado.id, consultaEnfileirada });
});

// ─── POST /api/cliente/multas/:dispositivoId/pagamento — gera Pix/boleto ─────
// Body: { aits?: string[] } (vazio/omitido = todas). Regenera com valor atual (worker).
router.post('/:dispositivoId/pagamento', requirePermission('multas.pagar'), async (req: ClienteRequest, res: Response): Promise<void> => {
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
