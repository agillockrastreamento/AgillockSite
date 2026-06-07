/**
 * Importa clientes e dispositivos do sistema anterior para o banco do AgilLock.
 *
 * Pre-requisito: rodar converter-xlsx.py antes, gerando:
 *   scripts/importar/data/clientes.json
 *   scripts/importar/data/dispositivos.json
 *
 * O script e IDEMPOTENTE: pode ser rodado mais de uma vez sem duplicar.
 *   - Cliente: deduplicado pelo email do ClienteLogin (unique).
 *   - Dispositivo: deduplicado pelo identificador/IMEI (unique).
 *
 * O que faz:
 *   1. Garante um usuario ADMIN (criadoPorId obrigatorio).
 *   2. Cria Cliente + ClienteLogin (senha provisoria aleatoria) para cada linha.
 *   3. Cria Dispositivo, tenta vincular ao cliente pelo campo "Contato" (nome).
 *   4. Cria o device no Traccar (ou reaproveita se ja existir por IMEI) e grava traccarId.
 *
 * Relatorios gerados em scripts/importar/data/:
 *   - senhas-clientes.csv          (nome,email,senhaProvisoria)
 *   - dispositivos-nao-vinculados.csv  (identificador,nome,contato,motivo)
 *   - erros-traccar.csv            (identificador,erro)
 *
 * Variaveis de ambiente: DATABASE_URL, TRACCAR_URL, TRACCAR_USER, TRACCAR_PASSWORD
 *
 * Uso (dentro do container backend em producao):
 *   npx tsx scripts/importar/import-dados-anteriores.ts
 * Flags:
 *   --dry-run        nao escreve no banco nem no Traccar; so simula e gera relatorios
 *   --sem-traccar    cria no Postgres mas NAO cria devices no Traccar
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const DRY = process.argv.includes('--dry-run');
const SEM_TRACCAR = process.argv.includes('--sem-traccar');

const DATA_DIR = path.join(__dirname, 'data');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as any);

// ─── Traccar (inline, sem depender de src/ ou dist/) ────────────────────────
const TRACCAR_URL = process.env.TRACCAR_URL || 'http://traccar:8082';
const TRACCAR_USER = process.env.TRACCAR_USER || '';
const TRACCAR_PASSWORD = process.env.TRACCAR_PASSWORD || '';
const traccarHeaders = {
  'Content-Type': 'application/json',
  Authorization: 'Basic ' + Buffer.from(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`).toString('base64'),
};

async function traccarGetByImei(imei: string): Promise<{ id: number } | null> {
  const res = await fetch(`${TRACCAR_URL}/api/devices?uniqueId=${encodeURIComponent(imei)}`, {
    headers: traccarHeaders,
  });
  if (!res.ok) throw new Error(`GET devices ${res.status}: ${await res.text()}`);
  const arr = (await res.json()) as Array<{ id: number }>;
  return arr.length ? arr[0] : null;
}

async function traccarCreate(payload: Record<string, unknown>): Promise<{ id: number }> {
  const res = await fetch(`${TRACCAR_URL}/api/devices`, {
    method: 'POST',
    headers: traccarHeaders,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST devices ${res.status}: ${await res.text()}`);
  return (await res.json()) as { id: number };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
type ClienteSrc = { nome: string; email: string | null; desativado: string | null; telefone: string | null };
type DispSrc = {
  nome: string; identificador: string; modelo: string | null; grupo: string | null;
  categoria: string | null; contato: string | null; desativado: string | null;
  telefone: string | null; placa: string | null; marca: string | null;
  modeloVeiculo: string | null; combustivel: string | null; consumo: string | null;
  iccid: string | null; operadora: string | null; cor: string | null; ano: string | null;
  renavam: string | null; chassi: string | null; localInstalacao: string | null;
  instalador: string | null; senha: string | null;
};

const ativoDe = (desativado: string | null) =>
  !(desativado && /^s/i.test(desativado.trim())); // "Sim" => inativo; "Não"/vazio => ativo

function normalizar(s: string | null): string {
  if (!s) return '';
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Sufixos que indicam pessoa juridica
const RE_PJ = /\b(LTDA|EIRELI|S\/A|S\.A|SA|ME|MEI|EPP|EMPRESA|COMERCIO|INDUSTRIA|TRANSPORTE|TRANSPORTES|SERVICOS|ASSOCIACAO|CONDOMINIO|IGREJA|SC LTDA)\b/;
function tipoPessoaDe(nome: string): string {
  return RE_PJ.test(normalizar(nome)) ? 'PJ' : 'PF';
}

// Rotulos de plano/grupo do Traccar grudados no nome (ruido para o matching).
// Removidos APENAS da chave de comparacao — o nome salvo do cliente fica fiel ao original.
const RE_RUIDO = /\b(ATUAL MASTER|ATUAL|MASTER|BASIC|PLANO|TESTE|CANCELADO|INADIMPLENTE)\b/g;
function chaveMatch(s: string | null): string {
  return normalizar(s).replace(RE_RUIDO, ' ').replace(/\s+/g, ' ').trim();
}

function senhaProvisoria(): string {
  // 10 chars alfanumericos (sem ambiguos)
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz';
  const b = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += alfabeto[b[i] % alfabeto.length];
  return out;
}

function csvLinha(campos: (string | null | undefined)[]): string {
  return campos
    .map((c) => {
      const v = c == null ? '' : String(c);
      return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    })
    .join(',');
}

function lerJson<T>(arquivo: string): T {
  const p = path.join(DATA_DIR, arquivo);
  if (!fs.existsSync(p)) {
    console.error(`❌ ${p} não encontrado. Rode converter-xlsx.py primeiro.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Import dados anteriores ${DRY ? '(DRY-RUN)' : ''} ${SEM_TRACCAR ? '(SEM TRACCAR)' : ''} ===\n`);

  const clientes = lerJson<ClienteSrc[]>('clientes.json');
  const dispositivos = lerJson<DispSrc[]>('dispositivos.json');
  console.log(`Origem: ${clientes.length} clientes, ${dispositivos.length} dispositivos\n`);

  // 1. Admin (criadoPorId)
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, email: true } });
  if (!admin) {
    console.error('❌ Nenhum usuário ADMIN encontrado. Rode o seed-admin antes.');
    process.exit(1);
  }
  console.log(`Admin (criador): ${admin.email}\n`);

  // ── 2. Clientes + ClienteLogin ──
  const senhasCsv: string[] = ['nome,email,senhaProvisoria'];
  // mapa chave-de-match -> [clienteId]; chaves repetidas viram ambiguas
  const nomeParaIds = new Map<string, string[]>();
  let cliCriados = 0, cliExistentes = 0, loginsCriados = 0;

  for (const c of clientes) {
    const nome = c.nome.trim();
    const email = c.email?.trim().toLowerCase() || null;
    const norm = chaveMatch(nome);

    // Dedup: pelo login (email unique). Sem email, dedup por nome exato.
    let clienteId: string | null = null;
    if (email) {
      const login = await prisma.clienteLogin.findUnique({ where: { email }, select: { clienteId: true } });
      if (login) clienteId = login.clienteId;
    } else {
      const existente = await prisma.cliente.findFirst({ where: { nome }, select: { id: true } });
      if (existente) clienteId = existente.id;
    }

    if (clienteId) {
      cliExistentes++;
    } else if (!DRY) {
      const senha = email ? senhaProvisoria() : null;
      const criado = await prisma.cliente.create({
        data: {
          nome,
          email,
          telefone: c.telefone,
          tipoPessoa: tipoPessoaDe(nome),
          status: ativoDe(c.desativado) ? 'ATIVO' : 'INATIVO',
          criadoPorId: admin.id,
          ...(email && senha
            ? {
                logins: {
                  create: {
                    email,
                    senhaHash: await bcrypt.hash(senha, 10),
                    tipo: 'responsavel',
                    ativo: ativoDe(c.desativado),
                  },
                },
              }
            : {}),
        },
        select: { id: true },
      });
      clienteId = criado.id;
      cliCriados++;
      if (email && senha) {
        loginsCriados++;
        senhasCsv.push(csvLinha([nome, email, senha]));
      }
    } else {
      cliCriados++; // contagem em dry-run
      clienteId = `dry:${email || nome}`; // id sintetico p/ simular o matching
      if (email) senhasCsv.push(csvLinha([nome, email, '(dry-run)']));
    }

    // indexa para matching de dispositivos
    if (clienteId) {
      const lista = nomeParaIds.get(norm) || [];
      lista.push(clienteId);
      nomeParaIds.set(norm, lista);
    }
  }
  console.log(`Clientes: ${cliCriados} criados, ${cliExistentes} já existiam, ${loginsCriados} logins criados.`);

  // ── 3. Matching helper ──
  // Retorna clienteId ou {motivo} se nao resolvido.
  function resolverCliente(contato: string | null): { id?: string; motivo?: string } {
    const cand = chaveMatch((contato || '').split('/')[0]); // primeiro segmento = dono
    if (!cand) return { motivo: 'contato vazio' };

    // match exato
    const exato = nomeParaIds.get(cand);
    if (exato) {
      if (exato.length === 1) return { id: exato[0] };
      return { motivo: 'nome ambíguo (cliente duplicado)' };
    }
    // match por prefixo bidirecional: a chave do cliente e prefixo do candidato
    // ou vice-versa (cobre nome do contato truncado ou com tokens extras).
    const candidatos: string[] = [];
    for (const [k, ids] of nomeParaIds) {
      if (ids.length === 1 && k.length >= 8 && (k.startsWith(cand) || cand.startsWith(k))) {
        candidatos.push(ids[0]);
      }
    }
    const unicos = Array.from(new Set(candidatos));
    if (unicos.length === 1) return { id: unicos[0] };
    if (unicos.length > 1) return { motivo: 'múltiplos clientes possíveis' };
    return { motivo: 'sem correspondência' };
  }

  // ── 4. Dispositivos ──
  const naoVinc: string[] = ['identificador,nome,contato,motivo'];
  const errosTraccar: string[] = ['identificador,erro'];
  let dispCriados = 0, dispExistentes = 0, vinculados = 0, traccarOk = 0;

  for (const d of dispositivos) {
    const identificador = d.identificador.trim();
    const ja = await prisma.dispositivo.findUnique({ where: { identificador }, select: { id: true } });
    if (ja) { dispExistentes++; continue; }

    const m = resolverCliente(d.contato);
    if (m.id) vinculados++;
    else naoVinc.push(csvLinha([identificador, d.nome.trim(), d.contato, m.motivo]));

    if (DRY) { dispCriados++; continue; }

    const criado = await prisma.dispositivo.create({
      data: {
        nome: d.nome.trim(),
        identificador,
        categoria: d.categoria || 'car',
        grupo: d.grupo,
        contato: d.contato,
        ativo: ativoDe(d.desativado),
        modeloRastreador: d.modelo,
        telefoneRastreador: d.telefone,
        iccid: d.iccid,
        operadora: d.operadora,
        placa: d.placa ? d.placa.toUpperCase().trim() : null,
        marca: d.marca,
        modeloVeiculo: d.modeloVeiculo,
        cor: d.cor,
        ano: d.ano,
        renavam: d.renavam,
        chassi: d.chassi,
        combustivel: d.combustivel,
        localInstalacao: d.localInstalacao,
        instalador: d.instalador,
        senha: d.senha,
        clienteId: m.id || null,
        criadoPorId: admin.id,
      },
      select: { id: true },
    });
    dispCriados++;

    // Traccar
    if (!SEM_TRACCAR) {
      try {
        let traccarId: number;
        const existente = await traccarGetByImei(identificador);
        if (existente) {
          traccarId = existente.id;
        } else {
          const nomeTraccar = d.placa ? `${d.nome.trim()} (${d.placa.trim()})` : d.nome.trim();
          const novo = await traccarCreate({
            name: nomeTraccar,
            uniqueId: identificador,
            category: d.categoria || 'car',
            model: d.modelo || null,
            phone: d.telefone || null,
            attributes: {
              iccid: d.iccid || null,
              operadoraChip: d.operadora || null,
              consumo: d.consumo || null,
              senha: d.senha || null,
            },
          });
          traccarId = novo.id;
        }
        await prisma.dispositivo.update({ where: { id: criado.id }, data: { traccarId } });
        traccarOk++;
      } catch (e: any) {
        errosTraccar.push(csvLinha([identificador, e?.message || String(e)]));
      }
    }
  }

  console.log(`Dispositivos: ${dispCriados} criados, ${dispExistentes} já existiam.`);
  console.log(`  Vinculados a cliente: ${vinculados} | Não vinculados: ${naoVinc.length - 1}`);
  if (!SEM_TRACCAR) console.log(`  Traccar OK: ${traccarOk} | Erros Traccar: ${errosTraccar.length - 1}`);

  // ── 5. Relatorios ──
  fs.writeFileSync(path.join(DATA_DIR, 'senhas-clientes.csv'), '﻿' + senhasCsv.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(DATA_DIR, 'dispositivos-nao-vinculados.csv'), '﻿' + naoVinc.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(DATA_DIR, 'erros-traccar.csv'), '﻿' + errosTraccar.join('\n'), 'utf-8');
  console.log(`\nRelatórios gravados em scripts/importar/data/:`);
  console.log(`  senhas-clientes.csv, dispositivos-nao-vinculados.csv, erros-traccar.csv`);
  console.log(`\n${DRY ? '(DRY-RUN — nada foi gravado no banco)' : '✓ Concluído.'}\n`);
}

main()
  .catch((e) => {
    console.error('❌ Erro fatal:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
