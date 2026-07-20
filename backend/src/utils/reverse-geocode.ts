import prisma from './prisma';

// ── Configuração ──────────────────────────────────────────────────────────────
// Cadeia de provedores, tentados em ordem até um devolver endereço não-vazio.
// Ex.: GEOCODER_PROVIDER="photon,nominatim" — o Nominatim público fica como
// último recurso, com volume baixíssimo (dentro da política de uso deles).
type Provedor = 'google' | 'nominatim' | 'photon';

const PROVEDORES_VALIDOS: Provedor[] = ['google', 'nominatim', 'photon'];

function cadeiaProvedores(): Provedor[] {
  const bruto = (process.env.GEOCODER_PROVIDER || '').trim();
  if (bruto) {
    const lista = bruto
      .split(',')
      .map(p => p.trim().toLowerCase())
      .filter((p): p is Provedor => (PROVEDORES_VALIDOS as string[]).includes(p));
    if (lista.length) return lista;
  }
  // Sem env configurada, mantém o comportamento histórico: Google primeiro
  // (se houver chave), Nominatim público como fallback.
  return googleKey() ? ['google', 'nominatim'] : ['nominatim'];
}

function googleKey(): string {
  return process.env.GOOGLE_MAPS_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_JS_API_KEY || '';
}

const NOMINATIM_URL = () => process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const PHOTON_URL = () => process.env.PHOTON_URL || 'http://photon:2322';
const TIMEOUT_MS = Number(process.env.GEOCODER_TIMEOUT_MS || 6000);

// Endereço muda em escala de anos (rua renomeada, loteamento novo). 180 dias
// dá folga de sobra sem congelar o dado para sempre.
const TTL_DIAS = Number(process.env.GEOCODE_CACHE_TTL_DIAS || 180);

// ── Cache ─────────────────────────────────────────────────────────────────────
// 4 casas decimais ≈ 11 m — dentro da margem de erro do próprio GPS, então o
// arredondamento é imperceptível. O front já agrupava com 3 casas (~110 m),
// logo isto é mais preciso que o comportamento anterior.
export function chaveCache(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

// Dedup de chamadas simultâneas: os relatórios disparam 5 workers em paralelo e
// sem isto a mesma coordenada iria para o provedor várias vezes.
const emVoo = new Map<string, Promise<string>>();

async function lerCache(chave: string): Promise<string | null> {
  try {
    const row = await prisma.geocodeCache.findUnique({ where: { chave } });
    if (!row) return null;
    const idadeDias = (Date.now() - row.criadoEm.getTime()) / 86_400_000;
    if (idadeDias > TTL_DIAS) return null;
    return row.endereco;
  } catch {
    // Falha de banco não pode derrubar a geocodificação.
    return null;
  }
}

async function gravarCache(chave: string, endereco: string, provedor: Provedor): Promise<void> {
  // NUNCA cachear resultado vazio: uma falha momentânea de rede viraria endereço
  // em branco permanente naquela coordenada.
  if (!endereco.trim()) return;
  try {
    await prisma.geocodeCache.upsert({
      where: { chave },
      create: { chave, endereco, provedor },
      update: { endereco, provedor, criadoEm: new Date() },
    });
  } catch {
    // Cache é otimização, não pode quebrar a resposta.
  }
}

// ── Formatadores por provedor ────────────────────────────────────────────────
// Cada provedor nomeia os campos de forma diferente. Photon usa street/
// housenumber/district onde o Nominatim usa road/house_number/suburb — apontar
// um para o formatador do outro devolve string vazia em todos os pontos.
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function montar(partes: (string | undefined)[]): string {
  return partes.filter((p): p is string => !!p && !!p.trim()).join(', ');
}

function formatarNominatim(address: Record<string, unknown> = {}): string {
  const road = texto(address.road);
  const houseNumber = texto(address.house_number);
  return montar([
    texto(address.amenity),
    road ? (houseNumber ? `${road}, ${houseNumber}` : road) : '',
    texto(address.suburb) || texto(address.neighbourhood) || texto(address.quarter),
    texto(address.city) || texto(address.town) || texto(address.village) || texto(address.municipality),
    texto(address.state),
    texto(address.postcode),
    texto(address.country),
  ]);
}

function formatarPhoton(props: Record<string, unknown> = {}): string {
  const street = texto(props.street);
  const houseNumber = texto(props.housenumber);
  // `name` é o POI/estabelecimento; só entra se não for repetição da rua.
  const nome = texto(props.name);
  return montar([
    nome && nome !== street ? nome : '',
    street ? (houseNumber ? `${street}, ${houseNumber}` : street) : '',
    texto(props.district),
    texto(props.city) || texto(props.county),
    texto(props.state),
    texto(props.postcode),
    texto(props.country),
  ]);
}

// ── Provedores ────────────────────────────────────────────────────────────────
async function viaGoogle(lat: number, lon: number): Promise<string> {
  const key = googleKey();
  if (!key) return '';
  const params = new URLSearchParams({ latlng: `${lat},${lon}`, language: 'pt-BR', key });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return '';
  const data = await res.json() as { status?: string; results?: Array<{ formatted_address?: string }> };
  return data.status === 'OK' ? texto(data.results?.[0]?.formatted_address) : '';
}

async function viaNominatim(lat: number, lon: number): Promise<string> {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lon),
    'accept-language': 'pt-BR',
  });
  const res = await fetch(`${NOMINATIM_URL()}/reverse?${params}`, {
    headers: {
      'User-Agent': 'AgilLockRastreamento/1.0 (https://agillock.com.br)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return '';
  const data = await res.json() as { display_name?: string; address?: Record<string, unknown> };
  return formatarNominatim(data.address) || texto(data.display_name);
}

async function viaPhoton(lat: number, lon: number): Promise<string> {
  // Sem parâmetro `lang`: os dumps do Photon trazem inglês/alemão/francês mais o
  // idioma local. No Brasil o nome local já é o português, então omitir devolve
  // pt-BR; pedir `lang=pt` não é suportado e degradaria o resultado.
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const res = await fetch(`${PHOTON_URL()}/reverse?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return '';
  const data = await res.json() as { features?: Array<{ properties?: Record<string, unknown> }> };
  return formatarPhoton(data.features?.[0]?.properties);
}

const IMPL: Record<Provedor, (lat: number, lon: number) => Promise<string>> = {
  google: viaGoogle,
  nominatim: viaNominatim,
  photon: viaPhoton,
};

// ── API pública ───────────────────────────────────────────────────────────────
async function resolver(lat: number, lon: number, chave: string): Promise<string> {
  for (const provedor of cadeiaProvedores()) {
    try {
      const endereco = await IMPL[provedor](lat, lon);
      if (endereco) {
        await gravarCache(chave, endereco, provedor);
        return endereco;
      }
    } catch {
      // Provedor indisponível/timeout: tenta o próximo da cadeia.
    }
  }
  return '';
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('Coordenadas inválidas.');
  }

  const chave = chaveCache(lat, lon);

  const cacheado = await lerCache(chave);
  if (cacheado) return cacheado;

  const jaEmVoo = emVoo.get(chave);
  if (jaEmVoo) return jaEmVoo;

  const promessa = resolver(lat, lon, chave).finally(() => emVoo.delete(chave));
  emVoo.set(chave, promessa);
  return promessa;
}
