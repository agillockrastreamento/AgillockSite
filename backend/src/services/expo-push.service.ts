import prisma from '../utils/prisma';

type ExpoMessage = {
  to: string;
  sound?: 'default';
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'default' | 'normal' | 'high';
};

type SendOptions = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

function isExpoPushToken(token: string): boolean {
  return /^ExponentPushToken\[[^\]]+\]$/.test(token) || /^ExpoPushToken\[[^\]]+\]$/.test(token);
}

class ExpoPushService {
  isValidToken(token: string): boolean {
    return isExpoPushToken(token);
  }

  async enviarParaCliente(clienteLoginId: string, options: SendOptions): Promise<void> {
    const tokens = await prisma.appPushToken.findMany({
      where: { clienteLoginId, ativo: true },
      select: { id: true, token: true },
    });

    const validos = tokens.filter(item => isExpoPushToken(item.token));
    const invalidos = tokens.filter(item => !isExpoPushToken(item.token));

    if (invalidos.length) {
      await prisma.appPushToken.updateMany({
        where: { id: { in: invalidos.map(item => item.id) } },
        data: { ativo: false, ultimoErro: 'Token Expo inválido.' },
      });
    }

    if (!validos.length) return;

    for (let i = 0; i < validos.length; i += CHUNK_SIZE) {
      const chunk = validos.slice(i, i + CHUNK_SIZE);
      const messages: ExpoMessage[] = chunk.map(item => ({
        to: item.token,
        sound: 'default',
        title: options.title,
        body: options.body,
        data: options.data,
        priority: 'high',
      }));

      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messages),
        });

        const payload = await res.json().catch(() => null) as any;
        if (!res.ok) {
          const erro = payload?.errors?.[0]?.message || payload?.message || `Expo Push HTTP ${res.status}`;
          await this.marcarErro(chunk.map(item => item.id), erro, false);
          continue;
        }

        const results = Array.isArray(payload?.data) ? payload.data : [];
        await Promise.all(chunk.map(async (item, index) => {
          const result = results[index];
          if (!result || result.status === 'ok') {
            await prisma.appPushToken.update({
              where: { id: item.id },
              data: { ultimoErro: null, lastSeenAt: new Date() },
            }).catch(() => undefined);
            return;
          }

          const erro = result.message || result.details?.error || 'Falha ao enviar push Expo.';
          const desativar = result.details?.error === 'DeviceNotRegistered';
          await this.marcarErro([item.id], erro, desativar);
        }));
      } catch (err: any) {
        await this.marcarErro(chunk.map(item => item.id), err?.message || 'Falha de rede no Expo Push.', false);
      }
    }
  }

  private async marcarErro(ids: string[], erro: string, desativar: boolean): Promise<void> {
    if (!ids.length) return;
    await prisma.appPushToken.updateMany({
      where: { id: { in: ids } },
      data: { ultimoErro: erro, ...(desativar ? { ativo: false } : {}) },
    }).catch(() => undefined);
  }
}

export default new ExpoPushService();
