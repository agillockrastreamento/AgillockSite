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
  const html = preencherTemplate(tipo, { tipo, cliente, fiadores, testemunhas, representante: representante || {} } as DadosContrato);
  res.json({ html });
});

// GET /api/contratos
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
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
    if (dataFim) (where.createdAt as any).lte = new Date(dataFim + 'T23:59:59');
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
});

// GET /api/contratos/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const contrato = await prisma.contrato.findUnique({
    where: { id },
    include: { cliente: true, criadoPor: { select: { id: true, nome: true } } },
  });
  if (!contrato) { res.status(404).json({ error: 'Contrato não encontrado.' }); return; }
  res.json(contrato);
});

// POST /api/contratos — salvar rascunho
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { tipo, clienteId, fiadores, testemunhas, htmlConteudo, metodoAutenticacao } = req.body;
  if (!tipo || !clienteId || !testemunhas || !htmlConteudo || !metodoAutenticacao) {
    res.status(400).json({ error: 'tipo, clienteId, testemunhas, htmlConteudo e metodoAutenticacao são obrigatórios.' });
    return;
  }
  // Check permission for COLABORADOR
  if (req.user!.role === 'COLABORADOR') {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.podeCriarContrato) { res.status(403).json({ error: 'Sem permissão para criar contratos.' }); return; }
  }
  const contrato = await prisma.contrato.create({
    data: { tipo, clienteId, fiadores: fiadores || null, testemunhas, htmlConteudo, metodoAutenticacao, criadoPorId: req.user!.userId },
  });
  res.status(201).json(contrato);
});

// PUT /api/contratos/:id — update draft
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const contrato = await prisma.contrato.findUnique({ where: { id } });
  if (!contrato) { res.status(404).json({ error: 'Contrato não encontrado.' }); return; }
  if (contrato.status !== 'RASCUNHO') { res.status(400).json({ error: 'Apenas contratos em rascunho podem ser editados.' }); return; }
  if (req.user!.role === 'COLABORADOR') {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.podeEditarContrato) { res.status(403).json({ error: 'Sem permissão para editar contratos.' }); return; }
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
});

// POST /api/contratos/:id/enviar — HTML→PDF→ClickSign
router.post('/:id/enviar', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const contratoBase = await prisma.contrato.findUnique({ where: { id } });
  if (!contratoBase) { res.status(404).json({ error: 'Contrato não encontrado.' }); return; }
  if (contratoBase.status !== 'RASCUNHO') { res.status(400).json({ error: 'Contrato já enviado para assinatura.' }); return; }

  const config = await prisma.configuracoes.findUnique({ where: { id: '1' } });
  if (!config?.representanteNome || !config?.representanteEmail || !config?.representanteCpf) {
    res.status(400).json({ error: 'Configure o Representante AgilLock em Configurações antes de enviar contratos.' });
    return;
  }

  const cliente = await prisma.cliente.findUnique({ where: { id: contratoBase.clienteId } });
  if (!cliente) { res.status(404).json({ error: 'Cliente do contrato não encontrado.' }); return; }

  const testemunhas = contratoBase.testemunhas as Array<{ nome: string; cpf: string; email: string; telefone: string; assinarDigital: boolean }>;
  const fiadores = (contratoBase.fiadores || []) as Array<{ nome: string; cpf: string; email: string; telefone: string }>;
  const metodo = contratoBase.metodoAutenticacao;

  // Generate PDF
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await htmlParaPdf(contratoBase.htmlConteudo);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao gerar PDF do contrato.' });
    return;
  }

  // ClickSign flow
  let envelopeId: string, documentId: string;
  const signatariosResult: Array<{ nome: string; signerId: string; link: string; tipo: string }> = [];
  try {
    ({ envelopeId } = await clicksign.criarEnvelope(`Contrato ${contratoBase.tipo} - ${cliente.nome}`));
    ({ documentId } = await clicksign.uploadDocumento(envelopeId, pdfBuffer, 'contrato.pdf'));

    const isPJ = contratoBase.tipo.startsWith('PJ');
    const socios = isPJ ? ((cliente.socios as any[]) || []) : [];

    if (isPJ) {
      for (const socio of socios) {
        const { signerId, link } = await clicksign.adicionarSignatario(envelopeId, { nome: socio.nome, email: socio.email || cliente.email || '', telefone: socio.telefone || cliente.telefone || '', cpf: socio.cpf, grupo: 1 });
        await clicksign.adicionarRequisitoQualificacao(envelopeId, documentId, signerId, 'party');
        await clicksign.adicionarRequisitoAutenticacao(envelopeId, signerId, metodo);
        signatariosResult.push({ nome: socio.nome, signerId, link, tipo: 'socio' });
      }
      for (const fiador of fiadores) {
        const { signerId, link } = await clicksign.adicionarSignatario(envelopeId, { nome: fiador.nome, email: fiador.email, telefone: fiador.telefone, cpf: fiador.cpf, grupo: 1 });
        await clicksign.adicionarRequisitoQualificacao(envelopeId, documentId, signerId, 'party');
        await clicksign.adicionarRequisitoAutenticacao(envelopeId, signerId, metodo);
        signatariosResult.push({ nome: fiador.nome, signerId, link, tipo: 'fiador' });
      }
    } else {
      const { signerId, link } = await clicksign.adicionarSignatario(envelopeId, { nome: cliente.nome, email: cliente.email || '', telefone: cliente.telefone || '', cpf: cliente.cpfCnpj || '', grupo: 1 });
      await clicksign.adicionarRequisitoQualificacao(envelopeId, documentId, signerId, 'party');
      await clicksign.adicionarRequisitoAutenticacao(envelopeId, signerId, metodo);
      signatariosResult.push({ nome: cliente.nome, signerId, link, tipo: 'cliente' });
    }

    // Group 2: AgilLock representative
    const { signerId: repId, link: repLink } = await clicksign.adicionarSignatario(envelopeId, { nome: config.representanteNome!, email: config.representanteEmail!, telefone: config.representanteTelefone || '', cpf: config.representanteCpf || '', grupo: 2 });
    await clicksign.adicionarRequisitoQualificacao(envelopeId, documentId, repId, 'party');
    await clicksign.adicionarRequisitoAutenticacao(envelopeId, repId, metodo);
    signatariosResult.push({ nome: config.representanteNome!, signerId: repId, link: repLink, tipo: 'agillock' });

    // Group 3: digital witnesses
    for (const t of testemunhas) {
      if (t.assinarDigital) {
        const { signerId, link } = await clicksign.adicionarSignatario(envelopeId, { nome: t.nome, email: t.email, telefone: t.telefone, cpf: t.cpf, grupo: 3 });
        await clicksign.adicionarRequisitoQualificacao(envelopeId, documentId, signerId, 'witness');
        await clicksign.adicionarRequisitoAutenticacao(envelopeId, signerId, metodo);
        signatariosResult.push({ nome: t.nome, signerId, link, tipo: 'testemunha' });
      }
    }

    await clicksign.ativarEnvelope(envelopeId);
  } catch (e: any) {
    res.status(502).json({ error: `Falha na integração com o ClickSign: ${e.message}` });
    return;
  }

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
});

// POST /api/contratos/:id/cancelar
router.post('/:id/cancelar', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const contrato = await prisma.contrato.findUnique({ where: { id } });
  if (!contrato) { res.status(404).json({ error: 'Contrato não encontrado.' }); return; }
  if (contrato.status !== 'AGUARDANDO_ASSINATURA') { res.status(400).json({ error: 'Apenas contratos aguardando assinatura podem ser cancelados.' }); return; }
  if (req.user!.role === 'COLABORADOR') {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.podeEditarContrato) { res.status(403).json({ error: 'Sem permissão para cancelar contratos.' }); return; }
  }
  if (contrato.clicksignEnvelopeId) {
    try { await clicksign.cancelarEnvelope(contrato.clicksignEnvelopeId); } catch { /* ignore if already cancelled */ }
  }
  const updated = await prisma.contrato.update({ where: { id }, data: { status: 'CANCELADO' } });
  res.json(updated);
});

// DELETE /api/contratos/:id — only RASCUNHO
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const contrato = await prisma.contrato.findUnique({ where: { id } });
  if (!contrato) { res.status(404).json({ error: 'Contrato não encontrado.' }); return; }
  if (contrato.status !== 'RASCUNHO') { res.status(400).json({ error: 'Apenas rascunhos podem ser excluídos.' }); return; }
  if (req.user!.role === 'COLABORADOR') {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.podeExcluirContrato) { res.status(403).json({ error: 'Sem permissão para excluir contratos.' }); return; }
  }
  await prisma.contrato.delete({ where: { id } });
  res.status(204).end();
});

export default router;
