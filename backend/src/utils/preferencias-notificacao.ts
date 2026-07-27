import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { periodoKmOuPadrao } from '../services/notification.service';

export type CanaisPreferencia = { web: boolean; app: boolean; email: boolean };

export type ExtrasPreferencia = {
  overspeedLimit?: number | null;
  kmTrocaOleo?: number | null;
  semAtualizacaoHoras?: number | null;
  kmExcedida?: {
    kmMaximo30Dias?: number | null;
    diaRenovacaoMes?: number | null;
    diaSemanaRenovacao?: number | null;
    periodo?: string | null;
  } | null;
  kmReduzida?: {
    kmMinimo7Dias?: number | null;
    diaSemanaRenovacao?: number | null;
    diaRenovacaoMes?: number | null;
    periodo?: string | null;
  } | null;
};

// Colunas que cada tipo grava além dos canais. Um tipo só pode tocar nas suas:
// se todos escrevessem em todas, salvar "ignitionOn" apagaria a configuração de
// quilometragem. Os nomes são fixos aqui (nunca vêm do corpo da requisição).
const COLUNAS_POR_TIPO: Record<string, string[]> = {
  overspeed: ['overspeedLimit'],
  kmExcedida: ['kmMaximo30Dias', 'diaRenovacaoMes', 'diaSemanaRenovacao', 'kmPeriodo'],
  kmReduzida: ['kmMinimo7Dias', 'diaSemanaRenovacao', 'diaRenovacaoMes', 'kmPeriodo'],
  trocaOleo: ['kmTrocaOleo'],
  semAtualizacao: ['semAtualizacaoHoras'],
};

function valoresExtras(tipo: string, extras: ExtrasPreferencia): Record<string, unknown> {
  if (tipo === 'overspeed') {
    return { overspeedLimit: extras.overspeedLimit ?? 100 };
  }
  if (tipo === 'kmExcedida') {
    return {
      kmMaximo30Dias: extras.kmExcedida?.kmMaximo30Dias ?? null,
      diaRenovacaoMes: extras.kmExcedida?.diaRenovacaoMes ?? null,
      diaSemanaRenovacao: extras.kmExcedida?.diaSemanaRenovacao ?? null,
      kmPeriodo: periodoKmOuPadrao(extras.kmExcedida?.periodo, 'kmExcedida'),
    };
  }
  if (tipo === 'kmReduzida') {
    return {
      kmMinimo7Dias: extras.kmReduzida?.kmMinimo7Dias ?? null,
      diaSemanaRenovacao: extras.kmReduzida?.diaSemanaRenovacao ?? null,
      diaRenovacaoMes: extras.kmReduzida?.diaRenovacaoMes ?? null,
      kmPeriodo: periodoKmOuPadrao(extras.kmReduzida?.periodo, 'kmReduzida'),
    };
  }
  if (tipo === 'trocaOleo') {
    return { kmTrocaOleo: extras.kmTrocaOleo ?? null };
  }
  if (tipo === 'semAtualizacao') {
    return { semAtualizacaoHoras: extras.semAtualizacaoHoras ?? 3 };
  }
  return {};
}

// Teto de linhas por statement. O Postgres aceita 65535 parâmetros por query e
// cada linha usa até ~8 — 500 deixa folga larga e mantém o SQL curto.
const LINHAS_POR_STATEMENT = 500;

/**
 * Grava as preferências de notificação de vários dispositivos de uma vez.
 *
 * Usa INSERT ... ON CONFLICT em massa (um statement por tipo de evento) em vez
 * de um upsert por linha. Com 300 veículos eram ~5 mil upserts numa transação
 * interativa só, que estourava o timeout de 5 s do Prisma (P2028) e devolvia
 * "Erro ao salvar preferências" — agora são poucos statements e leva ~2 s.
 *
 * Cada tipo é gravado numa transação própria: se algo falhar no meio, os tipos
 * já gravados permanecem e basta salvar de novo (a operação é idempotente).
 */
export async function salvarPreferenciasEmMassa(params: {
  clienteLoginId: string;
  dispositivoIds: string[];
  preferencias: Record<string, CanaisPreferencia>;
  extras: ExtrasPreferencia;
}): Promise<number> {
  const { clienteLoginId, dispositivoIds, preferencias, extras } = params;
  if (!dispositivoIds.length) return 0;

  let linhasGravadas = 0;

  for (const tipo of Object.keys(preferencias)) {
    const canais = preferencias[tipo];
    if (!canais) continue;

    const extrasDoTipo = valoresExtras(tipo, extras);
    const nomesExtras = COLUNAS_POR_TIPO[tipo] ?? [];
    const colunasExtras = nomesExtras.map((n) => Prisma.raw(`"${n}"`));
    const atualizaExtras = nomesExtras.map((n) => Prisma.raw(`"${n}" = EXCLUDED."${n}"`));

    for (let i = 0; i < dispositivoIds.length; i += LINHAS_POR_STATEMENT) {
      const fatia = dispositivoIds.slice(i, i + LINHAS_POR_STATEMENT);

      const linhas = fatia.map((dispositivoId) => {
        const valores = [
          Prisma.sql`gen_random_uuid()`,
          Prisma.sql`${clienteLoginId}`,
          Prisma.sql`${dispositivoId}`,
          Prisma.sql`${tipo}`,
          Prisma.sql`${canais.web === true}`,
          Prisma.sql`${canais.app === true}`,
          Prisma.sql`${canais.email === true}`,
          ...nomesExtras.map((n) => Prisma.sql`${extrasDoTipo[n] ?? null}`),
          Prisma.sql`NOW()`,
        ];
        return Prisma.sql`(${Prisma.join(valores)})`;
      });

      linhasGravadas += await prisma.$executeRaw`
        INSERT INTO "PreferenciaNotificacao" (
          id, "clienteLoginId", "dispositivoId", "tipoEvento", web, app, email
          ${colunasExtras.length ? Prisma.sql`, ${Prisma.join(colunasExtras)}` : Prisma.empty}
          , "updatedAt"
        )
        VALUES ${Prisma.join(linhas)}
        ON CONFLICT ("clienteLoginId", "dispositivoId", "tipoEvento") DO UPDATE SET
          web = EXCLUDED.web,
          app = EXCLUDED.app,
          email = EXCLUDED.email
          ${atualizaExtras.length ? Prisma.sql`, ${Prisma.join(atualizaExtras)}` : Prisma.empty}
          , "updatedAt" = NOW()
      `;
    }
  }

  return linhasGravadas;
}
