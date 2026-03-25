import express from 'express';
import cors from 'cors';
import path from 'path';
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

const app = express();

// CORS
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5500').split(',');
app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições sem origin (Postman, curl) em desenvolvimento
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
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
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

// Health check — deve vir antes de qualquer router com prefixo genérico /api
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// Rotas — ordem importa: rotas com prefixo específico primeiro,
// rotas genéricas (/api) depois para evitar que authMiddleware bloqueie rotas públicas
app.use('/api/auth', authRoutes);
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

// Rota não encontrada
app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

export default app;
