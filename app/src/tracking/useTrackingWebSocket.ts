import { useCallback, useEffect, useRef } from 'react';

import { trackingWs, type TrackingMessage, type WsEvent, type WsPosition } from './trackingWebSocket';
import type { TrackingDevice, TraccarDeviceIndex } from './trackingTypes';

export function useTrackingWebSocket(
  _devices: TrackingDevice[],
  traccarIndex: TraccarDeviceIndex,
  onMessage: (position: WsPosition, dispositivoId: string) => void,
  onEvent?: (event: WsEvent, dispositivoId: string) => void,
) {
  // Refs keep the latest values without triggering effect re-runs
  const traccarIndexRef = useRef(traccarIndex);
  traccarIndexRef.current = traccarIndex;

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const deviceIdsRef = useRef(new Set(_devices.map(device => device.dispositivoId)));
  deviceIdsRef.current = new Set(_devices.map(device => device.dispositivoId));

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const handler = (message: TrackingMessage) => {
      for (const pos of message.positions ?? []) {
        const dispositivoId = traccarIndexRef.current[pos.deviceId];
        if (dispositivoId) {
          onMessageRef.current(pos, dispositivoId);
        }
      }
      for (const event of message.events ?? []) {
        const dispositivoId = event.dispositivoId ?? (event.deviceId != null ? traccarIndexRef.current[event.deviceId] : undefined);
        if (dispositivoId && deviceIdsRef.current.has(dispositivoId)) {
          onEventRef.current?.(event, dispositivoId);
        }
      }
    };

    trackingWs.connect()
      .then(() => { unsubscribe = trackingWs.subscribe(handler); })
      .catch(() => {});

    return () => {
      unsubscribe?.();
      trackingWs.disconnect();
    };
  }, []); // Run once — handler reads latest values via refs

  const isConnected = useCallback(() => trackingWs.isConnected(), []);
  return { isConnected };
}

export function updateDeviceFromMessage(
  devices: TrackingDevice[],
  dispositivoId: string,
  position: WsPosition,
): TrackingDevice[] {
  return devices.map((device) => {
    if (device.dispositivoId !== dispositivoId) return device;
    return {
      ...device,
      status: 'online',
      // Motorista do cartão RFID: acompanha a troca de motorista sem recarregar
      motorista: 'motorista' in position ? position.motorista ?? null : device.motorista,
      posicao: {
        latitude: position.latitude,
        longitude: position.longitude,
        velocidade: position.velocidade ?? null,
        curso: position.curso ?? null,
        fixTime: position.fixTime ?? null,
        deviceTime: position.deviceTime ?? null,
        serverTime: position.serverTime ?? null,
        endereco: position.endereco ?? null,
        ignicao: position.ignicao ?? null,
        emMovimento: position.emMovimento ?? null,
        alarme: position.alarme ?? null,
        bloqueado: position.bloqueado ?? null,
        bateria_nivel: position.bateria_nivel ?? null,
        tensao: position.tensao ?? null,
        sinal: position.sinal ?? null,
        odometro: position.odometro ?? null,
        horas_motor: position.horas_motor ?? null,
      },
      lastUpdate: position.serverTime ?? position.deviceTime ?? null,
    };
  });
}
