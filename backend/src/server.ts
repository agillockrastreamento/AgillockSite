import 'dotenv/config';
import http from 'http';
import app from './app';
import { initTraccarWebSocket } from './services/traccar.ws';
import FinanceiroNotificationService from './services/financeiro-notification.service';
import ContratoClicksignSyncService from './services/contrato-clicksign-sync.service';
import NotificationService from './services/notification.service';

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(app);

initTraccarWebSocket(httpServer);
FinanceiroNotificationService.iniciarAgendador();
ContratoClicksignSyncService.iniciarAgendador();

// Verifica recorrências por data a cada hora
setInterval(() => {
  NotificationService.verificarRecorrenciasDataTodas().catch(err =>
    console.error('[Scheduler] Erro ao verificar recorrências por data:', err)
  );
}, 60 * 60 * 1000);
// Executa imediatamente ao iniciar
setTimeout(() => {
  NotificationService.verificarRecorrenciasDataTodas().catch(err =>
    console.error('[Scheduler] Erro ao verificar recorrências por data:', err)
  );
}, 5000);

httpServer.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
