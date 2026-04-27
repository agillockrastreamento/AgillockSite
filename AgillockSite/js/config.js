/**
 * Configuracao da URL da API - ajuste conforme o ambiente.
 * Em desenvolvimento: 'http://localhost:3000'
 * Em producao:        'https://api.agillock.com.br'
 */

window.API_URL = 'https://api.agillock.com.br';

/**
 * Biblioteca de icones SVG 3D para veiculos e ativos - AgilLock.
 * Vista superior com detalhes por categoria, gradientes e sombras.
 */
window.AL_ICONS_3D = {
  SIZE: 48,

  CATEGORIAS: [
    'ambulancia', 'aviao_passageiros', 'bicicleta', 'caixa_estacionaria',
    'caminhao', 'caminhao_trator', 'caminhao_bau', 'caminhao_bomba_concreto',
    'caminhao_betoneira', 'caminhao_reboque', 'caminhao_reboque_estrado',
    'caminhao_tanque_combustivel', 'caminhao_pipa', 'caminhao_vacuo',
    'caminhao_bombeiros', 'caminhao_esgoto', 'caminhao_recuperacao',
    'caminhao_transporte', 'caravana', 'carro', 'carro_executivo',
    'carro_hatchback', 'carro_assistencia', 'carro_luxo', 'container_20',
    'container_40', 'container_tanque', 'drone', 'empilhadeira',
    'escavadeira', 'escavadora', 'motocicleta_cruzada', 'padrao', 'pedicalo',
    'plataforma_reboque', 'reboque_gerador', 'reboque_reefer',
    'reboque_tanque', 'reboque_residuos', 'reboque_caixa', 'reboque_carro',
    'reboque_container_gerador', 'retroescavadeira', 'aclo_compressor',
    'trator', 'taxi', 'van', 'van_campista', 'viatura', 'onibus'
  ],

  getSvgHtml: function(categoria, cor, course) {
    const angle = course || 0;
    const color = cor || '#c8870a';
    const cat = this.mapCategoria(categoria);
    const uid = `${cat}-${color}`.replace(/[^a-zA-Z0-9_-]/g, '');
    const ids = {
      body: `al-body-${uid}`,
      glass: `al-glass-${uid}`,
      metal: `al-metal-${uid}`,
      rubber: `al-rubber-${uid}`,
      light: `al-light-${uid}`,
      red: `al-red-${uid}`,
      blue: `al-blue-${uid}`
    };

    return `
    <svg width="${this.SIZE}" height="${this.SIZE}" viewBox="0 0 100 100" aria-hidden="true" style="transform: rotate(${angle}deg); filter: drop-shadow(0 3px 5px rgba(0,0,0,0.42));">
      <defs>
        <linearGradient id="${ids.body}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.34" />
          <stop offset="22%" style="stop-color:${color};stop-opacity:1" />
          <stop offset="64%" style="stop-color:${color};stop-opacity:0.94" />
          <stop offset="100%" style="stop-color:#000000;stop-opacity:0.26" />
        </linearGradient>
        <linearGradient id="${ids.glass}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#dff7ff;stop-opacity:0.9" />
          <stop offset="45%" style="stop-color:#506a79;stop-opacity:0.95" />
          <stop offset="100%" style="stop-color:#121d27;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="${ids.metal}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#68747a;stop-opacity:1" />
          <stop offset="48%" style="stop-color:#e7edf0;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#748088;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="${ids.rubber}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#050608;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#3c4248;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#050608;stop-opacity:1" />
        </linearGradient>
        <radialGradient id="${ids.light}" cx="50%" cy="45%" r="60%">
          <stop offset="0%" style="stop-color:#fff7c8;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#e7b84a;stop-opacity:1" />
        </radialGradient>
        <linearGradient id="${ids.red}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#ff9a9a;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#b20f18;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="${ids.blue}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#9bdcff;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#1454b8;stop-opacity:1" />
        </linearGradient>
      </defs>
      <g transform="translate(50, 50)">
        ${this.draw(cat, color, ids)}
      </g>
    </svg>`;
  },

  mapCategoria: function(c) {
    const normalized = String(c || 'padrao').toLowerCase().trim();
    if (this.CATEGORIAS.indexOf(normalized) >= 0) return normalized;
    if (/pickup|picape/.test(normalized)) return 'pickup';
    if (/moto/.test(normalized)) return 'motocicleta_cruzada';
    if (/bike|bici/.test(normalized)) return 'bicicleta';
    if (/bus|onibus|ônibus/.test(normalized)) return 'onibus';
    if (/van/.test(normalized)) return 'van';
    if (/ambul/.test(normalized)) return 'ambulancia';
    if (/policia|polícia|viatura/.test(normalized)) return 'viatura';
    if (/taxi|táxi/.test(normalized)) return 'taxi';
    if (/aviao|avião|plane/.test(normalized)) return 'aviao_passageiros';
    if (/container.*40/.test(normalized)) return 'container_40';
    if (/container/.test(normalized)) return 'container_20';
    if (/trator|tractor/.test(normalized) && !/caminhao|caminhão/.test(normalized)) return 'trator';
    if (/caminhao|caminhão|truck/.test(normalized)) return 'caminhao';
    if (/carro|auto|sedan/.test(normalized)) return 'carro';
    return 'padrao';
  },

  draw: function(cat, cor, ids) {
    const carConfigs = {
      carro: { width: 35, rear: 32 },
      pickup: { pickup: true },
      carro_executivo: { color: '#1f2933', width: 34, rear: 34, stripe: '<path d="M-11,-33 H11 M-12,25 H12" stroke="#c7d0d7" stroke-width="1.3" opacity="0.75" />' },
      carro_hatchback: { width: 33, rear: 25, cabinTop: -21, cabinBottom: 12, stripe: '<path d="M-13,17 Q0,26 13,17" stroke="#18222c" stroke-width="1.4" opacity="0.7" />' },
      carro_assistencia: { color: '#f0b429', stripe: `<rect x="-12" y="15" width="24" height="8" rx="2" fill="#1f2933" /><path d="M-7,19 H7 M0,12 V26" stroke="#ffffff" stroke-width="2" /><rect x="-7" y="-30" width="14" height="4" rx="2" fill="#f97316" />` },
      carro_luxo: { color: '#111827', width: 37, rear: 34, nose: -41, stripe: '<path d="M-14,-35 Q0,-41 14,-35 M-15,27 Q0,36 15,27" stroke="#d8b76a" stroke-width="1.6" opacity="0.86" />' },
      taxi: { color: '#facc15', stripe: '<rect x="-10" y="-33" width="20" height="5" rx="2" fill="#111827" /><path d="M-15,3 H15" stroke="#111827" stroke-width="4" stroke-dasharray="3 3" />' },
      viatura: { color: '#f8fafc', stripe: `<path d="M-16,-5 H16 V9 H-16 Z" fill="#111827" /><rect x="-9" y="-31" width="8" height="4" rx="2" fill="url(#${ids.red})" /><rect x="1" y="-31" width="8" height="4" rx="2" fill="url(#${ids.blue})" />` }
    };
    if (carConfigs[cat]) return carConfigs[cat].pickup ? this.pickup(cor, ids) : this.car(carConfigs[cat].color || cor, ids, carConfigs[cat]);

    const truckConfigs = {
      caminhao: { kind: 'flat' },
      caminhao_trator: { kind: 'tractor' },
      caminhao_bau: { kind: 'box', boxColor: '#eef2f5' },
      caminhao_bomba_concreto: { kind: 'pump' },
      caminhao_betoneira: { kind: 'mixer' },
      caminhao_reboque: { kind: 'tow' },
      caminhao_reboque_estrado: { kind: 'stake' },
      caminhao_tanque_combustivel: { kind: 'tank', mark: 'fuel' },
      caminhao_pipa: { kind: 'tank', color: '#2563eb', mark: 'water' },
      caminhao_vacuo: { kind: 'tank', mark: 'vacuum' },
      caminhao_bombeiros: { kind: 'fire', color: '#dc2626' },
      caminhao_esgoto: { kind: 'tank', color: '#0f766e', mark: 'sewer' },
      caminhao_recuperacao: { kind: 'recovery', color: '#f59e0b' },
      caminhao_transporte: { kind: 'cargo' }
    };
    if (truckConfigs[cat]) return this.truck(truckConfigs[cat], cor, ids);

    const trailerConfigs = {
      plataforma_reboque: { kind: 'platform' },
      reboque_gerador: { kind: 'generator' },
      reboque_reefer: { kind: 'reefer' },
      reboque_tanque: { kind: 'tank' },
      reboque_residuos: { kind: 'waste' },
      reboque_caixa: { kind: 'box' },
      reboque_carro: { kind: 'car' },
      reboque_container_gerador: { kind: 'container-generator' },
      aclo_compressor: { kind: 'compressor' }
    };
    if (trailerConfigs[cat]) return this.trailer(trailerConfigs[cat], cor, ids);

    const vanConfigs = {
      ambulancia: { kind: 'ambulance' },
      van: { kind: 'van' },
      van_campista: { kind: 'camper' },
      caravana: { kind: 'caravan' },
      onibus: { kind: 'bus' }
    };
    if (vanConfigs[cat]) return this.van(vanConfigs[cat], cor, ids);

    const containerConfigs = {
      caixa_estacionaria: { kind: 'stationary' },
      container_20: { kind: '20' },
      container_40: { kind: '40' },
      container_tanque: { kind: 'tank' }
    };
    if (containerConfigs[cat]) return this.container(containerConfigs[cat], cor, ids);

    const machineConfigs = {
      empilhadeira: { kind: 'forklift' },
      escavadeira: { kind: 'excavator' },
      escavadora: { kind: 'loader' },
      retroescavadeira: { kind: 'backhoe' },
      trator: { kind: 'tractor' }
    };
    if (machineConfigs[cat]) return this.machine(machineConfigs[cat], cor, ids);

    if (cat === 'aviao_passageiros') return this.plane(cor, ids);
    if (cat === 'bicicleta') return this.bike(cor, ids, false);
    if (cat === 'pedicalo') return this.bike(cor, ids, true);
    if (cat === 'motocicleta_cruzada') return this.motorcycle(cor, ids);
    if (cat === 'drone') return this.drone(cor, ids);
    return this.defaultIcon(cor, ids);
  },

  wheels: function(ids, ys, wide) {
    return ys.map(function(y) {
      const rx = wide ? 4.4 : 3.6;
      return `
        <ellipse cx="-19" cy="${y}" rx="${rx}" ry="8" fill="url(#${ids.rubber})" />
        <ellipse cx="19" cy="${y}" rx="${rx}" ry="8" fill="url(#${ids.rubber})" />
        <ellipse cx="-19" cy="${y}" rx="1.4" ry="3.8" fill="#aeb8bd" opacity="0.75" />
        <ellipse cx="19" cy="${y}" rx="1.4" ry="3.8" fill="#aeb8bd" opacity="0.75" />`;
    }).join('');
  },

  lights: function(ids, frontY, rearY) {
    return `
      <ellipse cx="-8" cy="${frontY}" rx="3.2" ry="2" fill="url(#${ids.light})" />
      <ellipse cx="8" cy="${frontY}" rx="3.2" ry="2" fill="url(#${ids.light})" />
      <rect x="-12" y="${rearY}" width="5" height="2.5" rx="1" fill="#b71018" />
      <rect x="7" y="${rearY}" width="5" height="2.5" rx="1" fill="#b71018" />`;
  },

  car: function(cor, ids, opts) {
    opts = opts || {};
    const rear = opts.rear || 31;
    const nose = opts.nose || -39;
    const width = opts.width || 34;
    const half = width / 2;
    const cabinTop = opts.cabinTop || -23;
    const cabinBottom = opts.cabinBottom || 10;
    const roofInset = opts.roofInset || 10;
    return `
      ${this.wheels(ids, [-22, 22], false)}
      <path d="M-${half - 3},${nose + 5} Q-${half - 1},${nose} 0,${nose - 2} Q${half - 1},${nose} ${half - 3},${nose + 5} L${half},${rear - 7} Q${half},${rear} 0,${rear + 4} Q-${half},${rear} -${half},${rear - 7} Z" fill="${cor}" stroke="#101820" stroke-width="1.25" />
      <path d="M-${half - 3},${nose + 5} Q-${half - 1},${nose} 0,${nose - 2} Q${half - 1},${nose} ${half - 3},${nose + 5} L${half},${rear - 7} Q${half},${rear} 0,${rear + 4} Q-${half},${rear} -${half},${rear - 7} Z" fill="url(#${ids.body})" opacity="0.82" />
      <path d="M-${roofInset},${cabinTop} L${roofInset},${cabinTop} L${roofInset + 3},${cabinBottom} L-${roofInset + 3},${cabinBottom} Z" fill="url(#${ids.glass})" stroke="#0e1720" stroke-width="1" />
      <path d="M-${roofInset + 1},${cabinTop + 4} H${roofInset + 1} M-${roofInset + 4},${cabinBottom - 2} H${roofInset + 4}" stroke="#e9fbff" stroke-width="1" opacity="0.45" />
      <path d="M0,${nose + 2} V${rear - 2}" stroke="#ffffff" stroke-width="1" opacity="0.22" />
      <path d="M-${half - 2},-5 H-${half + 3} M${half - 2},-5 H${half + 3}" stroke="#14191f" stroke-width="1.3" opacity="0.55" />
      ${this.lights(ids, nose + 7, rear - 5)}
      ${opts.stripe || ''}`;
  },

  pickup: function(cor, ids) {
    return `
      ${this.wheels(ids, [-23, 25], true)}
      <path d="M-17,-37 Q-14,-42 0,-43 Q14,-42 17,-37 L18,35 L-18,35 Z" fill="${cor}" stroke="#101820" stroke-width="1.25" />
      <path d="M-17,-37 Q-14,-42 0,-43 Q14,-42 17,-37 L18,35 L-18,35 Z" fill="url(#${ids.body})" opacity="0.82" />
      <path d="M-12,-26 H12 L14,-4 H-14 Z" fill="url(#${ids.glass})" stroke="#0d1820" stroke-width="1" />
      <rect x="-14" y="3" width="28" height="27" rx="3" fill="#20282f" stroke="#0f151a" stroke-width="1" />
      <path d="M-10,8 H10 V25 H-10 Z" fill="#59636b" opacity="0.35" />
      <path d="M-14,14 H14 M0,3 V30" stroke="#d7dee2" stroke-width="1" opacity="0.22" />
      ${this.lights(ids, -32, 31)}`;
  },

  truckCab: function(cor, ids) {
    return `
      <rect x="-18" y="-43" width="36" height="24" rx="4" fill="${cor}" stroke="#111820" stroke-width="1.2" />
      <rect x="-18" y="-43" width="36" height="24" rx="4" fill="url(#${ids.body})" opacity="0.76" />
      <path d="M-14,-39 H14 V-29 H-14 Z" fill="url(#${ids.glass})" stroke="#13202a" stroke-width="1" />
      <rect x="-9" y="-25" width="18" height="3" rx="1.5" fill="#27313a" opacity="0.75" />`;
  },

  boxBody: function(ids, y, h, color) {
    return `
      <rect x="-21" y="${y}" width="42" height="${h}" rx="3" fill="${color || '#d8dee2'}" stroke="#263039" stroke-width="1.1" />
      <rect x="-21" y="${y}" width="42" height="${h}" rx="3" fill="url(#${ids.metal})" opacity="0.25" />
      <path d="M-17,${y + 8} H17 M-17,${y + 20} H17 M-17,${y + 32} H17" stroke="#ffffff" stroke-width="1.2" opacity="0.28" />
      <path d="M-15,${y + 4} V${y + h - 4} M15,${y + 4} V${y + h - 4}" stroke="#64717a" stroke-width="1" opacity="0.6" />`;
  },

  tankBody: function(ids, y, h, color) {
    return `
      <rect x="-22" y="${y + 6}" width="44" height="${h - 12}" rx="18" fill="${color || '#dce3e7'}" stroke="#33404a" stroke-width="1.2" />
      <rect x="-22" y="${y + 6}" width="44" height="${h - 12}" rx="18" fill="url(#${ids.metal})" opacity="0.58" />
      <rect x="-5" y="${y + 3}" width="10" height="${h - 6}" rx="2" fill="#ffffff" opacity="0.24" />
      <path d="M-15,${y + 12} H15 M-15,${y + h - 12} H15" stroke="#65727a" stroke-width="1.2" opacity="0.7" />`;
  },

  truck: function(cfg, cor, ids) {
    const cabColor = cfg.color || cor;
    let body = '';
    if (cfg.kind === 'flat') body = `<rect x="-18" y="-15" width="36" height="54" rx="4" fill="#56616a" stroke="#222b32" stroke-width="1.1" /><rect x="-14" y="-9" width="28" height="40" rx="2" fill="url(#${ids.metal})" opacity="0.38" /><path d="M-14,2 H14 M-14,16 H14" stroke="#e8eef2" stroke-width="1" opacity="0.28" />`;
    if (cfg.kind === 'tractor') body = `<rect x="-16" y="-13" width="32" height="36" rx="3" fill="#2f3942" /><circle cx="0" cy="16" r="9" fill="url(#${ids.metal})" stroke="#111820" stroke-width="1.2" /><path d="M-10,32 H10" stroke="#aeb8bd" stroke-width="3" stroke-linecap="round" />`;
    if (cfg.kind === 'box') body = this.boxBody(ids, -17, 61, cfg.boxColor);
    if (cfg.kind === 'pump') body = `<rect x="-18" y="-17" width="36" height="48" rx="4" fill="#38434b" /><path d="M-14,-8 L13,8 L7,18 L-16,2 Z" fill="url(#${ids.metal})" /><path d="M0,-5 L-27,22 L-20,28 L8,2 L28,-15" stroke="#d0d7dc" stroke-width="5" stroke-linecap="round" fill="none" /><path d="M26,-16 L36,-27" stroke="#69747a" stroke-width="3" stroke-linecap="round" />`;
    if (cfg.kind === 'mixer') body = `<ellipse cx="0" cy="10" rx="19" ry="31" fill="url(#${ids.metal})" stroke="#26313a" stroke-width="1.2" /><path d="M-14,-11 Q5,3 -14,19 M-5,-18 Q15,2 -4,29 M9,-13 Q19,5 8,28" stroke="#ffffff" stroke-width="2" opacity="0.36" fill="none" /><rect x="-10" y="33" width="20" height="7" rx="2" fill="#4b5563" />`;
    if (cfg.kind === 'tow') body = `<path d="M-16,-10 H8 Q17,-6 17,5 V31 H-17 V8 Q-17,-4 -8,-10 Z" fill="#414b53" stroke="#111820" stroke-width="1.2" /><path d="M6,-5 L-12,20 H2 L-8,38 L16,9 H3 Z" fill="#facc15" stroke="#7c4a03" stroke-width="1" />`;
    if (cfg.kind === 'stake') body = `<rect x="-22" y="-12" width="44" height="52" rx="3" fill="#4b5563" stroke="#111820" stroke-width="1.1" /><path d="M-18,-5 H18 M-18,8 H18 M-18,21 H18 M-18,34 H18" stroke="#cbd5dc" stroke-width="2" opacity="0.55" /><path d="M-22,38 L22,38" stroke="#d97706" stroke-width="3" />`;
    if (cfg.kind === 'tank') {
      const marks = {
        fuel: '<path d="M-8,10 H8 M0,2 V18" stroke="#c2410c" stroke-width="4" stroke-linecap="round" />',
        water: '<path d="M-10,14 Q0,0 10,14 Q0,24 -10,14 Z" fill="#2ea8ff" opacity="0.8" />',
        vacuum: '<path d="M13,-4 C30,-2 30,18 14,22" stroke="#303942" stroke-width="4" fill="none" stroke-linecap="round" /><circle cx="13" cy="-4" r="3" fill="#111827" />',
        sewer: '<path d="M-13,11 H13" stroke="#14532d" stroke-width="5" stroke-linecap="round" /><path d="M-8,0 L8,22" stroke="#f8fafc" stroke-width="2" opacity="0.8" />'
      };
      body = this.tankBody(ids, -17, 62, cfg.mark === 'water' ? '#cfefff' : '#d7dde1') + (marks[cfg.mark] || '');
    }
    if (cfg.kind === 'fire') body = `<rect x="-19" y="-16" width="38" height="57" rx="4" fill="#b91c1c" stroke="#111820" stroke-width="1.1" /><path d="M-14,-8 H14 M-14,6 H14 M-14,20 H14" stroke="#facc15" stroke-width="3" /><path d="M-16,31 H16" stroke="#dbe4ea" stroke-width="4" stroke-linecap="round" /><rect x="-12" y="-37" width="8" height="4" rx="2" fill="url(#${ids.red})" /><rect x="4" y="-37" width="8" height="4" rx="2" fill="url(#${ids.blue})" />`;
    if (cfg.kind === 'recovery') body = `<rect x="-19" y="-15" width="38" height="54" rx="4" fill="#34404a" /><path d="M-10,-3 L12,18 M12,18 L4,26 M12,18 L20,10" stroke="#facc15" stroke-width="4" stroke-linecap="round" fill="none" /><circle cx="4" cy="26" r="4" fill="#111827" />`;
    if (cfg.kind === 'cargo') body = `<rect x="-21" y="-17" width="42" height="60" rx="3" fill="#cbd5dc" stroke="#26313a" stroke-width="1.1" /><rect x="-15" y="-9" width="13" height="18" rx="2" fill="#a16207" /><rect x="3" y="-8" width="12" height="20" rx="2" fill="#854d0e" /><rect x="-12" y="16" width="25" height="17" rx="2" fill="#92400e" />`;
    return `${this.wheels(ids, [-28, 22, 36], true)}${this.truckCab(cabColor, ids)}${body}`;
  },

  van: function(cfg, cor, ids) {
    if (cfg.kind === 'caravan') {
      return `${this.wheels(ids, [-28, 27], true)}<rect x="-22" y="-42" width="44" height="84" rx="9" fill="#f6f1e7" stroke="#334155" stroke-width="1.2" /><rect x="-14" y="-30" width="28" height="14" rx="3" fill="url(#${ids.glass})" /><rect x="-15" y="2" width="12" height="18" rx="2" fill="url(#${ids.glass})" /><rect x="5" y="0" width="10" height="26" rx="2" fill="#c9b282" /><path d="M-17,30 H17" stroke="#a16207" stroke-width="3" />`;
    }
    const isBus = cfg.kind === 'bus';
    const fill = cfg.kind === 'ambulance' ? '#f7fafc' : cor;
    const width = isBus ? 42 : 36;
    const x = -width / 2;
    let extra = '';
    if (cfg.kind === 'ambulance') extra = `<path d="M0,-5 V24 M-9,9 H9" stroke="#d71920" stroke-width="5" stroke-linecap="round" /><rect x="-12" y="-35" width="9" height="4" rx="2" fill="url(#${ids.red})" /><rect x="3" y="-35" width="9" height="4" rx="2" fill="url(#${ids.blue})" />`;
    if (cfg.kind === 'camper') extra = `<rect x="-10" y="4" width="20" height="18" rx="2" fill="#f0b429" opacity="0.9" /><path d="M-14,-2 H14" stroke="#2563eb" stroke-width="3" /><rect x="-7" y="-46" width="14" height="6" rx="2" fill="#dbe4ea" stroke="#334155" stroke-width="1" />`;
    if (isBus) extra = `<path d="M-16,-18 H16 M-16,-6 H16 M-16,6 H16 M-16,18 H16" stroke="url(#${ids.glass})" stroke-width="6" stroke-linecap="round" opacity="0.78" /><rect x="-6" y="30" width="12" height="10" rx="2" fill="#1f2937" />`;
    return `
      ${this.wheels(ids, [-30, 30], true)}
      <rect x="${x}" y="-45" width="${width}" height="90" rx="6" fill="${fill}" stroke="#111820" stroke-width="1.2" />
      <rect x="${x}" y="-45" width="${width}" height="90" rx="6" fill="url(#${ids.body})" opacity="${cfg.kind === 'ambulance' ? '0.26' : '0.7'}" />
      <rect x="-15" y="-38" width="30" height="15" rx="2" fill="url(#${ids.glass})" />
      <rect x="-14" y="-15" width="28" height="30" rx="2" fill="url(#${ids.glass})" opacity="0.65" />
      ${extra}${this.lights(ids, -40, 39)}`;
  },

  hitch: function() {
    return '<path d="M0,-5 V5 M-5,5 H5" stroke="#242b30" stroke-width="2.2" stroke-linecap="round" />';
  },

  trailer: function(cfg, cor, ids) {
    let body = '';
    if (cfg.kind === 'platform') body = `<rect x="-24" y="-22" width="48" height="58" rx="3" fill="#475569" stroke="#111820" stroke-width="1.1" /><path d="M-20,-14 H20 M-20,-2 H20 M-20,10 H20 M-20,22 H20" stroke="#cbd5dc" stroke-width="2" opacity="0.5" />`;
    if (cfg.kind === 'generator') body = `<rect x="-21" y="-30" width="42" height="58" rx="8" fill="#e5e7eb" stroke="#111820" stroke-width="1.2" /><rect x="-15" y="-18" width="30" height="11" rx="2" fill="#111827" opacity="0.75" /><path d="M-13,1 H13 M-13,10 H13" stroke="#64748b" stroke-width="3" stroke-linecap="round" /><circle cx="0" cy="21" r="4" fill="#f59e0b" />`;
    if (cfg.kind === 'reefer') body = `${this.boxBody(ids, -36, 76, '#f8fafc')}<path d="M-7,-22 H7 M0,-29 V-15" stroke="#0ea5e9" stroke-width="4" stroke-linecap="round" /><rect x="-15" y="23" width="30" height="8" rx="2" fill="#dbeafe" />`;
    if (cfg.kind === 'tank') body = this.tankBody(ids, -36, 78, '#dbe4ea');
    if (cfg.kind === 'waste') body = this.tankBody(ids, -36, 78, '#9ca3af') + '<path d="M-10,4 H10 M-7,-4 L7,12" stroke="#166534" stroke-width="4" stroke-linecap="round" />';
    if (cfg.kind === 'box') body = this.boxBody(ids, -35, 75, '#d8dee2') + '<path d="M-18,-25 L18,25 M18,-25 L-18,25" stroke="#64748b" stroke-width="1.2" opacity="0.5" />';
    if (cfg.kind === 'car') body = `<rect x="-23" y="-28" width="46" height="66" rx="3" fill="#475569" stroke="#111820" stroke-width="1.1" /><path d="M-18,-20 H18 V30 H-18 Z" fill="#1f2937" opacity="0.65" /><path d="M-10,-10 H10 L13,18 H-13 Z" fill="${cor}" stroke="#111820" stroke-width="1" /><path d="M-7,-5 H7 L8,8 H-8 Z" fill="url(#${ids.glass})" />`;
    if (cfg.kind === 'container-generator') body = `<rect x="-22" y="-35" width="44" height="75" rx="3" fill="#0f766e" stroke="#111820" stroke-width="1.2" /><path d="M-16,-29 V34 M-8,-29 V34 M0,-29 V34 M8,-29 V34 M16,-29 V34" stroke="#ccfbf1" stroke-width="1" opacity="0.35" /><rect x="-12" y="-8" width="24" height="20" rx="2" fill="#f59e0b" stroke="#78350f" stroke-width="1" /><path d="M-8,0 H8" stroke="#111827" stroke-width="3" />`;
    if (cfg.kind === 'compressor') body = `<rect x="-21" y="-32" width="42" height="60" rx="8" fill="#f59e0b" stroke="#111820" stroke-width="1.2" /><rect x="-15" y="-22" width="30" height="22" rx="11" fill="url(#${ids.metal})" /><path d="M-13,10 H13 M-11,19 H11" stroke="#4b5563" stroke-width="3" stroke-linecap="round" />`;
    return `${this.wheels(ids, [29, 39], true)}${this.hitch()}${body}`;
  },

  container: function(cfg, cor, ids) {
    if (cfg.kind === 'stationary') return `<path d="M-24,-30 H24 L18,35 H-18 Z" fill="#64748b" stroke="#1f2937" stroke-width="1.4" /><path d="M-18,-21 H18 M-20,-7 H20 M-22,8 H22 M-16,24 H16" stroke="#e2e8f0" stroke-width="2" opacity="0.35" /><path d="M-20,-29 L-26,-38 M20,-29 L26,-38" stroke="#334155" stroke-width="3" stroke-linecap="round" /><rect x="-16" y="-4" width="32" height="14" rx="2" fill="${cor}" opacity="0.55" />`;
    if (cfg.kind === 'tank') return `<rect x="-24" y="-42" width="48" height="84" rx="3" fill="#334155" stroke="#111827" stroke-width="1.2" /><ellipse cx="0" cy="0" rx="18" ry="37" fill="url(#${ids.metal})" stroke="#1f2937" stroke-width="1.2" /><path d="M-22,-27 H22 M-22,27 H22 M-16,-39 V39 M16,-39 V39" stroke="#e2e8f0" stroke-width="1.4" opacity="0.38" />`;
    const isLong = cfg.kind === '40';
    const fill = isLong ? '#0f766e' : '#2563eb';
    const w = isLong ? 48 : 42;
    const h = isLong ? 88 : 76;
    const x = -w / 2;
    const y = -h / 2;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="#1e293b" stroke-width="1.3" /><path d="M${x + 6},${y + 5} V${y + h - 5} M${x + 15},${y + 5} V${y + h - 5} M0,${y + 5} V${y + h - 5} M${w / 2 - 15},${y + 5} V${y + h - 5} M${w / 2 - 6},${y + 5} V${y + h - 5}" stroke="#dbeafe" stroke-width="1.1" opacity="0.36" /><path d="M${x},-24 H${w / 2} M${x},0 H${w / 2} M${x},24 H${w / 2}" stroke="#0f172a" stroke-width="1.3" opacity="0.35" />`;
  },

  machine: function(cfg, cor, ids) {
    if (cfg.kind === 'forklift') return `${this.wheels(ids, [-18, 25], true)}<rect x="-17" y="-20" width="28" height="42" rx="4" fill="${cor}" stroke="#111820" stroke-width="1.2" /><rect x="-12" y="-16" width="19" height="18" rx="2" fill="url(#${ids.glass})" /><path d="M12,-33 V39 M20,-33 V39 M12,18 H34 M20,27 H38" stroke="#29323a" stroke-width="4" stroke-linecap="round" /><rect x="-4" y="15" width="13" height="13" rx="2" fill="#374151" />`;
    if (cfg.kind === 'tractor') return `<ellipse cx="-19" cy="17" rx="8" ry="18" fill="url(#${ids.rubber})" /><ellipse cx="19" cy="17" rx="8" ry="18" fill="url(#${ids.rubber})" /><ellipse cx="-16" cy="-26" rx="5" ry="9" fill="url(#${ids.rubber})" /><ellipse cx="16" cy="-26" rx="5" ry="9" fill="url(#${ids.rubber})" /><rect x="-15" y="-20" width="30" height="39" rx="5" fill="${cor}" stroke="#111820" stroke-width="1.2" /><rect x="-10" y="-16" width="20" height="18" rx="2" fill="url(#${ids.glass})" /><rect x="-8" y="9" width="16" height="13" rx="2" fill="#27313a" opacity="0.8" /><path d="M-12,-31 H12" stroke="#2f3942" stroke-width="4" stroke-linecap="round" />`;
    const tracks = `<rect x="-24" y="-26" width="9" height="52" rx="4" fill="url(#${ids.rubber})" /><rect x="15" y="-26" width="9" height="52" rx="4" fill="url(#${ids.rubber})" /><path d="M-21,-20 V20 M19,-20 V20" stroke="#6a7176" stroke-width="1" stroke-dasharray="3 4" opacity="0.65" />`;
    if (cfg.kind === 'loader') return `${tracks}<rect x="-15" y="-18" width="30" height="34" rx="4" fill="${cor}" stroke="#111820" stroke-width="1.1" /><rect x="-11" y="-14" width="22" height="16" rx="2" fill="url(#${ids.glass})" /><path d="M-4,15 V39" stroke="#6b7280" stroke-width="8" stroke-linecap="round" /><path d="M-18,41 H18" stroke="#4b5563" stroke-width="6" stroke-linecap="round" />`;
    if (cfg.kind === 'backhoe') return `${this.wheels(ids, [-20, 25], true)}<rect x="-16" y="-22" width="30" height="37" rx="4" fill="${cor}" stroke="#111820" stroke-width="1.1" /><rect x="-11" y="-18" width="20" height="15" rx="2" fill="url(#${ids.glass})" /><path d="M12,-4 C28,-9 33,-24 24,-35" stroke="${cor}" stroke-width="6" fill="none" stroke-linecap="round" /><path d="M24,-35 L35,-42 L33,-28" fill="#a16207" stroke="#422006" stroke-width="1" /><path d="M-15,11 L-28,30" stroke="${cor}" stroke-width="5" stroke-linecap="round" />`;
    return `${tracks}<rect x="-13" y="-23" width="28" height="29" rx="4" fill="${cor}" stroke="#111820" stroke-width="1.1" /><path d="M-10,-19 H10 V-2 H-10 Z" fill="url(#${ids.glass})" /><path d="M8,2 C23,7 27,22 17,35" stroke="${cor}" stroke-width="7" fill="none" stroke-linecap="round" /><path d="M17,35 L31,40 L22,24" fill="#a16207" stroke="#422006" stroke-width="1" />`;
  },

  plane: function(cor, ids) {
    return `<path d="M-5,-45 Q0,-49 5,-45 L8,27 L0,45 L-8,27 Z" fill="#eef3f6" stroke="#26313a" stroke-width="1.1" /><path d="M-45,-9 Q-17,-16 -4,-4 L-4,8 Q-24,9 -45,3 Z" fill="url(#${ids.metal})" stroke="#2f3942" stroke-width="1" /><path d="M45,-9 Q17,-16 4,-4 L4,8 Q24,9 45,3 Z" fill="url(#${ids.metal})" stroke="#2f3942" stroke-width="1" /><path d="M-16,30 L-36,42 L-13,38 Z M16,30 L36,42 L13,38 Z" fill="#d4dce1" stroke="#2f3942" stroke-width="1" /><rect x="-3" y="-39" width="6" height="11" rx="2" fill="url(#${ids.glass})" /><path d="M-3,-22 H3 M-3,-14 H3 M-3,-6 H3 M-3,2 H3 M-3,10 H3" stroke="#587184" stroke-width="2" stroke-linecap="round" />`;
  },

  bike: function(cor, ids, pedicab) {
    return `<ellipse cx="0" cy="-32" rx="7" ry="9" fill="none" stroke="url(#${ids.rubber})" stroke-width="3" /><ellipse cx="0" cy="33" rx="7" ry="9" fill="none" stroke="url(#${ids.rubber})" stroke-width="3" /><path d="M0,-32 L-10,-4 L0,7 L10,-4 Z M0,7 L0,33 M-10,-4 H11 M10,-4 L16,-15 M-14,-7 H-4" stroke="${cor}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" /><rect x="-12" y="-8" width="10" height="3" rx="1.5" fill="#111827" /><path d="M13,-16 H23" stroke="#111827" stroke-width="2.4" stroke-linecap="round" />${pedicab ? '<rect x="-18" y="2" width="36" height="24" rx="5" fill="#f8fafc" stroke="#334155" stroke-width="1.2" /><rect x="-13" y="6" width="26" height="10" rx="2" fill="url(#' + ids.glass + ')" opacity="0.85" />' : ''}`;
  },

  motorcycle: function(cor, ids) {
    return `<ellipse cx="0" cy="-35" rx="6.4" ry="8.8" fill="url(#${ids.rubber})" /><ellipse cx="0" cy="36" rx="6.6" ry="9.2" fill="url(#${ids.rubber})" /><path d="M-3,-28 L-5,-13 M3,-28 L5,-13" stroke="url(#${ids.metal})" stroke-width="2.2" stroke-linecap="round" /><path d="M-20,-15 H20" stroke="#2e3842" stroke-width="3.6" stroke-linecap="round" /><path d="M-8,-12 Q0,-18 8,-12 L9,6 Q0,12 -9,6 Z" fill="${cor}" stroke="#111820" stroke-width="1" /><path d="M-8,-12 Q0,-18 8,-12 L9,6 Q0,12 -9,6 Z" fill="url(#${ids.body})" opacity="0.75" /><rect x="-8" y="3" width="16" height="10" rx="3" fill="#39434d" /><rect x="-5" y="10" width="10" height="13" rx="4" fill="#111827" /><path d="M-5,22 Q-3,31 0,36 Q3,31 5,22" stroke="url(#${ids.metal})" stroke-width="2" fill="none" /><path d="M9,5 Q16,17 12,31" stroke="#cbd5dc" stroke-width="2.5" fill="none" stroke-linecap="round" />`;
  },

  drone: function(cor, ids) {
    return `<rect x="-11" y="-11" width="22" height="22" rx="5" fill="${cor}" stroke="#111820" stroke-width="1.2" /><rect x="-11" y="-11" width="22" height="22" rx="5" fill="url(#${ids.body})" opacity="0.7" /><path d="M-10,-10 L-28,-28 M10,-10 L28,-28 M-10,10 L-28,28 M10,10 L28,28" stroke="#3f4a54" stroke-width="3" stroke-linecap="round" /><circle cx="-33" cy="-33" r="10" fill="none" stroke="url(#${ids.rubber})" stroke-width="3" /><circle cx="33" cy="-33" r="10" fill="none" stroke="url(#${ids.rubber})" stroke-width="3" /><circle cx="-33" cy="33" r="10" fill="none" stroke="url(#${ids.rubber})" stroke-width="3" /><circle cx="33" cy="33" r="10" fill="none" stroke="url(#${ids.rubber})" stroke-width="3" />`;
  },

  defaultIcon: function(cor, ids) {
    return `<circle cx="0" cy="0" r="28" fill="${cor}" stroke="#111820" stroke-width="2" /><circle cx="0" cy="0" r="28" fill="url(#${ids.body})" opacity="0.8" /><path d="M0,-33 L8,-7 L0,-12 L-8,-7 Z" fill="#ffffff" opacity="0.92" /><circle cx="0" cy="6" r="7" fill="url(#${ids.glass})" />`;
  }
};
