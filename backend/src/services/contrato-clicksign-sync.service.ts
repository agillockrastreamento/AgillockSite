import prisma from '../utils/prisma';
import * as clicksign from './clicksign.service';

const TZ = 'America/Sao_Paulo';

type SyncResultado = {
  contrato: any;
  clicksign: { documentoStatus: string; envelopeStatus: string };
  atualizado: boolean;
};

function dataBrasilISO(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

class ContratoClicksignSyncService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  iniciarAgendador(): void {
    if (this.timer) return;
    this.agendarProximaExecucao();
  }

  private agendarProximaExecucao(): void {
    const delay = this.milisegundosAteProximaExecucao();
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.sincronizarPendentes();
      } catch (err: any) {
        console.error('[ClickSign Sync] Erro na sincronizacao diaria:', err?.message || err);
      } finally {
        this.agendarProximaExecucao();
      }
    }, delay);
    console.log(`[ClickSign Sync] Proxima execucao diaria agendada para ${new Date(Date.now() + delay).toISOString()} (17:00 America/Sao_Paulo).`);
  }

  private milisegundosAteProximaExecucao(): number {
    const agora = new Date();
    let alvo = new Date(`${dataBrasilISO()}T17:00:00-03:00`);
    if (agora.getTime() >= alvo.getTime()) {
      alvo = new Date(`${dataBrasilISO(1)}T17:00:00-03:00`);
    }
    return Math.max(1_000, alvo.getTime() - agora.getTime());
  }

  async sincronizarPorId(id: string): Promise<SyncResultado> {
    const contrato = await prisma.contrato.findUnique({ where: { id } });
    if (!contrato) {
      const err = new Error('Contrato não encontrado.');
      (err as any).statusCode = 404;
      throw err;
    }
    return this.sincronizarContrato(contrato);
  }

  async sincronizarPendentes(): Promise<{ verificados: number; atualizados: number; erros: Array<{ id: string; erro: string }> }> {
    if (this.running) return { verificados: 0, atualizados: 0, erros: [] };
    this.running = true;
    try {
      const contratos = await prisma.contrato.findMany({
        where: {
          status: 'AGUARDANDO_ASSINATURA',
          clicksignEnvelopeId: { not: null },
          clicksignDocumentoId: { not: null },
        },
        orderBy: { updatedAt: 'asc' },
      });

      let atualizados = 0;
      const erros: Array<{ id: string; erro: string }> = [];
      for (const contrato of contratos) {
        try {
          const result = await this.sincronizarContrato(contrato);
          if (result.atualizado) atualizados++;
        } catch (err: any) {
          erros.push({ id: contrato.id, erro: err?.message || 'Erro desconhecido' });
        }
      }

      console.log(`[ClickSign Sync] verificados=${contratos.length}, atualizados=${atualizados}, erros=${erros.length}`);
      return { verificados: contratos.length, atualizados, erros };
    } finally {
      this.running = false;
    }
  }

  private async sincronizarContrato(contrato: any): Promise<SyncResultado> {
    if (!contrato.clicksignEnvelopeId || !contrato.clicksignDocumentoId) {
      const err = new Error('Contrato não possui documento no ClickSign.');
      (err as any).statusCode = 400;
      throw err;
    }

    const [documento, envelope] = await Promise.all([
      clicksign.buscarDocumento(contrato.clicksignEnvelopeId, contrato.clicksignDocumentoId).catch(() => null),
      clicksign.buscarEnvelope(contrato.clicksignEnvelopeId).catch(() => null),
    ]);
    if (!documento && !envelope) {
      throw new Error('Não foi possível consultar o contrato na ClickSign.');
    }

    const documentoStatus = String(documento?.attributes?.status || documento?.status || '').toLowerCase();
    const envelopeStatus = String(envelope?.attributes?.status || envelope?.status || '').toLowerCase();
    const finishedAt = documento?.attributes?.finished_at || documento?.finished_at || null;
    const isAssinado = documentoStatus === 'closed' || envelopeStatus === 'closed';
    const isCancelado = ['canceled', 'cancelled', 'refused'].includes(documentoStatus)
      || ['canceled', 'cancelled', 'refused'].includes(envelopeStatus);

    let atualizado = false;
    let contratoAtualizado = contrato;
    if (isAssinado && contrato.status !== 'ASSINADO') {
      contratoAtualizado = await prisma.contrato.update({
        where: { id: contrato.id },
        data: { status: 'ASSINADO', assinadoEm: finishedAt ? new Date(finishedAt) : new Date() },
      });
      atualizado = true;
    } else if (isCancelado && contrato.status !== 'CANCELADO') {
      contratoAtualizado = await prisma.contrato.update({
        where: { id: contrato.id },
        data: { status: 'CANCELADO' },
      });
      atualizado = true;
    }

    return {
      contrato: contratoAtualizado,
      clicksign: { documentoStatus, envelopeStatus },
      atualizado,
    };
  }
}

export default new ContratoClicksignSyncService();
