import prisma from '../utils/prisma';
import EmailService from './email.service';

type DispositivoBasico = { id: string; nome: string; placa: string | null; identificador: string };

class NotificationService {
  async processarEvento(identificador: string, tipo: string, dados: any) {
    try {
      const dispositivo = await prisma.dispositivo.findFirst({
        where: { identificador },
        include: {
          cliente: { include: { login: true } },
          clientesVinculados: { include: { cliente: { include: { login: true } } } },
        },
      });

      if (!dispositivo) {
        console.warn(`[Notif] Dispositivo não encontrado para identificador: ${identificador}`);
        return;
      }

      const clientesMap = new Map<string, { nome: string; login: { id: string; email: string; ativo: boolean } | null }>();
      if (dispositivo.cliente) clientesMap.set(dispositivo.cliente.id, dispositivo.cliente);
      for (const vinculo of dispositivo.clientesVinculados) {
        if (!clientesMap.has(vinculo.cliente.id)) clientesMap.set(vinculo.cliente.id, vinculo.cliente);
      }

      if (clientesMap.size === 0) {
        console.warn(`[Notif] Nenhum cliente encontrado para dispositivo ${identificador}`);
        return;
      }

      console.log(`[Notif] Evento "${tipo}" para ${identificador} — ${clientesMap.size} cliente(s)`);

      for (const cliente of clientesMap.values()) {
        const clienteLogin = cliente.login;
        if (!clienteLogin || !clienteLogin.ativo) continue;

        // select explícito: apenas os campos de canais e limite — evita erro de coluna inexistente
        // caso a migration de km ainda não tenha sido aplicada em produção
        const pref = await prisma.preferenciaNotificacao.findUnique({
          where: {
            clienteLoginId_dispositivoId_tipoEvento: {
              clienteLoginId: clienteLogin.id,
              dispositivoId: dispositivo.id,
              tipoEvento: tipo,
            },
          },
          select: { web: true, app: true, email: true, overspeedLimit: true },
        });

        if (!pref || (!pref.web && !pref.app && !pref.email)) {
          if (tipo !== 'overspeed') {
            console.log(`[Notif] Sem preferência ativa para "${tipo}" — cliente ${clienteLogin.id}`);
            continue;
          }
        }

        if (tipo === 'overspeed') {
          const limiteCliente = pref?.overspeedLimit ?? 100;
          if ((dados.velocidade ?? 0) <= limiteCliente) {
            console.log(`[Notif] Overspeed ignorado: ${dados.velocidade} km/h <= limite ${limiteCliente}`);
            continue;
          }
        }

        const mensagem = this.gerarMensagem(tipo, dispositivo.nome, dispositivo.placa, dados);

        if (pref?.web || pref?.app) {
          await prisma.eventoNotificacao.create({
            data: {
              clienteLoginId: clienteLogin.id,
              dispositivoId: dispositivo.id,
              tipoEvento: tipo,
              mensagem,
              latitude: dados.latitude ?? null,
              longitude: dados.longitude ?? null,
              velocidade: dados.velocidade ?? null,
            },
          });
          console.log(`[Notif] Evento "${tipo}" salvo para ${cliente.nome}`);
        }

        if (pref?.email && clienteLogin.email) {
          const html = EmailService.gerarTemplateAlerta(
            cliente.nome,
            dispositivo.nome,
            dispositivo.placa || '',
            this.getLabelTipo(tipo),
            new Date().toLocaleString('pt-BR'),
            dados.endereco ?? null,
          );
          await EmailService.enviarEmail(
            clienteLogin.email,
            `Alerta: ${this.getLabelTipo(tipo)} — ${dispositivo.nome}`,
            html,
          );
          console.log(`[Notif] E-mail "${tipo}" enviado para ${clienteLogin.email}`);
        }

        if (pref?.app) {
          console.log(`[APP NOTIF] Enviando para ${cliente.nome}: ${mensagem}`);
        }
      }
    } catch (error: any) {
      console.error(`[Notif] Erro ao processar evento "${tipo}" para ${identificador}:`, error?.message || error);
    }
  }

  async verificarKmNotificacoes(identificador: string, odometroMetros: number) {
    try {
      const dispositivo = await prisma.dispositivo.findFirst({
        where: { identificador },
        include: {
          cliente: { include: { login: true } },
          clientesVinculados: { include: { cliente: { include: { login: true } } } },
        },
      });
      if (!dispositivo) return;

      const clientesMap = new Map<string, { nome: string; login: { id: string; email: string; ativo: boolean } | null }>();
      if (dispositivo.cliente) clientesMap.set(dispositivo.cliente.id, dispositivo.cliente);
      for (const vinculo of dispositivo.clientesVinculados) {
        if (!clientesMap.has(vinculo.cliente.id)) clientesMap.set(vinculo.cliente.id, vinculo.cliente);
      }

      for (const cliente of clientesMap.values()) {
        const clienteLogin = cliente.login;
        if (!clienteLogin?.ativo) continue;
        await this._verificarKmExcedida(clienteLogin.id, dispositivo, odometroMetros);
        await this._verificarKmReduzida(clienteLogin.id, dispositivo, odometroMetros);
        await this._verificarTrocaOleo(clienteLogin.id, dispositivo, odometroMetros);
      }
    } catch (error) {
      console.error('Erro ao verificar km notificações:', error);
    }
  }

  private async _verificarKmExcedida(
    clienteLoginId: string,
    dispositivo: DispositivoBasico,
    odometroMetros: number,
  ) {
    const pref = await prisma.preferenciaNotificacao.findUnique({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'kmExcedida' } },
    });
    if (!pref || (!pref.web && !pref.app && !pref.email)) return;
    if (!pref.kmMaximo30Dias || !pref.diaRenovacaoMes) return;

    const periodoInicio = _ultimaOcorrenciaDiaMes(pref.diaRenovacaoMes, new Date());

    const estado = await prisma.estadoKmNotificacao.upsert({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'kmExcedida' } },
      create: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'kmExcedida', kmBaseMetros: odometroMetros, dataBase: periodoInicio, notificacaoEnviada: false },
      update: {},
    });

    if (estado.dataBase < periodoInicio) {
      await prisma.estadoKmNotificacao.update({
        where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'kmExcedida' } },
        data: { kmBaseMetros: odometroMetros, dataBase: periodoInicio, notificacaoEnviada: false },
      });
      return;
    }

    const kmNoPeriodo = (odometroMetros - estado.kmBaseMetros) / 1000;
    if (kmNoPeriodo > pref.kmMaximo30Dias && !estado.notificacaoEnviada) {
      const mensagem = `Quilometragem Excedida: O veículo ${dispositivo.nome}${dispositivo.placa ? ' (' + dispositivo.placa + ')' : ''} atingiu ${Math.round(kmNoPeriodo)} km no período (limite: ${pref.kmMaximo30Dias} km).`;
      await this._salvarEEnviar(clienteLoginId, dispositivo, pref, 'kmExcedida', mensagem);
      await prisma.estadoKmNotificacao.update({
        where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'kmExcedida' } },
        data: { notificacaoEnviada: true },
      });
    }
  }

  private async _verificarKmReduzida(
    clienteLoginId: string,
    dispositivo: DispositivoBasico,
    odometroMetros: number,
  ) {
    const pref = await prisma.preferenciaNotificacao.findUnique({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'kmReduzida' } },
    });
    if (!pref || (!pref.web && !pref.app && !pref.email)) return;
    if (!pref.kmMinimo7Dias || pref.diaSemanaRenovacao == null) return;

    const ultimaRenovacao = _ultimaOcorrenciaDiaSemana(pref.diaSemanaRenovacao, new Date());

    const estado = await prisma.estadoKmNotificacao.upsert({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'kmReduzida' } },
      create: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'kmReduzida', kmBaseMetros: odometroMetros, dataBase: ultimaRenovacao, notificacaoEnviada: false },
      update: {},
    });

    if (estado.dataBase < ultimaRenovacao) {
      const kmNoPeriodo = (odometroMetros - estado.kmBaseMetros) / 1000;
      if (kmNoPeriodo < pref.kmMinimo7Dias) {
        const mensagem = `Quilometragem Reduzida: O veículo ${dispositivo.nome}${dispositivo.placa ? ' (' + dispositivo.placa + ')' : ''} percorreu apenas ${Math.round(kmNoPeriodo)} km nos últimos 7 dias (mínimo: ${pref.kmMinimo7Dias} km).`;
        await this._salvarEEnviar(clienteLoginId, dispositivo, pref, 'kmReduzida', mensagem);
      }
      await prisma.estadoKmNotificacao.update({
        where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'kmReduzida' } },
        data: { kmBaseMetros: odometroMetros, dataBase: ultimaRenovacao, notificacaoEnviada: true },
      });
    }
  }

  private async _verificarTrocaOleo(
    clienteLoginId: string,
    dispositivo: DispositivoBasico,
    odometroMetros: number,
  ) {
    const pref = await prisma.preferenciaNotificacao.findUnique({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'trocaOleo' } },
    });
    if (!pref || (!pref.web && !pref.app && !pref.email)) return;
    if (!pref.kmTrocaOleo) return;

    const estado = await prisma.estadoKmNotificacao.upsert({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'trocaOleo' } },
      create: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'trocaOleo', kmBaseMetros: odometroMetros, dataBase: new Date(), notificacaoEnviada: false },
      update: {},
    });

    const kmDesdeBase = (odometroMetros - estado.kmBaseMetros) / 1000;
    if (kmDesdeBase >= pref.kmTrocaOleo && !estado.notificacaoEnviada) {
      const mensagem = `Troca de Óleo: O veículo ${dispositivo.nome}${dispositivo.placa ? ' (' + dispositivo.placa + ')' : ''} percorreu ${Math.round(kmDesdeBase)} km desde a última troca de óleo. Recomenda-se a troca!`;
      await this._salvarEEnviar(clienteLoginId, dispositivo, pref, 'trocaOleo', mensagem);
      // Auto-reset: start counting from current odometer again
      await prisma.estadoKmNotificacao.update({
        where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'trocaOleo' } },
        data: { kmBaseMetros: odometroMetros, dataBase: new Date(), notificacaoEnviada: false },
      });
    }
  }

  private async _salvarEEnviar(
    clienteLoginId: string,
    dispositivo: DispositivoBasico,
    pref: { web: boolean; app: boolean; email: boolean },
    tipo: string,
    mensagem: string,
  ) {
    if (pref.web || pref.app) {
      await prisma.eventoNotificacao.create({
        data: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: tipo, mensagem, latitude: null, longitude: null, velocidade: null },
      });
    }
    if (pref.email) {
      const loginData = await prisma.clienteLogin.findUnique({ where: { id: clienteLoginId }, include: { cliente: { select: { nome: true } } } });
      if (loginData) {
        const html = EmailService.gerarTemplateAlerta(
          loginData.cliente.nome,
          dispositivo.nome,
          dispositivo.placa || '',
          this.getLabelTipo(tipo),
          new Date().toLocaleString('pt-BR'),
          undefined,
        );
        await EmailService.enviarEmail(loginData.email, `Alerta: ${this.getLabelTipo(tipo)} — ${dispositivo.nome}`, html);
      }
    }
  }

  private getLabelTipo(tipo: string) {
    const labels: Record<string, string> = {
      ignitionOn:    'Ignição Ligada',
      ignitionOff:   'Ignição Desligada',
      geofenceEnter: 'Entrada em Cerca',
      geofenceExit:  'Saída de Cerca',
      overspeed:     'Excesso de Velocidade',
      powerCut:      'Alimentação Cortada',
      alarm:         'Alarme',
      deviceLocked:  'Veículo Bloqueado',
      deviceUnlocked:'Veículo Desbloqueado',
      kmExcedida:    'Quilometragem Excedida',
      kmReduzida:    'Quilometragem Reduzida',
      trocaOleo:     'Troca de Óleo',
    };
    return labels[tipo] || tipo;
  }

  private gerarMensagem(tipo: string, nome: string, placa: string | null, dados: any) {
    const p = placa ? `(${placa})` : '';
    switch (tipo) {
      case 'ignitionOn':    return `Ignição Ligada: O veículo ${nome} ${p} foi ligado.`;
      case 'ignitionOff':   return `Ignição Desligada: O veículo ${nome} ${p} foi desligado.`;
      case 'geofenceEnter': return `Cerca Virtual: O veículo ${nome} ${p} entrou em uma área monitorada.`;
      case 'geofenceExit':  return `Cerca Virtual: O veículo ${nome} ${p} saiu de uma área monitorada.`;
      case 'overspeed':     return `Velocidade: O veículo ${nome} ${p} excedeu o limite definido (${dados.velocidade} km/h).`;
      case 'powerCut':      return `Alerta de Energia: A alimentação do rastreador no veículo ${nome} ${p} foi cortada.`;
      case 'alarm':         return `Alarme: O veículo ${nome} ${p} acionou um alerta${dados.alarme ? ` (${dados.alarme})` : ''}.`;
      case 'deviceLocked':  return `Bloqueio: O motor do veículo ${nome} ${p} foi bloqueado remotamente.`;
      case 'deviceUnlocked':return `Desbloqueio: O motor do veículo ${nome} ${p} foi desbloqueado remotamente.`;
      default:              return `Evento: ${tipo} no veículo ${nome} ${p}`;
    }
  }
}

export default new NotificationService();

function _ultimaOcorrenciaDiaMes(dia: number, agora: Date): Date {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  if (agora.getDate() >= dia) {
    d.setDate(dia);
  } else {
    d.setMonth(d.getMonth() - 1);
    const diasNoMes = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(dia, diasNoMes));
  }
  return d;
}

function _ultimaOcorrenciaDiaSemana(diaSemana: number, agora: Date): Date {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - diaSemana + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}
