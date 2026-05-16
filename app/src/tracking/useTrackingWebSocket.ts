import { useCallback, useEffect, useRef } from 'react';

import { trackingWs, type TrackingMessage, type WsPosition } from './trackingWebSocket';
import type { TrackingDevice, TraccarDeviceIndex } from './trackingTypes';

export function useTrackingWebSocket(
  _devices: TrackingDevice[],
  traccarIndex: TraccarDeviceIndex,
  onMessage: (position: WsPosition, dispositivoId: string) => void,
) {
  // Refs keep the latest values without triggering effect re-runs
  const traccarIndexRef = useRef(traccarIndex);
  traccarIndexRef.current = traccarIndex;

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const handler = (message: TrackingMessage) => {
      for (const pos of message.positions ?? []) {
        const dispositivoId = traccarIndexRef.current[pos.deviceId];
        if (dispositivoId) {
          onMessageRef.current(pos, dispositivoId);
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
