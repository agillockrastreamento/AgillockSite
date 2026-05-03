import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import ExpoPushService from './expo-push.service';

const TZ = 'America/Sao_Paulo';

function dataBrasilISO(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

function inicioDiaBrasil(isoDate = dataBrasilISO()): Date {
  return new Date(`${isoDate}T00:00:00-03:00`);
}

function fimDiaBrasil(isoDate = dataBrasilISO()): Date {
  return new Date(`${isoDate}T23:59:59.999-03:00`);
}

function formatMoney(valor: Prisma.Decimal | number): string {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function diasAtraso(vencimento: Date, hojeInicio: Date): number {
  const vencIso = vencimento.toLocaleDateString('en-CA', { timeZone: TZ });
  const vencInicio = inicioDiaBrasil(vencIso);
  return Math.max(1, Math.floor((hojeInicio.getTime() - vencInicio.getTime()) / 86_400_000));
}

class FinanceiroNotificationService {
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
        await this.processarNotificacoesDoDia();
      } catch (err: any) {
        console.error('[Financeiro Notif] Erro no processamento diario:', err?.message || err);
      } finally {
        this.agendarProximaExecucao();
      }
    }, delay);
    console.log(`[Financeiro Notif] Proxima execucao diaria agendada para ${new Date(Date.now() + delay).toISOString()} (09:00 America/Sao_Paulo).`);
  }

  private milisegundosAteProximaExecucao(): number {
    const hojeIso = dataBrasilISO();
    const agora = new Date();
    let alvo = new Date(`${hojeIso}T09:00:00-03:00`);
    if (agora.getTime() >= alvo.getTime()) {
      alvo = new Date(`${dataBrasilISO(1)}T09:00:00-03:00`);
    }
    return Math.max(1_000, alvo.getTime() - agora.getTime());
  }

  async processarNotificacoesDoDia(dataIso = dataBrasilISO()): Promise<{ vencendoHoje: number; atrasados: number }> {
    if (this.running) return { vencendoHoje: 0, atrasados: 0 };
    this.running = true;

    try {
      const hojeInicio = inicioDiaBrasil(dataIso);
      const hojeFim = fimDiaBrasil(dataIso);

      await prisma.boleto.updateMany({
        where: { status: 'PENDENTE', vencimento: { lt: hojeInicio } },
        data: { status: 'ATRASADO' },
      });

      const [vencendoHoje, atrasados] = await Promise.all([
        prisma.boleto.findMany({
          where: {
            status: 'PENDENTE',
            vencimento: { gte: hojeInicio, lte: hojeFim },
            carne: { cliente: { login: { is: { ativo: true } } } },
          },
          include: { carne: { include: { cliente: { include: { login: true } } } } },
        }),
        prisma.boleto.findMany({
          where: {
            status: 'ATRASADO',
            vencimento: { lt: hojeInicio },
            carne: { cliente: { login: { is: { ativo: true } } } },
          },
          include: { carne: { include: { cliente: { include: { login: true } } } } },
        }),
      ]);

      let totalVencendo = 0;
      for (const boleto of vencendoHoje) {
        const login = boleto.carne.cliente.login;
        if (!login?.ativo) continue;
        const ok = await this.notificarBoleto(login.id, boleto.id, 'boletoVencendoHoje', hojeInicio, {
          title: 'Boleto vence hoje',
          body: `Seu boleto de ${formatMoney(boleto.valor)} vence hoje. Toque para ver a segunda via.`,
          mensagem: `Boleto vence hoje: parcela ${boleto.numeroParcela} no valor de ${formatMoney(boleto.valor)} vence hoje.`,
          data: { boletoId: boleto.id, tipo: 'boletoVencendoHoje', linkBoleto: boleto.linkBoleto },
        });
        if (ok) totalVencendo++;
      }

      let totalAtrasados = 0;
      for (const boleto of atrasados) {
        const login = boleto.carne.cliente.login;
        if (!login?.ativo) continue;
        const dias = diasAtraso(boleto.vencimento, hojeInicio);
        const ok = await this.notificarBoleto(login.id, boleto.id, 'boletoAtrasado', hojeInicio, {
          title: 'Boleto em atraso',
          body: `Voce tem um boleto em atraso ha ${dias} dia${dias === 1 ? '' : 's'}. Mantenha-se em dia para continuar acessando a area de monitoramento.`,
          mensagem: `Boleto em atraso: parcela ${boleto.numeroParcela} no valor de ${formatMoney(boleto.valor)} esta atrasada ha ${dias} dia${dias === 1 ? '' : 's'}. Mantenha-se em dia para continuar acessando a area de monitoramento.`,
          data: { boletoId: boleto.id, tipo: 'boletoAtrasado', diasAtraso: dias, linkBoleto: boleto.linkBoleto },
        });
        if (ok) totalAtrasados++;
      }

      if (totalVencendo || totalAtrasados) {
        console.log(`[Financeiro Notif] ${dataIso}: vencendoHoje=${totalVencendo}, atrasados=${totalAtrasados}`);
      }

      return { vencendoHoje: totalVencendo, atrasados: totalAtrasados };
    } finally {
      this.running = false;
    }
  }

  async notificarPagamentoRecebido(boletoId: string): Promise<boolean> {
    const boleto = await prisma.boleto.findUnique({
      where: { id: boletoId },
      include: { carne: { include: { cliente: { include: { login: true } } } } },
    });
    const login = boleto?.carne.cliente.login;
    if (!boleto || !login?.ativo) return false;

    const dataReferencia = inicioDiaBrasil(dataBrasilISO());
    const mensagem = `Pagamento recebido: identificamos o pagamento da parcela ${boleto.numeroParcela} no valor de ${formatMoney(boleto.valor)}. Obrigado por manter seu acesso em dia.`;

    try {
      await prisma.notificacaoFinanceiraEnvio.create({
        data: { clienteLoginId: login.id, boletoId: boleto.id, tipo: 'pagamentoRecebido', dataReferencia },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') return false;
      throw err;
    }

    await prisma.eventoNotificacao.create({
      data: {
        clienteLoginId: login.id,
        boletoId: boleto.id,
        tipoEvento: 'pagamentoRecebido',
        mensagem,
        latitude: null,
        longitude: null,
        velocidade: null,
      },
    });

    await ExpoPushService.enviarParaCliente(login.id, {
      title: 'Pagamento recebido',
      body: 'Recebemos seu pagamento. Obrigado por manter seu acesso em dia.',
      data: { boletoId: boleto.id, tipo: 'pagamentoRecebido', linkBoleto: boleto.linkBoleto },
    });

    return true;
  }

  private async notificarBoleto(
    clienteLoginId: string,
    boletoId: string,
    tipo: 'boletoVencendoHoje' | 'boletoAtrasado',
    dataReferencia: Date,
    payload: { title: string; body: string; mensagem: string; data: Record<string, unknown> },
  ): Promise<boolean> {
    try {
      await prisma.notificacaoFinanceiraEnvio.create({
        data: { clienteLoginId, boletoId, tipo, dataReferencia },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') return false;
      throw err;
    }

    await prisma.eventoNotificacao.create({
      data: {
        clienteLoginId,
        boletoId,
        tipoEvento: tipo,
        mensagem: payload.mensagem,
        latitude: null,
        longitude: null,
        velocidade: null,
      },
    });

    await ExpoPushService.enviarParaCliente(clienteLoginId, {
      title: payload.title,
      body: payload.body,
      data: payload.data,
    });

    return true;
  }
}

export default new FinanceiroNotificationService();
