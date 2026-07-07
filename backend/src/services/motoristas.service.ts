import prisma from '../utils/prisma';
import type { TraccarPosition } from './traccar.service';
import { cartaoDaPosicao } from './traccar.service';

// O leitor RFID (SGBRAS) envia o número do cartão do motorista via serial/1-wire
// ao rastreador, que o repassa ao Traccar no atributo `driverUniqueId`. Quando o
// pós-chave está ligado sem cartão aproximado (ou na string de fim de jornada), o
// rastreador envia um id composto apenas de zeros — que NÃO corresponde a motorista.
export function idMotoristaVazio(id: string | null | undefined): boolean {
  return !id || /^0+$/.test(String(id).trim());
}

// Normaliza o identificador para tolerar diferenças de padding (zeros à esquerda)
// e caixa do hexadecimal entre o valor recebido do rastreador e o cadastrado no
// motorista. NÃO converte decimal↔hexadecimal — são formatos incompatíveis que
// dependem da configuração do leitor (ver ManualDispositivoRFID.pdf, protocolos).
function normalizarIdentificador(id: string): string {
  return String(id).trim().replace(/^0+/, '').toUpperCase();
}

export interface MotoristaResumo { id: string; nome: string; cnh: string | null; }
export type ResolvedorMotorista = (driverUniqueId: string | null | undefined) => MotoristaResumo | null;

// Carrega um resolvedor driverUniqueId → Motorista a partir do cadastro local,
// já indexado. Deve ser chamado uma vez por request e reutilizado.
export async function carregarResolvedorMotoristas(): Promise<ResolvedorMotorista> {
  const motoristas = await prisma.motorista.findMany({
    where: { identificador: { not: null } },
    select: { id: true, nome: true, cnh: true, identificador: true },
  });
  const porIdentificador = new Map<string, MotoristaResumo>();
  for (const m of motoristas) {
    if (!m.identificador) continue;
    porIdentificador.set(normalizarIdentificador(m.identificador), { id: m.id, nome: m.nome, cnh: m.cnh });
  }
  return (driverUniqueId) => {
    if (idMotoristaVazio(driverUniqueId)) return null;
    return porIdentificador.get(normalizarIdentificador(driverUniqueId!)) ?? null;
  };
}

function tempoPosicaoMs(posicao: TraccarPosition): number | null {
  const raw = posicao.deviceTime || posicao.fixTime || posicao.serverTime;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

// Determina o cartão de motorista de uma viagem. O leitor SGBRAS só envia o cartão
// no login/logout da jornada (não em toda posição), e esse evento costuma cair um
// pouco ANTES do início do trecho de movimento detectado pelo Traccar. Por isso
// usa-se o cartão do evento mais recente com tempo ≤ fim da viagem (o motorista que
// estava logado durante o trecho). Fallback para `driverUniqueId` (1-wire) se vier.
export function cartaoDaViagem(
  viagem: { driverUniqueId?: string | null; startTime: string; endTime: string },
  posicoes: TraccarPosition[],
): string | null {
  if (!idMotoristaVazio(viagem.driverUniqueId)) return viagem.driverUniqueId!;
  return cartaoAntesDe(posicoes, new Date(viagem.endTime).getTime());
}

// Cartão do motorista em efeito num instante: o evento de cartão (serial) mais
// recente com tempo ≤ ateMs. Usado para viagens e para eventos (ex.: driverChanged).
export function cartaoAntesDe(posicoes: TraccarPosition[], ateMs: number): string | null {
  let melhor: { t: number; cartao: string } | null = null;
  for (const posicao of posicoes) {
    const t = tempoPosicaoMs(posicao);
    if (t == null || t > ateMs) continue;
    const cartao = cartaoDaPosicao(posicao.attributes);
    if (!cartao) continue;
    if (!melhor || t > melhor.t) melhor = { t, cartao: cartao.cartao };
  }
  return melhor?.cartao ?? null;
}
