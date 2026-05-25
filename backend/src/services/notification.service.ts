import prisma from '../utils/prisma';
import EmailService from './email.service';
import { reverseGeocode } from '../utils/reverse-geocode';
import ExpoPushService from './expo-push.service';

type DispositivoBasico = { id: string; nome: string; placa: string | null; identificador: string; traccarId?: number | null; clienteId?: string | null };

function _inicioDiaSaoPaulo(offsetDias = 0): Date {
  const dataSp = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const inicio = new Date(`${dataSp}T00:00:00-03:00`);
  inicio.setDate(inicio.getDate() + offsetDias);
  return inicio;
}

// Normaliza subtipos de manutenção para a chave de preferência do admin
function _tipoPreferenciaAdmin(tipo: string): string {
  if (tipo === 'manutencaoAlerta' || tipo === 'manutencaoAtrasada' || tipo === 'manutencaoFeita') return 'manutencao';
  if (tipo === 'recorrenciaDataAlerta' || tipo === 'recorrenciaDataNaoFeita' || tipo === 'recorrenciaDataFeita') return 'recorrenciaData';
  return tipo;
}

class NotificationService {
  private _lastOverspeedAt = new Map<string, number>(); // Cache para cooldown de velocidade
  private _enderecoCache = new Map<string, string>();
  private _lastIgnitionState = new Map<string, boolean>(); // Cache para evitar alertas duplicados de ignição
  private _lastAlarmAt = new Map<string, number>();        // Cooldown de alarme por dispositivo
  private _lastAdminEventAt = new Map<string, number>();   // Dedup de eventos admin por dispositivo+tipo
  private _adminPrefsCache: { data: { userId: string; prefs: unknown }[]; at: number } | null = null;

  private async resolverEnderecoEvento(dados: any): Promise<string | null> {
    if (dados.endereco) return dados.endereco;
    const lat = Number(dados.latitude);
    const lon = Number(dados.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const cacheKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (this._enderecoCache.has(cacheKey)) return this._enderecoCache.get(cacheKey) || null;
    const endereco = await reverseGeocode(lat, lon).catch(() => '');
    this._enderecoCache.set(cacheKey, endereco);
    return endereco || null;
  }

  async verificarEventosPosicao(identificador: string, dispositivo: any, dados: any): Promise<any[]> {
    const eventosDetectados: any[] = [];
    try {
      const clientesMap = new Map<string, { id: string; nome: string; login: { id: string; email: string; ativo: boolean } | null }>();
      if (dispositivo.cliente) clientesMap.set(dispositivo.cliente.id, dispositivo.cliente as any);
      for (const vinculo of dispositivo.clientesVinculados || []) {
        if (!clientesMap.has(vinculo.cliente.id)) clientesMap.set(vinculo.cliente.id, vinculo.cliente as any);
      }

      // 1. Verificar Ignição (Nível de Dispositivo para todos os clientes)
      let mudouIgnicao = false;
      let tipoIgn: 'ignitionOn' | 'ignitionOff' | null = null;

      if (dados.ignicao !== null) {
        const chaveIgnicao = `${dispositivo.id}_ignicao`;
        const ultimoEstadoConhecido = this._lastIgnitionState.get(chaveIgnicao) ?? dispositivo.telemetriaUltimaIgnicao;
        
        if (ultimoEstadoConhecido !== null && dados.ignicao !== ultimoEstadoConhecido) {
          tipoIgn = dados.ignicao ? 'ignitionOn' : 'ignitionOff';
          console.log(`[Notif] Mudança de ignição detectada para ${identificador}: ${ultimoEstadoConhecido} -> ${dados.ignicao}`);
          mudouIgnicao = true;
          this._lastIgnitionState.set(chaveIgnicao, dados.ignicao);
        } else if (ultimoEstadoConhecido === null) {
          this._lastIgnitionState.set(chaveIgnicao, dados.ignicao);
        }
      }

      for (const cliente of clientesMap.values()) {
        const clienteLogin = cliente.login;
        if (!clienteLogin || !clienteLogin.ativo) continue;

        // Processar Mudança de Ignição para este cliente
        if (mudouIgnicao && tipoIgn && !dados._skipIgnition) {
          const result = await this.processarEvento(identificador, tipoIgn, dados, clienteLogin.id);
          if (result) eventosDetectados.push(result);
        }

        // 2. Verificar Velocidade (Limite do Cliente)
        if (dados.velocidade !== null) {
          const prefVel = await prisma.preferenciaNotificacao.findUnique({
            where: {
              clienteLoginId_dispositivoId_tipoEvento: {
                clienteLoginId: clienteLogin.id,
                dispositivoId: dispositivo.id,
                tipoEvento: 'overspeed',
              },
            },
            select: { web: true, app: true, email: true, overspeedLimit: true },
          });

          if (prefVel && (prefVel.web || prefVel.app || prefVel.email)) {
            const limite = prefVel.overspeedLimit ?? 100;
            if (dados.velocidade > limite) {
              const chaveSpam = `${clienteLogin.id}_${dispositivo.id}_overspeed`;
              const agora = Date.now();
              const ultimoAlerta = this._lastOverspeedAt.get(chaveSpam) || 0;
              
              if (agora - ultimoAlerta > 1 * 60 * 1000) {
                console.log(`[Notif] Detectado excesso de velocidade (${dados.velocidade} km/h > ${limite}) para ${identificador} (Cliente: ${cliente.nome})`);
                const dadosComLimite = { ...dados, limiteConfigurado: limite };
                const result = await this.processarEvento(identificador, 'overspeed', dadosComLimite, clienteLogin.id);
                if (result) eventosDetectados.push(result);
                this._lastOverspeedAt.set(chaveSpam, agora);
              }
            }
          }
        }
        // 3. Verificar Alarmes de Hardware (com cooldown de 1 min por dispositivo)
        if (dados.alarme && !dados._skipAlarm) {
          let tipoAlarme = 'alarm';
          if (dados.alarme === 'powerCut' || dados.alarme === 'powerRestored') tipoAlarme = 'powerCut';
          const chaveAlarm = `${dispositivo.id}_${tipoAlarme}`;
          const agoraAlarm = Date.now();
          if (agoraAlarm - (this._lastAlarmAt.get(chaveAlarm) || 0) > 60_000) {
            this._lastAlarmAt.set(chaveAlarm, agoraAlarm);
            console.log(`[Notif] Detectado alarme de hardware (${dados.alarme}) para ${identificador} -> ${tipoAlarme}`);
            const result = await this.processarEvento(identificador, tipoAlarme, dados, clienteLogin.id);
            if (result) eventosDetectados.push(result);
          }
        }
      }
    } catch (error: any) {
      console.error(`[Notif] Erro ao verificar eventos de posição para ${identificador}:`, error.message);
    }
    return eventosDetectados;
  }

  async processarEvento(identificador: string, tipo: string, dados: any, targetClienteLoginId?: string): Promise<any | null> {
    let wsEvent: any = null;
    try {
      // Normalização exaustiva de tipos de evento
      const tipoOriginal = tipo;
      if (tipo === 'deviceOverspeed') tipo = 'overspeed';
      if (tipo === 'ignitionOn' || tipo === 'ignitionOff') { /* ok */ }
      if (tipo === 'geofenceEnter' || tipo === 'geofenceExit') { /* ok */ }
      if (tipo === 'deviceLocked' || tipo === 'deviceUnlocked') { /* ok */ }

      const dispositivo = await prisma.dispositivo.findFirst({
        where: {
          OR: [
            { identificador },
            { traccarId: (dados as any).traccarDeviceId }
          ]
        },
        include: {
          cliente: { include: { logins: { where: { tipo: 'responsavel', ativo: true }, take: 1 } } },
          clientesVinculados: { include: { cliente: { include: { logins: { where: { tipo: 'responsavel', ativo: true }, take: 1 } } } } },
        },
      });

      if (!dispositivo) {
        console.warn(`[Notif] Dispositivo não encontrado para identificador: ${identificador} (tipo: ${tipoOriginal})`);
        return null;
      }

      // Atualiza estado de ignição em memória para evitar que verificarEventosPosicao
      // dispare duplicata quando evento nativo e posição chegam em mensagens separadas
      if (tipo === 'ignitionOn') this._lastIgnitionState.set(`${dispositivo.id}_ignicao`, true);
      if (tipo === 'ignitionOff') this._lastIgnitionState.set(`${dispositivo.id}_ignicao`, false);
      // Atualiza cooldown de alarme para evitar duplicata via proactive check
      if (tipo === 'alarm' || tipo === 'powerCut') {
        this._lastAlarmAt.set(`${dispositivo.id}_${tipo}`, Date.now());
      }

      // Se encontramos por identificador mas o traccarId no banco está nulo, aproveitamos para atualizar
      if (!dispositivo.traccarId && (dados as any).traccarDeviceId) {
        await prisma.dispositivo.update({
          where: { id: dispositivo.id },
          data: { traccarId: (dados as any).traccarDeviceId }
        }).catch(err => console.error(`[Notif] Erro ao atualizar traccarId para ${identificador}:`, err.message));
      }

      const clientesMap = new Map<string, { id: string; nome: string; login: { id: string; email: string; ativo: boolean } | null }>();
      // Após o schema virar 1:N, `cliente.logins[0]` é o responsável (filtrado no query).
      // Mapeia para o campo singular `login` esperado por todo o serviço legado.
      const _liftLogin = (c: any) => ({ ...c, login: Array.isArray(c.logins) && c.logins[0] ? c.logins[0] : null });
      if (dispositivo.cliente) clientesMap.set(dispositivo.cliente.id, _liftLogin(dispositivo.cliente));
      for (const vinculo of dispositivo.clientesVinculados) {
        if (!clientesMap.has(vinculo.cliente.id)) clientesMap.set(vinculo.cliente.id, _liftLogin(vinculo.cliente));
      }

      if (clientesMap.size === 0) {
        console.warn(`[Notif] Nenhum cliente encontrado para dispositivo ${identificador} (${dispositivo.id})`);
        return null;
      }

      // Filtra apenas o cliente alvo, se especificado (vindo da verificação proativa)
      const clientesParaProcessar = targetClienteLoginId
        ? Array.from(clientesMap.values()).filter(c => c.login?.id === targetClienteLoginId)
        : Array.from(clientesMap.values());

      if (clientesParaProcessar.length > 0) {
        console.log(`[Notif] Evento "${tipo}" (original: ${tipoOriginal}) para ${identificador} — ${clientesParaProcessar.length} cliente(s)`);
      }

      // Geocerca de origem desconhecida (deletada do banco ou ainda não sincronizada):
      // não há como verificar propriedade, então não notifica nenhum cliente.
      if ((tipo === 'geofenceEnter' || tipo === 'geofenceExit') && dados.geofenceId && !dados.origemTipo) {
        console.warn(`[Notif] Geocerca traccarId=${dados.geofenceId} não encontrada no banco — notificação ignorada.`);
        return wsEvent;
      }

      if ((tipo === 'geofenceEnter' || tipo === 'geofenceExit') && (dados.origemTipo === 'ADMIN' || dados.origemTipo === 'CLIENTE')) {
        const clienteAdminRef = (dados.origemTipo === 'CLIENTE' && dados.clienteId)
          ? clientesParaProcessar.find(c => c.id === dados.clienteId)
          : clientesParaProcessar[0];
        const loginAdminRef = clienteAdminRef?.login;
        if (loginAdminRef?.id) {
          const mensagemAdmin = this.gerarMensagem(tipo, dispositivo.nome, dispositivo.placa, dados);
          const enderecoAdmin = await this.resolverEnderecoEvento(dados);
          await prisma.eventoNotificacao.create({
            data: {
              clienteLoginId: loginAdminRef.id,
              dispositivoId: dispositivo.id,
              tipoEvento: tipo,
              origemTipo: dados.origemTipo,
              origemId: dados.origemId ?? (dados.geofenceId != null ? String(dados.geofenceId) : null),
              adminEvento: true,
              mensagem: mensagemAdmin,
              latitude: dados.latitude ?? null,
              longitude: dados.longitude ?? null,
              endereco: enderecoAdmin,
              velocidade: dados.velocidade ?? null,
            },
          }).catch(err => console.error('[Notif] Erro ao salvar evento admin:', err.message));
        }
      }

      // Cria evento admin para tipos não-geocerca (geocerca já tem bloco dedicado acima)
      if (tipo !== 'geofenceEnter' && tipo !== 'geofenceExit') {
        await this._criarEventoAdmin(tipo, dispositivo, dados, clientesMap).catch(
          err => console.error('[Notif] Erro ao criar evento admin:', err.message),
        );
      }

      for (const cliente of clientesParaProcessar) {
        try {
          const clienteLogin = cliente.login;
          if (!clienteLogin || !clienteLogin.ativo) {
            console.log(`[Notif] Cliente ${cliente.nome} sem login ativo.`);
            continue;
          }

          if ((tipo === 'geofenceEnter' || tipo === 'geofenceExit') && dados.geofenceId) {
            const origemTipo = dados.origemTipo ?? null;
            const origemClienteId = dados.clienteId ?? null;
            if (origemTipo === 'CLIENTE' && origemClienteId && origemClienteId !== cliente.id) {
              console.log(`[Notif] Cerca de outro cliente ignorada para ${cliente.nome}.`);
              continue;
            }
            if (origemTipo === 'ADMIN' && dados.notificarCliente === false) {
              console.log(`[Notif] Cerca admin sem notificacao ao cliente ignorada para ${cliente.nome}.`);
              continue;
            }
          }

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
            console.log(`[Notif] Sem preferência ativa para "${tipo}" — cliente ${clienteLogin.id} (${cliente.nome})`);
            continue;
          }

          if (tipo === 'overspeed') {
            const limiteCliente = pref.overspeedLimit ?? 100;
            const velocidadeAtual = dados.velocidade ?? 0;
            
            if (dados.velocidade !== null && velocidadeAtual <= limiteCliente) {
              console.log(`[Notif] Overspeed ignorado: ${velocidadeAtual} km/h <= limite ${limiteCliente} (cliente: ${cliente.nome})`);
              continue;
            }
          }

          const mensagem = this.gerarMensagem(tipo, dispositivo.nome, dispositivo.placa, dados);
          const label = this.getLabelTipo(tipo);
          const enderecoEvento = await this.resolverEnderecoEvento(dados);

          // Canal Web/App (Banco de Dados)
          if (pref.web || pref.app) {
            try {
              await prisma.eventoNotificacao.create({
                data: {
                  clienteLoginId: clienteLogin.id,
                  dispositivoId: dispositivo.id,
                  tipoEvento: tipo,
                  origemTipo: dados.origemTipo ?? null,
                  origemId: dados.origemId ?? (dados.geofenceId != null ? String(dados.geofenceId) : null),
                  mensagem,
                  latitude: dados.latitude ?? null,
                  longitude: dados.longitude ?? null,
                  endereco: enderecoEvento,
                  velocidade: dados.velocidade ?? null,
                },
              });
              
              // Prepara objeto para o WebSocket
              wsEvent = {
                deviceId: (dados as any).traccarDeviceId || dispositivo.traccarId,
                type: tipo,
                tipoLabel: label,
                serverTime: new Date().toISOString(),
                mensagem,
                lat: dados.latitude ?? null,
                lng: dados.longitude ?? null,
                endereco: enderecoEvento,
                origemTipo: dados.origemTipo ?? null,
                origemId: dados.origemId ?? (dados.geofenceId != null ? String(dados.geofenceId) : null),
                clienteId: dados.clienteId ?? null,
                notificarCliente: dados.notificarCliente,
                geofenceId: dados.geofenceId ?? null,
              };

              console.log(`[Notif] Evento "${tipo}" salvo no banco para ${cliente.nome}`);
            } catch (dbErr: any) {
              console.error(`[Notif] Erro ao salvar evento no banco para ${cliente.nome}:`, dbErr.message);
            }
          }

          // Canal E-mail
          if (pref.email && clienteLogin.email) {
            try {
              const html = EmailService.gerarTemplateAlerta(
                cliente.nome,
                dispositivo.nome,
                dispositivo.placa || '',
                label,
                new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                enderecoEvento ?? undefined,
              );
              await EmailService.enviarEmail(
                clienteLogin.email,
                `Alerta: ${label} — ${dispositivo.nome}`,
                html,
              );
              console.log(`[Notif] E-mail "${tipo}" enviado para ${clienteLogin.email}`);
            } catch (emailErr: any) {
              console.error(`[Notif] Erro ao enviar e-mail para ${clienteLogin.email}:`, emailErr.message);
            }
          }

          if (pref.app) {
            await ExpoPushService.enviarParaCliente(clienteLogin.id, {
              title: label,
              body: mensagem,
              data: {
                tipo,
                dispositivoId: dispositivo.id,
                traccarId: (dados as any).traccarDeviceId || dispositivo.traccarId,
              },
            });
          }
        } catch (clienteErr: any) {
          console.error(`[Notif] Erro ao processar notificações para o cliente ${cliente.nome}:`, clienteErr.message);
        }
      }
    } catch (error: any) {
      console.error(`[Notif] Erro ao processar evento "${tipo}" para ${identificador}:`, error?.message || error);
    }
    return wsEvent;
  }

  async verificarKmNotificacoes(identificador: string, odometroMetros: number): Promise<any[]> {
    const eventosDetectados: any[] = [];
    try {
      const dispositivo = await prisma.dispositivo.findFirst({
        where: { identificador },
        include: {
          cliente: { include: { logins: { where: { tipo: 'responsavel', ativo: true }, take: 1 } } },
          clientesVinculados: { include: { cliente: { include: { logins: { where: { tipo: 'responsavel', ativo: true }, take: 1 } } } } },
        },
      });
      if (!dispositivo) return eventosDetectados;

      const clientesMap = new Map<string, { nome: string; login: { id: string; email: string; ativo: boolean } | null }>();
      const _liftLoginKm = (c: any) => ({ ...c, login: Array.isArray(c.logins) && c.logins[0] ? c.logins[0] : null });
      if (dispositivo.cliente) clientesMap.set(dispositivo.cliente.id, _liftLoginKm(dispositivo.cliente));
      for (const vinculo of dispositivo.clientesVinculados) {
        if (!clientesMap.has(vinculo.cliente.id)) clientesMap.set(vinculo.cliente.id, _liftLoginKm(vinculo.cliente));
      }

      const clientes = Array.from(clientesMap.values());
      for (const cliente of clientes) {
        const clienteLogin = cliente.login;
        if (!clienteLogin?.ativo) continue;
        await this._verificarKmExcedida(clienteLogin.id, dispositivo, odometroMetros);
        await this._verificarKmReduzida(clienteLogin.id, dispositivo, odometroMetros);
      }
      eventosDetectados.push(...await this._verificarManutencaoRecorrencias(dispositivo, odometroMetros, clientes.map(c => c.login).filter((l): l is { id: string; email: string; ativo: boolean } => !!l?.ativo)));
    } catch (error) {
      console.error('Erro ao verificar km notificações:', error);
    }
    return eventosDetectados;
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
      create: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'trocaOleo', kmBaseMetros: odometroMetros, dataBase: new Date(), notificacaoEnviada: false, ultimaNotificacaoKm: -9999 },
      update: {},
    });

    const intervalo = pref.kmTrocaOleo;
    const kmDesdeBase = (odometroMetros - estado.kmBaseMetros) / 1000;
    const ultima = estado.ultimaNotificacaoKm ?? -9999;
    const nome = dispositivo.nome;
    const pl = dispositivo.placa ? ` (${dispositivo.placa})` : '';

    // Build threshold list in ascending order
    const candidatos: Array<{ km: number; mensagem: string }> = [];

    if (intervalo - 100 > 0) {
      candidatos.push({
        km: intervalo - 100,
        mensagem: `Troca de Óleo: O veículo ${nome}${pl} está a 100 km da próxima troca de óleo (intervalo: ${intervalo} km).`,
      });
    }
    if (intervalo - 50 > 0) {
      candidatos.push({
        km: intervalo - 50,
        mensagem: `Troca de Óleo: O veículo ${nome}${pl} está a 50 km da próxima troca de óleo (intervalo: ${intervalo} km).`,
      });
    }
    candidatos.push({
      km: intervalo,
      mensagem: `Troca de Óleo: O veículo ${nome}${pl} atingiu o intervalo de troca de óleo (${intervalo} km). Realize a troca!`,
    });

    // Past-due: every 20km
    if (kmDesdeBase > intervalo) {
      const blocos = Math.floor((kmDesdeBase - intervalo) / 20);
      for (let i = 1; i <= blocos; i++) {
        const kmAtrasado = i * 20;
        candidatos.push({
          km: intervalo + kmAtrasado,
          mensagem: `Troca de Óleo Atrasada: O veículo ${nome}${pl} passou ${kmAtrasado} km do intervalo de troca de óleo. Realize a troca o quanto antes!`,
        });
      }
    }

    // Find first uncrossed threshold
    const proximo = candidatos.find(c => kmDesdeBase >= c.km && ultima < c.km);
    if (!proximo) return;

    await this._salvarEEnviar(clienteLoginId, dispositivo, pref, 'trocaOleo', proximo.mensagem);
    await prisma.estadoKmNotificacao.update({
      where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: 'trocaOleo' } },
      data: { ultimaNotificacaoKm: proximo.km },
    });
  }

  private async _verificarManutencaoRecorrencias(
    dispositivo: DispositivoBasico,
    odometroMetros: number,
    clienteLogins: Array<{ id: string; email: string; ativo: boolean }>,
  ) {
    const eventosDetectados: any[] = [];
    const targets: Array<{ clienteLoginId: string; pref: { web: boolean; app: boolean; email: boolean } }> = [];
    for (const login of clienteLogins) {
      const pref = await prisma.preferenciaNotificacao.findUnique({
        where: {
          clienteLoginId_dispositivoId_tipoEvento: {
            clienteLoginId: login.id,
            dispositivoId: dispositivo.id,
            tipoEvento: 'manutencao',
          },
        },
      });
      if (pref && (pref.web || pref.app || pref.email)) {
        targets.push({ clienteLoginId: login.id, pref });
      }
    }
    if (!targets.length) return eventosDetectados;

    const recorrenciasRaw = await prisma.manutencaoRecorrencia.findMany({
      where: { dispositivoId: dispositivo.id, ativa: true },
      include: { clienteLogin: { select: { clienteId: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // Ignora recorrências CLIENTE cujo criador não é mais o responsável atual pelo dispositivo
    const recorrenciasValidas = recorrenciasRaw.filter(r => {
      if (r.origem === 'ADMIN') return true;
      return r.clienteLogin?.clienteId === dispositivo.clienteId;
    });
    const recorrencias = this._deduplicarRecorrenciasManutencao(recorrenciasValidas);

    const odometroKm = odometroMetros / 1000;
    const nome = dispositivo.nome;
    const pl = dispositivo.placa ? ` (${dispositivo.placa})` : '';

    for (const rec of recorrencias) {
      const targetsRecorrencia = rec.origem === 'CLIENTE' && rec.clienteLoginId
        ? targets.filter(t => t.clienteLoginId === rec.clienteLoginId)
        : targets;
      if (!targetsRecorrencia.length) continue;
      const kmPercorrido = odometroKm - rec.kmBase;
      const intervalo = rec.intervaloKm;
      const titulo = rec.titulo;

      // Pre-due: 50 km before (orange)
      if (!rec.alerta50Enviado && kmPercorrido >= intervalo - 50) {
        const kmRestante = Math.max(0, Math.round(intervalo - kmPercorrido));
        const mensagem = `Manutenção Próxima: "${titulo}" no veículo ${nome}${pl} — faltam ${kmRestante} km para o próximo serviço (intervalo: ${intervalo} km).`;
        eventosDetectados.push(...await this._notificarTargetsManutencao(targetsRecorrencia, dispositivo, 'manutencaoAlerta', mensagem, rec.origem, rec.id));
        await prisma.manutencaoRecorrencia.update({ where: { id: rec.id }, data: { alerta50Enviado: true } });
        rec.alerta50Enviado = true;
      }

      // Pre-due: 25 km before (orange)
      if (!rec.alerta25Enviado && kmPercorrido >= intervalo - 25) {
        const kmRestante = Math.max(0, Math.round(intervalo - kmPercorrido));
        const mensagem = `Manutenção Urgente: "${titulo}" no veículo ${nome}${pl} — faltam apenas ${kmRestante} km para o próximo serviço!`;
        eventosDetectados.push(...await this._notificarTargetsManutencao(targetsRecorrencia, dispositivo, 'manutencaoAlerta', mensagem, rec.origem, rec.id));
        await prisma.manutencaoRecorrencia.update({ where: { id: rec.id }, data: { alerta25Enviado: true } });
        rec.alerta25Enviado = true;
      }

      // At limit (orange → transitions to red on post-due)
      if (!rec.alerta0Enviado && kmPercorrido >= intervalo) {
        const mensagem = `Manutenção Devida: "${titulo}" no veículo ${nome}${pl} atingiu o intervalo de ${intervalo} km. Realize o serviço!`;
        eventosDetectados.push(...await this._notificarTargetsManutencao(targetsRecorrencia, dispositivo, 'manutencaoAlerta', mensagem, rec.origem, rec.id));
        await prisma.manutencaoRecorrencia.update({ where: { id: rec.id }, data: { alerta0Enviado: true } });
        rec.alerta0Enviado = true;
      }

      // Post-due: every 50 km after the limit (red)
      if (kmPercorrido > intervalo) {
        const blocos = Math.floor((kmPercorrido - intervalo) / 50);
        const ultima = rec.ultimaAlertaPostDueKm ?? -1;
        for (let i = 1; i <= blocos; i++) {
          const kmAtrasado = i * 50;
          if (ultima < kmAtrasado) {
            const mensagem = `Manutenção Atrasada: "${titulo}" no veículo ${nome}${pl} está ${kmAtrasado} km acima do intervalo recomendado (${intervalo} km). Realize o serviço urgente!`;
            eventosDetectados.push(...await this._notificarTargetsManutencao(targetsRecorrencia, dispositivo, 'manutencaoAtrasada', mensagem, rec.origem, rec.id));
            await prisma.manutencaoRecorrencia.update({ where: { id: rec.id }, data: { ultimaAlertaPostDueKm: kmAtrasado } });
            break;
          }
        }
      }
    }
    return eventosDetectados;
  }

  async verificarRecorrenciasDataTodas() {
    try {
      const agora = _inicioDiaSaoPaulo();

      // Busca todas as recorrências ativas cujo dataReferencia já é relevante (até 7 dias à frente)
      const limite7d = new Date(agora);
      limite7d.setDate(limite7d.getDate() + 7);

      const recorrencias = await prisma.manutencaoRecorrenciaData.findMany({
        where: {
          ativa: true,
          dataReferencia: { lte: limite7d },
        },
        include: {
          dispositivo: { select: { id: true, nome: true, placa: true, identificador: true, traccarId: true, clienteId: true, manutencaoAtiva: true } },
          clienteLogin: { select: { id: true, clienteId: true, ativo: true } },
        },
      });

      for (const rec of recorrencias) {
        if (!rec.dispositivo.manutencaoAtiva) continue;

        // Verifica se o criador ainda é responsável
        if (rec.origem === 'CLIENTE' && rec.clienteLogin?.clienteId !== rec.dispositivo.clienteId) continue;

        await this._verificarAlertasRecorrenciaData(rec as any, agora);
      }

      // Verifica recorrências atrasadas (passaram da data e não foram marcadas como feitas)
      const recAtrasadas = await prisma.manutencaoRecorrenciaData.findMany({
        where: { ativa: true, dataReferencia: { lt: agora } },
        include: {
          dispositivo: { select: { id: true, nome: true, placa: true, identificador: true, traccarId: true, clienteId: true, manutencaoAtiva: true } },
          clienteLogin: { select: { id: true, clienteId: true, ativo: true } },
        },
      });

      for (const rec of recAtrasadas) {
        if (!rec.dispositivo.manutencaoAtiva) continue;
        if (rec.origem === 'CLIENTE' && rec.clienteLogin?.clienteId !== rec.dispositivo.clienteId) continue;
        await this._verificarAlertaPosDueData(rec as any, agora);
      }
    } catch (err) {
      console.error('[NotifData] Erro ao verificar recorrências por data:', err);
    }
  }

  private async _verificarAlertasRecorrenciaData(rec: any, agora: Date) {
    const data = new Date(rec.dataReferencia);
    data.setHours(0, 0, 0, 0);
    const diffDias = Math.ceil((data.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24));

    const targets = await this._buscarTargetsRecorrenciaData(rec);
    if (!targets.length) return;

    const nome = rec.dispositivo.nome;
    const pl = rec.dispositivo.placa ? ` (${rec.dispositivo.placa})` : '';
    const dataStr = data.toLocaleDateString('pt-BR');

    const atualizacoes: Record<string, boolean> = {};

    if (!rec.alerta7dEnviado && diffDias <= 7 && diffDias > 4) {
      const msg = `Lembrete: "${rec.titulo}" no veículo ${nome}${pl} está agendado para ${dataStr} (em ${diffDias} dias).`;
      await this._notificarTargetsData(targets, rec.dispositivo, 'recorrenciaDataAlerta', msg, rec.origem, rec.id, rec.canalNotificacao);
      atualizacoes.alerta7dEnviado = true;
    }
    if (!rec.alerta4dEnviado && diffDias <= 4 && diffDias > 2) {
      const msg = `Lembrete: "${rec.titulo}" no veículo ${nome}${pl} está em ${diffDias} dias (${dataStr}).`;
      await this._notificarTargetsData(targets, rec.dispositivo, 'recorrenciaDataAlerta', msg, rec.origem, rec.id, rec.canalNotificacao);
      atualizacoes.alerta4dEnviado = true;
    }
    if (!rec.alerta2dEnviado && diffDias <= 2 && diffDias > 1) {
      const msg = `Atenção: "${rec.titulo}" no veículo ${nome}${pl} é em 2 dias (${dataStr}).`;
      await this._notificarTargetsData(targets, rec.dispositivo, 'recorrenciaDataAlerta', msg, rec.origem, rec.id, rec.canalNotificacao);
      atualizacoes.alerta2dEnviado = true;
    }
    if (!rec.alerta1dEnviado && diffDias <= 1 && diffDias > 0) {
      const msg = `Urgente: "${rec.titulo}" no veículo ${nome}${pl} é AMANHÃ (${dataStr})!`;
      await this._notificarTargetsData(targets, rec.dispositivo, 'recorrenciaDataAlerta', msg, rec.origem, rec.id, rec.canalNotificacao);
      atualizacoes.alerta1dEnviado = true;
    }
    if (!rec.alertaDiaEnviado && diffDias === 0) {
      const msg = `Hoje: "${rec.titulo}" no veículo ${nome}${pl} está agendado para HOJE!`;
      await this._notificarTargetsData(targets, rec.dispositivo, 'recorrenciaDataAlerta', msg, rec.origem, rec.id, rec.canalNotificacao);
      atualizacoes.alertaDiaEnviado = true;
    }

    if (Object.keys(atualizacoes).length) {
      await prisma.manutencaoRecorrenciaData.update({ where: { id: rec.id }, data: atualizacoes });
    }
  }

  private async _verificarAlertaPosDueData(rec: any, agora: Date) {
    const ultima = rec.ultimoAlertaPosDue ? new Date(rec.ultimoAlertaPosDue) : null;
    const umDia = 24 * 60 * 60 * 1000;
    if (ultima && agora.getTime() - ultima.getTime() < umDia) return;

    const targets = await this._buscarTargetsRecorrenciaData(rec);
    if (!targets.length) return;

    const data = new Date(rec.dataReferencia);
    const diffDias = Math.ceil((agora.getTime() - data.getTime()) / (1000 * 60 * 60 * 24));
    const nome = rec.dispositivo.nome;
    const pl = rec.dispositivo.placa ? ` (${rec.dispositivo.placa})` : '';
    const dataStr = data.toLocaleDateString('pt-BR');
    const msg = `Pendente: "${rec.titulo}" no veículo ${nome}${pl} estava agendado para ${dataStr} (há ${diffDias} dia(s)) e ainda não foi confirmado.`;

    await this._notificarTargetsData(targets, rec.dispositivo, 'recorrenciaDataNaoFeita', msg, rec.origem, rec.id, rec.canalNotificacao);
    await prisma.manutencaoRecorrenciaData.update({ where: { id: rec.id }, data: { ultimoAlertaPosDue: agora } });
  }

  private async _buscarTargetsRecorrenciaData(rec: any): Promise<Array<{ clienteLoginId: string; pref: { web: boolean; app: boolean; email: boolean } }>> {
    const targets: Array<{ clienteLoginId: string; pref: { web: boolean; app: boolean; email: boolean } }> = [];

    const candidatos = rec.clienteLoginId
      ? [{ id: rec.clienteLoginId }]
      : await prisma.clienteLogin.findMany({
          where: { cliente: { dispositivos: { some: { id: rec.dispositivoId } } }, ativo: true },
          select: { id: true },
        });

    for (const c of candidatos) {
      // Tenta primeiro preferência específica 'recorrenciaData', depois fallback para 'manutencao'
      let pref = await prisma.preferenciaNotificacao.findUnique({
        where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId: c.id, dispositivoId: rec.dispositivoId, tipoEvento: 'recorrenciaData' } },
      });
      if (!pref || (!pref.web && !pref.app && !pref.email)) {
        pref = await prisma.preferenciaNotificacao.findUnique({
          where: { clienteLoginId_dispositivoId_tipoEvento: { clienteLoginId: c.id, dispositivoId: rec.dispositivoId, tipoEvento: 'manutencao' } },
        });
      }
      const canal = rec.canalNotificacao || 'todos';
      const webOn = canal === 'todos' || canal === 'web' || canal === 'web_app' || canal === 'web_email';
      const appOn = canal === 'todos' || canal === 'app' || canal === 'web_app' || canal === 'app_email';
      const emailOn = canal === 'todos' || canal === 'email' || canal === 'web_email' || canal === 'app_email';
      if (pref && (pref.web || pref.app || pref.email)) {
        targets.push({ clienteLoginId: c.id, pref: { web: pref.web && webOn, app: pref.app && appOn, email: pref.email && emailOn } });
      }
    }
    return targets;
  }

  private async _notificarTargetsData(
    targets: Array<{ clienteLoginId: string; pref: { web: boolean; app: boolean; email: boolean } }>,
    dispositivo: DispositivoBasico,
    tipo: 'recorrenciaDataAlerta' | 'recorrenciaDataNaoFeita',
    mensagem: string,
    origemTipo?: string | null,
    origemId?: string | null,
    _canal?: string,
  ) {
    for (const target of targets) {
      await this._salvarEEnviar(target.clienteLoginId, dispositivo, target.pref, tipo, mensagem, origemTipo, origemId);
    }
  }

  private _deduplicarRecorrenciasManutencao<T extends { titulo: string; intervaloKm: number; kmBase: number; origem?: string | null; clienteLoginId?: string | null; id?: string }>(recorrencias: T[]): T[] {
    const vistos = new Set<string>();
    return recorrencias.filter((rec) => {
      const chave = `${rec.titulo.trim().toLowerCase()}|${rec.intervaloKm}|${Math.round(rec.kmBase)}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
  }

  private async _notificarTargetsManutencao(
    targets: Array<{ clienteLoginId: string; pref: { web: boolean; app: boolean; email: boolean } }>,
    dispositivo: DispositivoBasico,
    tipo: 'manutencaoAlerta' | 'manutencaoAtrasada',
    mensagem: string,
    origemTipo?: string | null,
    origemId?: string | null,
  ) {
    const eventos: any[] = [];
    for (const target of targets) {
      const evento = await this._salvarEEnviar(target.clienteLoginId, dispositivo, target.pref, tipo, mensagem, origemTipo, origemId);
      if (evento && !eventos.length) eventos.push(evento);
    }
    return eventos;
  }

  private async _salvarEEnviar(
    clienteLoginId: string,
    dispositivo: DispositivoBasico,
    pref: { web: boolean; app: boolean; email: boolean },
    tipo: string,
    mensagem: string,
    origemTipo?: string | null,
    origemId?: string | null,
  ) {
    let wsEvent: any = null;
    if (pref.web || pref.app) {
      await prisma.eventoNotificacao.create({
        data: { clienteLoginId, dispositivoId: dispositivo.id, tipoEvento: tipo, origemTipo: origemTipo ?? null, origemId: origemId ?? null, mensagem, latitude: null, longitude: null, velocidade: null },
      });
      wsEvent = {
        deviceId: dispositivo.traccarId,
        dispositivoId: dispositivo.id,
        type: tipo,
        tipoLabel: this.getLabelTipo(tipo),
        serverTime: new Date().toISOString(),
        mensagem,
        lat: null,
        lng: null,
        endereco: null,
        origemTipo: origemTipo ?? null,
        origemId: origemId ?? null,
        clienteLoginId,
        adminEvento: false,
      };
    }
    if (pref.email) {
      const loginData = await prisma.clienteLogin.findUnique({ where: { id: clienteLoginId }, include: { cliente: { select: { nome: true } } } });
      if (loginData) {
        const html = EmailService.gerarTemplateAlerta(
          loginData.cliente.nome,
          dispositivo.nome,
          dispositivo.placa || '',
          this.getLabelTipo(tipo),
          new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
          undefined,
        );
        await EmailService.enviarEmail(loginData.email, `Alerta: ${this.getLabelTipo(tipo)} — ${dispositivo.nome}`, html);
      }
    }
    if (pref.app) {
      await ExpoPushService.enviarParaCliente(clienteLoginId, {
        title: this.getLabelTipo(tipo),
        body: mensagem,
        data: { tipo, dispositivoId: dispositivo.id },
      });
    }
    return wsEvent;
  }

  private async _getAdminPrefs() {
    if (!this._adminPrefsCache || Date.now() - this._adminPrefsCache.at > 30_000) {
      const data = await prisma.adminPreferencia.findMany();
      this._adminPrefsCache = { data, at: Date.now() };
    }
    return this._adminPrefsCache.data;
  }

  private async _criarEventoAdmin(
    tipo: string,
    dispositivo: DispositivoBasico,
    dados: any,
    clientesMap: Map<string, { id: string; nome: string; login: { id: string; email: string; ativo: boolean } | null }>,
  ) {
    // Dedup: cria no máximo 1 evento admin por dispositivo+tipo por minuto
    const chave = `${dispositivo.id}_${tipo}`;
    const agora = Date.now();
    if (agora - (this._lastAdminEventAt.get(chave) || 0) <= 60_000) return;

    const tipoAdmin = _tipoPreferenciaAdmin(tipo);
    const adminPrefs = await this._getAdminPrefs();
    const algumAdminHabilitou = adminPrefs.some(a => !!(a.prefs as Record<string, unknown>)?.[tipoAdmin]);
    if (!algumAdminHabilitou) return;

    // Precisa de um clienteLoginId válido como âncora FK no schema
    const refCliente = Array.from(clientesMap.values()).find(c => c.login?.ativo);
    const refLoginId = refCliente?.login?.id;
    if (!refLoginId) return;

    this._lastAdminEventAt.set(chave, agora);

    const mensagem = this.gerarMensagem(tipo, dispositivo.nome, dispositivo.placa, dados);
    const endereco = await this.resolverEnderecoEvento(dados);
    await prisma.eventoNotificacao.create({
      data: {
        clienteLoginId: refLoginId,
        dispositivoId: dispositivo.id,
        tipoEvento: tipo,
        origemTipo: dados.origemTipo ?? null,
        origemId: dados.origemId ?? (dados.geofenceId != null ? String(dados.geofenceId) : null),
        adminEvento: true,
        mensagem,
        latitude: dados.latitude ?? null,
        longitude: dados.longitude ?? null,
        endereco,
        velocidade: dados.velocidade ?? null,
      },
    });
  }

  private getLabelTipo(tipo: string) {
    const labels: Record<string, string> = {
      ignitionOn:    'Ignição Ligada',
      ignitionOff:   'Ignição Desligada',
      geofenceEnter: 'Entrada em Zona de Segurança',
      geofenceExit:  'Saída de Zona de Segurança',
      overspeed:     'Excesso de Velocidade',
      powerCut:      'Alimentação Cortada',
      alarm:         'Alarme',
      deviceLocked:  'Veículo Bloqueado',
      deviceUnlocked:'Veículo Desbloqueado',
      kmExcedida:    'Quilometragem Excedida',
      kmReduzida:       'Quilometragem Reduzida',
      trocaOleo:        'Troca de Óleo',
      manutencao:       'Manutenção',
      manutencaoAlerta: 'Alerta de Manutenção',
      manutencaoAtrasada: 'Manutenção Atrasada',
      manutencaoFeita:  'Manutenção Realizada',
      recorrenciaDataAlerta: 'Alerta de Recorrência',
      recorrenciaDataNaoFeita: 'Recorrência Pendente',
      recorrenciaDataFeita: 'Recorrência Realizada',
      boletoVencendoHoje: 'Boleto vence hoje',
      boletoAtrasado: 'Boleto em atraso',
      pagamentoRecebido: 'Pagamento recebido',
    };
    return labels[tipo] || tipo;
  }

  private gerarMensagem(tipo: string, nome: string, placa: string | null, dados: any) {
    const p = placa ? `(${placa})` : '';
    switch (tipo) {
      case 'ignitionOn':    return `Ignição Ligada: O veículo ${nome} ${p} foi ligado.`;
      case 'ignitionOff':   return `Ignição Desligada: O veículo ${nome} ${p} foi desligado.`;
      case 'geofenceEnter': {
        const zona = dados.geofenceNome ? `: ${dados.geofenceNome}` : '';
        return `Zona de Segurança: O veículo ${nome} ${p} entrou em uma área monitorada${zona}.`;
      }
      case 'geofenceExit': {
        const zona = dados.geofenceNome ? `: ${dados.geofenceNome}` : '';
        return `Zona de Segurança: O veículo ${nome} ${p} saiu de uma área monitorada${zona}.`;
      }
      case 'overspeed':     return `Excesso de Velocidade: O veículo ${nome} ${p} atingiu ${dados.velocidade} km/h (limite: ${dados.limiteConfigurado ?? '—'} km/h).`;
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
