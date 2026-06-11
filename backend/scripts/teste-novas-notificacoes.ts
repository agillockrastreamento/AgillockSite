// Teste manual da máquina de estados das novas notificações (sem banco):
// usa dispositivo sem clientes vinculados para validar apenas a detecção.
import NotificationService from '../src/services/notification.service';

const svc: any = NotificationService;

function disp(id: string) {
  return { id, telemetriaUltimaIgnicao: null, cliente: null, clientesVinculados: [] };
}

let falhas = 0;
function check(nome: string, cond: boolean) {
  console.log(`${cond ? 'OK  ' : 'FALHA'} ${nome}`);
  if (!cond) falhas++;
}

async function main() {
  // ── 1) Veículo em movimento ──────────────────────────────────────────────
  // primeiro pacote: parado (apenas registra estado, não notifica)
  await svc.verificarEventosPosicao('MOV1', disp('d1'), { ignicao: false, emMovimento: false, velocidade: 0, alarme: null });
  check('movimento: estado inicial parado registrado', svc._lastMotionState.get('d1') === false);
  check('movimento: sem alerta no primeiro pacote', !svc._lastMovementAt.has('d1'));

  // segundo pacote: movendo com ignição desligada → deve detectar início de movimento
  await svc.verificarEventosPosicao('MOV1', disp('d1'), { ignicao: false, emMovimento: true, velocidade: 12, alarme: null });
  check('movimento: transição parado→movendo detectada (ignição desligada)', svc._lastMovementAt.has('d1'));

  // terceiro pacote: para e volta a se mover dentro do cooldown → não re-dispara
  const marcaCooldown = svc._lastMovementAt.get('d1');
  await svc.verificarEventosPosicao('MOV1', disp('d1'), { ignicao: false, emMovimento: false, velocidade: 0, alarme: null });
  await svc.verificarEventosPosicao('MOV1', disp('d1'), { ignicao: false, emMovimento: true, velocidade: 15, alarme: null });
  check('movimento: cooldown de 5 min respeitado', svc._lastMovementAt.get('d1') === marcaCooldown);

  // fallback sem atributo motion: usa velocidade >= 5 km/h
  await svc.verificarEventosPosicao('MOV2', disp('d2'), { ignicao: true, emMovimento: null, velocidade: 0, alarme: null });
  await svc.verificarEventosPosicao('MOV2', disp('d2'), { ignicao: true, emMovimento: null, velocidade: 40, alarme: null });
  check('movimento: fallback por velocidade funciona', svc._lastMovementAt.has('d2'));

  // ── 2) Motor ocioso ──────────────────────────────────────────────────────
  // ignição ligada + parado → inicia contagem
  await svc.verificarEventosPosicao('OCI1', disp('d3'), { ignicao: true, emMovimento: false, velocidade: 0, alarme: null });
  check('ocioso: contagem iniciada com ignição ligada e parado', svc._idleState.has('d3') && svc._idleState.get('d3').notificado === false);

  // antes de 5 min → não notifica
  await svc.verificarEventosPosicao('OCI1', disp('d3'), { ignicao: true, emMovimento: false, velocidade: 0, alarme: null });
  check('ocioso: não notifica antes de 5 min', svc._idleState.get('d3').notificado === false);

  // simula 6 min parado → notifica
  svc._idleState.get('d3').desde = Date.now() - 6 * 60_000;
  await svc.verificarEventosPosicao('OCI1', disp('d3'), { ignicao: true, emMovimento: false, velocidade: 0, alarme: null });
  check('ocioso: notifica após exceder 5 min', svc._idleState.get('d3').notificado === true);

  // segue parado → não re-notifica (flag permanece, sem reset)
  await svc.verificarEventosPosicao('OCI1', disp('d3'), { ignicao: true, emMovimento: false, velocidade: 0, alarme: null });
  check('ocioso: não re-notifica enquanto continua parado', svc._idleState.get('d3').notificado === true);

  // volta a se mover → reseta estado
  await svc.verificarEventosPosicao('OCI1', disp('d3'), { ignicao: true, emMovimento: true, velocidade: 30, alarme: null });
  check('ocioso: reset ao voltar a se mover', !svc._idleState.has('d3'));

  // ignição desligada enquanto parado → reseta estado (não é ocioso)
  await svc.verificarEventosPosicao('OCI2', disp('d4'), { ignicao: true, emMovimento: false, velocidade: 0, alarme: null });
  await svc.verificarEventosPosicao('OCI2', disp('d4'), { ignicao: false, emMovimento: false, velocidade: 0, alarme: null });
  check('ocioso: reset ao desligar a ignição', !svc._idleState.has('d4'));

  // ── 3) Mensagens e labels ────────────────────────────────────────────────
  const msgMov = svc.gerarMensagem('veiculoMovimento', 'Carro Teste', 'ABC1D23', { ignicao: false });
  check('mensagem movimento começa com o label (tipoLabel via split ":")', msgMov.startsWith('Veículo em Movimento:'));
  check('mensagem movimento menciona ignição desligada', msgMov.includes('ignição desligada'));
  const msgOci = svc.gerarMensagem('motorOcioso', 'Carro Teste', 'ABC1D23', { ociosoMinutos: 7 });
  check('mensagem ocioso com minutos', msgOci.startsWith('Motor Ocioso:') && msgOci.includes('7 minutos'));
  const msgSem = svc.gerarMensagem('semAtualizacao', 'Carro Teste', null, { horasSemAtualizacao: 5 });
  check('mensagem sem atualização com horas', msgSem.startsWith('Veículo sem Atualização:') && msgSem.includes('5 horas'));
  check('label veiculoMovimento', svc.getLabelTipo('veiculoMovimento') === 'Veículo em Movimento');
  check('label motorOcioso', svc.getLabelTipo('motorOcioso') === 'Motor Ocioso');
  check('label semAtualizacao', svc.getLabelTipo('semAtualizacao') === 'Veículo sem Atualização');

  console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} TESTE(S) FALHARAM`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
