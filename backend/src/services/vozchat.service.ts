/**
 * Cliente HTTP AgilLock → VozChat (add-on "Ágil Lock").
 * Empurra cobranças em atraso e dispara a mensagem de boas-vindas + PDF do guia.
 * Autentica com a API key do tenant do VozChat (Authorization: Bearer fc_live_...).
 *
 * Config por env:
 *   VOZCHAT_API_URL  (ex.: https://app.vozchat.tech)
 *   VOZCHAT_API_KEY  (fc_live_... do tenant agil-lock)
 *   WHATSAPP_INTEGRACAO_ATIVA=true  (liga os disparos; ausente/false = no-op)
 */

export interface CobrancaItem {
  telefone: string;
  nome?: string | null;
  diasAtraso: number;
  valor?: string | null;
  vencimento?: string | null;   // 'YYYY-MM-DD'
  codigoBarras?: string | null;
  linkBoleto?: string | null;
}

export interface BoasVindasPayload {
  telefone: string;
  nome?: string | null;
  login?: string | null;
  senha?: string | null;
  incluirGuia?: boolean;
}

function ativo(): boolean {
  return String(process.env.WHATSAPP_INTEGRACAO_ATIVA || '').toLowerCase() === 'true';
}

function config(): { base: string; key: string } | null {
  const base = process.env.VOZCHAT_API_URL;
  const key = process.env.VOZCHAT_API_KEY;
  if (!base || !key) return null;
  return { base: base.replace(/\/+$/, ''), key };
}

async function post(path: string, body: unknown): Promise<any> {
  const cfg = config();
  if (!cfg) {
    console.warn('[VozChat] integração não configurada (VOZCHAT_API_URL / VOZCHAT_API_KEY ausentes).');
    return { success: false, error: 'NAO_CONFIGURADO' };
  }
  const resp = await fetch(`${cfg.base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error(`[VozChat] ${path} → HTTP ${resp.status}:`, (data as any)?.error || '');
    return { success: false, status: resp.status, ...(data as object) };
  }
  return data;
}

class VozChatService {
  configurado(): boolean {
    return ativo() && !!config();
  }

  /** Empurra os boletos em atraso (o VozChat move o card + envia a mensagem neutra). */
  async syncCobrancas(itens: CobrancaItem[]): Promise<{ success: boolean; processados?: number; enviados?: number }> {
    if (!ativo() || itens.length === 0) return { success: false };
    try {
      return await post('/api/integracao/agillock/cobrancas/sync', { itens });
    } catch (err: any) {
      console.error('[VozChat] syncCobrancas falhou:', err?.message || err);
      return { success: false };
    }
  }

  /** Dispara a mensagem de boas-vindas (credenciais + PDF do guia) pelo Baileys do VozChat. */
  async enviarBoasVindas(payload: BoasVindasPayload): Promise<{ success: boolean; enviado?: boolean }> {
    if (!ativo()) return { success: false, enviado: false };
    try {
      return await post('/api/integracao/agillock/boas-vindas/enviar', payload);
    } catch (err: any) {
      console.error('[VozChat] enviarBoasVindas falhou:', err?.message || err);
      return { success: false, enviado: false };
    }
  }
}

export default new VozChatService();
