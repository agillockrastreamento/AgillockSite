// backend/src/services/clicksign.service.ts
// Uses native fetch (Node 18+)

const BASE_URL = process.env.CLICKSIGN_BASE_URL || 'https://sandbox.clicksign.com';
const TOKEN    = process.env.CLICKSIGN_ACCESS_TOKEN || '';

function getHeaders() {
  return {
    'Content-Type': 'application/vnd.api+json',
    'Accept':       'application/vnd.api+json',
    'Authorization': `Bearer ${TOKEN}`,
  };
}

async function req(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickSign ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function criarEnvelope(nome: string): Promise<{ envelopeId: string }> {
  const data = await req('POST', '/api/v3/envelopes', {
    data: { type: 'envelopes', attributes: { name: nome, locale: 'pt-BR', auto_close: true, remind_interval: 3 } },
  });
  return { envelopeId: (data as any).data.id };
}

export async function uploadDocumento(envelopeId: string, pdfBuffer: Buffer, filename: string): Promise<{ documentId: string }> {
  const base64 = pdfBuffer.toString('base64');
  const data = await req('POST', `/api/v3/envelopes/${envelopeId}/documents`, {
    data: {
      type: 'documents',
      attributes: {
        filename,
        content_base64: `data:application/pdf;base64,${base64}`,
      },
    },
  });
  return { documentId: (data as any).data.id };
}

export interface SignatarioDados {
  nome: string;
  email: string;
  telefone?: string;
  cpf?: string;
  grupo?: number;
}

export async function adicionarSignatario(envelopeId: string, dados: SignatarioDados): Promise<{ signerId: string; link: string }> {
  const data = await req('POST', `/api/v3/envelopes/${envelopeId}/signers`, {
    data: {
      type: 'signers',
      attributes: {
        name: dados.nome,
        email: dados.email,
        ...(dados.telefone ? { phone_number: dados.telefone.replace(/\D/g, '') } : {}),
        ...(dados.cpf ? { documentation: dados.cpf.replace(/\D/g, '') } : {}),
        ...(dados.grupo !== undefined ? { group: dados.grupo } : {}),
        communicate_events: ['sign', 'envelope_closed'],
      },
    },
  });
  const attrs = (data as any).data.attributes;
  return { signerId: (data as any).data.id, link: attrs.link || attrs.sign_url || '' };
}

export async function adicionarRequisitoQualificacao(envelopeId: string, documentId: string, signerId: string, qualificacao: string): Promise<void> {
  await req('POST', `/api/v3/envelopes/${envelopeId}/requirements`, {
    data: {
      type: 'requirements',
      attributes: { action: qualificacao },  // "party" para cliente/sócio/fiador/representante, "witness" para testemunha
      relationships: {
        document: { data: { type: 'documents', id: documentId } },
        signer:   { data: { type: 'signers',   id: signerId } },
      },
    },
  });
}

export async function adicionarRequisitoAutenticacao(envelopeId: string, signerId: string, tipo: string): Promise<void> {
  await req('POST', `/api/v3/envelopes/${envelopeId}/requirements`, {
    data: {
      type: 'requirements',
      attributes: { action: tipo },
      relationships: {
        signer: { data: { type: 'signers', id: signerId } },
      },
    },
  });
}

export async function ativarEnvelope(envelopeId: string): Promise<void> {
  await req('PATCH', `/api/v3/envelopes/${envelopeId}`, {
    data: { type: 'envelopes', id: envelopeId, attributes: { status: 'running' } },
  });
}

export async function cancelarEnvelope(envelopeId: string): Promise<void> {
  await req('PATCH', `/api/v3/envelopes/${envelopeId}`, {
    data: { type: 'envelopes', id: envelopeId, attributes: { status: 'canceled' } },
  });
}
