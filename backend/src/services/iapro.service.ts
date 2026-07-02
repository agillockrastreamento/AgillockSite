import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

/**
 * Integração com a IAPRO (plataforma de proteção veicular).
 *
 * Fluxos:
 *  - IAPRO → Ágil Lock: ao gerar contrato, a IAPRO chama POST /api/integracao/iapro/clientes
 *    (upsertClienteIapro) criando o cliente e o veículo aqui (sem boletos — a cobrança é da IAPRO).
 *  - Ágil Lock → IAPRO: quando um dispositivo é vinculado a um cliente da IAPRO,
 *    notificarIaproVinculoDispositivo marca o veículo como rastreado e avisa a IAPRO
 *    (que move o card do Kanban para "Ativo" e dispara as notificações).
 */

export const IAPRO_VALOR_PLACA = 39.9;

function normalizarPlaca(placa?: string | null): string | null {
  if (!placa) return null;
  const limpa = String(placa).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return limpa || null;
}

function digits(v?: string | null): string {
  return v ? String(v).replace(/\D/g, '') : '';
}

// ─── Chamadas à API da IAPRO ────────────────────────────────────────────────

function iaproConfig(): { url: string; key: string } | null {
  const url = (process.env.IAPRO_API_URL || '').replace(/\/+$/, '');
  const key = process.env.IAPRO_API_KEY || '';
  if (!url || !key) return null;
  return { url, key };
}

export async function postIapro(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const cfg = iaproConfig();
  if (!cfg) {
    return { ok: false, status: 0, data: { message: 'Integração IAPRO não configurada (IAPRO_API_URL/IAPRO_API_KEY).' } };
  }
  const res = await fetch(`${cfg.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.key },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ─── Upsert de cliente + veículo vindos da IAPRO ────────────────────────────

export interface IaproClientePayload {
  iaproClienteId: string;
  nome: string;
  cpfCnpj?: string | null;
  telefone?: string | null;
  email?: string | null;
  tipoPessoa?: string | null;
  endereco?: {
    cep?: string | null;
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
  } | null;
  veiculo?: {
    iaproVehicleId: string;
    iaproContractId?: string | null;
    placa?: string | null;
    marca?: string | null;
    modelo?: string | null;
    cor?: string | null;
    ano?: string | null;
  } | null;
}

export async function upsertClienteIapro(payload: IaproClientePayload) {
  if (!payload?.iaproClienteId || !payload?.nome) {
    throw new Error('iaproClienteId e nome são obrigatórios.');
  }

  // 1) Resolve o cliente: por iaproClienteId, depois por CPF/CNPJ (cliente que já existia aqui).
  let cliente = await prisma.cliente.findUnique({ where: { iaproClienteId: payload.iaproClienteId } });
  const doc = digits(payload.cpfCnpj);
  if (!cliente && doc) {
    const candidatos = await prisma.cliente.findMany({
      where: { cpfCnpj: { not: null } },
      select: { id: true, cpfCnpj: true },
    });
    const match = candidatos.find((c) => digits(c.cpfCnpj) === doc);
    if (match) cliente = await prisma.cliente.findUnique({ where: { id: match.id } });
  }

  const endereco = payload.endereco || {};
  if (cliente) {
    // Atualiza marcadores da integração e preenche apenas campos vazios (não sobrescreve edições locais).
    cliente = await prisma.cliente.update({
      where: { id: cliente.id },
      data: {
        origemIapro: true,
        iaproClienteId: payload.iaproClienteId,
        ...(cliente.cpfCnpj ? {} : { cpfCnpj: payload.cpfCnpj || null }),
        ...(cliente.telefone ? {} : { telefone: payload.telefone || null }),
        ...(cliente.email ? {} : { email: payload.email || null }),
        ...(cliente.origemCliente ? {} : { origemCliente: 'IAPRO' }),
        ...(cliente.cep ? {} : { cep: endereco.cep || null }),
        ...(cliente.logradouro ? {} : {
          logradouro: endereco.logradouro || null,
          numero: endereco.numero || null,
          complemento: endereco.complemento || null,
          bairro: endereco.bairro || null,
          cidade: endereco.cidade || null,
          estado: endereco.estado || null,
        }),
      },
    });
  } else {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', ativo: true }, select: { id: true } });
    if (!admin) throw new Error('Nenhum usuário ADMIN ativo para registrar o cliente da integração.');
    cliente = await prisma.cliente.create({
      data: {
        nome: payload.nome,
        cpfCnpj: payload.cpfCnpj || null,
        telefone: payload.telefone || null,
        email: payload.email || null,
        tipoPessoa: payload.tipoPessoa === 'PJ' ? 'PJ' : 'PF',
        origemCliente: 'IAPRO',
        origemIapro: true,
        iaproClienteId: payload.iaproClienteId,
        cep: endereco.cep || null,
        logradouro: endereco.logradouro || null,
        numero: endereco.numero || null,
        complemento: endereco.complemento || null,
        bairro: endereco.bairro || null,
        cidade: endereco.cidade || null,
        estado: endereco.estado || null,
        criadoPorId: admin.id,
      },
    });
  }

  // 2) Upsert do veículo IAPRO.
  let iaproVeiculo = null;
  if (payload.veiculo?.iaproVehicleId) {
    const v = payload.veiculo;
    const placa = normalizarPlaca(v.placa);
    iaproVeiculo = await prisma.iaproVeiculo.upsert({
      where: { iaproVehicleId: v.iaproVehicleId },
      create: {
        iaproVehicleId: v.iaproVehicleId,
        iaproContractId: v.iaproContractId || null,
        placa,
        marca: v.marca || null,
        modelo: v.modelo || null,
        cor: v.cor || null,
        ano: v.ano != null ? String(v.ano) : null,
        clienteId: cliente.id,
      },
      update: {
        iaproContractId: v.iaproContractId || null,
        placa,
        marca: v.marca || null,
        modelo: v.modelo || null,
        cor: v.cor || null,
        ano: v.ano != null ? String(v.ano) : null,
        clienteId: cliente.id,
        ativo: true,
      },
    });

    // 3) Se já existe um dispositivo deste cliente com a mesma placa, vincula direto
    //    (sem notificar a IAPRO — quem origina esse upsert é a própria IAPRO).
    if (placa && !iaproVeiculo.dispositivoId) {
      const dispositivo = await prisma.dispositivo.findFirst({
        where: {
          placa,
          OR: [{ clienteId: cliente.id }, { clientesVinculados: { some: { clienteId: cliente.id } } }],
        },
        select: { id: true },
      });
      if (dispositivo) {
        iaproVeiculo = await prisma.iaproVeiculo.update({
          where: { id: iaproVeiculo.id },
          data: { dispositivoId: dispositivo.id },
        });
      }
    }
  }

  return { clienteId: cliente.id, iaproVeiculoId: iaproVeiculo?.id ?? null, rastreado: !!iaproVeiculo?.dispositivoId };
}

// ─── Hook: dispositivo vinculado a cliente da IAPRO ─────────────────────────

/**
 * Chamada após vincular um dispositivo a um cliente (responsável principal ou vínculo extra).
 * Se o cliente veio da IAPRO, casa o dispositivo com o IaproVeiculo (por placa) e notifica a
 * IAPRO que o rastreador foi instalado. Best-effort: nunca propaga erro para a rota chamadora.
 */
export async function notificarIaproVinculoDispositivo(dispositivoId: string): Promise<void> {
  try {
    const dispositivo = await prisma.dispositivo.findUnique({
      where: { id: dispositivoId },
      select: {
        id: true, nome: true, identificador: true, placa: true, clienteId: true,
        clientesVinculados: { select: { clienteId: true } },
      },
    });
    if (!dispositivo) return;

    const clienteIds = [
      ...(dispositivo.clienteId ? [dispositivo.clienteId] : []),
      ...dispositivo.clientesVinculados.map((cv) => cv.clienteId),
    ];
    if (!clienteIds.length) return;

    const clientesIapro = await prisma.cliente.findMany({
      where: { id: { in: clienteIds }, origemIapro: true },
      select: { id: true, nome: true },
    });
    if (!clientesIapro.length) return;

    const placa = normalizarPlaca(dispositivo.placa);

    for (const cliente of clientesIapro) {
      // Prioridade: veículo IAPRO com a mesma placa; fallback: único veículo do cliente sem rastreador
      // (cobre veículo 0km ainda sem placa na IAPRO).
      let veiculo = placa
        ? await prisma.iaproVeiculo.findFirst({ where: { clienteId: cliente.id, placa, ativo: true } })
        : null;
      if (!veiculo) {
        const pendentes = await prisma.iaproVeiculo.findMany({
          where: { clienteId: cliente.id, dispositivoId: null, ativo: true },
          take: 2,
        });
        if (pendentes.length === 1) veiculo = pendentes[0];
      }
      if (!veiculo) continue;
      if (veiculo.dispositivoId === dispositivo.id) continue; // já notificado/vinculado

      await prisma.iaproVeiculo.update({
        where: { id: veiculo.id },
        data: { dispositivoId: dispositivo.id },
      });

      const resultado = await postIapro('/agillock/integration/tracker-installed', {
        iaproVehicleId: veiculo.iaproVehicleId,
        plate: veiculo.placa || placa,
        deviceName: dispositivo.nome,
        deviceIdentifier: dispositivo.identificador,
      });
      if (!resultado.ok) {
        console.error('[IAPRO] Falha ao notificar rastreador instalado:', resultado.status, JSON.stringify(resultado.data));
      } else {
        console.log(`[IAPRO] Rastreador instalado notificado — veículo ${veiculo.placa || '(sem placa)'} do cliente ${cliente.nome}.`);
      }
    }
  } catch (err) {
    console.error('[IAPRO] Erro no hook de vínculo de dispositivo:', err instanceof Error ? err.message : err);
  }
}

// ─── Tela IAPRO do admin ────────────────────────────────────────────────────

type EstadoVeiculoIapro = 'ATIVO' | 'INATIVO' | 'SEM_RASTREAMENTO';

function estadoVeiculo(v: { ativo: boolean; dispositivoId: string | null }, clienteStatus: string): EstadoVeiculoIapro {
  if (!v.ativo || clienteStatus !== 'ATIVO') return 'INATIVO';
  if (!v.dispositivoId) return 'SEM_RASTREAMENTO';
  return 'ATIVO';
}

export async function listarClientesIapro(filtros: {
  busca?: string;
  status?: string; // ATIVO | INATIVO | SEM_RASTREAMENTO
  de?: Date;
  ate?: Date;
}) {
  const veiculos = await prisma.iaproVeiculo.findMany({
    where: {
      ...(filtros.de || filtros.ate
        ? { createdAt: { ...(filtros.de ? { gte: filtros.de } : {}), ...(filtros.ate ? { lte: filtros.ate } : {}) } }
        : {}),
      ...(filtros.busca
        ? {
            OR: [
              { placa: { contains: filtros.busca.toUpperCase().replace(/[^A-Z0-9]/g, ''), mode: 'insensitive' } },
              { cliente: { nome: { contains: filtros.busca, mode: 'insensitive' } } },
              { cliente: { cpfCnpj: { contains: digits(filtros.busca) || filtros.busca } } },
            ],
          }
        : {}),
    },
    include: {
      cliente: { select: { id: true, nome: true, cpfCnpj: true, telefone: true, email: true, status: true } },
      dispositivo: { select: { id: true, nome: true, identificador: true, ativo: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  let linhas = veiculos.map((v) => ({
    id: v.id,
    iaproVehicleId: v.iaproVehicleId,
    placa: v.placa,
    marca: v.marca,
    modelo: v.modelo,
    cor: v.cor,
    ano: v.ano,
    createdAt: v.createdAt,
    cliente: v.cliente,
    dispositivo: v.dispositivo,
    estado: estadoVeiculo(v, v.cliente.status),
  }));

  if (filtros.status) {
    linhas = linhas.filter((l) => l.estado === filtros.status);
  }

  return linhas;
}

export async function resumoIapro() {
  const veiculos = await prisma.iaproVeiculo.findMany({
    include: { cliente: { select: { status: true } } },
  });
  const totalVeiculos = veiculos.length;
  const ativos = veiculos.filter((v) => estadoVeiculo(v, v.cliente.status) === 'ATIVO').length;
  const semRastreamento = veiculos.filter((v) => estadoVeiculo(v, v.cliente.status) === 'SEM_RASTREAMENTO').length;
  const inativos = totalVeiculos - ativos - semRastreamento;
  const clientes = await prisma.cliente.count({ where: { origemIapro: true } });

  return {
    totalClientes: clientes,
    totalVeiculos,
    veiculosAtivos: ativos,
    veiculosSemRastreamento: semRastreamento,
    veiculosInativos: inativos,
    valorPlaca: IAPRO_VALOR_PLACA,
    faturaMensal: Math.round(ativos * IAPRO_VALOR_PLACA * 100) / 100,
  };
}

export async function contadorSemRastreamento(): Promise<number> {
  const veiculos = await prisma.iaproVeiculo.findMany({
    where: { ativo: true, dispositivoId: null },
    include: { cliente: { select: { status: true } } },
  });
  return veiculos.filter((v) => v.cliente.status === 'ATIVO').length;
}

// ─── Remoção vinda da IAPRO (cliente/veículo excluído lá) ───────────────────

export interface IaproRemocaoPayload {
  iaproClienteId?: string | null;
  iaproVehicleId?: string | null;
  iaproContractId?: string | null;
}

/**
 * Chamada PELA IAPRO quando um cliente/veículo/contrato é excluído lá. Remove os
 * IaproVeiculo correspondentes (que ficariam órfãos na tela IAPRO como "sem rastreador")
 * e, se o cliente não tiver mais nenhum veículo IAPRO, limpa os marcadores da integração
 * (sai do contador de clientes IAPRO). Nunca apaga o cliente/dispositivo da Ágil Lock —
 * apenas desfaz o vínculo com a IAPRO.
 */
export async function removerIntegracaoIapro(payload: IaproRemocaoPayload) {
  const iaproClienteId = payload?.iaproClienteId || null;
  const iaproVehicleId = payload?.iaproVehicleId || null;
  const iaproContractId = payload?.iaproContractId || null;

  const or: Prisma.IaproVeiculoWhereInput[] = [];
  if (iaproVehicleId) or.push({ iaproVehicleId });
  if (iaproContractId) or.push({ iaproContractId });
  if (iaproClienteId) or.push({ cliente: { iaproClienteId } });
  if (!or.length) {
    throw new Error('Informe iaproClienteId, iaproVehicleId ou iaproContractId.');
  }

  const veiculos = await prisma.iaproVeiculo.findMany({
    where: { OR: or },
    select: { id: true, clienteId: true },
  });

  const clienteIds = new Set<string>(veiculos.map((v) => v.clienteId));

  if (veiculos.length) {
    await prisma.iaproVeiculo.deleteMany({ where: { id: { in: veiculos.map((v) => v.id) } } });
  }

  // Cobre o caso do cliente sem nenhum IaproVeiculo cadastrado (só o marcador de origem).
  if (iaproClienteId) {
    const cliente = await prisma.cliente.findUnique({ where: { iaproClienteId }, select: { id: true } });
    if (cliente) clienteIds.add(cliente.id);
  }

  // Para cada cliente afetado: se não sobrou nenhum veículo IAPRO, desmarca a origem.
  let clientesAtualizados = 0;
  for (const clienteId of clienteIds) {
    const restantes = await prisma.iaproVeiculo.count({ where: { clienteId } });
    if (restantes === 0) {
      const r = await prisma.cliente.updateMany({
        where: { id: clienteId, origemIapro: true },
        data: { origemIapro: false, iaproClienteId: null },
      });
      clientesAtualizados += r.count;
    }
  }

  return { veiculosRemovidos: veiculos.length, clientesAtualizados };
}

// ─── Compartilhar cliente/veículo da Ágil Lock com a IAPRO ──────────────────

export async function compartilharComIapro(clienteId: string, dispositivoId: string) {
  const [cliente, dispositivo] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId } }),
    prisma.dispositivo.findUnique({
      where: { id: dispositivoId },
      select: {
        id: true, nome: true, placa: true, marca: true, modeloVeiculo: true, cor: true,
        ano: true, renavam: true, chassi: true, clienteId: true,
        clientesVinculados: { select: { clienteId: true } },
      },
    }),
  ]);
  if (!cliente) throw new Error('Cliente não encontrado.');
  if (!dispositivo) throw new Error('Dispositivo não encontrado.');

  const pertence = dispositivo.clienteId === clienteId
    || dispositivo.clientesVinculados.some((cv) => cv.clienteId === clienteId);
  if (!pertence) throw new Error('O dispositivo não pertence a este cliente.');
  if (!dispositivo.placa) throw new Error('O dispositivo não tem placa cadastrada — a IAPRO localiza a cotação pela placa.');

  const resultado = await postIapro('/agillock/integration/share-client', {
    cliente: {
      agilClienteId: cliente.id,
      nome: cliente.nome,
      cpfCnpj: cliente.cpfCnpj,
      telefone: cliente.telefone,
      email: cliente.email,
      tipoPessoa: cliente.tipoPessoa,
      dataNascimento: cliente.dataNascimento,
      rg: cliente.rg,
      endereco: {
        cep: cliente.cep,
        logradouro: cliente.logradouro,
        numero: cliente.numero,
        complemento: cliente.complemento,
        bairro: cliente.bairro,
        cidade: cliente.cidade,
        estado: cliente.estado,
      },
    },
    veiculo: {
      placa: normalizarPlaca(dispositivo.placa),
      marca: dispositivo.marca,
      modelo: dispositivo.modeloVeiculo,
      cor: dispositivo.cor,
      ano: dispositivo.ano,
      renavam: dispositivo.renavam,
      chassi: dispositivo.chassi,
      dispositivoVinculado: true,
      agilDispositivoId: dispositivo.id,
    },
  });

  if (!resultado.ok) {
    const data = resultado.data as { message?: string } | undefined;
    throw new Error(data?.message || `A IAPRO recusou o compartilhamento (HTTP ${resultado.status}).`);
  }
  return resultado.data;
}
