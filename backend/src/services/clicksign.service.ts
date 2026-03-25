// backend/src/services/clicksign.service.ts
// Uses native fetch (Node 18+)

const BASE_URL = process.env.CLICKSIGN_BASE_URL || 'https://sandbox.clicksign.com';

function formatCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}` : cpf;
}

function getHeaders() {
  const token = process.env.CLICKSIGN_ACCESS_TOKEN;
  if (!token) throw new Error('CLICKSIGN_ACCESS_TOKEN nao configurado. Configure em .env');
  return {
    'Content-Type': 'application/vnd.api+json',
    'Accept': 'application/vnd.api+json',
    'Authorization': token,
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
    throw new Error(`ClickSign ${method} ${path} -> ${res.status}: ${text}`);
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
        ...(dados.cpf ? { documentation: formatCpf(dados.cpf) } : {}),
        ...(dados.grupo !== undefined ? { group: dados.grupo } : {}),
        communicate_events: { signature_request: 'whatsapp', signature_reminder: 'email', document_signed: 'whatsapp' },
      },
    },
  });

  const signer = (data as any).data;
  return { signerId: signer.id, link: '' };
}

export async function adicionarRequisitoQualificacao(envelopeId: string, documentId: string, signerId: string, role: string): Promise<void> {
  await req('POST', `/api/v3/envelopes/${envelopeId}/requirements`, {
    data: {
      type: 'requirements',
      attributes: { action: 'agree', role },
      relationships: {
        document: { data: { type: 'documents', id: documentId } },
        signer: { data: { type: 'signers', id: signerId } },
      },
    },
  });
}

// metodo: 'email' | 'sms' | 'whatsapp' | 'handwritten' | 'selfie' | 'official_document'
export async function adicionarRequisitoAutenticacao(envelopeId: string, documentId: string, signerId: string, metodo: string): Promise<void> {
  const authMap: Record<string, string> = {
    email: 'email',
    sms: 'sms',
    whatsapp: 'whatsapp',
    handwritten: 'handwritten',
    selfie: 'selfie',
    official_document: 'official_document',
  };
  const auth = authMap[metodo] ?? 'email';
  await req('POST', `/api/v3/envelopes/${envelopeId}/requirements`, {
    data: {
      type: 'requirements',
      attributes: { action: 'provide_evidence', auth },
      relationships: {
        document: { data: { type: 'documents', id: documentId } },
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

export async function reenviarNotificacao(envelopeId: string, signerId: string): Promise<void> {
  // Canal deve corresponder ao communicate_events.signature_request configurado no signatário ('whatsapp')
  await req('POST', `/api/v3/envelopes/${envelopeId}/signers/${signerId}/notifications`, {
    data: { type: 'notifications', attributes: { channel: 'whatsapp' } },
  });
}

