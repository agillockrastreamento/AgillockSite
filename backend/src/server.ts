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

function proximaExecucaoRecorrenciasData(): Date {
  const agora = new Date();
  const dataSp = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  let alvo = new Date(`${dataSp}T08:00:00-03:00`);
  if (alvo <= agora) {
    alvo = new Date(alvo.getTime() + 24 * 60 * 60 * 1000);
  }
  return alvo;
}

function agendarRecorrenciasData() {
  const proxima = proximaExecucaoRecorrenciasData();
  const delay = Math.max(1000, proxima.getTime() - Date.now());
  console.log(`[Scheduler] Recorrencias por data agendadas para ${proxima.toISOString()} (08:00 America/Sao_Paulo).`);
  setTimeout(() => {
    NotificationService.verificarRecorrenciasDataTodas()
      .catch(err => console.error('[Scheduler] Erro ao verificar recorrencias por data:', err))
      .finally(agendarRecorrenciasData);
  }, delay);
}

agendarRecorrenciasData();

httpServer.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
