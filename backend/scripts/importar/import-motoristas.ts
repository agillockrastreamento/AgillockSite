/**
 * Importa MOTORISTAS (e os vinculos motorista->dispositivo recuperaveis) do
 * sistema anterior para o banco do AgilLock.
 *
 * Pre-requisito: rodar fetch-monitorando.py antes, gerando:
 *   scripts/importar/data/motoristas.json          [{ nome, identificador }]
 *   scripts/importar/data/motoristas-vinculos.json [{ imei, driverUniqueId }]
 *
 * Idempotente:
 *   - Motorista deduplicado por identificador (unique).
 *   - MotoristaDispositivo via createMany skipDuplicates.
 *
 * O que faz:
 *   1. Cria Motorista (nome + identificador) para cada linha.
 *   2. Cria o driver no Traccar (ou reaproveita por uniqueId) e grava traccarId.
 *   3. Vincula motorista<->dispositivo (so os 22 recuperaveis) no banco e no Traccar.
 *
 * Relatorio em scripts/importar/data/:
 *   - motoristas-vinculos-nao-resolvidos.csv (imei,driverUniqueId,motivo)
 *
 * Variaveis de ambiente: DATABASE_URL, TRACCAR_URL, TRACCAR_USER, TRACCAR_PASSWORD
 *
 * Uso (dentro do container backend):
 *   npx tsx scripts/importar/import-motoristas.ts
 * Flags: --dry-run | --sem-traccar
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DRY = process.argv.includes('--dry-run');
const SEM_TRACCAR = process.argv.includes('--sem-traccar');

const DATA_DIR = path.join(__dirname, 'data');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as any);

// ─── Traccar inline ─────────────────────────────────────────────────────────
const TRACCAR_URL = process.env.TRACCAR_URL || 'http://traccar:8082';
const TRACCAR_USER = process.env.TRACCAR_USER || '';
const TRACCAR_PASSWORD = process.env.TRACCAR_PASSWORD || '';
const traccarHeaders = {
  'Content-Type': 'application/json',
  Authorization: 'Basic ' + Buffer.from(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`).toString('base64'),
};

type TDriver = { id: number; name: string; uniqueId: string };

async function traccarGetDrivers(): Promise<TDriver[]> {
  const res = await fetch(`${TRACCAR_URL}/api/drivers`, { headers: traccarHeaders });
  if (!res.ok) throw new Error(`GET drivers ${res.status}: ${await res.text()}`);
  return (await res.json()) as TDriver[];
}
async function traccarCreateDriver(name: string, uniqueId: string): Promise<TDriver> {
  const res = await fetch(`${TRACCAR_URL}/api/drivers`, {
    method: 'POST',
    headers: traccarHeaders,
    body: JSON.stringify({ name, uniqueId }),
  });
  if (!res.ok) throw new Error(`POST drivers ${res.status}: ${await res.text()}`);
  return (await res.json()) as TDriver;
}
async function traccarLinkDriverToDevice(driverId: number, deviceId: number): Promise<void> {
  const res = await fetch(`${TRACCAR_URL}/api/permissions`, {
    method: 'POST',
    headers: traccarHeaders,
    body: JSON.stringify({ deviceId, driverId }),
  });
  if (!res.ok) throw new Error(`POST permissions ${res.status}: ${await res.text()}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
type MotoristaSrc = { nome: string; identificador: string };
type VinculoSrc = { imei: string; driverUniqueId: string };

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
    console.error(`❌ ${p} não encontrado. Rode fetch-monitorando.py primeiro.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Import motoristas ${DRY ? '(DRY-RUN)' : ''} ${SEM_TRACCAR ? '(SEM TRACCAR)' : ''} ===\n`);

  const motoristas = lerJson<MotoristaSrc[]>('motoristas.json');
  const vinculos = lerJson<VinculoSrc[]>('motoristas-vinculos.json');
  console.log(`Origem: ${motoristas.length} motoristas, ${vinculos.length} vínculos\n`);

  // Cache de drivers do nosso Traccar (uniqueId -> id)
  let traccarPorUniqueId = new Map<string, number>();
  if (!SEM_TRACCAR) {
    try {
      const list = await traccarGetDrivers();
      traccarPorUniqueId = new Map(list.map((d) => [d.uniqueId, d.id]));
    } catch (e: any) {
      console.error('⚠️  Não consegui listar drivers do Traccar:', e?.message || e);
    }
  }

  // ── 1. Motoristas ──
  let criados = 0, existentes = 0, traccarOk = 0;
  // identificador -> { motoristaId, traccarId } para o passo de vinculos
  const porIdentificador = new Map<string, { id: string; traccarId: number | null }>();

  for (const m of motoristas) {
    const nome = m.nome.trim();
    const identificador = m.identificador.trim();
    if (!identificador) continue;

    let registro = await prisma.motorista.findUnique({
      where: { identificador },
      select: { id: true, traccarId: true },
    });
    if (registro) {
      existentes++;
    } else if (!DRY) {
      registro = await prisma.motorista.create({
        data: { nome, identificador, ativo: true },
        select: { id: true, traccarId: true },
      });
      criados++;
    } else {
      criados++;
      registro = { id: `dry:${identificador}`, traccarId: null };
    }

    // Traccar: cria/reaproveita driver e grava traccarId
    let traccarId = registro.traccarId;
    if (!SEM_TRACCAR && !DRY && !traccarId) {
      try {
        traccarId = traccarPorUniqueId.get(identificador) ?? (await traccarCreateDriver(nome, identificador)).id;
        await prisma.motorista.update({ where: { id: registro.id }, data: { traccarId } });
        traccarOk++;
      } catch (e: any) {
        console.error(`  ⚠️ Traccar driver ${identificador}: ${e?.message || e}`);
      }
    }

    porIdentificador.set(identificador, { id: registro.id, traccarId });
  }
  console.log(`Motoristas: ${criados} criados, ${existentes} já existiam.`);
  if (!SEM_TRACCAR) console.log(`  Traccar OK: ${traccarOk}`);

  // ── 2. Vinculos motorista <-> dispositivo ──
  const naoResolvidos: string[] = ['imei,driverUniqueId,motivo'];
  let vinculados = 0, traccarLinks = 0;

  for (const v of vinculos) {
    const imei = v.imei.trim();
    const driverUid = v.driverUniqueId.trim();
    const mot = porIdentificador.get(driverUid);
    const disp = await prisma.dispositivo.findUnique({
      where: { identificador: imei },
      select: { id: true, traccarId: true },
    });

    if (!mot) { naoResolvidos.push(csvLinha([imei, driverUid, 'motorista não encontrado'])); continue; }
    if (!disp) { naoResolvidos.push(csvLinha([imei, driverUid, 'dispositivo não encontrado'])); continue; }

    if (!DRY) {
      await prisma.motoristaDispositivo.createMany({
        data: [{ motoristaId: mot.id, dispositivoId: disp.id }],
        skipDuplicates: true,
      });
    }
    vinculados++;

    // Link no Traccar (precisa dos dois traccarId)
    if (!SEM_TRACCAR && !DRY && mot.traccarId && disp.traccarId) {
      try {
        await traccarLinkDriverToDevice(mot.traccarId, disp.traccarId);
        traccarLinks++;
      } catch (e: any) {
        // 400 costuma ser "ja vinculado" — nao e erro fatal
        if (!/\b400\b/.test(e?.message || '')) {
          console.error(`  ⚠️ Traccar link drv${driverUid}/dev${imei}: ${e?.message || e}`);
        }
      }
    }
  }
  console.log(`Vínculos: ${vinculados} aplicados, ${naoResolvidos.length - 1} não resolvidos.`);
  if (!SEM_TRACCAR) console.log(`  Links no Traccar: ${traccarLinks}`);

  fs.writeFileSync(
    path.join(DATA_DIR, 'motoristas-vinculos-nao-resolvidos.csv'),
    '﻿' + naoResolvidos.join('\n'),
    'utf-8',
  );
  console.log(`\nRelatório: scripts/importar/data/motoristas-vinculos-nao-resolvidos.csv`);
  console.log(`\n${DRY ? '(DRY-RUN — nada foi gravado)' : '✓ Concluído.'}\n`);
}

main()
  .catch((e) => {
    console.error('❌ Erro fatal:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
