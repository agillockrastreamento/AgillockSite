'use strict';

import prisma from '../utils/prisma';

/**
 * ⭐ **Webhook para o Raposo Motors** (07/08/2026) — o que era polling.
 *
 * O Raposo perguntava de 20 em 20 minutos, uma chamada por placa: com 150
 * veículos são **450 chamadas por hora** para descobrir que quase nada mudou —
 * e mesmo assim o KM da tela dele ficava até 20 minutos atrasado. Caro e
 * desatualizado ao mesmo tempo.
 *
 * Aqui o sentido se inverte. A Ágil Lock já recebe as posições em tempo real
 * pelo WebSocket do Traccar; é de lá que o KM sai, no instante em que a moto
 * anda. Duas naturezas de evento, dois tratamentos:
 *
 * - **KM vai em lote.** Cada moto emite posição a cada poucos segundos; um
 *   webhook por posição seria muito pior que o polling. As placas cujo odômetro
 *   mudou se acumulam em memória e descarregam **uma chamada a cada 60 s** com
 *   o lote inteiro: 60 chamadas por hora, independente do tamanho da frota, e
 *   no máximo um minuto de atraso.
 * - **Manutenção vai na hora.** Recorrência criada, editada, desativada ou
 *   marcada feita, e registro criado. São raros e cada um importa.
 *
 * Tudo passa pelo **outbox** (`WebhookRaposoEvento`): grava primeiro, entrega
 * depois, com retentativa e backoff. Um deploy do Raposo não perde evento.
 *
 * 🔴 **Nasce desligado e fecha por padrão.** Sem `RAPOSO_WEBHOOK_ATIVO=true`,
 * URL e segredo, nada é gravado nem enviado. E `RAPOSO_WEBHOOK_CLIENTE_IDS`
 * delimita **de quem** são os veículos que o Raposo pode receber: sem essa
 * lista, nenhum evento sai. A frota da Ágil Lock é de vários clientes, e a
 * integração é com um só.
 */

/** De quanto em quanto tempo o KM acumulado é descarregado num evento. */
const INTERVALO_LOTE_KM_MS = 60_000;
/** De quanto em quanto tempo o worker procura o que entregar. */
const INTERVALO_WORKER_MS = 15_000;
/** Eventos por rodada do worker. */
const POR_RODADA = 25;
/**
 * Depois disto o evento é dado por perdido (≈ 6 h de tentativas com o backoff
 * abaixo). Não é buraco: o job diário de reconciliação do Raposo relê tudo por
 * placa e conserta o que o webhook não entregou.
 */
const MAX_TENTATIVAS = 12;
const TEMPO_LIMITE_MS = 20_000;

export function webhookRaposoAtivo(): boolean {
  return (
    process.env.RAPOSO_WEBHOOK_ATIVO === 'true' &&
    !!process.env.RAPOSO_WEBHOOK_URL &&
    !!process.env.RAPOSO_WEBHOOK_SECRET
  );
}

/** Ids dos clientes cuja frota o Raposo pode receber. Vazio = ninguém. */
function clientesDaRaposo(): string[] {
  return (process.env.RAPOSO_WEBHOOK_CLIENTE_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Filtra os dispositivos que interessam ao Raposo e devolve a placa de cada um
 * — a placa é a chave da integração (o Raposo não conhece nossos ids).
 */
async function dispositivosDaRaposo(ids: string[]): Promise<Map<string, string>> {
  const clientes = clientesDaRaposo();
  if (!ids.length || !clientes.length) return new Map();
  const dispositivos = await prisma.dispositivo.findMany({
    where: {
      id: { in: ids },
      ativo: true,
      placa: { not: null },
      OR: [
        { clienteId: { in: clientes } },
        { clientesVinculados: { some: { clienteId: { in: clientes } } } },
      ],
    },
    select: { id: true, placa: true },
  });
  return new Map(dispositivos.filter(d => d.placa).map(d => [d.id, d.placa as string]));
}

async function gravarEvento(tipo: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await prisma.webhookRaposoEvento.create({ data: { tipo, payload: payload as any } });
  } catch (err) {
    // Falhar aqui não pode derrubar a operação que gerou o evento: quem marcou
    // a manutenção como feita fez o trabalho dele, e a reconciliação diária do
    // Raposo é a rede embaixo.
    console.error('[webhook-raposo] falha ao gravar evento no outbox:', err);
  }
}

// ── KM em lote ────────────────────────────────────────────────────────────────

/** dispositivoId → odômetro em metros, mais recente visto desde o último lote. */
const kmPendente = new Map<string, number>();

/**
 * Chamado a cada posição processada (traccar.ws). Só acumula em memória — é
 * barato de propósito, roda no caminho quente do WebSocket.
 */
export function registrarKmDoDispositivo(dispositivoId: string, odometroMetros: number | null | undefined): void {
  if (!webhookRaposoAtivo()) return;
  if (odometroMetros == null || !Number.isFinite(odometroMetros)) return;
  const anterior = kmPendente.get(dispositivoId);
  // Odômetro é monotônico: guardar o maior evita que um pacote atrasado do
  // Traccar (eles chegam fora de ordem) faça o KM do Raposo andar para trás.
  if (anterior == null || odometroMetros > anterior) kmPendente.set(dispositivoId, odometroMetros);
}

async function descarregarLoteKm(): Promise<void> {
  if (!webhookRaposoAtivo() || kmPendente.size === 0) return;
  const lote = Array.from(kmPendente.entries());
  kmPendente.clear();

  try {
    const placas = await dispositivosDaRaposo(lote.map(([id]) => id));
    if (!placas.size) return;
    const veiculos = lote
      .filter(([id]) => placas.has(id))
      .map(([id, metros]) => ({ placa: placas.get(id) as string, km: Math.round(metros / 1000), odometroMetros: metros }));
    if (!veiculos.length) return;
    await gravarEvento('km.lote', { veiculos, medidoEm: new Date().toISOString() });
  } catch (err) {
    console.error('[webhook-raposo] falha ao montar o lote de KM:', err);
  }
}

// ── Eventos de manutenção ─────────────────────────────────────────────────────

export type TipoEventoManutencao =
  | 'recorrencia.criada'
  | 'recorrencia.editada'
  | 'recorrencia.desativada'
  | 'recorrencia.feita'
  | 'recorrenciaData.criada'
  | 'recorrenciaData.editada'
  | 'recorrenciaData.desativada'
  | 'recorrenciaData.feita'
  | 'registro.criado';

/**
 * Empurra um evento de manutenção ao Raposo, na hora.
 *
 * 🔴 **Não chame nas rotas da própria integração** (`integracao-raposo.routes`):
 * o que veio do Raposo não volta para ele. Sem essa regra, criar um plano lá
 * geraria um evento de volta que criaria... o mesmo plano — e o ping-pong só
 * pararia porque a idempotência do outro lado o segura, que é sorte, não
 * desenho.
 */
export function emitirEventoManutencao(
  dispositivoId: string,
  tipo: TipoEventoManutencao,
  dados: Record<string, unknown>,
): void {
  if (!webhookRaposoAtivo()) return;
  void (async () => {
    try {
      const placas = await dispositivosDaRaposo([dispositivoId]);
      const placa = placas.get(dispositivoId);
      if (!placa) return;
      await gravarEvento(tipo, { placa, ocorridoEm: new Date().toISOString(), ...dados });
    } catch (err) {
      console.error('[webhook-raposo] falha ao emitir evento de manutenção:', err);
    }
  })();
}

type RecorrenciaKm = {
  id: string;
  dispositivoId: string;
  titulo: string;
  descricao?: string | null;
  intervaloKm: number;
  kmBase: number;
};

/**
 * O registro que o "feito" deixou. Vai junto no evento para o Raposo **fechar a
 * ocorrência ligada à manutenção certa** — e para não duplicá-la depois: a
 * reconciliação diária usa esse mesmo id como chave.
 */
export type RegistroDoFeito = {
  id: string;
  dataRealizacao?: Date;
  kmRealizacao?: number | null;
  custo?: unknown;
  oficina?: string | null;
};

/** Recorrência por KM criada, editada, desativada ou marcada feita. */
export function emitirRecorrenciaKm(
  tipo: 'criada' | 'editada' | 'desativada' | 'feita',
  rec: RecorrenciaKm,
  registro?: RegistroDoFeito,
): void {
  emitirEventoManutencao(rec.dispositivoId, `recorrencia.${tipo}`, {
    recorrenciaId: rec.id,
    titulo: rec.titulo,
    descricao: rec.descricao ?? null,
    intervaloKm: rec.intervaloKm,
    kmBase: rec.kmBase,
    ...(registro
      ? {
          registroId: registro.id,
          dataRealizacao: registro.dataRealizacao ?? null,
          kmRealizacao: registro.kmRealizacao ?? null,
          custo: registro.custo != null ? Number(registro.custo) : null,
          oficina: registro.oficina ?? null,
        }
      : {}),
  });
}

type RecorrenciaData = {
  id: string;
  dispositivoId: string;
  titulo: string;
  descricao?: string | null;
  tipoRecorrencia: string;
  dataReferencia: Date;
  intervaloDias?: number | null;
};

/** Recorrência por data criada, editada, desativada ou marcada feita. */
export function emitirRecorrenciaData(
  tipo: 'criada' | 'editada' | 'desativada' | 'feita',
  rec: RecorrenciaData,
  registro?: RegistroDoFeito,
): void {
  emitirEventoManutencao(rec.dispositivoId, `recorrenciaData.${tipo}`, {
    recorrenciaId: rec.id,
    titulo: rec.titulo,
    descricao: rec.descricao ?? null,
    tipoRecorrencia: rec.tipoRecorrencia,
    dataReferencia: rec.dataReferencia,
    intervaloDias: rec.intervaloDias ?? null,
    ...(registro
      ? {
          registroId: registro.id,
          dataRealizacao: registro.dataRealizacao ?? null,
          kmRealizacao: registro.kmRealizacao ?? null,
          custo: registro.custo != null ? Number(registro.custo) : null,
          oficina: registro.oficina ?? null,
        }
      : {}),
  });
}

/**
 * Registro de manutenção criado. Do outro lado ele vira uma `manutencao` de
 * origem IMPORTADO_AGILLOCK — histórico, sem lançamento financeiro. O dinheiro
 * é decisão do Raposo, e continua sendo.
 */
export function emitirRegistroCriado(reg: {
  id: string;
  dispositivoId: string;
  titulo: string;
  tipo: string;
  descricao?: string | null;
  dataRealizacao: Date;
  kmRealizacao?: number | null;
  custo?: unknown;
  oficina?: string | null;
}): void {
  emitirEventoManutencao(reg.dispositivoId, 'registro.criado', {
    registroId: reg.id,
    titulo: reg.titulo,
    tipo: reg.tipo,
    descricao: reg.descricao ?? null,
    dataRealizacao: reg.dataRealizacao,
    kmRealizacao: reg.kmRealizacao ?? null,
    custo: reg.custo != null ? Number(reg.custo) : null,
    oficina: reg.oficina ?? null,
  });
}

// ── Entrega (worker do outbox) ────────────────────────────────────────────────

/** 30 s, 1 min, 2 min… até um teto de 30 min. */
function proximaTentativa(tentativas: number): Date {
  const espera = Math.min(30_000 * 2 ** tentativas, 30 * 60_000);
  return new Date(Date.now() + espera);
}

async function entregar(evento: { id: string; tipo: string; payload: unknown }): Promise<'ok' | 'retentar' | 'desistir'> {
  const resposta = await fetch(String(process.env.RAPOSO_WEBHOOK_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agillock-secret': String(process.env.RAPOSO_WEBHOOK_SECRET),
    },
    body: JSON.stringify({ id: evento.id, tipo: evento.tipo, dados: evento.payload }),
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  });
  if (resposta.ok) return 'ok';
  /**
   * 400 e 422 são "este evento está errado" — repetir não conserta, e insistir
   * bloquearia a fila atrás dele. 401/403 são segredo errado: aí vale repetir,
   * porque a correção é do outro lado e vem sem novo deploy aqui.
   */
  if (resposta.status === 400 || resposta.status === 422) return 'desistir';
  throw new Error(`HTTP ${resposta.status}`);
}

export async function processarOutboxRaposo(): Promise<{ entregues: number }> {
  if (!webhookRaposoAtivo()) return { entregues: 0 };

  const pendentes = await prisma.webhookRaposoEvento.findMany({
    where: {
      entregueEm: null,
      desistiuEm: null,
      tentativas: { lt: MAX_TENTATIVAS },
      proximaTentativaEm: { lte: new Date() },
    },
    orderBy: { criadoEm: 'asc' },
    take: POR_RODADA,
  });

  let entregues = 0;
  for (const evento of pendentes) {
    try {
      const r = await entregar(evento);
      if (r === 'desistir') {
        await prisma.webhookRaposoEvento.update({
          where: { id: evento.id },
          data: { desistiuEm: new Date(), ultimoErro: 'Recusado pelo Raposo (payload inválido).' },
        });
        continue;
      }
      await prisma.webhookRaposoEvento.update({
        where: { id: evento.id },
        data: { entregueEm: new Date(), tentativas: { increment: 1 }, ultimoErro: null },
      });
      entregues++;
    } catch (err) {
      const tentativas = evento.tentativas + 1;
      await prisma.webhookRaposoEvento.update({
        where: { id: evento.id },
        data: {
          tentativas,
          proximaTentativaEm: proximaTentativa(tentativas),
          ultimoErro: String((err as Error)?.message ?? err).slice(0, 500),
          ...(tentativas >= MAX_TENTATIVAS ? { desistiuEm: new Date() } : {}),
        },
      });
      /**
       * 🔴 **Para a rodada no primeiro erro de rede.** Os eventos de um mesmo
       * veículo têm ordem — "editada" depois de "desativada" reabriria um plano
       * que o operador acabou de encerrar. Parar preserva a ordem e evita
       * martelar um destino que já está fora do ar.
       */
      break;
    }
  }
  return { entregues };
}

/**
 * Limpa o que já foi entregue há mais de 7 dias. O outbox é um caminho, não um
 * arquivo: o histórico de manutenção mora nas tabelas de manutenção.
 */
async function limparEntregues(): Promise<void> {
  const limite = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  try {
    await prisma.webhookRaposoEvento.deleteMany({
      where: { OR: [{ entregueEm: { lt: limite } }, { desistiuEm: { lt: limite } }] },
    });
  } catch (err) {
    console.error('[webhook-raposo] falha ao limpar o outbox:', err);
  }
}

let iniciado = false;

/** Sobe os dois relógios: o do lote de KM e o do worker de entrega. */
export function iniciarWebhookRaposo(): void {
  if (iniciado) return;
  iniciado = true;

  if (!webhookRaposoAtivo()) {
    console.log('[webhook-raposo] desligado (RAPOSO_WEBHOOK_ATIVO != true) — nada será enviado ao Raposo.');
    return;
  }
  if (!clientesDaRaposo().length) {
    console.warn(
      '[webhook-raposo] ligado, mas RAPOSO_WEBHOOK_CLIENTE_IDS está vazio: nenhum veículo se qualifica e nenhum evento sairá.',
    );
  }
  console.log(`[webhook-raposo] ligado → ${process.env.RAPOSO_WEBHOOK_URL} (lote de KM a cada ${INTERVALO_LOTE_KM_MS / 1000}s).`);

  setInterval(() => {
    void descarregarLoteKm();
  }, INTERVALO_LOTE_KM_MS).unref?.();

  setInterval(() => {
    void processarOutboxRaposo().catch(err => console.error('[webhook-raposo] worker:', err));
  }, INTERVALO_WORKER_MS).unref?.();

  setInterval(
    () => {
      void limparEntregues();
    },
    6 * 60 * 60 * 1000,
  ).unref?.();
}
