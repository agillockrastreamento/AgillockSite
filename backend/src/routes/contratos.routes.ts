import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { param, query } from '../utils/params';
import { preencherTemplate, DadosContrato } from '../services/contrato-template.service';
import { htmlParaPdf } from '../services/pdf.service';
import * as clicksign from '../services/clicksign.service';

const router = Router();
router.use(authMiddleware);
router.use(requireRoles('ADMIN', 'COLABORADOR'));


// POST /api/contratos/preview — BEFORE /:id
router.post('/preview', async (req: AuthRequest, res: Response): Promise<void> => {
  const { tipo, cliente, fiadores, testemunhas, representante } = req.body;
  if (!tipo || !cliente || !testemunhas) {
    res.status(400).json({ error: 'tipo, cliente e testemunhas são obrigatórios.' });
    return;
  }
  try {
    const html = preencherTemplate(tipo, { tipo, cliente, fiadores, testemunhas, representante: representante || {} } as DadosContrato);
    res.json({ html });
  } catch (e: any) {
    res.status(400).json({ error: `Erro ao gerar prévia: ${e.message}` });
  }
});

// POST /api/contratos/view-pdf — gera PDF a partir do HTML e retorna stream
router.post('/view-pdf', async (req: AuthRequest, res: Response): Promise<void> => {
  const { htmlConteudo } = req.body;
  if (!htmlConteudo) {
    res.status(400).json({ error: 'htmlConteudo é obrigatório.' });
    return;
  }
  try {
    const pdfBuffer = await htmlParaPdf(htmlConteudo);
    res.contentType('application/pdf');
    res.send(pdfBuffer);
  } catch (e: any) {
    res.status(500).json({ error: `Erro ao gerar PDF: ${e.message}` });
  }
});

// GET /api/contratos
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const status = query(req.query.status);
    const tipo = query(req.query.tipo);
    const clienteId = query(req.query.clienteId);
    const criadoPorId = query(req.query.criadoPorId);
    const dataInicio = query(req.query.dataInicio);
    const dataFim = query(req.query.dataFim);
    const busca = query(req.query.busca);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (tipo) where.tipo = tipo;
    if (clienteId) where.clienteId = clienteId;
    if (criadoPorId) where.criadoPorId = criadoPorId;
    if (dataInicio || dataFim) {
      where.createdAt = {};
      if (dataInicio) (where.createdAt as any).gte = new Date(dataInicio);
      if (dataFim) (where.createdAt as any).lte = new Date(dataFim + 'T23:59:59.999Z');
    }
    if (busca) {
      where.cliente = { nome: { contains: busca, mode: 'insensitive' } };
    }
    const contratos = await prisma.contrato.findMany({
      where,
      include: { cliente: { select: { id: true, nome: true } }, criadoPor: { select: { id: true, nome: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(contratos);
  } catch (e: any) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/contratos/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = param(req, 'id');
    let contrato = await prisma.contrato.findUnique({
      where: { id },
      include: { cliente: true, criadoPor: { select: { id: true, nome: true } } },
    });
    if (!contrato) { res.status(404).json({ error: 'Contrato nÃ£o encontrado.' }); return; }


    res.json(contrato);
  } catch (e: any) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/contratos â€” salvar rascunho
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { tipo, clienteId, fiadores, testemunhas, htmlConteudo, metodoAutenticacao } = req.body;
    if (!tipo || !clienteId || !testemunhas || !htmlConteudo || !metodoAutenticacao) {
      res.status(400).json({ error: 'tipo, clienteId, testemunhas, htmlConteudo e metodoAutenticacao sÃ£o obrigatÃ³rios.' });
      return;
    }
    // Check permission for COLABORADOR
    if (req.user!.role === 'COLABORADOR') {
      const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
      if (!user?.podeCriarContrato) { res.status(403).json({ error: 'Sem permissÃ£o para criar contratos.' }); return; }
    }
    const contrato = await prisma.contrato.create({
      data: { tipo, clienteId, fiadores: fiadores || null, testemunhas, htmlConteudo, metodoAutenticacao, criadoPorId: req.user!.userId },
    });
    res.status(201).json(contrato);
  } catch (e: any) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// PUT /api/contratos/:id â€” update draft
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = param(req, 'id');
    const contrato = await prisma.contrato.findUnique({ where: { id } });
    if (!contrato) { res.status(404).json({ error: 'Contrato nÃ£o encontrado.' }); return; }
    if (contrato.status !== 'RASCUNHO') { res.status(400).json({ error: 'Apenas contratos em rascunho podem ser editados.' }); return; }
    if (req.user!.role === 'COLABORADOR') {
      const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
      if (!user?.podeEditarContrato) { res.status(403).json({ error: 'Sem permissÃ£o para editar contratos.' }); return; }
    }
    const { htmlConteudo, fiadores, testemunhas, metodoAutenticacao } = req.body;
    const updated = await prisma.contrato.update({
      where: { id },
      data: {
        ...(htmlConteudo !== undefined ? { htmlConteudo } : {}),
        ...(fiadores !== undefined ? { fiadores } : {}),
        ...(testemunhas !== undefined ? { testemunhas } : {}),
        ...(metodoAutenticacao !== undefined ? { metodoAutenticacao } : {}),
      },
    });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/contratos/:id/enviar â€” HTMLâ†’PDFâ†’ClickSign
router.post('/:id/enviar', async (req: AuthRequest, res: Response): Promise<void> => {
  // Wrap early Prisma calls
  let contratoBase: any;
  let config: any;
  let cliente: any;
  try {
    const id = param(req, 'id');
    contratoBase = await prisma.contrato.findUnique({ where: { id } });
    if (!contratoBase) { res.status(404).json({ error: 'Contrato nÃ£o encontrado.' }); return; }
    if (contratoBase.status !== 'RASCUNHO') { res.status(400).json({ error: 'Contrato jÃ¡ enviado para assinatura.' }); return; }

    config = await prisma.configuracoes.findUnique({ where: { id: '1' } });

    cliente = await prisma.cliente.findUnique({ where: { id: contratoBase.clienteId } });
    if (!cliente) { res.status(404).json({ error: 'Cliente do contrato nÃ£o encontrado.' }); return; }
  } catch (e: any) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
    return;
  }

  const id = contratoBase.id;
  // Generate PDF
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await htmlParaPdf(contratoBase.htmlConteudo);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao gerar PDF do contrato.' });
    return;
  }

  // ClickSign flow
  let envelopeId: string = '', documentId: string = '';
  const signatariosResult: Array<{ nome: string; signerId: string; link: string; tipo: string }> = [];
  try {
    ({ envelopeId } = await clicksign.criarEnvelope(`Contrato ${contratoBase.tipo} - ${cliente.nome}`));
    ({ documentId } = await clicksign.uploadDocumento(envelopeId, pdfBuffer, 'contrato.pdf'));

    const isPJ = contratoBase.tipo.startsWith('PJ');
    const socios = isPJ ? ((cliente.socios as any[]) || []) : [];

    // Apenas cliente (PF) ou sÃ³cios (PJ) assinam digitalmente
    if (isPJ) {
      for (const socio of socios) {
        const email = socio.email || cliente.email || '';
        const { signerId } = await clicksign.adicionarSignatario(envelopeId, { nome: socio.nome, email, telefone: socio.telefone || cliente.telefone || '', cpf: socio.cpf });
        await clicksign.adicionarRequisitoQualificacao(envelopeId, documentId, signerId, 'contractor');
        await clicksign.adicionarRequisitoAutenticacao(envelopeId, documentId, signerId, 'handwritten');
        await clicksign.adicionarRequisitoAutenticacao(envelopeId, documentId, signerId, 'official_document');
        await clicksign.adicionarRequisitoAutenticacao(envelopeId, documentId, signerId, 'selfie');
        signatariosResult.push({ nome: socio.nome, email, signerId, link: '', tipo: 'socio' });
      }
    } else {
      const email = cliente.email || '';
      const { signerId } = await clicksign.adicionarSignatario(envelopeId, { nome: cliente.nome, email, telefone: cliente.telefone || '', cpf: cliente.cpfCnpj || '' });
      await clicksign.adicionarRequisitoQualificacao(envelopeId, documentId, signerId, 'contractor');
      await clicksign.adicionarRequisitoAutenticacao(envelopeId, documentId, signerId, 'handwritten');
      await clicksign.adicionarRequisitoAutenticacao(envelopeId, documentId, signerId, 'official_document');
      await clicksign.adicionarRequisitoAutenticacao(envelopeId, documentId, signerId, 'selfie');
      signatariosResult.push({ nome: cliente.nome, email, signerId, link: '', tipo: 'cliente' });
    }

    await clicksign.ativarEnvelope(envelopeId);
    // ClickSign V3 não expõe sign_url via API — links são enviados automaticamente por email aos signatários
  } catch (e: any) {
    if (envelopeId) {
      console.error(`[ClickSign] Falha apÃ³s criar envelope ${envelopeId}. Envelope pode estar Ã³rfÃ£o. Erro: ${e.message}`);
    }
    res.status(502).json({ error: `Falha na integraÃ§Ã£o com o ClickSign: ${e.message}` });
    return;
  }

  // Wrap final Prisma update
  try {
    const updated = await prisma.contrato.update({
      where: { id },
      data: {
        status: 'AGUARDANDO_ASSINATURA',
        clicksignEnvelopeId: envelopeId,
        clicksignDocumentoId: documentId,
        signatarios: signatariosResult,
      },
    });
    res.json({ contrato: updated, signatarios: signatariosResult });
  } catch (e: any) {
    res.status(500).json({ error: 'Erro ao salvar status do contrato apÃ³s envio.' });
  }
});

// GET /api/contratos/:id/debug-signers â€” TEMPORÃRIO
router.get('/:id/debug-signers', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = param(req, 'id');
    const contrato = await prisma.contrato.findUnique({ where: { id } });
    if (!contrato?.clicksignEnvelopeId) { res.status(400).json({ error: 'Contrato sem envelopeId.' }); return; }
    const token = process.env.CLICKSIGN_ACCESS_TOKEN;
    const baseUrl = process.env.CLICKSIGN_BASE_URL || 'https://sandbox.clicksign.com';
    const envelopeId = contrato.clicksignEnvelopeId;
    const headers = { 'Content-Type': 'application/vnd.api+json', 'Accept': 'application/vnd.api+json', 'Authorization': token! };

    // Busca envelope completo
    const envelopeRes = await fetch(`${baseUrl}/api/v3/envelopes/${envelopeId}`, { headers });
    const envelopeJson: any = await envelopeRes.json();

    // Tenta gerar link de assinatura via notificaÃ§Ã£o on-demand
    const signatarios = (contrato.signatarios as any[]) || [];
    const signersDetalhes = await Promise.all(signatarios.map(async (s: any) => {
      const notifRes = await fetch(`${baseUrl}/api/v3/envelopes/${envelopeId}/signers/${s.signerId}/notifications`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: { type: 'notifications', attributes: { channel: 'link' } } }),
      });
      const notifJson = await notifRes.json();
      return { signerId: s.signerId, nome: s.nome, status: notifRes.status, notifRaw: notifJson };
    }));

    res.json({ envelopeId, envelopeStatus: envelopeJson?.data?.attributes?.status, signersDetalhes });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/contratos/:id/notificar/:signerId — reenviar email de assinatura
router.post('/:id/notificar/:signerId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = param(req, 'id');
    const signerId = req.params.signerId as string;
    const contrato = await prisma.contrato.findUnique({ where: { id } });
    if (!contrato) { res.status(404).json({ error: 'Contrato não encontrado.' }); return; }
    if (!contrato.clicksignEnvelopeId) { res.status(400).json({ error: 'Contrato sem envelope ClickSign.' }); return; }
    if (contrato.status !== 'AGUARDANDO_ASSINATURA') { res.status(400).json({ error: 'Contrato não está aguardando assinatura.' }); return; }
    await clicksign.reenviarNotificacao(contrato.clicksignEnvelopeId, signerId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Erro ao reenviar notificação.' });
  }
});

// POST /api/contratos/:id/cancelar
router.post('/:id/cancelar', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = param(req, 'id');
    const contrato = await prisma.contrato.findUnique({ where: { id } });
    if (!contrato) { res.status(404).json({ error: 'Contrato nÃ£o encontrado.' }); return; }
    if (contrato.status !== 'AGUARDANDO_ASSINATURA') { res.status(400).json({ error: 'Apenas contratos aguardando assinatura podem ser cancelados.' }); return; }
    if (req.user!.role === 'COLABORADOR') {
      const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
      if (!user?.podeEditarContrato) { res.status(403).json({ error: 'Sem permissÃ£o para cancelar contratos.' }); return; }
    }
    const updated = await prisma.contrato.update({ where: { id }, data: { status: 'CANCELADO' } });
    // A API V3 do ClickSign não suporta cancelamento programático de envelopes em andamento.
    // O envelope deve ser cancelado manualmente no painel do ClickSign.
    res.json({ ...updated, aviso: contrato.clicksignEnvelopeId ? 'Contrato cancelado no sistema. Cancele também no painel do ClickSign.' : undefined });
  } catch (e: any) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// DELETE /api/contratos/:id â€” only RASCUNHO
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = param(req, 'id');
    const contrato = await prisma.contrato.findUnique({ where: { id } });
    if (!contrato) { res.status(404).json({ error: 'Contrato nÃ£o encontrado.' }); return; }
    if (contrato.status !== 'RASCUNHO') { res.status(400).json({ error: 'Apenas rascunhos podem ser excluÃ­dos.' }); return; }
    if (req.user!.role === 'COLABORADOR') {
      const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
      if (!user?.podeExcluirContrato) { res.status(403).json({ error: 'Sem permissÃ£o para excluir contratos.' }); return; }
    }
    await prisma.contrato.delete({ where: { id } });
    res.status(204).end();
  } catch (e: any) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

export default router;

