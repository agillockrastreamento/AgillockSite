/**
 * Normaliza os dispositivos trazidos do sistema anterior, deixando-os no padrão
 * do sistema atual:
 *   - categoria em inglês (car, motorcycle, pickup...) → pt-BR (carro, motocicleta...)
 *   - nome "MODELO PLACA" → nome = só o modelo
 *   - placa embutida no nome → campo Placa (só se estiver vazio)
 *   - marca conhecida no início do nome → campo Marca (só se estiver vazio)
 *   - modelo do nome → campo Modelo (só se estiver vazio)
 *
 * As regras ficam em `normalizar-lib.ts` (testável sem banco). Este script só
 * conecta no banco/Traccar e aplica.
 *
 * IDEMPOTENTE: rodar mais de uma vez não altera o que já está no padrão.
 *
 * Uso (dentro do container backend em produção):
 *   # 1) VERIFICAR (não escreve nada) — gera relatório e mostra amostra:
 *   npx tsx scripts/importar/normalizar-dispositivos.ts
 *
 *   # 2) APLICAR (escreve no banco e sincroniza o Traccar):
 *   npx tsx scripts/importar/normalizar-dispositivos.ts --apply
 *
 * Flags:
 *   --apply         aplica de fato (sem ela = só verifica / dry-run)
 *   --sem-traccar   atualiza o Postgres mas NÃO mexe no Traccar
 *
 * Variáveis de ambiente: DATABASE_URL, TRACCAR_URL, TRACCAR_USER, TRACCAR_PASSWORD
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { planejarAjuste, PlanoAjuste } from './normalizar-lib';

const APPLY = process.argv.includes('--apply');
const SEM_TRACCAR = process.argv.includes('--sem-traccar');

const DATA_DIR = path.join(__dirname, 'data');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as any);

// ─── Traccar (inline, sem depender de src/) ─────────────────────────────────
const TRACCAR_URL = process.env.TRACCAR_URL || 'http://traccar:8082';
const TRACCAR_USER = process.env.TRACCAR_USER || '';
const TRACCAR_PASSWORD = process.env.TRACCAR_PASSWORD || '';
const traccarHeaders = {
  'Content-Type': 'application/json',
  Authorization: 'Basic ' + Buffer.from(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`).toString('base64'),
};

/** Atualiza só nome e categoria de um device no Traccar (preserva o resto). */
async function traccarUpdateNomeCategoria(traccarId: number, name: string, category: string | null): Promise<void> {
  const g = await fetch(`${TRACCAR_URL}/api/devices/${traccarId}`, { headers: traccarHeaders });
  if (!g.ok) throw new Error(`GET device ${traccarId}: ${g.status} ${await g.text()}`);
  const dev = (await g.json()) as Record<string, unknown>;
  dev.name = name;
  if (category) dev.category = category;
  const p = await fetch(`${TRACCAR_URL}/api/devices/${traccarId}`, {
    method: 'PUT',
    headers: traccarHeaders,
    body: JSON.stringify(dev),
  });
  if (!p.ok) throw new Error(`PUT device ${traccarId}: ${p.status} ${await p.text()}`);
}

/** Nome que vai para o Traccar: "modelo (placa)" — mesmo padrão do CRUD normal. */
function nomeTraccar(plano: PlanoAjuste): string {
  const nome = (plano.depois.nome || '').trim();
  const placa = (plano.depois.placa || '').trim();
  return placa ? `${nome} (${placa})` : nome;
}

function csvLinha(campos: (string | null | undefined)[]): string {
  return campos
    .map((c) => {
      const v = c == null ? '' : String(c);
      return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    })
    .join(',');
}

async function main() {
  console.log(`\n=== Normalizar dispositivos do sistema anterior ${APPLY ? '(APLICANDO)' : '(VERIFICAÇÃO / dry-run)'} ${SEM_TRACCAR ? '(SEM TRACCAR)' : ''} ===\n`);

  const dispositivos = await prisma.dispositivo.findMany({
    select: { id: true, traccarId: true, identificador: true, nome: true, categoria: true, placa: true, marca: true, modeloVeiculo: true },
  });
  console.log(`Total de dispositivos no banco: ${dispositivos.length}`);

  const planos: Array<PlanoAjuste & { id: string; traccarId: number | null }> = [];
  for (const d of dispositivos) {
    const plano = planejarAjuste({
      identificador: d.identificador,
      nome: d.nome,
      categoria: d.categoria,
      placa: d.placa,
      marca: d.marca,
      modeloVeiculo: d.modeloVeiculo,
    });
    if (plano.mudou) planos.push({ ...plano, id: d.id, traccarId: d.traccarId });
  }

  console.log(`Fora do padrão (precisam ajuste): ${planos.length}\n`);

  // Contadores por tipo de mudança e por categoria de destino.
  const porCategoria: Record<string, number> = {};
  for (const p of planos) {
    const c = p.depois.categoria || '(vazio)';
    porCategoria[c] = (porCategoria[c] || 0) + 1;
  }
  console.log('Categoria de destino:', JSON.stringify(porCategoria));

  // Relatório CSV (sempre gerado, mesmo em verificação).
  const csv = ['identificador,traccarId,nome_antes,nome_depois,categoria_antes,categoria_depois,placa,marca,modelo,motivos'];
  for (const p of planos) {
    csv.push(csvLinha([
      p.identificador, p.traccarId != null ? String(p.traccarId) : '',
      p.antes.nome, p.depois.nome, p.antes.categoria, p.depois.categoria,
      p.depois.placa, p.depois.marca, p.depois.modeloVeiculo, p.motivos.join('; '),
    ]));
  }
  const csvPath = path.join(DATA_DIR, 'normalizacao-dispositivos.csv');
  fs.writeFileSync(csvPath, '﻿' + csv.join('\n'), 'utf-8');
  console.log(`\nRelatório: ${csvPath}`);

  // Amostra no console (primeiros 15).
  console.log('\n--- amostra (antes → depois) ---');
  for (const p of planos.slice(0, 15)) {
    console.log(`[${p.antes.categoria}] "${p.antes.nome}"  =>  [${p.depois.categoria}] nome="${p.depois.nome}" placa=${p.depois.placa || '_'} marca=${p.depois.marca || '_'} modelo="${p.depois.modeloVeiculo || '_'}"`);
  }

  if (!APPLY) {
    console.log(`\n(VERIFICAÇÃO — nada foi gravado. Revise o CSV e rode com --apply para aplicar.)\n`);
    return;
  }

  // ── Aplicar ──
  let bancoOk = 0, traccarOk = 0, semTraccar = 0;
  const errosTraccar: string[] = ['identificador,traccarId,erro'];
  for (const p of planos) {
    await prisma.dispositivo.update({
      where: { id: p.id },
      data: {
        nome: p.depois.nome || undefined,
        categoria: p.depois.categoria,
        placa: p.depois.placa,
        marca: p.depois.marca,
        modeloVeiculo: p.depois.modeloVeiculo,
      },
    });
    bancoOk++;

    if (!SEM_TRACCAR) {
      if (p.traccarId == null) { semTraccar++; continue; }
      try {
        await traccarUpdateNomeCategoria(p.traccarId, nomeTraccar(p), p.depois.categoria);
        traccarOk++;
      } catch (e) {
        errosTraccar.push(csvLinha([p.identificador, String(p.traccarId), e instanceof Error ? e.message : String(e)]));
      }
    }
  }

  console.log(`\nBanco atualizado: ${bancoOk}`);
  if (!SEM_TRACCAR) {
    console.log(`Traccar atualizado: ${traccarOk} | sem traccarId: ${semTraccar} | erros: ${errosTraccar.length - 1}`);
    if (errosTraccar.length > 1) {
      const errPath = path.join(DATA_DIR, 'normalizacao-erros-traccar.csv');
      fs.writeFileSync(errPath, '﻿' + errosTraccar.join('\n'), 'utf-8');
      console.log(`Erros do Traccar em: ${errPath}`);
    }
  }
  console.log(`\n✓ Concluído.\n`);
}

main()
  .catch((e) => {
    console.error('❌ Erro fatal:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
