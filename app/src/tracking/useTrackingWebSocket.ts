import { useCallback, useEffect, useRef } from 'react';

import { trackingWs, type TrackingMessage } from './trackingWebSocket';
import type { TrackingDevice, TraccarDeviceIndex } from './trackingTypes';

function hasDeviceId(msg: TrackingMessage): msg is TrackingMessage & { deviceId: number } {
  return 'deviceId' in msg && typeof msg.deviceId === 'number';
}

export function useTrackingWebSocket(
  _devices: TrackingDevice[],
  traccarIndex: TraccarDeviceIndex,
  onMessage: (message: TrackingMessage, dispositivoId: string) => void,
) {
  // Refs keep the latest values without triggering effect re-runs
  const traccarIndexRef = useRef(traccarIndex);
  traccarIndexRef.current = traccarIndex;

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const handler = (message: TrackingMessage) => {
      if (hasDeviceId(message)) {
        const dispositivoId = traccarIndexRef.current[message.deviceId];
        if (dispositivoId) {
          onMessageRef.current(message, dispositivoId);
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
  }, []); // Run once — handler always reads latest values via refs

  const isConnected = useCallback(() => trackingWs.isConnected(), []);
  return { isConnected };
}

export function updateDeviceFromMessage(
  devices: TrackingDevice[],
  dispositivoId: string,
  message: TrackingMessage,
): TrackingDevice[] {
  if (message.type === 'POSITION') {
    return devices.map((device) => {
      if (device.dispositivoId === dispositivoId) {
        return {
          ...device,
          status: 'online',
          posicao: message.position,
          lastUpdate: message.position.serverTime ?? message.position.deviceTime ?? null,
        };
      }
      return device;
    });
  }

  if (message.type === 'ALARM') {
    return devices.map((device) => {
      if (device.dispositivoId === dispositivoId) {
        return {
          ...device,
          status: 'online',
          posicao: message.position ?? device.posicao,
          lastUpdate: message.position?.serverTime ?? message.position?.deviceTime ?? device.lastUpdate,
          alarme: message.alarm,
        };
      }
      return device;
    });
  }

  if (message.type === 'EVENT') {
    return devices.map((device) => {
      if (device.dispositivoId === dispositivoId) {
        return {
          ...device,
          status: 'online',
          posicao: message.position ?? device.posicao,
          lastUpdate: message.position?.serverTime ?? message.position?.deviceTime ?? device.lastUpdate,
        };
      }
      return device;
    });
  }

  return devices;
}
