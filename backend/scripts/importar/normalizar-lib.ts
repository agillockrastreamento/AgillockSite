/**
 * Lógica pura de normalização dos dispositivos trazidos do sistema anterior.
 *
 * Os dispositivos vieram com:
 *   - `nome` no formato "MODELO PLACA" (ex.: "HB20S PNE7C42"), às vezes com a
 *     marca na frente ("HONDA TITAN ...").
 *   - `categoria` em inglês (valores do Traccar: car, motorcycle, pickup, ...),
 *     que não casam com o select do sistema atual (carro, motocicleta, ...).
 *
 * Este módulo NÃO acessa banco nem Traccar — é só transformação, para poder
 * ser testado localmente (ver `node -e` no final do arquivo de uso).
 *
 * Regras acordadas (2026-07-23):
 *   - Categoria: mapa completo inglês → pt-BR; sem equivalente claro → 'padrao'.
 *   - Marca/Modelo: detecta marca conhecida na 1ª palavra; senão marca em branco
 *     e tudo vira modelo.
 *   - Só preenche campos VAZIOS (placa/marca/modeloVeiculo já preenchidos são
 *     preservados). O `nome`, porém, é sempre reescrito para o modelo (sem placa).
 */

// Categorias válidas no sistema atual (values do select em dispositivo.html).
export const CATEGORIAS_VALIDAS = new Set<string>([
  'ambulancia', 'aviao_passageiros', 'bicicleta', 'caixa_estacionaria',
  'caminhao', 'caminhao_trator', 'caminhao_bau', 'caminhao_bomba_concreto',
  'caminhao_betoneira', 'caminhao_reboque', 'caminhao_reboque_estrado',
  'caminhao_tanque_combustivel', 'caminhao_pipa', 'caminhao_vacuo',
  'caminhao_bombeiros', 'caminhao_esgoto', 'caminhao_recuperacao',
  'caminhao_transporte', 'caravana', 'carro', 'carro_executivo',
  'carro_hatchback', 'carro_assistencia', 'carro_luxo', 'container_20',
  'container_40', 'container_tanque', 'drone', 'empilhadeira', 'escavadeira',
  'escavadora', 'helicoptero', 'motocicleta', 'motocicleta_cruzada', 'padrao',
  'pedicalo', 'pickup', 'pickup_reboque', 'plataforma_reboque', 'reboque_gerador',
  'reboque_reefer', 'reboque_tanque', 'reboque_residuos', 'reboque_caixa',
  'reboque_carro', 'reboque_container_gerador', 'retroescavadeira',
  'aclo_compressor', 'trator', 'taxi', 'van', 'van_campista', 'viatura', 'onibus',
]);

// Mapa das categorias em inglês (Traccar) → valor do sistema atual.
// As que já são valores válidos (pickup, van) não precisam entrar aqui.
export const CATEGORIA_MAP: Record<string, string> = {
  car: 'carro',
  executive_car: 'carro_executivo',
  camper_van: 'van_campista',
  motorcycle: 'motocicleta',
  cruiser_motorcycle: 'motocicleta_cruzada',
  truck: 'caminhao',
  haul_truck: 'caminhao',
  tractor_unit: 'caminhao_trator',
  recovery_truck: 'caminhao_recuperacao',
  flatbed_trailer_bulkhead: 'plataforma_reboque',
  excavator: 'escavadeira',
  backhoe_loader: 'retroescavadeira',
  forklift_truck: 'empilhadeira',
  // Sem equivalente claro no sistema atual → 'padrao' (ajuste manual depois).
  bulldozer: 'padrao',
  skip: 'padrao',
};

// Marcas conhecidas (1ª palavra do nome). Ordenadas: nomes compostos antes dos
// simples para casar "NEW HOLLAND" antes de "HOLLAND", etc.
export const MARCAS = [
  'NEW HOLLAND', 'MERCEDES BENZ', 'LAND ROVER',
  'HONDA', 'YAMAHA', 'SUZUKI', 'KAWASAKI', 'SHINERAY', 'HAOJUE', 'DAFRA', 'BMW',
  'FIAT', 'VOLKSWAGEN', 'VW', 'CHEVROLET', 'GM', 'TOYOTA', 'HYUNDAI', 'RENAULT',
  'FORD', 'NISSAN', 'JEEP', 'MITSUBISHI', 'PEUGEOT', 'CITROEN', 'KIA', 'HONDA',
  'AUDI', 'MERCEDES', 'VOLVO', 'SCANIA', 'IVECO', 'CASE', 'JCB', 'HANGCHA',
  'CATERPILLAR', 'CAT', 'KOMATSU', 'RAM', 'DODGE', 'CHERY', 'JAC', 'TROLLER',
];

// Regex de placa BR (antiga ABC1234 e Mercosul ABC1D23), ancorada no FIM do nome.
const PLACA_FIM = /^(.*?)[\s-]*([A-Z]{3}[- ]?\d[A-Z0-9]\d{2})\s*$/;

/** Normaliza espaços e maiúsculas para o parsing. */
function up(s: string | null | undefined): string {
  return (s || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export interface ParseNome {
  placa: string | null;       // placa extraída do fim do nome (ou null)
  marca: string | null;       // marca conhecida detectada no início (ou null)
  modelo: string | null;      // o que resta = modelo do veículo (ou null)
  soImei: boolean;            // nome é só o IMEI (sequência de dígitos)
}

/** Quebra o nome "MODELO PLACA" (com marca opcional) em placa/marca/modelo. */
export function parseNome(nome: string | null | undefined): ParseNome {
  const n = up(nome);
  if (!n) return { placa: null, marca: null, modelo: null, soImei: false };
  // Nome que é só o IMEI (dígitos) — nada de modelo/placa para extrair.
  if (/^\d{6,}$/.test(n)) return { placa: null, marca: null, modelo: null, soImei: true };

  let resto = n;
  let placa: string | null = null;
  const m = n.match(PLACA_FIM);
  if (m && m[1].trim()) {
    // Só considera "placa" se sobrar um modelo antes dela (evita nome = só placa).
    placa = m[2].replace(/[- ]/g, '');
    resto = m[1].trim();
  }

  let marca: string | null = null;
  for (const mk of MARCAS) {
    if (resto === mk || resto.startsWith(mk + ' ')) {
      marca = mk;
      resto = resto.slice(mk.length).trim();
      break;
    }
  }

  return { placa, marca, modelo: resto || null, soImei: false };
}

/** Estado (parcial) de um dispositivo relevante para a normalização. */
export interface DispParaNormalizar {
  identificador: string;
  nome: string | null;
  categoria: string | null;
  placa: string | null;
  marca: string | null;
  modeloVeiculo: string | null;
}

export interface PlanoAjuste {
  identificador: string;
  mudou: boolean;
  motivos: string[];
  antes: { nome: string | null; categoria: string | null; placa: string | null; marca: string | null; modeloVeiculo: string | null };
  depois: { nome: string | null; categoria: string | null; placa: string | null; marca: string | null; modeloVeiculo: string | null };
}

/**
 * Calcula o "antes → depois" de um dispositivo, aplicando as regras acordadas.
 * `mudou = false` quando já está no padrão (nenhum campo precisa mexer).
 */
export function planejarAjuste(d: DispParaNormalizar): PlanoAjuste {
  const motivos: string[] = [];
  const p = parseNome(d.nome);

  // ── Categoria ──
  let categoria = d.categoria;
  if (categoria && !CATEGORIAS_VALIDAS.has(categoria)) {
    const mapeada = CATEGORIA_MAP[categoria];
    if (mapeada) {
      categoria = mapeada;
      motivos.push(`categoria ${d.categoria}→${mapeada}`);
    } else {
      // valor desconhecido e sem mapa: normaliza para 'padrao' para não ficar em inglês
      categoria = 'padrao';
      motivos.push(`categoria ${d.categoria}→padrao (sem mapa)`);
    }
  }

  // ── Placa / Marca / Modelo (só preenche vazios) ──
  let placa = d.placa;
  if (!placa && p.placa) { placa = p.placa; motivos.push('placa extraída do nome'); }

  let marca = d.marca;
  if (!marca && p.marca) { marca = p.marca; motivos.push('marca detectada no nome'); }

  let modeloVeiculo = d.modeloVeiculo;
  if (!modeloVeiculo && p.modelo) { modeloVeiculo = p.modelo; motivos.push('modelo do nome'); }

  // ── Nome (sempre vira só o modelo, sem placa/marca) ──
  let nome = d.nome;
  if (!p.soImei && p.modelo && up(nome) !== p.modelo) {
    nome = p.modelo;
    motivos.push('nome limpo (só modelo)');
  }

  const depois = { nome, categoria, placa, marca, modeloVeiculo };
  const antes = { nome: d.nome, categoria: d.categoria, placa: d.placa, marca: d.marca, modeloVeiculo: d.modeloVeiculo };
  const mudou =
    antes.nome !== depois.nome ||
    antes.categoria !== depois.categoria ||
    antes.placa !== depois.placa ||
    antes.marca !== depois.marca ||
    antes.modeloVeiculo !== depois.modeloVeiculo;

  return { identificador: d.identificador, mudou, motivos, antes, depois };
}
