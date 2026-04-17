/**                                                                                                                │
│   2 -  * Configuração da URL da API — ajuste conforme o ambiente.                                                │
│   3 -  * Em desenvolvimento: 'http://localhost:3000'                                                             │
│   4 -  * Em produção:        'https://api.agillock.com.br'                                                       │
*/         

window.API_URL = 'https://api.agillock.com.br';

/**
 * Biblioteca de Ícones SVG 3D para Veículos - AgilLock
 * Vista superior com efeitos de profundidade, gradientes e sombras.
 */
window.AL_ICONS_3D = {
  SIZE: 42,

  getSvgHtml: function(categoria, cor, course) {
    const angle = course || 0;
    const cat = this.mapCategoria(categoria);
    const shape = this.shapes[cat] || this.shapes['carro'];
    const gradId = `grad-body-${cor.replace('#','')}`;
    
    return `
    <svg width="${this.SIZE}" height="${this.SIZE}" viewBox="0 0 100 100" style="transform: rotate(${angle}deg); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:${cor};stop-opacity:1" />
          <stop offset="50%" style="stop-color:#ffffff;stop-opacity:0.4" />
          <stop offset="100%" style="stop-color:${cor};stop-opacity:1" />
        </linearGradient>
        <linearGradient id="grad-glass" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#1a2533;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#34495e;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="grad-metal" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#7f8c8d;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#bdc3c7;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#7f8c8d;stop-opacity:1" />
        </linearGradient>
      </defs>
      <g transform="translate(50, 50)">
        ${shape(cor, `url(#${gradId})`)}
      </g>
    </svg>`;
  },

  mapCategoria: function(c) {
    c = c.toLowerCase();
    if (/caminhao_bau|reboque_caixa/i.test(c)) return 'caminhao_bau';
    if (/tanque|pipa|vacuo/i.test(c)) return 'caminhao_tanque';
    if (/caminhao|trator/i.test(c) && !/agricola/i.test(c)) return 'caminhao';
    if (/pickup/i.test(c)) return 'pickup';
    if (/moto/i.test(c)) return 'moto';
    if (/bicicleta|pedicalo/i.test(c)) return 'bike';
    if (/van|onibus|caravana/i.test(c)) return 'onibus';
    if (/ambulancia|viatura/i.test(c)) return 'emergencia';
    if (/escavadeira|retro|maquina/i.test(c)) return 'maquina';
    if (/trator.*agricola/i.test(c)) return 'trator';
    if (/aviao/i.test(c)) return 'aviao';
    if (/helicoptero/i.test(c)) return 'helico';
    if (/caixa|container/i.test(c)) return 'container';
    return 'carro';
  },

  shapes: {
    carro: (cor, grad) => `
      <path d="M-14,-35 Q-16,-40 0,-40 Q16,-40 14,-35 L16,28 Q16,36 0,36 Q-16,36 -16,28 Z" fill="${cor}" />
      <path d="M-14,-35 Q-16,-40 0,-40 Q16,-40 14,-35 L16,28 Q16,36 0,36 Q-16,36 -16,28 Z" fill="${grad}" opacity="0.5" />
      <path d="M-11,-22 L11,-22 L13,8 L-13,8 Z" fill="url(#grad-glass)" />
      <rect x="-10" y="-32" width="20" height="5" rx="1" fill="white" opacity="0.2" />
    `,
    pickup: (cor, grad) => `
      <path d="M-15,-35 Q-17,-40 0,-40 Q17,-40 15,-35 L17,32 L-17,32 Z" fill="${cor}" />
      <path d="M-15,-35 Q-17,-40 0,-40 Q17,-40 15,-35 L17,32 L-17,32 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-22 L12,-22 L13,2 L-13,2 Z" fill="url(#grad-glass)" />
      <rect x="-14" y="5" width="28" height="24" fill="#333" opacity="0.3" /> <!-- Caçamba -->
    `,
    caminhao: (cor, grad) => `
      <rect x="-18" y="-40" width="36" height="25" rx="2" fill="${cor}" /> <!-- Cabine -->
      <rect x="-18" y="-40" width="36" height="25" rx="2" fill="${grad}" opacity="0.4" />
      <rect x="-15" y="-38" width="30" height="15" fill="url(#grad-glass)" />
      <rect x="-16" y="-12" width="32" height="50" fill="#555" /> <!-- Chassis -->
      <rect x="-20" y="5" width="4" height="10" fill="#222" /> <!-- Rodas -->
      <rect x="16" y="5" width="4" height="10" fill="#222" />
    `,
    caminhao_bau: (cor, grad) => `
      <rect x="-18" y="-42" width="36" height="20" rx="2" fill="${cor}" />
      <rect x="-16" y="-40" width="32" height="10" fill="url(#grad-glass)" />
      <rect x="-20" y="-20" width="40" height="65" rx="2" fill="#ecf0f1" /> <!-- Baú -->
      <rect x="-20" y="-20" width="40" height="65" rx="2" fill="url(#grad-metal)" opacity="0.3" />
    `,
    caminhao_tanque: (cor, grad) => `
      <rect x="-18" y="-42" width="36" height="20" rx="2" fill="${cor}" />
      <rect x="-20" y="-20" width="40" height="65" rx="18" fill="url(#grad-metal)" /> <!-- Tanque -->
      <rect x="-5" y="-15" width="10" height="55" fill="white" opacity="0.2" />
    `,
    moto: (cor, grad) => `
      <rect x="-3" y="-35" width="6" height="18" rx="3" fill="#222" /> <!-- Pneu F -->
      <rect x="-3" y="15" width="6" height="22" rx="3" fill="#222" /> <!-- Pneu T -->
      <path d="M-6,-15 L6,-15 Q10,0 6,20 L-6,20 Q-10,0 -6,-15" fill="${cor}" />
      <path d="M-6,-15 L6,-15 Q10,0 6,20 L-6,20 Q-10,0 -6,-15" fill="${grad}" opacity="0.5" />
      <rect x="-15" y="-12" width="30" height="3" rx="1" fill="#7f8c8d" /> <!-- Guidão -->
    `,
    bike: (cor) => `
      <rect x="-1.5" y="-30" width="3" height="60" fill="#333" />
      <rect x="-10" y="-20" width="20" height="2" fill="#7f8c8d" />
      <ellipse cx="0" cy="0" rx="4" ry="10" fill="${cor}" />
    `,
    onibus: (cor, grad) => `
      <rect x="-19" y="-45" width="38" height="90" rx="4" fill="${cor}" />
      <rect x="-19" y="-45" width="38" height="90" rx="4" fill="${grad}" opacity="0.4" />
      <rect x="-16" y="-42" width="32" height="12" fill="url(#grad-glass)" />
      <rect x="-16" y="-25" width="32" height="60" fill="url(#grad-glass)" opacity="0.6" />
      <rect x="-10" y="-44" width="20" height="2" fill="white" opacity="0.3" />
    `,
    emergencia: (cor, grad) => `
      <rect x="-17" y="-38" width="34" height="76" rx="4" fill="${cor}" />
      <rect x="-17" y="-38" width="34" height="76" rx="4" fill="${grad}" opacity="0.4" />
      <path d="M-14,-28 L14,-28 L16,-10 L-16,-10 Z" fill="url(#grad-glass)" />
      <rect x="-10" y="-14" width="8" height="4" fill="red" /> <!-- Giroflex -->
      <rect x="2" y="-14" width="8" height="4" fill="blue" />
    `,
    maquina: (cor, grad) => `
      <rect x="-18" y="-25" width="36" height="45" rx="2" fill="${cor}" /> <!-- Corpo -->
      <rect x="-15" y="-22" width="30" height="20" fill="url(#grad-glass)" />
      <rect x="-6" y="20" width="12" height="35" fill="#7f8c8d" /> <!-- Braço -->
      <rect x="-22" y="-30" width="8" height="60" fill="#333" /> <!-- Lagartas -->
      <rect x="14" y="-30" width="8" height="60" fill="#333" />
    `,
    trator: (cor, grad) => `
      <rect x="-12" y="-15" width="24" height="35" rx="2" fill="${cor}" />
      <rect x="-12" y="-15" width="24" height="35" rx="2" fill="${grad}" opacity="0.4" />
      <rect x="-20" y="5" width="8" height="20" fill="#222" /> <!-- Rodas Grandes -->
      <rect x="12" y="5" width="8" height="20" fill="#222" />
      <rect x="-18" y="-25" width="6" height="12" fill="#222" /> <!-- Rodas Pequenas -->
      <rect x="12" y="-25" width="6" height="12" fill="#222" />
    `,
    aviao: (cor) => `
      <path d="M-5,-45 L5,-45 L8,35 L0,45 L-8,35 Z" fill="#ecf0f1" /> <!-- Fuselagem -->
      <path d="M-45,-10 L45,-10 L45,5 L-45,5 Z" fill="#ecf0f1" /> <!-- Asas -->
      <path d="M-15,35 L15,35 L15,42 L-15,42 Z" fill="#ecf0f1" /> <!-- Cauda -->
      <rect x="-3" y="-40" width="6" height="8" fill="#34495e" /> <!-- Cockpit -->
    `,
    helico: (cor) => `
      <ellipse cx="0" cy="-5" rx="12" ry="30" fill="${cor}" />
      <rect x="-1" y="-5" width="2" height="45" fill="#7f8c8d" /> <!-- Cauda -->
      <rect x="-40" y="-6" width="80" height="2" fill="#333" opacity="0.6" /> <!-- Hélice -->
      <rect x="-2" y="-42" width="4" height="80" fill="#333" opacity="0.6" transform="rotate(90)" />
    `,
    container: () => `
      <rect x="-20" y="-40" width="40" height="80" fill="#2980b9" />
      <rect x="-20" y="-40" width="40" height="80" fill="url(#grad-metal)" opacity="0.3" />
      <path d="M-20,-30 H20 M-20,-10 H20 M-20,10 H20 M-20,30 H20" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
    `
  }
};
