import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma';

const router = Router();

const WEBHOOK_SECRET = process.env.CLICKSIGN_WEBHOOK_SECRET || '';

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

    // ClickSign V3 webhook format:
    // { event: { name: "cancel"|"close"|"auto_close"|"sign"|..., ... }, document: { key: "uuid", ... } }
    const eventName: string = payload?.event?.name || '';
    const documentKey: string = payload?.document?.key || '';

    console.log(`[Webhook ClickSign] event=${eventName} documentKey=${documentKey}`);

    if (!documentKey) {
      res.status(200).json({ ok: true });
      return;
    }

    // Busca por documentKey em clicksignDocumentoId (campo primário) ou clicksignEnvelopeId (fallback)
    const where = {
      OR: [
        { clicksignDocumentoId: documentKey },
        { clicksignEnvelopeId: documentKey },
      ],
    };

    if (eventName === 'close' || eventName === 'auto_close') {
      await prisma.contrato.updateMany({
        where,
        data: { status: 'ASSINADO', assinadoEm: new Date() },
      });
    } else if (eventName === 'cancel') {
      await prisma.contrato.updateMany({
        where,
        data: { status: 'CANCELADO' },
      });
    }

    res.status(200).json({ ok: true });
  }
);

export default router;
