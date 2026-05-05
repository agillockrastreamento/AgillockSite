import { useCallback, useEffect, useRef } from 'react';

import { trackingWs, type TrackingMessage } from './trackingWebSocket';
import type { TrackingDevice, TraccarDeviceIndex } from './trackingTypes';

function hasDeviceId(msg: TrackingMessage): msg is TrackingMessage & { deviceId: number } {
  return 'deviceId' in msg && typeof msg.deviceId === 'number';
}

export function useTrackingWebSocket(
  devices: TrackingDevice[],
  traccarIndex: TraccarDeviceIndex,
  onMessage: (message: TrackingMessage, dispositivoId: string) => void,
) {
  const devicesRef = useRef(devices);
  devicesRef.current = devices;

  const handleMessage = useCallback(
    (message: TrackingMessage) => {
      if (hasDeviceId(message)) {
        const dispositivoId = traccarIndex[message.deviceId];
        if (dispositivoId) {
          onMessage(message, dispositivoId);
        }
      }
    },
    [traccarIndex, onMessage],
  );

  useEffect(() => {
    trackingWs.connect().then(() => {
      const unsubscribe = trackingWs.subscribe(handleMessage);
      return unsubscribe;
    });

    return () => {
      trackingWs.disconnect();
    };
  }, [handleMessage]);

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
          posicao: message.position ?? device.posicao,
          lastUpdate: message.position?.serverTime ?? message.position?.deviceTime ?? device.lastUpdate,
        };
      }
      return device;
    });
  }

  return devices;
}