import { Router, Response } from 'express';
import { ClienteRequest, clienteAuthMiddleware } from '../middleware/cliente-auth.middleware';
import {
  listarVeiculosDoCliente,
  cotarPlaca,
  concluirWeb,
  normalizarPlaca,
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

// POST /api/cliente/cotacao-iapro/cotar { placa }
// Consulta a placa na IAPRO e retorna dados do veículo + valores + WhatsApp comercial.
router.post('/cotar', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const placa = normalizarPlaca(req.body?.placa);
    if (placa.length < 7) {
      res.status(400).json({ error: 'Informe uma placa válida.' });
      return;
    }
    const resultado = await cotarPlaca(placa);
    // Remove os dados crus internos antes de devolver ao cliente.
    const { _raw, ...veiculo } = resultado.veiculo;
    res.json({ veiculo, preco: resultado.preco, whatsappComercial: resultado.whatsappComercial });
  } catch (error) {
    console.error('[Cotação IAPRO] Erro ao cotar placa:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Erro ao cotar a placa.' });
  }
});

// POST /api/cliente/cotacao-iapro/concluir-web { placa }
// Orquestra a sessão de cotação na IAPRO até o pagamento da adesão e devolve a URL do site.
router.post('/concluir-web', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const placa = normalizarPlaca(req.body?.placa);
    if (placa.length < 7) {
      res.status(400).json({ error: 'Informe uma placa válida.' });
      return;
    }
    const resultado = await concluirWeb(req.cliente!.clienteId, placa);
    res.json(resultado);
  } catch (error) {
    console.error('[Cotação IAPRO] Erro ao concluir na web:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Erro ao iniciar a cotação na web.' });
  }
});

export default router;
