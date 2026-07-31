import crypto from 'crypto';

// Guarda a senha do portal do cliente de forma reversível, para que o admin possa
// consultar a senha atual (o bcrypt do `senhaHash` continua sendo o que autentica).
// AES-256-GCM com chave derivada de SENHA_SECRET (ou JWT_SECRET, se não houver).
// Trocar esse segredo torna ilegíveis as senhas já gravadas — o login continua
// funcionando normalmente, apenas a visualização deixa de ser possível.
const SEGREDO = process.env.SENHA_SECRET || process.env.JWT_SECRET || '';
const CHAVE = crypto.createHash('sha256').update(`senha-cliente:${SEGREDO}`).digest();

export function cifrarSenha(senha: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', CHAVE, iv);
  const dados = Buffer.concat([cipher.update(senha, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), dados.toString('base64')].join('.');
}

export function decifrarSenha(valor: string | null | undefined): string | null {
  if (!valor) return null;

  const [versao, ivB64, tagB64, dadosB64] = valor.split('.');
  if (versao !== 'v1' || !ivB64 || !tagB64 || !dadosB64) return null;

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', CHAVE, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dadosB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (_) {
    // Segredo trocado ou registro corrompido — tratamos como "senha indisponível".
    return null;
  }
}
