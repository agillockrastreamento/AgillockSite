import { tokenStorage } from '../storage/tokenStorage';
import { environment } from '../config/environment';
import type { TrackingPosition } from './trackingTypes';

export type TrackingMessage =
  | {
      type: 'POSITION';
      deviceId: number;
      position: TrackingPosition;
    }
  | {
      type: 'ALARM';
      deviceId: number;
      alarm: string;
      position?: TrackingPosition;
    }
  | {
      type: 'EVENT';
      deviceId: number;
      eventType: string;
      position?: TrackingPosition;
    }
  | {
      type: 'ACK';
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