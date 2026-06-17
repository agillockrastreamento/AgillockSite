import { Router, Response } from 'express';
import { ClienteRequest, clienteAuthMiddleware } from '../middleware/cliente-auth.middleware';
import {
  listarVeiculosDoCliente,
  cotarPlaca,
  cotarZero,
  contratar,
  listarFipeMarcas,
  listarFipeModelos,
  listarFipeAnos,
  normalizarPlaca,
  normalizarTipo,
} from '../services/iapro-cotacao.service';

const router = Router();
router.use(clienteAuthMiddleware);

// GET /api/cliente/cotacao-iapro/veiculos
// Veículos (dispositivos com placa) do cliente para o seletor da cotação.
router.get('/veiculos', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const clienteId = req.cliente!.clienteId;
    const veiculos = await listarVeiculosDoCliente(clienteId, req.cliente!.dispositivoIdsPermitidos);
    res.json(veiculos);
  } catch (error) {
    console.error('[Cotação IAPRO] Erro ao listar veículos:', error);
    res.status(500).json({ error: 'Erro ao carregar veículos.' });
  }
});

// POST /api/cliente/cotacao-iapro/cotar { placa, sessionId? }
// Consulta a placa, GRAVA a cotação na IAPRO (aparece no painel) e retorna veículo + valores + sessionId.
router.post('/cotar', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const placa = normalizarPlaca(req.body?.placa);
    if (placa.length < 7) {
      res.status(400).json({ error: 'Informe uma placa válida.' });
      return;
    }
    const sessionId = req.body?.sessionId ? String(req.body.sessionId) : undefined;
    const resultado = await cotarPlaca(req.cliente!.clienteId, placa, sessionId);
    const { _raw, ...veiculo } = resultado.veiculo;
    res.json({ veiculo, preco: resultado.preco, whatsappComercial: resultado.whatsappComercial, sessionId: resultado.sessionId });
  } catch (error) {
    console.error('[Cotação IAPRO] Erro ao cotar placa:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Erro ao cotar a placa.' });
  }
});

// ─── Veículo 0 km (selects da FIPE) ─────────────────────────────────────────

// GET /api/cliente/cotacao-iapro/fipe/marcas?tipo=CARRO
router.get('/fipe/marcas', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    res.json(await listarFipeMarcas(String(req.query.tipo || 'CARRO')));
  } catch (error) {
    console.error('[Cotação IAPRO] Erro FIPE marcas:', error);
    res.status(502).json({ error: 'Erro ao carregar marcas.' });
  }
});

// GET /api/cliente/cotacao-iapro/fipe/modelos?tipo=&marca=<brandId>
router.get('/fipe/modelos', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const marca = String(req.query.marca || '');
    if (!marca) { res.status(400).json({ error: 'Selecione a marca.' }); return; }
    res.json(await listarFipeModelos(String(req.query.tipo || 'CARRO'), marca));
  } catch (error) {
    console.error('[Cotação IAPRO] Erro FIPE modelos:', error);
    res.status(502).json({ error: 'Erro ao carregar modelos.' });
  }
});

// GET /api/cliente/cotacao-iapro/fipe/anos?tipo=&marca=&modelo=
router.get('/fipe/anos', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const marca = String(req.query.marca || '');
    const modelo = String(req.query.modelo || '');
    if (!marca || !modelo) { res.status(400).json({ error: 'Selecione marca e modelo.' }); return; }
    res.json(await listarFipeAnos(String(req.query.tipo || 'CARRO'), marca, modelo));
  } catch (error) {
    console.error('[Cotação IAPRO] Erro FIPE anos:', error);
    res.status(502).json({ error: 'Erro ao carregar anos.' });
  }
});

function lerSelecaoFipe(body: unknown): { tipo: string; marca: string; modelo: string; ano: string; sessionId?: string } | null {
  const b = (body || {}) as Record<string, unknown>;
  const tipo = normalizarTipo(String(b.tipo || ''));
  const marca = String(b.marca || '');
  const modelo = String(b.modelo || '');
  const ano = String(b.ano || '');
  if (!marca || !modelo || !ano) return null;
  return { tipo, marca, modelo, ano, sessionId: b.sessionId ? String(b.sessionId) : undefined };
}

// POST /api/cliente/cotacao-iapro/cotar-zero { tipo, marca, modelo, ano, sessionId? }
router.post('/cotar-zero', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const sel = lerSelecaoFipe(req.body);
    if (!sel) { res.status(400).json({ error: 'Selecione tipo, marca, modelo e ano.' }); return; }
    const resultado = await cotarZero(req.cliente!.clienteId, sel.tipo, sel.marca, sel.modelo, sel.ano, sel.sessionId);
    const { _raw, ...veiculo } = resultado.veiculo;
    res.json({ veiculo: { ...veiculo, zeroKm: true }, preco: resultado.preco, whatsappComercial: resultado.whatsappComercial, sessionId: resultado.sessionId });
  } catch (error) {
    console.error('[Cotação IAPRO] Erro ao cotar 0 km:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Erro ao cotar o veículo.' });
  }
});

// POST /api/cliente/cotacao-iapro/contratar { sessionId }
// Envia os dados do cliente (AgilLock → IAPRO) e entra na contratação (etapa 4 — pagamento da adesão).
router.post('/contratar', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const sessionId = req.body?.sessionId ? String(req.body.sessionId) : '';
    if (!sessionId) { res.status(400).json({ error: 'Cotação inválida. Refaça a cotação.' }); return; }
    const resultado = await contratar(req.cliente!.clienteId, sessionId);
    res.json(resultado);
  } catch (error) {
    console.error('[Cotação IAPRO] Erro ao contratar:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Erro ao iniciar a contratação.' });
  }
});

export default router;
