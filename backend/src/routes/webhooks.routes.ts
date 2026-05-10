import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma';

const router = Router();

const WEBHOOK_SECRET = process.env.CLICKSIGN_WEBHOOK_SECRET || '';

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v?.trim())).map((v) => v.trim())));
}

function extractClicksignIds(payload: any): { documentIds: string[]; envelopeIds: string[] } {
  const documents = asArray(payload?.document);
  const data = payload?.data;
  const relationships = data?.relationships || payload?.relationships || {};

  return {
    documentIds: uniqueStrings([
      ...documents.flatMap((doc: any) => [doc?.key, doc?.id, doc?.document_key]),
      payload?.document?.key,
      payload?.document?.id,
      data?.type === 'documents' ? data?.id : null,
      relationships?.document?.data?.id,
      payload?.event?.data?.document?.key,
      payload?.event?.data?.document?.id,
    ]),
    envelopeIds: uniqueStrings([
      payload?.envelope?.id,
      payload?.envelope?.key,
      data?.type === 'envelopes' ? data?.id : null,
      relationships?.envelope?.data?.id,
      payload?.event?.data?.envelope?.id,
      payload?.event?.data?.envelope?.key,
    ]),
  };
}

function isDocumentoFinalizado(payload: any, eventName: string): boolean {
  const finalEvents = new Set(['close', 'auto_close', 'document_closed']);
  if (finalEvents.has(eventName)) return true;

  const documents = asArray(payload?.document);
  return documents.some((doc: any) => String(doc?.status || '').toLowerCase() === 'closed');
}

router.post('/clicksign',
  express.raw({ type: '*/*' }),
  async (req: Request, res: Response): Promise<void> => {
    const rawBody = req.body;

    // rawBody pode ser Buffer (quando express.raw() processa) ou Object (fallback)
    let bodyStr: string;
    if (Buffer.isBuffer(rawBody)) {
      bodyStr = rawBody.toString('utf8');
    } else if (typeof rawBody === 'string') {
      bodyStr = rawBody;
    } else {
      bodyStr = JSON.stringify(rawBody);
    }

    const hmacHeader = (req.headers['content-hmac'] as string) || '';

    if (WEBHOOK_SECRET) {
      const expected = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(bodyStr).digest('hex');
      if (hmacHeader !== expected) {
        res.status(401).json({ error: 'HMAC inválido' });
        return;
      }
    }

    let payload: any;
    try {
      payload = typeof rawBody === 'object' && !Buffer.isBuffer(rawBody)
        ? rawBody
        : JSON.parse(bodyStr);
    } catch {
      res.status(400).json({ error: 'Payload inválido' });
      return;
    }

    // ClickSign webhook format:
    // { event: { name: "cancel"|"close"|"auto_close"|"document_closed"|"sign"|..., ... }, document: { key: "uuid", ... } }
    const eventName: string = payload?.event?.name || '';
    const { documentIds, envelopeIds } = extractClicksignIds(payload);

    console.log(`[Webhook ClickSign] event=${eventName} documentIds=${documentIds.join(',') || '-'} envelopeIds=${envelopeIds.join(',') || '-'}`);

    if (!documentIds.length && !envelopeIds.length) {
      res.status(200).json({ ok: true });
      return;
    }

    // Busca pelos IDs enviados pela ClickSign em diferentes formatos do webhook.
    const where = {
      OR: [
        ...(documentIds.length ? [{ clicksignDocumentoId: { in: documentIds } }] : []),
        ...(envelopeIds.length ? [{ clicksignEnvelopeId: { in: envelopeIds } }] : []),
        ...(documentIds.length ? [{ clicksignEnvelopeId: { in: documentIds } }] : []),
      ],
    };

    if (isDocumentoFinalizado(payload, eventName)) {
      const result = await prisma.contrato.updateMany({
        where,
        data: { status: 'ASSINADO', assinadoEm: new Date() },
      });
      console.log(`[Webhook ClickSign] contratos assinados atualizados=${result.count}`);
    } else if (eventName === 'cancel') {
      const result = await prisma.contrato.updateMany({
        where,
        data: { status: 'CANCELADO' },
      });
      console.log(`[Webhook ClickSign] contratos cancelados atualizados=${result.count}`);
    }

    res.status(200).json({ ok: true });
  }
);

/**
 * Webhook para dispositivos ZHENCB (A01, A02, A03)
 * Formato esperado (do documento):
 * {
 *   "code": 200,
 *   "data": [
 *     {
 *       "deviceId": "D8:23:F9:58:D6:99",
 *       "latitude": "22.6846869",
 *       "longitude": "113.9786924",
 *       "timestamp": "2025-12-05T09:41:53",
 *       "accuracy": "103",
 *       ...
 *     }
 *   ],
 *   "message": "success"
 * }
 */
router.post('/zhencb',
  express.json(),
  async (req: Request, res: Response): Promise<void> => {
  const payload = req.body;
  const devices = payload?.data;

  if (!Array.isArray(devices)) {
    console.warn('[Webhook ZHENCB] Payload inválido: "data" não é um array');
    res.status(400).json({ error: 'Payload inválido' });
    return;
  }

  console.log(`[Webhook ZHENCB] Recebidos dados de ${devices.length} dispositivos`);

  const TRACCAR_OSMAND_URL = process.env.TRACCAR_OSMAND_URL || 'http://traccar:5055';

  // Processa cada dispositivo em paralelo (best-effort)
  const results = await Promise.allSettled(devices.map(async (device: any) => {
    const { deviceId, latitude, longitude, timestamp, accuracy } = device;

    if (!deviceId || !latitude || !longitude) {
      throw new Error(`Dados incompletos para dispositivo ${deviceId || 'unknown'}`);
    }

    // O Traccar aceita o protocolo OsmAnd via HTTP GET ou POST.
    // Usaremos parâmetros na query string conforme padrão OsmAnd.
    const params = new URLSearchParams({
      id: deviceId,
      lat: latitude,
      lon: longitude,
      timestamp: String(Math.floor(new Date(timestamp).getTime() / 1000)), // Traccar OsmAnd espera segundos ou ISO
      hdop: accuracy || '0',
    });

    const traccarUrl = `${TRACCAR_OSMAND_URL}/?${params.toString()}`;

    const traccarRes = await fetch(traccarUrl);
    if (!traccarRes.ok) {
      throw new Error(`Falha ao enviar para Traccar: ${traccarRes.status} ${await traccarRes.text()}`);
    }

    return deviceId;
  }));

  const successCount = results.filter(r => r.status === 'fulfilled').length;
  const failCount = results.filter(r => r.status === 'rejected').length;

  console.log(`[Webhook ZHENCB] Processamento concluído: ${successCount} sucessos, ${failCount} falhas`);

  // Loga erros se houver
  results.forEach((r, idx) => {
    if (r.status === 'rejected') {
      console.error(`[Webhook ZHENCB] Erro no dispositivo ${devices[idx]?.deviceId}:`, r.reason);
    }
  });

  res.status(200).json({ ok: true, processed: devices.length, success: successCount });
});

export default router;
