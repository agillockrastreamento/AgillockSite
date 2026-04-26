import prisma from '../utils/prisma';
import EmailService from './email.service';

class NotificationService {
  /**
   * Processa um evento que acabou de ocorrer.
   * @param dispositivoTraccarId ID do dispositivo no Traccar
   * @param tipo ignitionOn, ignitionOff, geofenceEnter, geofenceExit, overspeed, powerCut, alarm, deviceLocked, deviceUnlocked
   * @param dados Dados extras (velocidade, latitude, longitude, etc)
   */
  async processarEvento(dispositivoTraccarId: number, tipo: string, dados: any) {
    try {
      // 1. Encontrar o dispositivo e TODOS os clientes associados (dono direto + vinculados)
      const dispositivo = await prisma.dispositivo.findFirst({
        where: { traccarId: dispositivoTraccarId },
        include: {
          cliente: {
            include: { login: true },
          },
          clientesVinculados: {
            include: {
              cliente: {
                include: { login: true },
              },
            },
          },
        },
      });

      if (!dispositivo) return;

      // Montar lista única de clientes: dono direto + vinculados (sem duplicatas)
      const clientesMap = new Map<string, { nome: string; login: { id: string; email: string; ativo: boolean } | null }>();

      if (dispositivo.cliente) {
        clientesMap.set(dispositivo.cliente.id, dispositivo.cliente);
      }
      for (const vinculo of dispositivo.clientesVinculados) {
        if (!clientesMap.has(vinculo.cliente.id)) {
          clientesMap.set(vinculo.cliente.id, vinculo.cliente);
        }
      }

      if (clientesMap.size === 0) return;

      // 2. Para cada cliente, verificar preferências e disparar notificação
      for (const cliente of clientesMap.values()) {
        const clienteLogin = cliente.login;
        if (!clienteLogin || !clienteLogin.ativo) continue;

        const pref = await prisma.preferenciaNotificacao.findUnique({
          where: {
            clienteLoginId_dispositivoId_tipoEvento: {
              clienteLoginId: clienteLogin.id,
              dispositivoId: dispositivo.id,
              tipoEvento: tipo,
            },
          },
        });

        // Se não tem preferência ou está tudo desligado, ignora
        if (!pref || (!pref.web && !pref.app && !pref.email)) {
          if (tipo !== 'overspeed') continue;
        }

        // 3. Lógica específica de Excesso de Velocidade (limite do cliente)
        if (tipo === 'overspeed') {
          const limiteCliente = pref?.overspeedLimit ?? 100;
          if ((dados.velocidade ?? 0) <= limiteCliente) continue;
        }

        // 4. Gerar mensagem amigável
        const mensagem = this.gerarMensagem(tipo, dispositivo.nome, dispositivo.placa, dados);

        // 5. Salvar no histórico (para consulta posterior na Web)
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
        }

        // 6. Disparar E-mail (usa o e-mail de acesso ao portal — ClienteLogin.email)
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
        }

        // 7. Notificação App (futuro — Firebase Cloud Messaging)
        if (pref?.app) {
          console.log(`[APP NOTIF] Enviando para ${cliente.nome}: ${mensagem}`);
        }
      }
    } catch (error) {
      console.error('Erro no NotificationService:', error);
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
