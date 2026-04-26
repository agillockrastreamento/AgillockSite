function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function formatarEnderecoNominatim(address?: Record<string, unknown>): string {
  if (!address) return '';
  const partes: string[] = [];
  const amenity = texto(address.amenity);
  const road = texto(address.road);
  const houseNumber = texto(address.house_number);
  const bairro = texto(address.suburb) || texto(address.neighbourhood) || texto(address.quarter);
  const cidade = texto(address.city) || texto(address.town) || texto(address.village) || texto(address.municipality);
  const state = texto(address.state);
  const postcode = texto(address.postcode);
  const country = texto(address.country);
  if (amenity) partes.push(amenity);
  if (road) partes.push(houseNumber ? `${road}, ${houseNumber}` : road);
  if (bairro) partes.push(bairro);
  if (cidade) partes.push(cidade);
  if (state) partes.push(state);
  if (postcode) partes.push(postcode);
  if (country) partes.push(country);
  return partes.join(', ');
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('Coordenadas invalidas.');
  }

  const googleKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_JS_API_KEY;
  if (googleKey) {
    try {
      const googleParams = new URLSearchParams({
        latlng: `${lat},${lon}`,
        language: 'pt-BR',
        key: googleKey,
      });
      const googleRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${googleParams.toString()}`);
      if (googleRes.ok) {
        const googleData = await googleRes.json() as { status?: string; results?: Array<{ formatted_address?: string }> };
        const enderecoGoogle = googleData.status === 'OK' ? googleData.results?.[0]?.formatted_address : '';
        if (enderecoGoogle) return enderecoGoogle;
      }
    } catch {
      // fallback abaixo
    }
  }

  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lon),
    'accept-language': 'pt-BR',
  });

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: {
        'User-Agent': 'AgilLockRastreamento/1.0 (https://agillock.com.br)',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return '';
    const data = await res.json() as { display_name?: string; address?: Record<string, unknown> };
    return formatarEnderecoNominatim(data.address) || data.display_name || '';
  } catch {
    return '';
  }
}
