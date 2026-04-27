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
  SIZE: 48,

  getSvgHtml: function(categoria, cor, course) {
    const angle = course || 0;
    const cat = this.mapCategoria(categoria);
    const shape = this.shapes[cat] || this.shapes['carro'];
    const gradId = `grad-body-${cor.replace('#','')}`;
    
    return `
    <svg width="${this.SIZE}" height="${this.SIZE}" viewBox="0 0 100 100" style="transform: rotate(${angle}deg); filter: drop-shadow(0 3px 5px rgba(0,0,0,0.4));">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:${cor};stop-opacity:1" />
          <stop offset="30%" style="stop-color:#ffffff;stop-opacity:0.5" />
          <stop offset="100%" style="stop-color:${cor};stop-opacity:1" />
        </linearGradient>
        <linearGradient id="grad-glass" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#111820;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#2c3e50;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#111820;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="grad-metal" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#5a6268;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#d5d8dc;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#5a6268;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="grad-dark" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#1a1a1a;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#444;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#1a1a1a;stop-opacity:1" />
        </linearGradient>
      </defs>
      <g transform="translate(50, 50)">
        ${shape(cor, `url(#${gradId})`)}
      </g>
    </svg>`;
  },

  mapCategoria: function(c) {
    if (!c) return 'carro';
    const cleanC = c.toLowerCase();
    // Tenta buscar diretamente pelo nome exato do value (mais robusto)
    if (this.shapes[cleanC]) return cleanC;
    
    // Fallbacks de segurança baseados em regex para categorias não listadas explicitamente
    if (/caminhao_bau|reboque_caixa/i.test(cleanC)) return 'caminhao_bau';
    if (/tanque|pipa|vacuo/i.test(cleanC)) return 'caminhao_tanque_combustivel';
    if (/caminhao|trator/i.test(cleanC) && !/agricola/i.test(cleanC)) return 'caminhao';
    if (/pickup/i.test(cleanC)) return 'carro_assistencia'; // Base de pickup
    if (/moto/i.test(cleanC)) return 'motocicleta_cruzada';
    if (/bicicleta|pedicalo/i.test(cleanC)) return 'bicicleta';
    if (/van|onibus|caravana/i.test(cleanC)) return 'onibus';
    if (/ambulancia|viatura/i.test(cleanC)) return 'ambulancia';
    if (/escavadeira|retro|maquina/i.test(cleanC)) return 'escavadeira';
    if (/aviao/i.test(cleanC)) return 'aviao_passageiros';
    if (/caixa|container/i.test(cleanC)) return 'container_40';
    return 'carro';
  },

  shapes: {
    // ==========================================
    // 1. CARROS E DERIVADOS (Detalhados)
    // ==========================================
    carro: (cor, grad) => `
      <!-- Rodas -->
      <rect x="-18" y="-22" width="4" height="12" rx="2" fill="#111" />
      <rect x="14" y="-22" width="4" height="12" rx="2" fill="#111" />
      <rect x="-18" y="15" width="4" height="12" rx="2" fill="#111" />
      <rect x="14" y="15" width="4" height="12" rx="2" fill="#111" />
      <!-- Corpo principal -->
      <path d="M-15,-36 Q0,-40 15,-36 L16,30 Q0,36 -16,30 Z" fill="${cor}" />
      <path d="M-15,-36 Q0,-40 15,-36 L16,30 Q0,36 -16,30 Z" fill="${grad}" opacity="0.6" />
      <!-- Para-brisa e Teto -->
      <path d="M-12,-18 Q0,-22 12,-18 L13.5,3 Q0,0 -13.5,3 Z" fill="url(#grad-glass)" />
      <rect x="-10" y="-3" width="20" height="20" rx="3" fill="#fff" opacity="0.1" />
      <path d="M-11,21 Q0,17 11,21 L10,27 Q0,30 -10,27 Z" fill="url(#grad-glass)" />
      <!-- Retrovisores -->
      <path d="M-15,-10 L-19,-8 L-18,-4 L-15,-6 Z" fill="${cor}" />
      <path d="M15,-10 L19,-8 L18,-4 L15,-6 Z" fill="${cor}" />
      <!-- Faróis e Lanternas -->
      <rect x="-13" y="-38" width="7" height="3" rx="1" fill="#fff" opacity="0.9" />
      <rect x="6" y="-38" width="7" height="3" rx="1" fill="#fff" opacity="0.9" />
      <rect x="-14" y="31" width="6" height="2" fill="red" opacity="0.8" />
      <rect x="8" y="31" width="6" height="2" fill="red" opacity="0.8" />
    `,
    carro_executivo: (cor, grad) => window.AL_ICONS_3D.shapes.carro('#2c3e50', 'url(#grad-dark)') + `
      <rect x="-8" y="-3" width="16" height="20" fill="#000" opacity="0.3" />
    `,
    carro_hatchback: (cor, grad) => `
      <rect x="-18" y="-20" width="4" height="12" rx="2" fill="#111" />
      <rect x="14" y="-20" width="4" height="12" rx="2" fill="#111" />
      <rect x="-18" y="10" width="4" height="12" rx="2" fill="#111" />
      <rect x="14" y="10" width="4" height="12" rx="2" fill="#111" />
      <path d="M-15,-34 Q0,-38 15,-34 L16,20 Q0,25 -16,20 Z" fill="${cor}" />
      <path d="M-15,-34 Q0,-38 15,-34 L16,20 Q0,25 -16,20 Z" fill="${grad}" opacity="0.6" />
      <path d="M-12,-18 Q0,-22 12,-18 L13.5,3 Q0,0 -13.5,3 Z" fill="url(#grad-glass)" />
      <path d="M-12,12 Q0,8 12,12 L11,18 Q0,21 -11,18 Z" fill="url(#grad-glass)" />
      <path d="M-15,-10 L-19,-8 L-18,-4 L-15,-6 Z" fill="${cor}" />
      <path d="M15,-10 L19,-8 L18,-4 L15,-6 Z" fill="${cor}" />
    `,
    carro_luxo: (cor, grad) => window.AL_ICONS_3D.shapes.carro(cor, grad) + `
      <path d="M-6,-40 L0,-35 L6,-40" fill="none" stroke="#fff" stroke-width="1.5" opacity="0.5"/>
    `,
    taxi: (cor, grad) => window.AL_ICONS_3D.shapes.carro('#f1c40f', 'url(#grad-body-f1c40f)') + `
      <rect x="-4" y="2" width="8" height="4" rx="1" fill="#fff" stroke="#333" stroke-width="0.5"/>
      <rect x="-3" y="3" width="6" height="2" fill="#e67e22" />
    `,
    viatura: (cor, grad) => window.AL_ICONS_3D.shapes.carro('#2c3e50', 'url(#grad-dark)') + `
      <path d="M-16,-5 L16,-5 L16,10 L-16,10 Z" fill="#ecf0f1" />
      <rect x="-8" y="5" width="8" height="4" fill="red" />
      <rect x="0" y="5" width="8" height="4" fill="blue" />
    `,

    // ==========================================
    // 2. PICKUPS E VANS
    // ==========================================
    carro_assistencia: (cor, grad) => `
      <!-- Rodas Pick-up -->
      <rect x="-19" y="-25" width="5" height="14" rx="2" fill="#111" />
      <rect x="14" y="-25" width="5" height="14" rx="2" fill="#111" />
      <rect x="-19" y="18" width="5" height="14" rx="2" fill="#111" />
      <rect x="14" y="18" width="5" height="14" rx="2" fill="#111" />
      <!-- Cabine Frontal -->
      <path d="M-16,-35 Q0,-40 16,-35 L16.5,-2 L-16.5,-2 Z" fill="${cor}" />
      <path d="M-16,-35 Q0,-40 16,-35 L16.5,-2 L-16.5,-2 Z" fill="${grad}" opacity="0.6" />
      <!-- Para-brisa -->
      <path d="M-13,-20 Q0,-25 13,-20 L14.5,-5 Q0,-3 -14.5,-5 Z" fill="url(#grad-glass)" />
      <!-- Retrovisores de Pickup -->
      <rect x="-20" y="-18" width="5" height="8" rx="1" fill="#1a1a1a" />
      <rect x="15" y="-18" width="5" height="8" rx="1" fill="#1a1a1a" />
      <!-- Caçamba Traseira -->
      <path d="M-16.5,-1 L16.5,-1 L16,38 L-16,38 Z" fill="${cor}" />
      <path d="M-16.5,-1 L16.5,-1 L16,38 L-16,38 Z" fill="url(#grad-metal)" opacity="0.4" />
      <!-- Detalhes do interior da Caçamba -->
      <rect x="-13" y="1" width="26" height="34" rx="1" fill="#1a1a1a" />
      <path d="M-10,3 V33 M-5,3 V33 M0,3 V33 M5,3 V33 M10,3 V33" stroke="#333" stroke-width="1.5" />
      <!-- Santantônio (Barra de proteção traseira) -->
      <path d="M-16,-1 L16,-1 L16,4 L-16,4 Z" fill="url(#grad-metal)" />
      <!-- Faróis -->
      <rect x="-14" y="-38" width="7" height="4" rx="1" fill="#fff" opacity="0.9" />
      <rect x="7" y="-38" width="7" height="4" rx="1" fill="#fff" opacity="0.9" />
      <!-- Giroflex de Assistência -->
      <rect x="-6" y="-12" width="12" height="4" rx="2" fill="#f39c12" opacity="0.9" />
      <!-- Lanternas -->
      <rect x="-16" y="36" width="4" height="3" fill="red" opacity="0.9" />
      <rect x="12" y="36" width="4" height="3" fill="red" opacity="0.9" />
    `,
    van: (cor, grad) => `
      <rect x="-18" y="-28" width="4" height="14" rx="2" fill="#111" />
      <rect x="14" y="-28" width="4" height="14" rx="2" fill="#111" />
      <rect x="-18" y="20" width="4" height="14" rx="2" fill="#111" />
      <rect x="14" y="20" width="4" height="14" rx="2" fill="#111" />
      <rect x="-18" y="-38" width="36" height="76" rx="4" fill="${cor}" />
      <rect x="-18" y="-38" width="36" height="76" rx="4" fill="${grad}" opacity="0.6" />
      <path d="M-15,-28 L15,-28 L16,-10 L-16,-10 Z" fill="url(#grad-glass)" />
      <rect x="-16" y="0" width="4" height="20" fill="url(#grad-glass)" />
      <rect x="12" y="0" width="4" height="20" fill="url(#grad-glass)" />
      <rect x="-20" y="-25" width="4" height="8" rx="1" fill="#1a1a1a" />
      <rect x="16" y="-25" width="4" height="8" rx="1" fill="#1a1a1a" />
    `,
    van_campista: (cor, grad) => window.AL_ICONS_3D.shapes.van(cor, grad) + `
      <rect x="-12" y="0" width="24" height="25" fill="#ecf0f1" rx="2" opacity="0.8"/>
      <rect x="16" y="-5" width="4" height="30" fill="#7f8c8d" />
    `,
    ambulancia: (cor, grad) => window.AL_ICONS_3D.shapes.van('#ecf0f1', 'url(#grad-body-ecf0f1)') + `
      <rect x="-4" y="5" width="8" height="20" fill="#e74c3c" />
      <rect x="-10" y="11" width="20" height="8" fill="#e74c3c" />
      <rect x="-10" y="-20" width="6" height="3" fill="red" />
      <rect x="4" y="-20" width="6" height="3" fill="blue" />
    `,

    // ==========================================
    // 3. MOTOS E BICICLETAS (Moto Esportiva!)
    // ==========================================
    motocicleta_cruzada: (cor, grad) => `
      <!-- Rodas Slick Larga (MotoGP) -->
      <rect x="-3.5" y="-38" width="7" height="16" rx="3" fill="#111" />
      <rect x="-5.5" y="22" width="11" height="18" rx="4" fill="#111" />
      
      <!-- Para-lama dianteiro aerodinâmico -->
      <path d="M-4.5,-29 Q0,-32 4.5,-29 L4.5,-22 Q0,-24 -4.5,-22 Z" fill="${cor}" />
      
      <!-- Asas Aerodinâmicas Laterais (Winglets MotoGP) -->
      <path d="M-12,-22 L-22,-18 L-14,-12 Z" fill="#1a1a1a" />
      <path d="M12,-22 L22,-18 L14,-12 Z" fill="#1a1a1a" />
      
      <!-- Carenagem Frontal Larga e Agressiva -->
      <path d="M-12,-25 Q0,-38 12,-25 L15,-8 Q0,-10 -15,-8 Z" fill="${cor}" />
      <path d="M-12,-25 Q0,-38 12,-25 L15,-8 Q0,-10 -15,-8 Z" fill="${grad}" opacity="0.8" />
      
      <!-- Para-brisa (Bolha Racing) -->
      <path d="M-7,-24 Q0,-32 7,-24 L8,-16 Q0,-18 -8,-16 Z" fill="url(#grad-glass)" opacity="0.9" />
      
      <!-- Guidão clip-on racing (recolhido) -->
      <path d="M-12,-15 L-6,-12 M12,-15 L6,-12" stroke="#222" stroke-width="3" stroke-linecap="round" />
      
      <!-- Tanque de Combustível Robusto -->
      <path d="M-10,-8 Q0,-16 10,-8 L8,6 Q0,10 -8,6 Z" fill="${cor}" />
      <path d="M-10,-8 Q0,-16 10,-8 L8,6 Q0,10 -8,6 Z" fill="url(#grad-metal)" opacity="0.4" />
      
      <!-- Escapamento esportivo lateral (Carbono/Titânio) -->
      <path d="M5,10 L13,26" stroke="#222" stroke-width="5" stroke-linecap="round" />
      <path d="M6,12 L12,25" stroke="url(#grad-metal)" stroke-width="2" stroke-linecap="round" />
      <circle cx="13" cy="26" r="1.5" fill="#000" />
      
      <!-- Banco do piloto solo (Racing) -->
      <path d="M-6,4 Q0,-2 6,4 L4,16 Q0,20 -4,16 Z" fill="#1a1a1a" />
      
      <!-- Rabeta traseira pontiaguda (Solo/Sem garupa) -->
      <path d="M-4,16 Q0,12 4,16 L1,32 Q0,35 -1,32 Z" fill="${cor}" />
    `,
    bicicleta: (cor) => `
      <rect x="-1.5" y="-30" width="3" height="60" fill="#333" />
      <rect x="-12" y="-20" width="24" height="2" fill="#7f8c8d" />
      <path d="M0,-18 L-3,5 L0,10 L3,5 Z" stroke="${cor}" stroke-width="2" fill="none" />
      <ellipse cx="0" cy="5" rx="4" ry="8" fill="#111" />
    `,
    drone: () => `
      <circle cx="0" cy="0" r="10" fill="#34495e" />
      <circle cx="0" cy="0" r="4" fill="#e74c3c" />
      <path d="M-8,-8 L-25,-25 M8,-8 L25,-25 M-8,8 L-25,25 M8,8 L25,25" stroke="#7f8c8d" stroke-width="4" stroke-linecap="round" />
      <circle cx="-25" cy="-25" r="12" fill="#bdc3c7" opacity="0.4" />
      <circle cx="25" cy="-25" r="12" fill="#bdc3c7" opacity="0.4" />
      <circle cx="-25" cy="25" r="12" fill="#bdc3c7" opacity="0.4" />
      <circle cx="25" cy="25" r="12" fill="#bdc3c7" opacity="0.4" />
    `,

    // ==========================================
    // 4. CAMINHÕES (BASES E RÍGIDOS)
    // ==========================================
    caminhao: (cor, grad) => `
      <!-- Chassi e Rodas -->
      <rect x="-14" y="-10" width="28" height="48" fill="#2c3e50" />
      <rect x="-20" y="8" width="6" height="14" rx="2" fill="#111" />
      <rect x="14" y="8" width="6" height="14" rx="2" fill="#111" />
      <rect x="-20" y="26" width="6" height="14" rx="2" fill="#111" />
      <rect x="14" y="26" width="6" height="14" rx="2" fill="#111" />
      <!-- Cabine -->
      <rect x="-18" y="-40" width="36" height="30" rx="4" fill="${cor}" />
      <rect x="-18" y="-40" width="36" height="30" rx="4" fill="${grad}" opacity="0.6" />
      <!-- Para-brisa panorâmico -->
      <path d="M-15,-36 Q0,-40 15,-36 L16,-22 Q0,-20 -16,-22 Z" fill="url(#grad-glass)" />
      <!-- Retrovisores robustos -->
      <rect x="-23" y="-30" width="5" height="12" rx="1" fill="#1a1a1a" />
      <rect x="18" y="-30" width="5" height="12" rx="1" fill="#1a1a1a" />
      <rect x="-23" y="-28" width="2" height="8" fill="#bdc3c7" />
      <rect x="21" y="-28" width="2" height="8" fill="#bdc3c7" />
    `,
    caminhao_trator: (cor, grad) => window.AL_ICONS_3D.shapes.caminhao(cor, grad) + `
      <ellipse cx="0" cy="18" rx="10" ry="12" fill="url(#grad-metal)" />
      <circle cx="0" cy="18" r="3" fill="#111" />
    `,
    caminhao_bau: (cor, grad) => window.AL_ICONS_3D.shapes.caminhao(cor, grad) + `
      <rect x="-20" y="-12" width="40" height="52" rx="2" fill="#ecf0f1" />
      <rect x="-20" y="-12" width="40" height="52" rx="2" fill="url(#grad-metal)" opacity="0.3" />
    `,
    caminhao_tanque_combustivel: (cor, grad) => window.AL_ICONS_3D.shapes.caminhao(cor, grad) + `
      <rect x="-18" y="-12" width="36" height="52" rx="18" fill="url(#grad-metal)" />
      <circle cx="0" cy="0" r="4" fill="#333" />
      <circle cx="0" cy="15" r="4" fill="#333" />
      <circle cx="0" cy="30" r="4" fill="#333" />
    `,
    caminhao_pipa: (cor, grad) => window.AL_ICONS_3D.shapes.caminhao(cor, grad) + `
      <rect x="-18" y="-12" width="36" height="52" rx="18" fill="#3498db" />
      <rect x="-18" y="-12" width="36" height="52" rx="18" fill="url(#grad-metal)" opacity="0.4" />
      <path d="M-10,40 L-15,48 M10,40 L15,48 M0,40 L0,50" stroke="#a4b0be" stroke-width="2" />
    `,
    caminhao_vacuo: (cor, grad) => window.AL_ICONS_3D.shapes.caminhao_tanque_combustivel(cor, grad) + `
      <rect x="-22" y="0" width="4" height="35" fill="#2c3e50" rx="2" />
      <rect x="18" y="0" width="4" height="35" fill="#2c3e50" rx="2" />
    `,
    caminhao_esgoto: (cor, grad) => window.AL_ICONS_3D.shapes.caminhao_vacuo(cor, grad),
    caminhao_bomba_concreto: (cor, grad) => window.AL_ICONS_3D.shapes.caminhao(cor, grad) + `
      <rect x="-12" y="-12" width="24" height="50" fill="#95a5a6" />
      <path d="M0,0 L15,-15 L10,-35" fill="none" stroke="#e67e22" stroke-width="4" stroke-linejoin="round" />
    `,
    caminhao_betoneira: (cor, grad) => window.AL_ICONS_3D.shapes.caminhao(cor, grad) + `
      <ellipse cx="0" cy="15" rx="14" ry="22" fill="#ecf0f1" />
      <path d="M-10,-2 L10,32 M-14,8 L10,25 M-10,20 L5,35" stroke="#bdc3c7" stroke-width="2" />
    `,
    caminhao_reboque_estrado: (cor, grad) => window.AL_ICONS_3D.shapes.caminhao(cor, grad) + `
      <rect x="-20" y="-12" width="40" height="52" fill="#d35400" />
      <path d="M-18,-10 V38 M-10,-10 V38 M-2,-10 V38 M6,-10 V38 M14,-10 V38" stroke="#111" stroke-width="1" opacity="0.5" />
    `,
    caminhao_reboque: (cor, grad) => window.AL_ICONS_3D.shapes.caminhao(cor, grad) + `
      <rect x="-20" y="-12" width="40" height="52" fill="url(#grad-metal)" />
      <rect x="-18" y="38" width="36" height="4" fill="#e74c3c" />
    `,
    caminhao_recuperacao: (cor, grad) => window.AL_ICONS_3D.shapes.caminhao(cor, grad) + `
      <rect x="-18" y="-12" width="36" height="30" fill="url(#grad-metal)" />
      <path d="M-5,10 L0,35 L5,10 Z" fill="#f39c12" />
      <line x1="0" y1="35" x2="0" y2="45" stroke="#333" stroke-width="2" />
    `,
    caminhao_bombeiros: (cor, grad) => `
      <rect x="-18" y="-45" width="36" height="90" rx="3" fill="#c0392b" />
      <rect x="-18" y="-45" width="36" height="90" rx="3" fill="url(#grad-dark)" opacity="0.3" />
      <path d="M-15,-38 L15,-38 L16,-25 L-16,-25 Z" fill="url(#grad-glass)" />
      <rect x="-8" y="-20" width="16" height="60" fill="url(#grad-metal)" />
      <path d="M-8,-15 H8 M-8,-5 H8 M-8,5 H8 M-8,15 H8 M-8,25 H8 M-8,35 H8" stroke="#fff" stroke-width="1.5" />
      <rect x="-12" y="-42" width="6" height="4" fill="red" />
      <rect x="6" y="-42" width="6" height="4" fill="red" />
    `,
    caminhao_transporte: (cor, grad) => window.AL_ICONS_3D.shapes.caminhao_bau(cor, grad),

    // ==========================================
    // 5. REBOQUES E CONTAINERS (Stand-alone)
    // ==========================================
    plataforma_reboque: () => `
      <rect x="-20" y="-35" width="40" height="70" fill="url(#grad-metal)" />
      <rect x="-22" y="-5" width="4" height="20" fill="#111" />
      <rect x="18" y="-5" width="4" height="20" fill="#111" />
      <path d="M-5,-35 L0,-45 L5,-35 Z" fill="#7f8c8d" />
    `,
    reboque_carro: () => window.AL_ICONS_3D.shapes.plataforma_reboque() + `
      <rect x="-16" y="-25" width="8" height="50" fill="#e67e22" />
      <rect x="8" y="-25" width="8" height="50" fill="#e67e22" />
    `,
    reboque_caixa: () => `
      <rect x="-20" y="-35" width="40" height="70" rx="2" fill="#ecf0f1" />
      <rect x="-20" y="-35" width="40" height="70" rx="2" fill="url(#grad-metal)" opacity="0.3" />
      <rect x="-22" y="0" width="4" height="20" fill="#111" />
      <rect x="18" y="0" width="4" height="20" fill="#111" />
      <path d="M-5,-35 L0,-45 L5,-35 Z" fill="#7f8c8d" />
    `,
    reboque_reefer: () => window.AL_ICONS_3D.shapes.reboque_caixa() + `
      <rect x="-10" y="-35" width="20" height="8" fill="#bdc3c7" />
      <circle cx="0" cy="-31" r="3" fill="#333" />
    `,
    reboque_tanque: () => `
      <rect x="-18" y="-35" width="36" height="70" rx="18" fill="url(#grad-metal)" />
      <rect x="-22" y="0" width="4" height="20" fill="#111" />
      <rect x="18" y="0" width="4" height="20" fill="#111" />
      <path d="M-5,-35 L0,-45 L5,-35 Z" fill="#7f8c8d" />
    `,
    reboque_residuos: () => window.AL_ICONS_3D.shapes.reboque_caixa() + `
      <rect x="-18" y="-30" width="36" height="60" fill="#27ae60" />
    `,
    reboque_gerador: () => window.AL_ICONS_3D.shapes.reboque_caixa() + `
      <rect x="-15" y="-20" width="30" height="40" fill="#f1c40f" />
      <circle cx="-6" cy="0" r="5" fill="#333" />
      <circle cx="6" cy="0" r="5" fill="#333" />
    `,
    aclo_compressor: () => `
      <rect x="-12" y="-15" width="24" height="30" rx="3" fill="#e67e22" />
      <rect x="-14" y="-5" width="2" height="10" fill="#111" />
      <rect x="12" y="-5" width="2" height="10" fill="#111" />
      <path d="M-2,-15 L0,-25 L2,-15 Z" fill="#7f8c8d" />
      <circle cx="0" cy="0" r="6" fill="#333" />
    `,
    container_20: () => `
      <rect x="-20" y="-20" width="40" height="40" fill="#2980b9" />
      <rect x="-20" y="-20" width="40" height="40" fill="url(#grad-metal)" opacity="0.3" />
      <path d="M-20,-10 H20 M-20,0 H20 M-20,10 H20" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
    `,
    container_40: () => `
      <rect x="-20" y="-40" width="40" height="80" fill="#8e44ad" />
      <rect x="-20" y="-40" width="40" height="80" fill="url(#grad-metal)" opacity="0.3" />
      <path d="M-20,-30 H20 M-20,-10 H20 M-20,10 H20 M-20,30 H20" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
    `,
    container_tanque: () => window.AL_ICONS_3D.shapes.container_20() + `
      <rect x="-20" y="-20" width="40" height="40" fill="none" stroke="#e67e22" stroke-width="3" />
      <rect x="-16" y="-18" width="32" height="36" rx="16" fill="url(#grad-metal)" />
    `,
    reboque_container_gerador: () => window.AL_ICONS_3D.shapes.plataforma_reboque() + window.AL_ICONS_3D.shapes.container_20() + `
      <circle cx="0" cy="0" r="8" fill="#111" />
    `,
    caixa_estacionaria: () => `
      <path d="M-22,-22 L22,-22 L18,22 L-18,22 Z" fill="#e74c3c" />
      <path d="M-22,-22 L22,-22 L18,22 L-18,22 Z" fill="url(#grad-metal)" opacity="0.4" />
      <rect x="-18" y="-18" width="36" height="36" fill="#c0392b" />
    `,

    // ==========================================
    // 6. MÁQUINAS E TRATORES
    // ==========================================
    trator: (cor, grad) => `
      <rect x="-12" y="-15" width="24" height="35" rx="2" fill="${cor}" />
      <rect x="-12" y="-15" width="24" height="35" rx="2" fill="${grad}" opacity="0.4" />
      <rect x="-10" y="-5" width="20" height="15" fill="url(#grad-glass)" />
      <rect x="-22" y="5" width="10" height="22" rx="2" fill="#1a1a1a" />
      <rect x="12" y="5" width="10" height="22" rx="2" fill="#1a1a1a" />
      <rect x="-18" y="-25" width="6" height="14" rx="1" fill="#1a1a1a" />
      <rect x="12" y="-25" width="6" height="14" rx="1" fill="#1a1a1a" />
    `,
    escavadeira: (cor, grad) => `
      <rect x="-22" y="-30" width="8" height="60" fill="#222" />
      <rect x="14" y="-30" width="8" height="60" fill="#222" />
      <rect x="-16" y="-20" width="32" height="40" rx="4" fill="${cor}" />
      <rect x="-14" y="-15" width="14" height="20" fill="url(#grad-glass)" />
      <path d="M4,-15 L10,-15 L10,-45 L4,-45 Z" fill="#f39c12" />
      <path d="M2,-45 L12,-45 L14,-55 L0,-55 Z" fill="#7f8c8d" />
    `,
    escavadora: (cor, grad) => window.AL_ICONS_3D.shapes.escavadeira(cor, grad),
    retroescavadeira: (cor, grad) => window.AL_ICONS_3D.shapes.trator(cor, grad) + `
      <path d="M-12,-25 L12,-25 L14,-35 L-14,-35 Z" fill="#f39c12" />
      <path d="M-4,20 L4,20 L4,45 L-4,45 Z" fill="#f39c12" />
      <path d="M-6,45 L6,45 L4,55 L-4,55 Z" fill="#7f8c8d" />
    `,
    empilhadeira: (cor, grad) => `
      <rect x="-12" y="-10" width="24" height="25" rx="2" fill="${cor}" />
      <rect x="-8" y="-5" width="16" height="12" fill="#222" />
      <rect x="-15" y="5" width="4" height="10" fill="#111" />
      <rect x="11" y="5" width="4" height="10" fill="#111" />
      <rect x="-15" y="-15" width="4" height="10" fill="#111" />
      <rect x="11" y="-15" width="4" height="10" fill="#111" />
      <rect x="-14" y="-20" width="28" height="4" fill="#7f8c8d" />
      <rect x="-10" y="-35" width="3" height="15" fill="#bdc3c7" />
      <rect x="7" y="-35" width="3" height="15" fill="#bdc3c7" />
    `,

    // ==========================================
    // 7. ÔNIBUS E AÉREO
    // ==========================================
    onibus: (cor, grad) => `
      <rect x="-18" y="-45" width="36" height="90" rx="4" fill="${cor}" />
      <rect x="-18" y="-45" width="36" height="90" rx="4" fill="${grad}" opacity="0.5" />
      <path d="M-16,-42 L16,-42 L16,-32 L-16,-32 Z" fill="url(#grad-glass)" />
      <rect x="-16" y="-25" width="4" height="60" fill="url(#grad-glass)" />
      <rect x="12" y="-25" width="4" height="60" fill="url(#grad-glass)" />
    `,
    caravana: (cor, grad) => window.AL_ICONS_3D.shapes.onibus('#ecf0f1', 'url(#grad-body-ecf0f1)') + `
      <rect x="-10" y="-10" width="20" height="20" fill="#bdc3c7" />
      <rect x="-16" y="-5" width="4" height="15" fill="#ecf0f1" />
    `,
    aviao_passageiros: () => `
      <path d="M-6,-45 Q0,-55 6,-45 L8,35 L0,45 L-8,35 Z" fill="#ecf0f1" />
      <path d="M-6,0 L-45,15 L-45,20 L-6,10 Z" fill="#ecf0f1" />
      <path d="M6,0 L45,15 L45,20 L6,10 Z" fill="#ecf0f1" />
      <path d="M-4,35 L-18,42 L-18,45 L-4,40 Z" fill="#bdc3c7" />
      <path d="M4,35 L18,42 L18,45 L4,40 Z" fill="#bdc3c7" />
      <rect x="-20" y="12" width="6" height="10" rx="3" fill="#7f8c8d" />
      <rect x="14" y="12" width="6" height="10" rx="3" fill="#7f8c8d" />
      <path d="M-4,-40 Q0,-45 4,-40 L5,-35 L-5,-35 Z" fill="url(#grad-glass)" />
    `
  }
};
