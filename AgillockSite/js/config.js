/**
 * Configuração da URL da API — ajuste conforme o ambiente.
 * Em desenvolvimento: 'http://localhost:3000'
 * Em produção:        'https://api.agillock.com.br'
 */

window.API_URL = 'https://api.agillock.com.br';

/**
 * Biblioteca de Ícones SVG de Veículos — Vista Superior (Top-View)
 * Cada categoria tem geometria própria, proporcional e detalhada.
 */
window.AL_ICONS_3D = {
  SIZE: 48,

  getSvgHtml: function(categoria, cor, course) {
    const angle = course || 0;
    const cat   = this.mapCategoria(categoria);
    const shape = this.shapes[cat] || this.shapes['carro'];
    const gid   = `gb-${cor.replace('#','')}`;

    return `<svg width="${this.SIZE}" height="${this.SIZE}" viewBox="0 0 100 100"
        style="transform:rotate(${angle}deg);filter:drop-shadow(0 2px 5px rgba(0,0,0,0.45));">
      <defs>
        <linearGradient id="${gid}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="${cor}" stop-opacity="1"/>
          <stop offset="48%"  stop-color="#ffffff" stop-opacity="0.38"/>
          <stop offset="100%" stop-color="${cor}" stop-opacity="1"/>
        </linearGradient>
        <linearGradient id="gls" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stop-color="#1a2533" stop-opacity="1"/>
          <stop offset="100%" stop-color="#2c3e50" stop-opacity="1"/>
        </linearGradient>
        <linearGradient id="gmt" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="#7f8c8d" stop-opacity="1"/>
          <stop offset="50%"  stop-color="#c8cfd0" stop-opacity="1"/>
          <stop offset="100%" stop-color="#7f8c8d" stop-opacity="1"/>
        </linearGradient>
      </defs>
      <g transform="translate(50,50)">${shape(cor, `url(#${gid})`)}</g>
    </svg>`;
  },

  mapCategoria: function(c) {
    if (!c) return 'carro';
    c = c.toLowerCase();
    if (/caminhao_bau|reboque_caixa/i.test(c))            return 'caminhao_bau';
    if (/tanque|pipa|vacuo/i.test(c))                     return 'caminhao_tanque';
    if (/caminhao|trator/i.test(c) && !/agricola/i.test(c)) return 'caminhao';
    if (/pickup/i.test(c))                                return 'pickup';
    if (/moto/i.test(c))                                  return 'moto';
    if (/bicicleta|pedicalo/i.test(c))                    return 'bike';
    if (/van|onibus|caravana/i.test(c))                   return 'onibus';
    if (/ambulancia|viatura/i.test(c))                    return 'emergencia';
    if (/escavadeira|retro|maquina/i.test(c))             return 'maquina';
    if (/trator.*agricola/i.test(c))                      return 'trator';
    if (/aviao/i.test(c))                                 return 'aviao';
    if (/helicoptero/i.test(c))                           return 'helico';
    if (/caixa|container/i.test(c))                       return 'container';
    return 'carro';
  },

  shapes: {

    /* ── CARRO (Sedã / Hatch) ────────────────────────────────────────────── */
    carro: (cor, grad) => `
      <path d="M-11,-34 C-12,-40 -5,-43 0,-43 C5,-43 12,-40 11,-34 L13,21 C13,30 6,35 0,35 C-6,35 -13,30 -13,21 Z" fill="${cor}"/>
      <path d="M-11,-34 C-12,-40 -5,-43 0,-43 C5,-43 12,-40 11,-34 L13,21 C13,30 6,35 0,35 C-6,35 -13,30 -13,21 Z" fill="${grad}" opacity="0.42"/>
      <path d="M-8.5,-31 Q0,-34 8.5,-31 L9.5,-21 Q0,-19 -9.5,-21 Z" fill="url(#gls)" opacity="0.95"/>
      <rect x="-7.5" y="-20" width="15" height="24" rx="2" fill="rgba(18,28,40,0.18)"/>
      <path d="M-8.5,6 Q0,4 8.5,6 L9.5,18 Q0,20 -9.5,18 Z" fill="url(#gls)" opacity="0.82"/>
      <path d="M-11,-27 L-15.5,-25 L-15.5,-21 L-11,-22 Z" fill="${cor}"/>
      <path d="M11,-27 L15.5,-25 L15.5,-21 L11,-22 Z" fill="${cor}"/>
      <line x1="0" y1="-43" x2="0" y2="-35" stroke="rgba(255,255,255,0.32)" stroke-width="1.4" stroke-linecap="round"/>
      <rect x="-18" y="-31" width="6" height="11" rx="2.5" fill="#111"/>
      <rect x="-17" y="-30" width="4" height="9"  rx="1.5" fill="#3a3a3a"/>
      <rect x="12"  y="-31" width="6" height="11" rx="2.5" fill="#111"/>
      <rect x="13"  y="-30" width="4" height="9"  rx="1.5" fill="#3a3a3a"/>
      <rect x="-18" y="15"  width="6" height="11" rx="2.5" fill="#111"/>
      <rect x="-17" y="16"  width="4" height="9"  rx="1.5" fill="#3a3a3a"/>
      <rect x="12"  y="15"  width="6" height="11" rx="2.5" fill="#111"/>
      <rect x="13"  y="16"  width="4" height="9"  rx="1.5" fill="#3a3a3a"/>
    `,

    /* ── PICKUP ──────────────────────────────────────────────────────────── */
    pickup: (cor, grad) => `
      <path d="M-14,-36 Q0,-41 14,-36 L15,10 L-15,10 Z" fill="${cor}"/>
      <path d="M-14,-36 Q0,-41 14,-36 L15,10 L-15,10 Z" fill="${grad}" opacity="0.4"/>
      <path d="M-10,-33 Q0,-36 10,-33 L11,-21 Q0,-19 -11,-21 Z" fill="url(#gls)" opacity="0.95"/>
      <rect x="-9.5" y="-20" width="19" height="14" rx="2" fill="rgba(18,28,40,0.18)"/>
      <path d="M-9.5,-7 Q0,-9 9.5,-7 L9.5,-5 Q0,-4 -9.5,-5 Z" fill="url(#gls)" opacity="0.78"/>
      <path d="M-15,-28 L-19,-26 L-19,-22 L-15,-23 Z" fill="${cor}"/>
      <path d="M15,-28 L19,-26 L19,-22 L15,-23 Z" fill="${cor}"/>
      <rect x="-14" y="10" width="28" height="28" rx="1.5" fill="#2e2e2e"/>
      <rect x="-12" y="12" width="24" height="24" rx="1"   fill="#1c1c1c"/>
      <line x1="-12" y1="12" x2="-12" y2="36" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
      <line x1="12"  y1="12" x2="12"  y2="36" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
      <line x1="-12" y1="24" x2="12"  y2="24" stroke="rgba(255,255,255,0.1)"  stroke-width="1"/>
      <rect x="-20" y="-33" width="6"  height="12" rx="2.5" fill="#111"/>
      <rect x="-19" y="-32" width="4"  height="10" rx="1.5" fill="#3a3a3a"/>
      <rect x="14"  y="-33" width="6"  height="12" rx="2.5" fill="#111"/>
      <rect x="15"  y="-32" width="4"  height="10" rx="1.5" fill="#3a3a3a"/>
      <rect x="-20" y="21"  width="6"  height="12" rx="2.5" fill="#111"/>
      <rect x="-19" y="22"  width="4"  height="10" rx="1.5" fill="#3a3a3a"/>
      <rect x="14"  y="21"  width="6"  height="12" rx="2.5" fill="#111"/>
      <rect x="15"  y="22"  width="4"  height="10" rx="1.5" fill="#3a3a3a"/>
    `,

    /* ── CAMINHÃO (Truck médio/pesado, plataforma) ────────────────────────── */
    caminhao: (cor, grad) => `
      <path d="M-17,-42 Q0,-46 17,-42 L18,-18 L-18,-18 Z" fill="${cor}"/>
      <path d="M-17,-42 Q0,-46 17,-42 L18,-18 L-18,-18 Z" fill="${grad}" opacity="0.4"/>
      <path d="M-13,-40 Q0,-43 13,-40 L14,-28 Q0,-26 -14,-28 Z" fill="url(#gls)" opacity="0.95"/>
      <rect x="-12" y="-27" width="24" height="10" rx="2" fill="rgba(18,28,40,0.2)"/>
      <rect x="-15" y="-18" width="30" height="4"  fill="#888"/>
      <rect x="-17" y="-14" width="34" height="56" rx="1.5" fill="#5a5a5a"/>
      <rect x="-15" y="-12" width="30" height="52" rx="1"   fill="#444"/>
      <line x1="-15" y1="-2"  x2="15" y2="-2"  stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
      <line x1="-15" y1="10"  x2="15" y2="10"  stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
      <line x1="-15" y1="22"  x2="15" y2="22"  stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
      <line x1="-15" y1="34"  x2="15" y2="34"  stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
      <rect x="-24" y="-40" width="8"  height="14" rx="2.5" fill="#111"/>
      <rect x="-23" y="-39" width="6"  height="12" rx="1.5" fill="#3a3a3a"/>
      <rect x="16"  y="-40" width="8"  height="14" rx="2.5" fill="#111"/>
      <rect x="17"  y="-39" width="6"  height="12" rx="1.5" fill="#3a3a3a"/>
      <rect x="-25" y="13"  width="9"  height="13" rx="2.5" fill="#111"/>
      <rect x="-24" y="14"  width="7"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="16"  y="13"  width="9"  height="13" rx="2.5" fill="#111"/>
      <rect x="17"  y="14"  width="7"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="-25" y="29"  width="9"  height="13" rx="2.5" fill="#111"/>
      <rect x="-24" y="30"  width="7"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="16"  y="29"  width="9"  height="13" rx="2.5" fill="#111"/>
      <rect x="17"  y="30"  width="7"  height="11" rx="1.5" fill="#3a3a3a"/>
    `,

    /* ── CAMINHÃO BAÚ (Box Truck — corpo fechado metálico) ───────────────── */
    caminhao_bau: (cor, grad) => `
      <path d="M-16,-44 Q0,-47 16,-44 L17,-24 L-17,-24 Z" fill="${cor}"/>
      <path d="M-16,-44 Q0,-47 16,-44 L17,-24 L-17,-24 Z" fill="${grad}" opacity="0.4"/>
      <path d="M-12,-42 Q0,-44 12,-42 L13,-30 Q0,-28 -13,-30 Z" fill="url(#gls)" opacity="0.95"/>
      <rect x="-11" y="-29" width="22" height="8" rx="2" fill="rgba(18,28,40,0.2)"/>
      <rect x="-19" y="-24" width="38" height="70" rx="2"   fill="#d8dde3"/>
      <rect x="-19" y="-24" width="38" height="70" rx="2"   fill="url(#gmt)" opacity="0.45"/>
      <rect x="-19" y="-24" width="4"  height="70"          fill="#b0b7bf"/>
      <rect x="15"  y="-24" width="4"  height="70"          fill="#b0b7bf"/>
      <line x1="-19" y1="-10" x2="19" y2="-10" stroke="#a8aeb5" stroke-width="1.5"/>
      <line x1="-19" y1="4"   x2="19" y2="4"   stroke="#a8aeb5" stroke-width="1.5"/>
      <line x1="-19" y1="18"  x2="19" y2="18"  stroke="#a8aeb5" stroke-width="1.5"/>
      <line x1="-19" y1="32"  x2="19" y2="32"  stroke="#a8aeb5" stroke-width="1.5"/>
      <line x1="0"   y1="38"  x2="0"  y2="46"  stroke="#888" stroke-width="2"/>
      <rect x="-2.5" y="41"   width="5" height="2" rx="1" fill="#888"/>
      <rect x="-24" y="-42" width="7"  height="13" rx="2.5" fill="#111"/>
      <rect x="-23" y="-41" width="5"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="17"  y="-42" width="7"  height="13" rx="2.5" fill="#111"/>
      <rect x="18"  y="-41" width="5"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="-26" y="10"  width="9"  height="13" rx="2.5" fill="#111"/>
      <rect x="-25" y="11"  width="7"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="17"  y="10"  width="9"  height="13" rx="2.5" fill="#111"/>
      <rect x="18"  y="11"  width="7"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="-26" y="26"  width="9"  height="13" rx="2.5" fill="#111"/>
      <rect x="-25" y="27"  width="7"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="17"  y="26"  width="9"  height="13" rx="2.5" fill="#111"/>
      <rect x="18"  y="27"  width="7"  height="11" rx="1.5" fill="#3a3a3a"/>
    `,

    /* ── CAMINHÃO TANQUE (Cisterna) ─────────────────────────────────────── */
    caminhao_tanque: (cor, grad) => `
      <path d="M-16,-44 Q0,-47 16,-44 L17,-24 L-17,-24 Z" fill="${cor}"/>
      <path d="M-16,-44 Q0,-47 16,-44 L17,-24 L-17,-24 Z" fill="${grad}" opacity="0.4"/>
      <path d="M-12,-42 Q0,-44 12,-42 L13,-30 Q0,-28 -13,-30 Z" fill="url(#gls)" opacity="0.95"/>
      <rect x="-11" y="-29" width="22" height="8" rx="2" fill="rgba(18,28,40,0.2)"/>
      <rect x="-18" y="-24" width="36" height="70" rx="18" fill="url(#gmt)"/>
      <ellipse cx="0" cy="-24" rx="18" ry="5" fill="#c2c5ca"/>
      <ellipse cx="0" cy="46"  rx="18" ry="5" fill="#adb0b5"/>
      <rect x="-4"  y="-19" width="8"  height="60" rx="4" fill="rgba(255,255,255,0.22)"/>
      <line x1="-18" y1="-8" x2="18" y2="-8" stroke="#888" stroke-width="2.2"/>
      <line x1="-18" y1="8"  x2="18" y2="8"  stroke="#888" stroke-width="2.2"/>
      <line x1="-18" y1="24" x2="18" y2="24" stroke="#888" stroke-width="2.2"/>
      <circle cx="0" cy="-14" r="4.5" fill="#999" stroke="#777" stroke-width="1"/>
      <circle cx="0" cy="-14" r="2"   fill="#666"/>
      <rect x="-24" y="-42" width="7"  height="13" rx="2.5" fill="#111"/>
      <rect x="-23" y="-41" width="5"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="17"  y="-42" width="7"  height="13" rx="2.5" fill="#111"/>
      <rect x="18"  y="-41" width="5"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="-26" y="10"  width="9"  height="13" rx="2.5" fill="#111"/>
      <rect x="-25" y="11"  width="7"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="17"  y="10"  width="9"  height="13" rx="2.5" fill="#111"/>
      <rect x="18"  y="11"  width="7"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="-26" y="26"  width="9"  height="13" rx="2.5" fill="#111"/>
      <rect x="-25" y="27"  width="7"  height="11" rx="1.5" fill="#3a3a3a"/>
      <rect x="17"  y="26"  width="9"  height="13" rx="2.5" fill="#111"/>
      <rect x="18"  y="27"  width="7"  height="11" rx="1.5" fill="#3a3a3a"/>
    `,

    /* ── MOTO ────────────────────────────────────────────────────────────── */
    moto: (cor, grad) => `
      <ellipse cx="0" cy="-38" rx="5.5" ry="8"   fill="#111"/>
      <ellipse cx="0" cy="-38" rx="3.5" ry="5.5" fill="#333"/>
      <ellipse cx="0" cy="-38" rx="1.5" ry="2.5" fill="#555"/>
      <path d="M-2.5,-30 L-3,-18 M2.5,-30 L3,-18" stroke="#8a9199" stroke-width="2" fill="none"/>
      <rect x="-18" y="-19" width="36" height="3.5" rx="1.8" fill="#555"/>
      <rect x="-18" y="-19" width="5.5" height="3.5" rx="1.8" fill="#2c3e50"/>
      <rect x="12.5" y="-19" width="5.5" height="3.5" rx="1.8" fill="#2c3e50"/>
      <rect x="-20" y="-20" width="3" height="5" rx="1" fill="#5a6270"/>
      <rect x="17"  y="-20" width="3" height="5" rx="1" fill="#5a6270"/>
      <path d="M-6,-16 Q-7,-6 -6.5,-4 L6.5,-4 Q7,-6 6,-16 Z" fill="${cor}"/>
      <path d="M-6,-16 Q-7,-6 -6.5,-4 L6.5,-4 Q7,-6 6,-16 Z" fill="${grad}" opacity="0.4"/>
      <rect x="-7" y="-4"  width="14" height="12" rx="2.5" fill="#444"/>
      <rect x="-5" y="-2"  width="10" height="8"  rx="1.5" fill="#555"/>
      <rect x="-5" y="8"   width="10" height="14" rx="3"   fill="#111"/>
      <rect x="-3.5" y="9" width="7"  height="12" rx="2"   fill="#222"/>
      <path d="M-1.5,12 L-2,26 M1.5,12 L2,26" stroke="#606060" stroke-width="1.5" fill="none"/>
      <path d="M-5,25 Q0,23 5,25 L5.5,31 Q0,33 -5.5,31 Z" fill="${cor}" opacity="0.65"/>
      <path d="M7,2 C12,10 13,22 12,34" stroke="#b0b0b0" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <ellipse cx="0" cy="36"  rx="5.5" ry="8"   fill="#111"/>
      <ellipse cx="0" cy="36"  rx="3.5" ry="5.5" fill="#333"/>
      <ellipse cx="0" cy="36"  rx="1.5" ry="2.5" fill="#555"/>
    `,

    /* ── BICICLETA ───────────────────────────────────────────────────────── */
    bike: (cor, grad) => `
      <ellipse cx="0" cy="-34" rx="5"   ry="7.5" fill="#111"/>
      <ellipse cx="0" cy="-34" rx="3"   ry="5"   fill="#2a2a2a"/>
      <ellipse cx="0" cy="-34" rx="1.2" ry="2"   fill="#555"/>
      <rect x="-13" y="-33" width="26" height="2.8" rx="1.4" fill="#4a4a4a"/>
      <rect x="-15" y="-33" width="3"  height="5"   rx="1"   fill="#3a3a3a"/>
      <rect x="12"  y="-33" width="3"  height="5"   rx="1"   fill="#3a3a3a"/>
      <rect x="-1.5" y="-32" width="3" height="10"  rx="1"   fill="#777"/>
      <path d="M-1.5,-22 L-4,6 M1.5,-22 L4,6" stroke="#666" stroke-width="2" fill="none"/>
      <path d="M-1.5,-22 L-4,6 L4,6 Z" fill="${cor}" opacity="0.65"/>
      <ellipse cx="0" cy="-26" rx="3.5" ry="2" fill="#222"/>
      <path d="M0,-24 L0,-20" stroke="#888" stroke-width="1.5"/>
      <circle cx="0" cy="-20" r="1.5" fill="#555"/>
      <rect x="-8" y="3"  width="16" height="2.8" rx="1.4" fill="#4a4a4a"/>
      <circle cx="0" cy="4.4" r="5" fill="none" stroke="#555" stroke-width="1.8"/>
      <circle cx="0" cy="4.4" r="1.8" fill="#555"/>
      <path d="M-1.2,6 Q-3,16 -2,24 M1.2,6 Q3,16 2,24" stroke="#555" stroke-width="1.2" fill="none"/>
      <ellipse cx="0" cy="32"  rx="5"   ry="7.5" fill="#111"/>
      <ellipse cx="0" cy="32"  rx="3"   ry="5"   fill="#2a2a2a"/>
      <ellipse cx="0" cy="32"  rx="1.2" ry="2"   fill="#555"/>
    `,

    /* ── ÔNIBUS ──────────────────────────────────────────────────────────── */
    onibus: (cor, grad) => `
      <rect x="-20" y="-44" width="40" height="88" rx="5" fill="${cor}"/>
      <rect x="-20" y="-44" width="40" height="88" rx="5" fill="${grad}" opacity="0.35"/>
      <rect x="-18" y="-44" width="36" height="6"  rx="3" fill="rgba(0,0,0,0.28)"/>
      <rect x="-14" y="-40" width="28" height="12" rx="2" fill="url(#gls)" opacity="0.90"/>
      <line x1="0" y1="-40" x2="0" y2="-28" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
      <rect x="-19" y="-23" width="5" height="7"  rx="1" fill="url(#gls)" opacity="0.85"/>
      <rect x="-19" y="-13" width="5" height="7"  rx="1" fill="url(#gls)" opacity="0.85"/>
      <rect x="-19" y="-3"  width="5" height="7"  rx="1" fill="url(#gls)" opacity="0.85"/>
      <rect x="-19" y="7"   width="5" height="7"  rx="1" fill="url(#gls)" opacity="0.85"/>
      <rect x="-19" y="17"  width="5" height="7"  rx="1" fill="url(#gls)" opacity="0.85"/>
      <rect x="-19" y="27"  width="5" height="7"  rx="1" fill="url(#gls)" opacity="0.85"/>
      <rect x="14"  y="-23" width="5" height="7"  rx="1" fill="url(#gls)" opacity="0.85"/>
      <rect x="14"  y="-13" width="5" height="7"  rx="1" fill="url(#gls)" opacity="0.85"/>
      <rect x="14"  y="-3"  width="5" height="7"  rx="1" fill="url(#gls)" opacity="0.85"/>
      <rect x="14"  y="7"   width="5" height="7"  rx="1" fill="url(#gls)" opacity="0.85"/>
      <rect x="14"  y="17"  width="5" height="7"  rx="1" fill="url(#gls)" opacity="0.85"/>
      <rect x="14"  y="27"  width="5" height="7"  rx="1" fill="url(#gls)" opacity="0.85"/>
      <rect x="-14" y="30"  width="28" height="10" rx="2" fill="url(#gls)" opacity="0.78"/>
      <rect x="-8"  y="-16" width="16" height="7"  rx="2" fill="rgba(255,255,255,0.22)"/>
      <rect x="-26" y="-38" width="8"  height="14" rx="2.5" fill="#111"/>
      <rect x="-25" y="-37" width="6"  height="12" rx="1.5" fill="#3a3a3a"/>
      <rect x="18"  y="-38" width="8"  height="14" rx="2.5" fill="#111"/>
      <rect x="19"  y="-37" width="6"  height="12" rx="1.5" fill="#3a3a3a"/>
      <rect x="-27" y="16"  width="9"  height="14" rx="2.5" fill="#111"/>
      <rect x="-26" y="17"  width="7"  height="12" rx="1.5" fill="#3a3a3a"/>
      <rect x="18"  y="16"  width="9"  height="14" rx="2.5" fill="#111"/>
      <rect x="19"  y="17"  width="7"  height="12" rx="1.5" fill="#3a3a3a"/>
      <rect x="-27" y="32"  width="9"  height="14" rx="2.5" fill="#111"/>
      <rect x="-26" y="33"  width="7"  height="12" rx="1.5" fill="#3a3a3a"/>
      <rect x="18"  y="32"  width="9"  height="14" rx="2.5" fill="#111"/>
      <rect x="19"  y="33"  width="7"  height="12" rx="1.5" fill="#3a3a3a"/>
    `,

    /* ── EMERGÊNCIA (Ambulância / Viatura) ──────────────────────────────── */
    emergencia: (cor, grad) => `
      <rect x="-16" y="-40" width="32" height="78" rx="4" fill="${cor}"/>
      <rect x="-16" y="-40" width="32" height="78" rx="4" fill="${grad}" opacity="0.3"/>
      <rect x="-12" y="-40" width="8"  height="3.5" rx="1.5" fill="#e74c3c"/>
      <rect x="-4"  y="-40" width="8"  height="3.5" rx="1.5" fill="#2980b9"/>
      <rect x="4"   y="-40" width="8"  height="3.5" rx="1.5" fill="#e74c3c"/>
      <rect x="-12" y="-38" width="24" height="12"  rx="2"   fill="url(#gls)" opacity="0.90"/>
      <line x1="0" y1="-38" x2="0" y2="-26" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
      <rect x="-2.5" y="-24" width="5"  height="16" rx="1.5" fill="white"/>
      <rect x="-8.5" y="-20" width="17" height="5"  rx="1.5" fill="white"/>
      <rect x="-1.5" y="-24" width="3"  height="16" rx="1"   fill="#e74c3c"/>
      <rect x="-8.5" y="-19" width="17" height="3"  rx="1"   fill="#e74c3c"/>
      <rect x="-15"  y="-20" width="5"  height="7"  rx="1"   fill="url(#gls)" opacity="0.80"/>
      <rect x="-15"  y="-5"  width="5"  height="7"  rx="1"   fill="url(#gls)" opacity="0.80"/>
      <rect x="-15"  y="10"  width="5"  height="7"  rx="1"   fill="url(#gls)" opacity="0.80"/>
      <rect x="10"   y="-20" width="5"  height="7"  rx="1"   fill="url(#gls)" opacity="0.80"/>
      <rect x="10"   y="-5"  width="5"  height="7"  rx="1"   fill="url(#gls)" opacity="0.80"/>
      <rect x="10"   y="10"  width="5"  height="7"  rx="1"   fill="url(#gls)" opacity="0.80"/>
      <line x1="0"   y1="24" x2="0"    y2="38"  stroke="rgba(0,0,0,0.25)" stroke-width="1.5"/>
      <rect x="-3"   y="30"  width="6"  height="2"  rx="1"   fill="rgba(0,0,0,0.25)"/>
      <rect x="-21"  y="-36" width="7"  height="12" rx="2.5" fill="#111"/>
      <rect x="-20"  y="-35" width="5"  height="10" rx="1.5" fill="#3a3a3a"/>
      <rect x="14"   y="-36" width="7"  height="12" rx="2.5" fill="#111"/>
      <rect x="15"   y="-35" width="5"  height="10" rx="1.5" fill="#3a3a3a"/>
      <rect x="-21"  y="18"  width="7"  height="12" rx="2.5" fill="#111"/>
      <rect x="-20"  y="19"  width="5"  height="10" rx="1.5" fill="#3a3a3a"/>
      <rect x="14"   y="18"  width="7"  height="12" rx="2.5" fill="#111"/>
      <rect x="15"   y="19"  width="5"  height="10" rx="1.5" fill="#3a3a3a"/>
    `,

    /* ── MÁQUINA (Escavadeira sobre esteiras) ───────────────────────────── */
    maquina: (cor, grad) => `
      <rect x="-22" y="-27" width="9"  height="54" rx="4"   fill="#2c2c2c"/>
      <rect x="-21" y="-26" width="7"  height="52" rx="3"   fill="#3a3a3a"/>
      <rect x="13"  y="-27" width="9"  height="54" rx="4"   fill="#2c2c2c"/>
      <rect x="14"  y="-26" width="7"  height="52" rx="3"   fill="#3a3a3a"/>
      <line x1="-22" y1="-16" x2="-13" y2="-16" stroke="#555" stroke-width="2"/>
      <line x1="-22" y1="-6"  x2="-13" y2="-6"  stroke="#555" stroke-width="2"/>
      <line x1="-22" y1="4"   x2="-13" y2="4"   stroke="#555" stroke-width="2"/>
      <line x1="-22" y1="14"  x2="-13" y2="14"  stroke="#555" stroke-width="2"/>
      <line x1="-22" y1="24"  x2="-13" y2="24"  stroke="#555" stroke-width="2"/>
      <line x1="13"  y1="-16" x2="22"  y2="-16" stroke="#555" stroke-width="2"/>
      <line x1="13"  y1="-6"  x2="22"  y2="-6"  stroke="#555" stroke-width="2"/>
      <line x1="13"  y1="4"   x2="22"  y2="4"   stroke="#555" stroke-width="2"/>
      <line x1="13"  y1="14"  x2="22"  y2="14"  stroke="#555" stroke-width="2"/>
      <line x1="13"  y1="24"  x2="22"  y2="24"  stroke="#555" stroke-width="2"/>
      <rect x="-13" y="-8"   width="26" height="16" rx="2" fill="#555"/>
      <ellipse cx="0" cy="-2" rx="16" ry="18" fill="${cor}"/>
      <ellipse cx="0" cy="-2" rx="16" ry="18" fill="${grad}" opacity="0.35"/>
      <rect x="-9"  y="-14"  width="12" height="9"  rx="2" fill="url(#gls)" opacity="0.90"/>
      <rect x="-11" y="8"    width="22" height="8"  rx="3" fill="#2a2a2a"/>
      <circle cx="0" cy="-2" r="5.5" fill="#3a3a3a"/>
      <circle cx="0" cy="-2" r="2.5" fill="#555"/>
      <rect x="-3"  y="-38"  width="6"  height="26" rx="3"   fill="#e67e22"/>
      <rect x="-2"  y="-46"  width="4"  height="16" rx="2"   fill="#d35400"/>
      <path d="M-6,-48 L6,-48 L7.5,-42 L-7.5,-42 Z" fill="#2a2a2a"/>
      <path d="M-7.5,-42 L7.5,-42 L5.5,-38 L-5.5,-38 Z" fill="#1a1a1a"/>
      <rect x="2"   y="-36"  width="3"  height="16" rx="1.5" fill="#bbb" opacity="0.7"/>
    `,

    /* ── TRATOR AGRÍCOLA ────────────────────────────────────────────────── */
    trator: (cor, grad) => `
      <ellipse cx="-20" cy="18" rx="12" ry="20" fill="#111"/>
      <ellipse cx="-20" cy="18" rx="9"  ry="15" fill="#1e1e1e"/>
      <ellipse cx="-20" cy="18" rx="5"  ry="8"  fill="#3a3a3a"/>
      <circle  cx="-20" cy="18" r="2"           fill="#555"/>
      <path d="M-31,8  L-28,7  M-32,12 L-29,12 M-32,16 L-29,16 M-32,20 L-29,20 M-32,24 L-29,24 M-31,28 L-28,29" stroke="#0a0a0a" stroke-width="2.5" fill="none"/>
      <ellipse cx="20"  cy="18" rx="12" ry="20" fill="#111"/>
      <ellipse cx="20"  cy="18" rx="9"  ry="15" fill="#1e1e1e"/>
      <ellipse cx="20"  cy="18" rx="5"  ry="8"  fill="#3a3a3a"/>
      <circle  cx="20"  cy="18" r="2"           fill="#555"/>
      <path d="M31,8  L28,7  M32,12 L29,12 M32,16 L29,16 M32,20 L29,20 M32,24 L29,24 M31,28 L28,29" stroke="#0a0a0a" stroke-width="2.5" fill="none"/>
      <rect x="-9" y="4"   width="18" height="28" rx="2" fill="#555"/>
      <path d="M-10,-30 Q0,-35 10,-30 L11,4 Q0,7 -11,4 Z" fill="${cor}"/>
      <path d="M-10,-30 Q0,-35 10,-30 L11,4 Q0,7 -11,4 Z" fill="${grad}" opacity="0.42"/>
      <line x1="-8" y1="-28" x2="-8" y2="2" stroke="rgba(0,0,0,0.22)" stroke-width="1"/>
      <line x1="8"  y1="-28" x2="8"  y2="2" stroke="rgba(0,0,0,0.22)" stroke-width="1"/>
      <line x1="-8" y1="-14" x2="8"  y2="-14" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
      <rect x="-9"  y="-30" width="18" height="14" rx="2" fill="${cor}"/>
      <rect x="-9"  y="-30" width="18" height="14" rx="2" fill="${grad}" opacity="0.3"/>
      <rect x="-8"  y="-36" width="16" height="8"  rx="3" fill="rgba(0,0,0,0.32)"/>
      <rect x="-7"  y="-29" width="6"  height="8"  rx="1" fill="url(#gls)" opacity="0.82"/>
      <rect x="1"   y="-29" width="6"  height="8"  rx="1" fill="url(#gls)" opacity="0.82"/>
      <ellipse cx="-12" cy="-30" rx="5.5" ry="7.5" fill="#111"/>
      <ellipse cx="-12" cy="-30" rx="3.5" ry="5"   fill="#222"/>
      <ellipse cx="12"  cy="-30" rx="5.5" ry="7.5" fill="#111"/>
      <ellipse cx="12"  cy="-30" rx="3.5" ry="5"   fill="#222"/>
      <rect x="6.5" y="-42" width="3.5" height="14" rx="1.5" fill="#555"/>
      <circle cx="8.3" cy="-42" r="2.5" fill="#333"/>
      <rect x="-5"  y="34" width="10" height="6"  rx="2" fill="#444"/>
      <rect x="-3"  y="40" width="6"  height="4"  rx="1" fill="#333"/>
    `,

    /* ── AVIÃO ───────────────────────────────────────────────────────────── */
    aviao: (cor, grad) => `
      <path d="M-5,-44 Q-6,-20 -6,18 Q-6,34 0,44 Q6,34 6,18 Q6,-20 5,-44 Q2,-48 0,-48 Q-2,-48 -5,-44 Z" fill="#e8ecef"/>
      <path d="M-5,-44 Q-6,-20 -6,18 Q-6,34 0,44 Q6,34 6,18 Q6,-20 5,-44 Q2,-48 0,-48 Q-2,-48 -5,-44 Z" fill="url(#gmt)" opacity="0.35"/>
      <ellipse cx="0" cy="-40" rx="4" ry="5.5" fill="url(#gls)" opacity="0.85"/>
      <path d="M-6,-4 L-45,12 L-43,20 L-6,9 Z" fill="${cor}"/>
      <path d="M-6,-4 L-45,12 L-43,20 L-6,9 Z" fill="${grad}" opacity="0.38"/>
      <path d="M6,-4  L45,12  L43,20  L6,9  Z"  fill="${cor}"/>
      <path d="M6,-4  L45,12  L43,20  L6,9  Z"  fill="${grad}" opacity="0.38"/>
      <line x1="-6" y1="7"  x2="-34" y2="16" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>
      <line x1="6"  y1="7"  x2="34"  y2="16" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>
      <ellipse cx="-27" cy="8"  rx="5.5" ry="8" fill="#b0b5bb"/>
      <ellipse cx="-27" cy="8"  rx="3.5" ry="6" fill="#8a9099"/>
      <ellipse cx="27"  cy="8"  rx="5.5" ry="8" fill="#b0b5bb"/>
      <ellipse cx="27"  cy="8"  rx="3.5" ry="6" fill="#8a9099"/>
      <path d="M-6,26  L-24,36 L-23,41 L-6,32 Z" fill="${cor}" opacity="0.88"/>
      <path d="M6,26   L24,36  L23,41  L6,32  Z" fill="${cor}" opacity="0.88"/>
      <rect x="-4.5" y="-40" width="9" height="70" rx="2" fill="${cor}" opacity="0.42"/>
      <circle cx="0" cy="-22" r="1.4" fill="rgba(120,190,255,0.75)"/>
      <circle cx="0" cy="-12" r="1.4" fill="rgba(120,190,255,0.75)"/>
      <circle cx="0" cy="-2"  r="1.4" fill="rgba(120,190,255,0.75)"/>
      <circle cx="0" cy="8"   r="1.4" fill="rgba(120,190,255,0.75)"/>
    `,

    /* ── HELICÓPTERO ────────────────────────────────────────────────────── */
    helico: (cor, grad) => `
      <ellipse cx="0" cy="-5" rx="44" ry="44" fill="rgba(160,160,160,0.10)" stroke="rgba(80,80,80,0.22)" stroke-width="1"/>
      <rect x="-44" y="-6.5" width="88" height="3"   rx="1.5" fill="#2a2a2a" opacity="0.72"/>
      <rect x="-1.5" y="-48" width="3"  height="88"  rx="1.5" fill="#2a2a2a" opacity="0.72"/>
      <circle cx="0" cy="-5" r="4.5" fill="#3a3a3a"/>
      <circle cx="0" cy="-5" r="2"   fill="#555"/>
      <path d="M-3,8 Q-4,28 -3,38 Q0,43 3,38 Q4,28 3,8 Z" fill="#7a7a7a"/>
      <path d="M-4,36 L-10,43 L-8,45 L-3,38 Z" fill="#666"/>
      <path d="M4,36  L10,43  L8,45  L3,38  Z" fill="#666"/>
      <ellipse cx="0" cy="38" rx="7" ry="2.5" fill="#444" opacity="0.75"/>
      <ellipse cx="0" cy="-2" rx="15" ry="20" fill="${cor}"/>
      <ellipse cx="0" cy="-2" rx="15" ry="20" fill="${grad}" opacity="0.38"/>
      <ellipse cx="0" cy="-16" rx="11" ry="9"  fill="url(#gls)" opacity="0.88"/>
      <ellipse cx="-3" cy="-19" rx="4" ry="4.5" fill="rgba(120,190,255,0.22)"/>
      <rect x="-10" y="-6"  width="6"  height="5" rx="1.5" fill="url(#gls)" opacity="0.78"/>
      <rect x="4"   y="-6"  width="6"  height="5" rx="1.5" fill="url(#gls)" opacity="0.78"/>
      <rect x="-20" y="6"   width="16" height="3" rx="1.5" fill="#4a4a4a"/>
      <rect x="4"   y="6"   width="16" height="3" rx="1.5" fill="#4a4a4a"/>
      <rect x="-18" y="0"   width="3"  height="8" rx="1"   fill="#5a5a5a"/>
      <rect x="-7"  y="0"   width="3"  height="8" rx="1"   fill="#5a5a5a"/>
      <rect x="4"   y="0"   width="3"  height="8" rx="1"   fill="#5a5a5a"/>
      <rect x="15"  y="0"   width="3"  height="8" rx="1"   fill="#5a5a5a"/>
    `,

    /* ── CONTAINER (Contêiner de transporte) ────────────────────────────── */
    container: (cor, grad) => `
      <rect x="-20" y="-42" width="40" height="84" rx="2" fill="${cor}"/>
      <rect x="-20" y="-42" width="40" height="84" rx="2" fill="${grad}" opacity="0.3"/>
      <rect x="-22" y="-44" width="6"  height="6"  rx="1" fill="rgba(0,0,0,0.35)"/>
      <rect x="16"  y="-44" width="6"  height="6"  rx="1" fill="rgba(0,0,0,0.35)"/>
      <rect x="-22" y="38"  width="6"  height="6"  rx="1" fill="rgba(0,0,0,0.35)"/>
      <rect x="16"  y="38"  width="6"  height="6"  rx="1" fill="rgba(0,0,0,0.35)"/>
      <rect x="-20" y="-42" width="3.5" height="84"         fill="rgba(0,0,0,0.22)"/>
      <rect x="16.5" y="-42" width="3.5" height="84"        fill="rgba(0,0,0,0.22)"/>
      <line x1="-20" y1="-28" x2="20" y2="-28" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
      <line x1="-20" y1="-14" x2="20" y2="-14" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
      <line x1="-20" y1="0"   x2="20" y2="0"   stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
      <line x1="-20" y1="14"  x2="20" y2="14"  stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
      <line x1="-20" y1="28"  x2="20" y2="28"  stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
      <line x1="0"   y1="28"  x2="0"  y2="42"  stroke="rgba(255,255,255,0.28)" stroke-width="1.5"/>
      <rect x="-8"  y="32"  width="3"  height="8" rx="1" fill="rgba(255,255,255,0.28)"/>
      <rect x="5"   y="32"  width="3"  height="8" rx="1" fill="rgba(255,255,255,0.28)"/>
      <circle cx="-6.5" cy="30" r="2.5" fill="rgba(255,255,255,0.32)"/>
      <circle cx="6.5"  cy="30" r="2.5" fill="rgba(255,255,255,0.32)"/>
      <rect x="-12" y="-8"  width="24" height="16" rx="1" fill="rgba(255,255,255,0.1)"/>
    `
  }
};
