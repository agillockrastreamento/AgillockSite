# Scheduler — consulta automática 2×/dia

## Requisito
Consultar automaticamente a situação dos veículos dos clientes habilitados **duas vezes por dia: 10h e 17h** (horário de Brasília, `America/Sao_Paulo`).

## Padrão do projeto
O backend usa `setTimeout` recursivo que calcula a próxima execução em horário de SP (ver `server.ts`: `proximaExecucaoRecorrenciasData` e `agendarRecorrenciasData`, e `FinanceiroNotificationService.iniciarAgendador`). Vamos seguir o mesmo padrão — **sem** adicionar dependência de cron.

## Implementação proposta

`backend/src/services/multas-scheduler.ts` (ou dentro de `multas.service.ts`):

```ts
const HORARIOS = [10, 17]; // horas, America/Sao_Paulo

function proximaExecucaoMultas(): Date {
  const agora = new Date();
  const dataSp = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  // monta candidatos de hoje (10:00 e 17:00 -03:00) e pega o primeiro > agora;
  // se nenhum, usa 10:00 de amanhã
  const candidatos = HORARIOS.map(h =>
    new Date(`${dataSp}T${String(h).padStart(2,'0')}:00:00-03:00`)
  );
  const futuro = candidatos.find(d => d > agora);
  return futuro ?? new Date(candidatos[0].getTime() + 24*60*60*1000);
}

function agendarConsultaMultas() {
  const proxima = proximaExecucaoMultas();
  const delay = Math.max(1000, proxima.getTime() - Date.now());
  console.log(`[MultasScheduler] Próxima consulta: ${proxima.toISOString()}`);
  setTimeout(() => {
    MultasService.consultarTodosHabilitados('AGENDADA')
      .catch(err => console.error('[MultasScheduler] erro:', err))
      .finally(agendarConsultaMultas);
  }, delay);
}

export function iniciarSchedulerMultas() { agendarConsultaMultas(); }
```

Chamar `iniciarSchedulerMultas()` em `server.ts`, junto dos outros agendadores.

> ⚠️ Atenção a fuso/horário de verão: o Brasil atualmente não tem horário de verão, então `-03:00` é fixo. Se voltar a ter, trocar a montagem fixa `-03:00` por uma conversão via `Intl`/biblioteca.

## Execução em lote (`consultarTodosHabilitados`)

```
1. Cria ConsultaMultaLog { origem, inicioEm, status: "EM_ANDAMENTO" }
2. Busca dispositivos de clientes com multasHabilitado=true e com renavam/chassi
3. Para cada dispositivo (sequencial, com pequeno delay ~1–3s entre eles):
     try:
       resultado = consultarVeiculo(dispositivo)   // fluxo Detran completo
       persiste situação + multas + pré-gera Pix/boleto (todas)
       acumula sucesso, soma multasColetadas
     catch e:
       marca situação ultimaConsultaStatus="ERRO"; acumula erro
4. Fecha o log: fimEm, duracaoMs, status (OK/PARCIAL/ERRO) e contadores
```

- **Sequencial + delay** para não sobrecarregar o Detran nem ser bloqueado. (Se o volume crescer muito, avaliar concorrência limitada, ex. 2–3 simultâneas.)
- **Falha isolada por veículo:** erro em um veículo não interrompe o lote.
- **Status do log:** `OK` (todos sucesso), `PARCIAL` (alguns erros), `ERRO` (nenhum sucesso / falha geral).

## O que cada consulta de veículo grava
- **Antes** do delete+insert: captura o conjunto de AITs já no banco (para detectar multas novas — ver [NOTIFICACOES](NOTIFICACOES.md)).
- Atualiza `VeiculoMultaSituacao`: `qtdMultas`, `valorTotal`, `possuiDebitoIpva`, `licenciamentoPendente`, `ultimaConsultaEm`, `ultimaConsultaStatus`.
- Substitui os `Multa` (delete+insert em transação).
- Pré-gera o extrato **de todas as multas**: `pixEmv`, `pixQrCodeBase64`, `boletoArquivo` (salvo em `/uploads/multas/<dispositivoId>/`).
- Dispara notificações ao **cliente**: `multaNova` (se houve AIT inédita), `multaVencimento7dias` e `multaVencimentoHoje` (com dedup por `NotificacaoMultaEnvio`).

## Notificação ao admin (fim do lote)
Ao fechar o `ConsultaMultaLog`, emitir 1 evento ao admin (`adminEvento=true`):
- `consultaMultasConcluida` (OK/PARCIAL) com o resumo (multas coletadas, nº clientes/veículos, duração).
- `consultaMultasErro` (falha geral).
Vale tanto para a execução agendada quanto para a manual. Ver [NOTIFICACOES](NOTIFICACOES.md).

## Métricas para a aba de histórico (admin)
Tudo já vem do `ConsultaMultaLog`: horário (`inicioEm`), se ocorreu tudo bem (`status`), quanto tempo levou (`duracaoMs`), quantas multas foram coletadas (`multasColetadas`), de quantos clientes/veículos (`clientesConsultados`, `veiculosConsultados`, `veiculosComSucesso/Erro`).

## Execução manual
`POST /api/multas/consultar-todos` chama a mesma função com `origem="MANUAL_ADMIN"`, permitindo ao admin forçar uma rodada fora do horário.
