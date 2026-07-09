import 'dotenv/config';
import http from 'http';
import app from './app';
import { initTraccarWebSocket, broadcastTrackingEvents } from './services/traccar.ws';
import FinanceiroNotificationService from './services/financeiro-notification.service';
import ContratoClicksignSyncService from './services/contrato-clicksign-sync.service';
import NotificationService from './services/notification.service';
import { iniciarConsultaLote } from './services/multas.service';

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

// Verifica veículos sem atualização de posição (limite de horas é escolha do usuário/admin;
// primeira checagem 2 min após o boot, depois a cada 30 min)
function agendarSemAtualizacao(delayMs: number) {
  setTimeout(() => {
    NotificationService.verificarDispositivosSemAtualizacao()
      .then(evts => { if (evts.length) broadcastTrackingEvents(evts); })
      .catch(err => console.error('[Scheduler] Erro ao verificar veículos sem atualização:', err))
      .finally(() => agendarSemAtualizacao(30 * 60 * 1000));
  }, delayMs);
}

agendarSemAtualizacao(2 * 60 * 1000);

// Consulta de multas (Detran): 2x/dia às 10h e 17h (America/Sao_Paulo). Ver docs/multas/SCHEDULER.md.
const HORARIOS_MULTAS = [10, 17];
function proximaExecucaoMultas(): Date {
  const agora = new Date();
  const dataSp = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const candidatos = HORARIOS_MULTAS.map((h) => new Date(`${dataSp}T${String(h).padStart(2, '0')}:00:00-03:00`));
  const futuro = candidatos.find((d) => d > agora);
  const base = candidatos[0] ?? agora;
  return futuro ?? new Date(base.getTime() + 24 * 60 * 60 * 1000);
}
function agendarConsultaMultas() {
  const proxima = proximaExecucaoMultas();
  const delay = Math.max(1000, proxima.getTime() - Date.now());
  console.log(`[Multas] Proxima consulta automatica agendada para ${proxima.toISOString()} (10h/17h America/Sao_Paulo).`);
  setTimeout(() => {
    iniciarConsultaLote('AGENDADA')
      .then((r) =>
        console.log(
          `[Multas] Lote iniciado (log ${r.logId}): ${r.elegiveis} veículo(s); ${r.ignorados} ignorado(s) por falta de renavam/chassi.`,
        ),
      )
      .catch((err) => console.error('[Multas] Erro ao iniciar lote:', err))
      .finally(agendarConsultaMultas);
  }, delay);
}
agendarConsultaMultas();

httpServer.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
