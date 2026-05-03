import 'dotenv/config';
import http from 'http';
import app from './app';
import { initTraccarWebSocket } from './services/traccar.ws';
import FinanceiroNotificationService from './services/financeiro-notification.service';
import ContratoClicksignSyncService from './services/contrato-clicksign-sync.service';

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(app);

initTraccarWebSocket(httpServer);
FinanceiroNotificationService.iniciarAgendador();
ContratoClicksignSyncService.iniciarAgendador();

httpServer.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
