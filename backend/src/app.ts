import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes';
import clientesRoutes from './routes/clientes.routes';
import placasRoutes from './routes/placas.routes';
import dispositivosRoutes from './routes/dispositivos.routes';
import carnesRoutes from './routes/carnes.routes';
import boletosRoutes from './routes/boletos.routes';
import efiRoutes from './routes/efi.routes';
import usuariosRoutes from './routes/usuarios.routes';
import dashboardRoutes from './routes/dashboard.routes';
import vendedorRoutes from './routes/vendedor.routes';
import configuracoesRoutes from './routes/configuracoes.routes';
import adminRoutes from './routes/admin.routes';
import webhooksRoutes from './routes/webhooks.routes';
import contratosRoutes from './routes/contratos.routes';
import rastreamentoRoutes from './routes/rastreamento.routes';
import motoristasRoutes from './routes/motoristas.routes';
import clienteLoginRoutes from './routes/cliente-login.routes';
import clientePortalRoutes from './routes/cliente-portal.routes';
import notificacoesRoutes from './routes/notificacoes.routes';
import notificacoesAdminRoutes from './routes/notificacoes-admin.routes';
import manutencoesRoutes from './routes/manutencoes.routes';
import manutencoesAdminRoutes from './routes/manutencoes-admin.routes';
import compartilhamentoRoutes from './routes/compartilhamento.routes';
import clientePerfilRoutes from './routes/cliente-perfil.routes';
import clienteUsuariosRoutes from './routes/cliente-usuarios.routes';
import clienteCotacaoIaproRoutes from './routes/cliente-cotacao-iapro.routes';
import usuariosResgateRoutes from './routes/usuarios-resgate.routes';
import tagsBleRoutes from './routes/tags-ble.routes';
import appResgateRoutes from './routes/app-resgate.routes';
import integracaoIaproRoutes from './routes/integracao-iapro.routes';
import iaproRoutes from './routes/iapro.routes';
import workerRoutes from './routes/worker.routes';
import { UPLOADS_DIR } from './utils/upload-paths';

const app = express();

// CORS
const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = new Set([
  ...(isProduction ? [] : [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]),
  ...configuredOrigins,
]);
function isAllowedCorsOrigin(origin: string) {
  if (allowedOrigins.has(origin)) return true;
  if (isProduction) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname.startsWith('192.168.') ||
      url.hostname.startsWith('10.')
    );
  } catch {
    return false;
  }
}
app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições sem origin (Postman, curl) em desenvolvimento
    if (!origin || (!isProduction && origin === 'null') || isAllowedCorsOrigin(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Origem bloqueada: ${origin}`);
      callback(new Error('Bloqueado pelo CORS'));
    }
  },
  credentials: true,
}));

// Webhook routes ANTES do express.json() para receber o body como Buffer bruto
app.use('/api/webhooks', webhooksRoutes);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: false })); // EFI webhook envia application/x-www-form-urlencoded

// Servir arquivos estáticos de uploads (imagens de dispositivos, etc.)
app.use('/uploads', express.static(UPLOADS_DIR));

// Health check — deve vir antes de qualquer router com prefixo genérico /api
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// Rotas — ordem importa: rotas com prefixo específico primeiro,
// rotas genéricas (/api) depois para evitar que authMiddleware bloqueie rotas públicas
app.use('/api/auth', authRoutes);
app.use('/api/compartilhamento', compartilhamentoRoutes); // público — ANTES de routers com authMiddleware global
app.use('/api/integracao/iapro', integracaoIaproRoutes);  // server-to-server IAPRO (API key própria)
app.use('/api/worker', workerRoutes);                     // server-to-server worker de multas (WORKER_API_KEY)
app.use('/api/iapro', iaproRoutes);                       // tela IAPRO do painel admin (JWT)
app.use('/api/clientes', clientesRoutes);
app.use('/api/carnes', carnesRoutes);
app.use('/api/boletos', boletosRoutes);
app.use('/api', efiRoutes);               // webhook público — antes de routers com authMiddleware
// webhooksRoutes já registrado antes do express.json() no topo
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/vendedor', vendedorRoutes);   // deve vir antes de app.use('/api', usuariosRoutes)
app.use('/api/configuracoes', configuracoesRoutes);
app.use('/api/contratos', contratosRoutes);
app.use('/api', placasRoutes);             // authMiddleware global no router
app.use('/api/dispositivos', dispositivosRoutes);
app.use('/api', usuariosRoutes);           // colaboradores + vendedores (authMiddleware global ADMIN)
app.use('/api', adminRoutes);              // rotas admin utilitárias
app.use('/api/rastreamento', rastreamentoRoutes);
app.use('/api/motoristas', motoristasRoutes);
app.use('/api/clientes', clienteLoginRoutes);   // CRUD do login do cliente (admin/colaborador)
app.use('/api/cliente/notificacoes', notificacoesRoutes);    // Notificações do cliente
app.use('/api/notificacoes-admin', notificacoesAdminRoutes); // Notificações admin
app.use('/api/cliente/manutencoes', manutencoesRoutes);      // Manutenções do cliente
app.use('/api/manutencoes-admin', manutencoesAdminRoutes);   // Manutenções admin
app.use('/api/cliente/perfil', clientePerfilRoutes); // Perfil do cliente
app.use('/api/cliente/cotacao-iapro', clienteCotacaoIaproRoutes); // Cotação IAPRO — antes de clientePortalRoutes
app.use('/api/cliente', clienteUsuariosRoutes); // Sub-usuários + /me/permissoes — antes de clientePortalRoutes
app.use('/api/cliente', clientePortalRoutes);   // portal do cliente (JWT role=CLIENTE)
app.use('/api', usuariosResgateRoutes); // CRUD admin de usuários de resgate
app.use('/api', tagsBleRoutes);         // CRUD de tags BLE (admin)
app.use('/api', appResgateRoutes);      // endpoints do app para resgate e admin pareador

// Rota não encontrada
app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

export default app;
