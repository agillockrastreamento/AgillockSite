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

export default router;
