import { tokenStorage } from '../storage/tokenStorage';
import { environment } from '../config/environment';

// Formato exato que o backend envia via WebSocket
export type WsPosition = {
  deviceId: number;
  latitude: number;
  longitude: number;
  velocidade?: number | null;
  curso?: number | null;
  fixTime?: string | null;
  deviceTime?: string | null;
  serverTime?: string | null;
  endereco?: string | null;
  ignicao?: boolean | null;
  emMovimento?: boolean | null;
  alarme?: string | null;
  bloqueado?: boolean | null;
  bateria_nivel?: number | null;
  tensao?: number | null;
  sinal?: number | null;
  odometro?: number | null;
  horas_motor?: number | null;
};

export type WsEvent = {
  deviceId?: number;
  dispositivoId?: string;
  type: string;
  tipoLabel?: string;
  serverTime?: string;
  mensagem?: string;
  lat?: number | null;
  lng?: number | null;
  endereco?: string | null;
};

export type TrackingMessage = {
  positions?: WsPosition[];
  events?: WsEvent[];
};

export type TrackingMessageHandler = (message: TrackingMessage) => void;

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

class TrackingWebSocket {
  private ws: WebSocket | null = null;
  private handlers: Set<TrackingMessageHandler> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isIntentionalClose = false;
  private shouldReconnect = false;

  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const token = await tokenStorage.get();
    if (!token) return;

    this.isIntentionalClose = false;
    this.shouldReconnect = true;

    return new Promise<void>((resolve, reject) => {
      const wsUrl = `${environment.wsUrl}?token=${encodeURIComponent(token)}`;

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as TrackingMessage;
            this.handlers.forEach((handler) => handler(data));
          } catch {}
        };

        this.ws.onerror = () => {
          reject(new Error('WebSocket error'));
        };

        this.ws.onclose = () => {
          if (!this.isIntentionalClose && this.shouldReconnect) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(() => {});
    }, RECONNECT_DELAY);
  }

  disconnect() {
    this.shouldReconnect = false;
    this.isIntentionalClose = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  subscribe(handler: TrackingMessageHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const trackingWs = new TrackingWebSocket();
