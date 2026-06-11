import 'dotenv/config';
import http from 'http';
import app from './app';
import { initTraccarWebSocket, broadcastTrackingEvents } from './services/traccar.ws';
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

// Verifica veículos sem atualização de posição há 3h+ (primeira checagem 2 min após o boot, depois a cada 30 min)
function agendarSemAtualizacao(delayMs: number) {
  setTimeout(() => {
    NotificationService.verificarDispositivosSemAtualizacao()
      .then(evts => { if (evts.length) broadcastTrackingEvents(evts); })
      .catch(err => console.error('[Scheduler] Erro ao verificar veículos sem atualização:', err))
      .finally(() => agendarSemAtualizacao(30 * 60 * 1000));
  }, delayMs);
}

agendarSemAtualizacao(2 * 60 * 1000);

httpServer.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
