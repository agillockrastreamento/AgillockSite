import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { decifrarSenha } from '../utils/senha-cifrada';
import { whatsappApiKeyMiddleware } from '../middleware/whatsapp-api-key.middleware';
import VozChatService from '../services/vozchat.service';

/**
 * Integração WhatsApp (VozChat → AgilLock), server-to-server, autenticada por WHATSAPP_API_KEY.
 * Montada em /api/integracao/whatsapp (ver app.ts).
 *
 * Usada pelo fluxo do VozChat (action agillock_enviar_senha): o cliente pede a senha no chat,
 * o VozChat chama aqui com o telefone, e o AGILLOCK dispara o envio das credenciais de volta
 * pelo próprio VozChat. A senha é decifrada no servidor e repassada só no payload do envio —
 * NUNCA volta no corpo de nenhuma resposta HTTP (sem endpoint de "consulta de senha").
 */
const router = Router();
router.use(whatsappApiKeyMiddleware);

const soDigitos = (s: string): string => String(s || '').replace(/\D/g, '');

/** Núcleo do número (últimos 8 dígitos) para casar telefones salvos sem padronização. */
function nucleo(digitos: string): string {
  const d = soDigitos(digitos);
  return d.length > 8 ? d.slice(-8) : d;
}

// ── POST /cliente/enviar-credenciais ──────────────────────────────────────────
// body: { telefone } → acha o cliente por telefone, decifra a senha atual e dispara pelo
// VozChat a mensagem com login/senha (sem PDF). Resposta só diz se enviou, sem a senha.
router.post('/cliente/enviar-credenciais', async (req: Request, res: Response): Promise<void> => {
  const alvo = nucleo(req.body?.telefone || '');
  if (!alvo || alvo.length < 8) {
    res.status(400).json({ error: 'Telefone inválido.' });
    return;
  }

  // Candidatos: clientes com login responsável ativo e telefone preenchido.
  const candidatos = await prisma.cliente.findMany({
    where: {
      telefone: { not: null },
      logins: { some: { tipo: 'responsavel', ativo: true } },
    },
    select: {
      nome: true,
      telefone: true,
      logins: {
        where: { tipo: 'responsavel', ativo: true },
        take: 1,
        select: { email: true, senhaCifrada: true },
      },
    },
    take: 5000,
  });

  const match = candidatos.find((c) => nucleo(c.telefone || '') === alvo);
  if (!match || !match.logins[0]) {
    res.status(404).json({ error: 'Cliente não encontrado para este telefone.' });
    return;
  }

  if (!VozChatService.configurado()) {
    res.status(503).json({ error: 'Integração WhatsApp não configurada.' });
    return;
  }

  const login = match.logins[0];
  const r = await VozChatService.enviarBoasVindas({
    telefone: soDigitos(req.body.telefone),
    nome: match.nome,
    login: login.email,
    // Null quando a senha é anterior à cifra reversível (só existe o hash) → segue sem senha.
    senha: decifrarSenha(login.senhaCifrada),
    incluirGuia: false,
  });

  // NUNCA devolve a senha — só o resultado do envio.
  res.json({ ok: r.success !== false, enviado: r.enviado !== false });
});

export default router;
