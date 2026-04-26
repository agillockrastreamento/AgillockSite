import prisma from '../utils/prisma';
import EmailService from './email.service';

class NotificationService {
  /**
   * Processa um evento que acabou de ocorrer
   * @param dispositivoTraccarId ID do dispositivo no Traccar
   * @param tipo ignitionOn, ignitionOff, geofenceEnter, geofenceExit, overspeed, powerCut
   * @param dados Dados extras (velocidade, latitude, longitude, etc)
   */
  async processarEvento(dispositivoTraccarId: number, tipo: string, dados: any) {
    try {
      // 1. Encontrar o dispositivo no nosso sistema
      const dispositivo = await prisma.dispositivo.findFirst({
        where: { traccarId: dispositivoTraccarId },
        include: {
          clientesVinculados: {
            include: {
              cliente: {
                include: { login: true }
              }
            }
          }
        }
      });

      if (!dispositivo || !dispositivo.clientesVinculados.length) return;

      // 2. Para cada cliente vinculado, verificar preferências
      for (const vinculo of dispositivo.clientesVinculados) {
        const clienteLogin = vinculo.cliente.login;
        if (!clienteLogin) continue;

        const pref = await prisma.preferenciaNotificacao.findUnique({
          where: {
            clienteLoginId_dispositivoId_tipoEvento: {
              clienteLoginId: clienteLogin.id,
              dispositivoId: dispositivo.id,
              tipoEvento: tipo
            }
          }
        });

        // Se não tem preferência ou está tudo desligado, ignora
        if (!pref || (!pref.web && !pref.app && !pref.email)) {
          // Exceção: excesso de velocidade precisa checar o limite personalizado do cliente
          if (tipo !== 'overspeed') continue;
        }

        // 3. Lógica específica de Excesso de Velocidade (limite do cliente)
        if (tipo === 'overspeed') {
          const limiteCliente = pref?.overspeedLimit || 100;
          if (dados.velocidade <= limiteCliente) continue;
        }

        // 4. Gerar mensagem amigável
        const mensagem = this.gerarMensagem(tipo, dispositivo.nome, dispositivo.placa, dados);

        // 5. Salvar no histórico (para consulta posterior e Web)
        if (pref?.web || pref?.app) {
           await prisma.eventoNotificacao.create({
             data: {
               clienteLoginId: clienteLogin.id,
               dispositivoId: dispositivo.id,
               tipoEvento: tipo,
               mensagem,
               latitude: dados.latitude,
               longitude: dados.longitude,
               velocidade: dados.velocidade
             }
           });
        }

        // 6. Disparar E-mail
        if (pref?.email && clienteLogin.email) {
          const html = EmailService.gerarTemplateAlerta(
            vinculo.cliente.nome,
            dispositivo.nome,
            dispositivo.placa || '',
            this.getLabelTipo(tipo),
            new Date().toLocaleString('pt-BR'),
            dados.endereco
          );
          
          await EmailService.enviarEmail(
            clienteLogin.email,
            `Alerta: ${this.getLabelTipo(tipo)} - ${dispositivo.nome}`,
            html
          );
        }

        // 7. Notificação App (Futuro)
        if (pref?.app) {
          // Aqui entraria a lógica de Firebase Cloud Messaging (FCM)
          console.log(`[APP NOTIF] Enviando para ${vinculo.cliente.nome}: ${mensagem}`);
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
      case 'deviceLocked':  return `Bloqueio: O motor do veículo ${nome} ${p} foi bloqueado remotamente.`;
      case 'deviceUnlocked':return `Desbloqueio: O motor do veículo ${nome} ${p} foi desbloqueado remotamente.`;
      default:              return `Evento: ${tipo} no veículo ${nome} ${p}`;
    }
  }
}

export default new NotificationService();