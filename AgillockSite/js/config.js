/**                                                                                                                │
│   2 -  * Configuração da URL da API — ajuste conforme o ambiente.                                                │
│   3 -  * Em desenvolvimento: 'http://localhost:3000'                                                             │
│   4 -  * Em produção:        'https://api.agillock.com.br'                                                       │
*/         

window.API_URL = 'https://api.agillock.com.br';

/**
 * Biblioteca de Ícones SVG 3D para Veículos - AgilLock
 * Vista superior com efeitos de profundidade, gradientes e sombras.
 * Versão expandida com ícones únicos para cada categoria.
 */
window.AL_ICONS_3D = {
  SIZE: 48,

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
        <linearGradient id="grad-tire" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#2c3e50;stop-opacity:1" />
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
    c = c.toLowerCase();
    const CATEGORY_MAP = {
      'ambulancia': 'ambulancia',
      'aviao_passageiros': 'aviao_passageiros',
      'bicicleta': 'bicicleta',
      'caixa_estacionaria': 'caixa_estacionaria',
      'caminhao': 'caminhao',
      'caminhao_trator': 'caminhao_trator',
      'caminhao_bau': 'caminhao_bau',
      'caminhao_bomba_concreto': 'caminhao_bomba_concreto',
      'caminhao_betoneira': 'caminhao_betoneira',
      'caminhao_reboque': 'caminhao_reboque',
      'caminhao_reboque_estrado': 'caminhao_reboque_estrado',
      'caminhao_tanque_combustivel': 'caminhao_tanque_combustivel',
      'caminhao_pipa': 'caminhao_pipa',
      'caminhao_vacuo': 'caminhao_vacuo',
      'caminhao_bombeiros': 'caminhao_bombeiros',
      'caminhao_esgoto': 'caminhao_esgoto',
      'caminhao_recuperacao': 'caminhao_recuperacao',
      'caminhao_transporte': 'caminhao_transporte',
      'caravana': 'caravana',
      'carro': 'carro',
      'carro_executivo': 'carro_executivo',
      'carro_hatchback': 'carro_hatchback',
      'carro_assistencia': 'carro_assistencia',
      'carro_luxo': 'carro_luxo',
      'container_20': 'container_20',
      'container_40': 'container_40',
      'container_tanque': 'container_tanque',
      'drone': 'drone',
      'empilhadeira': 'empilhadeira',
      'escavadeira': 'escavadeira',
      'escavadora': 'escavadora',
      'motocicleta_cruzada': 'motocicleta_cruzada',
      'plataforma_reboque': 'plataforma_reboque',
      'reboque_gerador': 'reboque_gerador',
      'reboque_reefer': 'reboque_reefer',
      'reboque_tanque': 'reboque_tanque',
      'reboque_residuos': 'reboque_residuos',
      'reboque_caixa': 'reboque_caixa',
      'reboque_carro': 'reboque_carro',
      'reboque_container_gerador': 'reboque_container_gerador',
      'retroescavadeira': 'retroescavadeira',
      'aclo_compressor': 'aclo_compressor',
      'trator': 'trator',
      'taxi': 'taxi',
      'van': 'van',
      'van_campista': 'van_campista',
      'viatura': 'viatura',
      'onibus': 'onibus'
    };
    return CATEGORY_MAP[c] || 'carro';
  },

  shapes: {
    /* ========== Ambulância ========== */
    ambulancia: (cor, grad) => `
      <path d="M-16,-38 Q-18,-44 0,-44 Q18,-44 16,-38 L18,32 L-18,32 Z" fill="${cor}" />
      <path d="M-16,-38 Q-18,-44 0,-44 Q18,-44 16,-38 L18,32 L-18,32 Z" fill="${grad}" opacity="0.5" />
      <path d="M-13,-26 L13,-26 L14,10 L-14,10 Z" fill="url(#grad-glass)" />
      <!-- Giroflex + cruz -->
      <rect x="-10" y="-22" width="20" height="6" rx="2" fill="#e74c3c" opacity="0.9"/>
      <line x1="0" y1="-24" x2="0" y2="-19" stroke="#fff" stroke-width="2"/>
      <line x1="-4" y1="-21.5" x2="4" y2="-21.5" stroke="#fff" stroke-width="2"/>
      <!-- Rodas -->
      <ellipse cx="14" cy="-8" rx="3" ry="5" fill="url(#grad-tire)"/>
      <ellipse cx="-14" cy="-8" rx="3" ry="5" fill="url(#grad-tire)"/>
      <ellipse cx="14" cy="20" rx="3" ry="5" fill="url(#grad-tire)"/>
      <ellipse cx="-14" cy="20" rx="3" ry="5" fill="url(#grad-tire)"/>
    `,

    /* ========== Avião de Passageiros ========== */
    aviao_passageiros: (cor, grad) => `
      <!-- Fuselagem -->
      <path d="M-4,-43 Q-6,-48 0,-50 Q6,-48 4,-43 L8,45 Q8,50 0,50 Q-8,50 -8,45 Z" fill="#ecf0f1" />
      <path d="M-4,-43 Q-6,-48 0,-50 Q6,-48 4,-43 L8,45 Q8,50 0,50 Q-8,50 -8,45 Z" fill="${grad}" opacity="0.3" />
      <!-- Asas -->
      <path d="M-44,-10 L44,-10 L48,-2 L-48,-2 Z" fill="#bdc3c7" />
      <path d="M-44,-10 L44,-10 L48,-2 L-48,-2 Z" fill="${grad}" opacity="0.2" />
      <!-- Motores -->
      <ellipse cx="-18" cy="-6" rx="4" ry="6" fill="#95a5a6" />
      <ellipse cx="18" cy="-6" rx="4" ry="6" fill="#95a5a6" />
      <!-- Janelas -->
      <rect x="-3" y="-30" width="6" height="3" fill="url(#grad-glass)" />
      <rect x="-3" y="-20" width="6" height="3" fill="url(#grad-glass)" />
      <rect x="-3" y="-10" width="6" height="3" fill="url(#grad-glass)" />
      <!-- Estabilizador vertical -->
      <rect x="-1" y="35" width="2" height="10" fill="#7f8c8d" />
    `,

    /* ========== Bicicleta ========== */
    bicicleta: (cor) => `
      <ellipse cx="0" cy="-30" rx="4" ry="8" fill="url(#grad-tire)"/>
      <ellipse cx="0" cy="30" rx="4" ry="8" fill="url(#grad-tire)"/>
      <!-- Quadro -->
      <path d="M-3,-30 L-6,-5 L6,-5 L3,-30 Z" fill="none" stroke="#7f8c8d" stroke-width="2.5"/>
      <line x1="-6" y1="-5" x2="0" y2="30" stroke="#7f8c8d" stroke-width="2.5"/>
      <line x1="6" y1="-5" x2="0" y2="30" stroke="#7f8c8d" stroke-width="2.5"/>
      <!-- Guidão -->
      <rect x="-12" y="-15" width="24" height="3" rx="1.5" fill="#555"/>
      <!-- Selim -->
      <rect x="-4" y="-12" width="8" height="10" rx="2" fill="#111"/>
    `,

    /* ========== Caixa Estacionária ========== */
    caixa_estacionaria: (cor, grad) => `
      <rect x="-20" y="-35" width="40" height="70" rx="3" fill="${cor}" />
      <rect x="-20" y="-35" width="40" height="70" rx="3" fill="${grad}" opacity="0.4" />
      <!-- Reforços -->
      <line x1="-20" y1="-15" x2="20" y2="-15" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <line x1="-20" y1="5" x2="20" y2="5" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <line x1="-20" y1="25" x2="20" y2="25" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <rect x="-8" y="-35" width="16" height="4" fill="url(#grad-metal)"/>
    `,

    /* ========== Caminhão (genérico - cabine + carroceria plana) ========== */
    caminhao: (cor, grad) => `
      <!-- Cabine -->
      <path d="M-14,-40 Q-16,-44 0,-44 Q16,-44 14,-40 L15,0 L-15,0 Z" fill="${cor}" />
      <path d="M-14,-40 Q-16,-44 0,-44 Q16,-44 14,-40 L15,0 L-15,0 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-26 L12,-26 L13,-4 L-13,-4 Z" fill="url(#grad-glass)" />
      <!-- Carroceria plana -->
      <rect x="-17" y="0" width="34" height="40" fill="#555" />
      <rect x="-17" y="0" width="34" height="40" fill="url(#grad-metal)" opacity="0.3" />
      <line x1="-17" y1="0" x2="17" y2="0" stroke="#888" stroke-width="1"/>
      <!-- Rodas -->
      <rect x="-20" y="-8" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="14" y="-8" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="-20" y="25" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="14" y="25" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão (unidade trator) ========== */
    caminhao_trator: (cor, grad) => `
      <path d="M-14,-40 Q-16,-44 0,-44 Q16,-44 14,-40 L15,5 L-15,5 Z" fill="${cor}" />
      <path d="M-14,-40 Q-16,-44 0,-44 Q16,-44 14,-40 L15,5 L-15,5 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-28 L12,-28 L13,-8 L-13,-8 Z" fill="url(#grad-glass)" />
      <!-- Quinta roda -->
      <circle cx="0" cy="12" r="8" fill="url(#grad-metal)" stroke="#555" stroke-width="1.5"/>
      <circle cx="0" cy="12" r="5" fill="none" stroke="#aaa" stroke-width="1"/>
      <!-- Chassi -->
      <rect x="-15" y="5" width="5" height="25" fill="#444" />
      <rect x="10" y="5" width="5" height="25" fill="#444" />
      <!-- Rodas -->
      <rect x="-19" y="-6" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="13" y="-6" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="-19" y="15" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="13" y="15" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão Baú ========== */
    caminhao_bau: (cor, grad) => `
      <path d="M-14,-40 Q-16,-44 0,-44 Q16,-44 14,-40 L15,-15 L-15,-15 Z" fill="${cor}" />
      <path d="M-14,-40 Q-16,-44 0,-44 Q16,-44 14,-40 L15,-15 L-15,-15 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-32 L12,-32 L13,-18 L-13,-18 Z" fill="url(#grad-glass)" />
      <!-- Baú -->
      <rect x="-18" y="-15" width="36" height="55" rx="3" fill="#ecf0f1" />
      <rect x="-18" y="-15" width="36" height="55" rx="3" fill="url(#grad-metal)" opacity="0.3" />
      <line x1="-18" y1="-5" x2="18" y2="-5" stroke="#ddd" stroke-width="1.5"/>
      <!-- Rodas -->
      <rect x="-20" y="-8" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="14" y="-8" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="-20" y="25" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="14" y="25" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão Bomba de Concreto ========== */
    caminhao_bomba_concreto: (cor, grad) => `
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-15 L-15,-15 Z" fill="${cor}" />
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-15 L-15,-15 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-34 L12,-34 L13,-18 L-13,-18 Z" fill="url(#grad-glass)" />
      <!-- Chassi e bomba -->
      <rect x="-18" y="-15" width="36" height="55" fill="#555" />
      <!-- Braço dobrado -->
      <rect x="-5" y="-15" width="10" height="8" fill="#e67e22" />
      <rect x="-10" y="-7" width="8" height="22" fill="#e67e22" />
      <rect x="-10" y="15" width="14" height="6" fill="#e67e22" />
      <!-- Mangueira -->
      <line x1="4" y1="21" x2="10" y2="30" stroke="#f1c40f" stroke-width="2"/>
      <!-- Rodas -->
      <rect x="-20" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="14" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="-20" y="20" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="14" y="20" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão Betoneira ========== */
    caminhao_betoneira: (cor, grad) => `
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-18 L-15,-18 Z" fill="${cor}" />
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-18 L-15,-18 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-34 L12,-34 L13,-20 L-13,-20 Z" fill="url(#grad-glass)" />
      <!-- Tambor -->
      <ellipse cx="2" cy="10" rx="16" ry="18" fill="#f39c12" />
      <ellipse cx="2" cy="10" rx="16" ry="18" fill="url(#grad-metal)" opacity="0.4" />
      <!-- Espirais -->
      <path d="M-14,10 Q-10,-10 14,10" stroke="#fff" stroke-width="1.5" fill="none" opacity="0.4"/>
      <path d="M-12,18 Q-8,0 12,18" stroke="#fff" stroke-width="1.5" fill="none" opacity="0.4"/>
      <!-- Calha -->
      <path d="M15,5 L22,12 L20,16 L14,10 Z" fill="#95a5a6" />
      <!-- Rodas -->
      <rect x="-20" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="14" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão Reboque ========== */
    caminhao_reboque: (cor, grad) => `
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-10 L-15,-10 Z" fill="${cor}" />
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-10 L-15,-10 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-34 L12,-34 L13,-14 L-13,-14 Z" fill="url(#grad-glass)" />
      <rect x="-17" y="-10" width="34" height="25" fill="#555" />
      <!-- Implemento de reboque -->
      <rect x="-3" y="15" width="6" height="18" fill="url(#grad-metal)" rx="1"/>
      <line x1="-12" y1="33" x2="12" y2="33" stroke="#7f8c8d" stroke-width="3"/>
      <!-- Rodas -->
      <rect x="-20" y="-8" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="14" y="-8" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão Reboque Estrado ========== */
    caminhao_reboque_estrado: (cor, grad) => `
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-10 L-15,-10 Z" fill="${cor}" />
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-10 L-15,-10 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-34 L12,-34 L13,-14 L-13,-14 Z" fill="url(#grad-glass)" />
      <rect x="-18" y="-10" width="36" height="45" rx="2" fill="#7f8c8d" />
      <!-- Grades laterais -->
      <line x1="-18" y1="-5" x2="18" y2="-5" stroke="#ccc" stroke-width="1"/>
      <line x1="-18" y1="5" x2="18" y2="5" stroke="#ccc" stroke-width="1"/>
      <line x1="-18" y1="15" x2="18" y2="15" stroke="#ccc" stroke-width="1"/>
      <line x1="-18" y1="25" x2="18" y2="25" stroke="#ccc" stroke-width="1"/>
      <!-- Guincho frontal -->
      <circle cx="0" cy="-10" r="4" fill="#e67e22" />
      <!-- Rodas -->
      <rect x="-21" y="-8" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="15" y="-8" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="-21" y="30" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="15" y="30" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão Tanque de Combustível ========== */
    caminhao_tanque_combustivel: (cor, grad) => `
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-18 L-15,-18 Z" fill="${cor}" />
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-18 L-15,-18 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-34 L12,-34 L13,-20 L-13,-20 Z" fill="url(#grad-glass)" />
      <!-- Tanque -->
      <rect x="-19" y="-18" width="38" height="60" rx="13" fill="url(#grad-metal)" />
      <ellipse cx="0" cy="-14" rx="10" ry="3" fill="#ecf0f1" opacity="0.5" />
      <rect x="-4" y="10" width="8" height="8" rx="1" fill="#e67e22" />
      <!-- Rodas -->
      <rect x="-22" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="16" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="-22" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="16" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão Pipa ========== */
    caminhao_pipa: (cor, grad) => `
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-18 L-15,-18 Z" fill="${cor}" />
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-18 L-15,-18 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-34 L12,-34 L13,-20 L-13,-20 Z" fill="url(#grad-glass)" />
      <!-- Tanque -->
      <rect x="-18" y="-18" width="36" height="58" rx="12" fill="#2980b9" />
      <rect x="-18" y="-18" width="36" height="58" rx="12" fill="url(#grad-metal)" opacity="0.4" />
      <!-- Gota d’água -->
      <path d="M0,-8 Q6,0 0,6 Q-6,0 0,-8 Z" fill="#fff" opacity="0.5"/>
      <!-- Rodas -->
      <rect x="-21" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="15" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="-21" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="15" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão Vácuo ========== */
    caminhao_vacuo: (cor, grad) => `
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-18 L-15,-18 Z" fill="${cor}" />
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-18 L-15,-18 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-34 L12,-34 L13,-20 L-13,-20 Z" fill="url(#grad-glass)" />
      <!-- Tanque -->
      <rect x="-18" y="-18" width="36" height="55" rx="14" fill="#95a5a6" />
      <rect x="-18" y="-18" width="36" height="55" rx="14" fill="url(#grad-metal)" opacity="0.4" />
      <!-- Carretel de mangueira -->
      <ellipse cx="12" cy="10" rx="6" ry="10" fill="#34495e" />
      <rect x="10" y="0" width="4" height="20" fill="#f1c40f" opacity="0.7" />
      <!-- Rodas -->
      <rect x="-21" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="15" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="-21" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="15" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão de Bombeiros ========== */
    caminhao_bombeiros: (cor, grad) => `
      <path d="M-16,-42 Q-18,-46 0,-46 Q18,-46 16,-42 L17,-15 L-17,-15 Z" fill="#c0392b" />
      <path d="M-16,-42 Q-18,-46 0,-46 Q18,-46 16,-42 L17,-15 L-17,-15 Z" fill="${grad}" opacity="0.3" />
      <path d="M-14,-34 L14,-34 L15,-18 L-15,-18 Z" fill="url(#grad-glass)" />
      <!-- Carroceria -->
      <rect x="-18" y="-15" width="36" height="60" fill="#c0392b" />
      <!-- Compartimentos -->
      <line x1="-18" y1="-5" x2="18" y2="-5" stroke="#fff" stroke-width="1.5" opacity="0.3"/>
      <line x1="-18" y1="15" x2="18" y2="15" stroke="#fff" stroke-width="1.5" opacity="0.3"/>
      <line x1="-18" y1="35" x2="18" y2="35" stroke="#fff" stroke-width="1.5" opacity="0.3"/>
      <!-- Escada -->
      <rect x="-4" y="-20" width="8" height="80" fill="#f1c40f" opacity="0.8"/>
      <!-- Canhão d'água -->
      <rect x="-2" y="-25" width="4" height="6" fill="#95a5a6" />
      <!-- Rodas -->
      <rect x="-21" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="15" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="-21" y="30" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="15" y="30" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão de Esgoto ========== */
    caminhao_esgoto: (cor, grad) => `
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-18 L-15,-18 Z" fill="${cor}" />
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-18 L-15,-18 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-34 L12,-34 L13,-20 L-13,-20 Z" fill="url(#grad-glass)" />
      <!-- Tanque com agitador -->
      <rect x="-18" y="-18" width="36" height="60" rx="10" fill="#7f8c8d" />
      <rect x="-18" y="-18" width="36" height="60" rx="10" fill="url(#grad-metal)" opacity="0.4" />
      <!-- Bico de sucção -->
      <circle cx="10" cy="20" r="5" fill="#f39c12" />
      <rect x="8" y="25" width="4" height="12" fill="#f39c12" />
      <!-- Rodas -->
      <rect x="-21" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="15" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="-21" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="15" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão de Recuperação ========== */
    caminhao_recuperacao: (cor, grad) => `
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-15 L-15,-15 Z" fill="${cor}" />
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-15 L-15,-15 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-34 L12,-34 L13,-18 L-13,-18 Z" fill="url(#grad-glass)" />
      <rect x="-16" y="-15" width="32" height="45" fill="#95a5a6" />
      <!-- Braço de recuperação -->
      <rect x="-6" y="-15" width="12" height="8" fill="#e67e22" />
      <rect x="-4" y="-7" width="8" height="40" fill="#e67e22" />
      <!-- Rodas -->
      <rect x="-19" y="-8" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="13" y="-8" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="-19" y="28" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="13" y="28" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caminhão de Transporte ========== */
    caminhao_transporte: (cor, grad) => `
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-15 L-15,-15 Z" fill="${cor}" />
      <path d="M-14,-42 Q-16,-46 0,-46 Q16,-46 14,-42 L15,-15 L-15,-15 Z" fill="${grad}" opacity="0.5" />
      <path d="M-12,-34 L12,-34 L13,-18 L-13,-18 Z" fill="url(#grad-glass)" />
      <!-- Carroceria com carga -->
      <rect x="-18" y="-15" width="36" height="55" fill="#888" />
      <rect x="-12" y="-10" width="24" height="15" fill="#ecf0f1" />
      <rect x="-18" y="20" width="36" height="20" fill="#555" />
      <!-- Amarrações -->
      <line x1="-14" y1="-15" x2="-14" y2="-5" stroke="#f1c40f" stroke-width="1.5"/>
      <line x1="14" y1="-15" x2="14" y2="-5" stroke="#f1c40f" stroke-width="1.5"/>
      <!-- Rodas -->
      <rect x="-21" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="15" y="-10" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="-21" y="30" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="15" y="30" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Caravana ========== */
    caravana: (cor, grad) => `
      <rect x="-16" y="-40" width="32" height="80" rx="6" fill="${cor}" />
      <rect x="-16" y="-40" width="32" height="80" rx="6" fill="${grad}" opacity="0.4" />
      <!-- Janelas -->
      <rect x="-12" y="-30" width="10" height="12" rx="2" fill="url(#grad-glass)" />
      <rect x="2" y="-30" width="10" height="12" rx="2" fill="url(#grad-glass)" />
      <rect x="-12" y="10" width="10" height="12" rx="2" fill="url(#grad-glass)" />
      <rect x="2" y="10" width="10" height="12" rx="2" fill="url(#grad-glass)" />
      <!-- Porta -->
      <rect x="-14" y="28" width="6" height="10" rx="1" fill="#fff" opacity="0.4" />
      <!-- Engate -->
      <rect x="-3" y="-48" width="6" height="10" fill="url(#grad-metal)" />
      <!-- Rodas -->
      <rect x="-20" y="32" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
      <rect x="14" y="32" width="6" height="12" rx="2" fill="url(#grad-tire)"/>
    `,

    /* ========== Carro (com detalhes) ========== */
    carro: (cor, grad) => `
      <path d="M-15,-36 Q-17,-42 0,-42 Q17,-42 15,-36 L18,32 Q18,38 0,38 Q-18,38 -18,32 Z" fill="${cor}" />
      <path d="M-15,-36 Q-17,-42 0,-42 Q17,-42 15,-36 L18,32 Q18,38 0,38 Q-18,38 -18,32 Z" fill="${grad}" opacity="0.4" />
      <!-- Para-brisa -->
      <path d="M-13,-22 L13,-22 L15,2 L-15,2 Z" fill="url(#grad-glass)" />
      <!-- Vigia traseiro -->
      <path d="M-13,8 L13,8 L15,28 L-15,28 Z" fill="url(#grad-glass)" opacity="0.7" />
      <!-- Teto solar -->
      <rect x="-8" y="-28" width="16" height="7" rx="2" fill="url(#grad-glass)" opacity="0.8" />
      <!-- Espelhos retrovisores -->
      <rect x="17" y="-20" width="4" height="5" rx="1.5" fill="#555" />
      <rect x="-21" y="-20" width="4" height="5" rx="1.5" fill="#555" />
      <!-- Faróis -->
      <circle cx="12" cy="-38" r="2.5" fill="#f1c40f" />
      <circle cx="-12" cy="-38" r="2.5" fill="#f1c40f" />
      <!-- Rodas -->
      <ellipse cx="16" cy="-6" rx="3" ry="5.5" fill="url(#grad-tire)" />
      <ellipse cx="-16" cy="-6" rx="3" ry="5.5" fill="url(#grad-tire)" />
      <ellipse cx="16" cy="22" rx="3" ry="5.5" fill="url(#grad-tire)" />
      <ellipse cx="-16" cy="22" rx="3" ry="5.5" fill="url(#grad-tire)" />
      <!-- Rodas internas (calotas) -->
      <ellipse cx="16" cy="-6" rx="1.5" ry="2.5" fill="#95a5a6" />
      <ellipse cx="-16" cy="-6" rx="1.5" ry="2.5" fill="#95a5a6" />
      <ellipse cx="16" cy="22" rx="1.5" ry="2.5" fill="#95a5a6" />
      <ellipse cx="-16" cy="22" rx="1.5" ry="2.5" fill="#95a5a6" />
    `,

    /* ========== Carro Executivo ========== */
    carro_executivo: (cor, grad) => `
      <path d="M-16,-38 Q-18,-44 0,-44 Q18,-44 16,-38 L19,34 Q19,40 0,40 Q-19,40 -19,34 Z" fill="${cor}" />
      <path d="M-16,-38 Q-18,-44 0,-44 Q18,-44 16,-38 L19,34 Q19,40 0,40 Q-19,40 -19,34 Z" fill="${grad}" opacity="0.5" />
      <!-- Vidro lateral único -->
      <path d="M-14,-24 L14,-24 L16,20 L-16,20 Z" fill="url(#grad-glass)" />
      <!-- Teto solar -->
      <rect x="-9" y="-30" width="18" height="7" rx="3" fill="url(#grad-glass)" opacity="0.8" />
      <!-- Rodas -->
      <ellipse cx="17" cy="-8" rx="3.5" ry="6" fill="url(#grad-tire)" />
      <ellipse cx="-17" cy="-8" rx="3.5" ry="6" fill="url(#grad-tire)" />
      <ellipse cx="17" cy="24" rx="3.5" ry="6" fill="url(#grad-tire)" />
      <ellipse cx="-17" cy="24" rx="3.5" ry="6" fill="url(#grad-tire)" />
    `,

    /* ========== Carro Hatchback ========== */
    carro_hatchback: (cor, grad) => `
      <path d="M-14,-36 Q-16,-42 0,-42 Q16,-42 14,-36 L16,14 Q16,20 0,20 Q-16,20 -16,14 Z" fill="${cor}" />
      <path d="M-14,-36 Q-16,-42 0,-42 Q16,-42 14,-36 L16,14 Q16,20 0,20 Q-16,20 -16,14 Z" fill="${grad}" opacity="0.5" />
      <!-- Vidro dianteiro -->
      <path d="M-12,-22 L12,-22 L14,2 L-14,2 Z" fill="url(#grad-glass)" />
      <!-- Pequeno vidro traseiro -->
      <path d="M-10,4 L10,4 L11,12 L-11,12 Z" fill="url(#grad-glass)" opacity="0.6" />
      <!-- Spoiler traseiro -->
      <rect x="-6" y="18" width="12" height="3" rx="1" fill="#333" />
      <!-- Rodas -->
      <ellipse cx="15" cy="-5" rx="3" ry="5" fill="url(#grad-tire)" />
      <ellipse cx="-15" cy="-5" rx="3" ry="5" fill="url(#grad-tire)" />
      <ellipse cx="15" cy="15" rx="3" ry="5" fill="url(#grad-tire)" />
      <ellipse cx="-15" cy="15" rx="3" ry="5" fill="url(#grad-tire)" />
    `,

    /* ========== Carro de Assistência ========== */
    carro_assistencia: (cor, grad) => `
      <path d="M-15,-38 Q-17,-44 0,-44 Q17,-44 15,-38 L17,30 L-17,30 Z" fill="${cor}" />
      <path d="M-15,-38 Q-17,-44 0,-44 Q17,-44 15,-38 L17,30 L-17,30 Z" fill="${grad}" opacity="0.5" />
      <path d="M-13,-26 L13,-26 L14,4 L-14,4 Z" fill="url(#grad-glass)" />
      <!-- Barra de luzes -->
      <rect x="-10" y="-22" width="20" height="5" rx="2" fill="#f1c40f" opacity="0.9"/>
      <!-- Rodas -->
      <ellipse cx="16" cy="-5" rx="3" ry="5" fill="url(#grad-tire)" />
      <ellipse cx="-16" cy="-5" rx="3" ry="5" fill="url(#grad-tire)" />
      <ellipse cx="16" cy="20" rx="3" ry="5" fill="url(#grad-tire)" />
      <ellipse cx="-16" cy="20" rx="3" ry="5" fill="url(#grad-tire)" />
    `,

    /* ========== Carro de Luxo ========== */
    carro_luxo: (cor, grad) => `
      <path d="M-17,-40 Q-19,-46 0,-46 Q19,-46 17,-40 L20,36 Q20,42 0,42 Q-20,42 -20,36 Z" fill="${cor}" />
      <path d="M-17,-40 Q-19,-46 0,-46 Q19,-46 17,-40 L20,36 Q20,42 0,42 Q-20,42 -20,36 Z" fill="${grad}" opacity="0.5" />
      <!-- Vidro panorâmico -->
      <path d="M-15,-26 L15,-26 L17,18 L-17,18 Z" fill="url(#grad-glass)" />
      <!-- Friso lateral -->
      <line x1="-18" y1="-2" x2="18" y2="-2" stroke="#fff" stroke-width="1.5" opacity="0.4"/>
      <!-- Rodas com detalhes -->
      <ellipse cx="18" cy="-8" rx="4" ry="6.5" fill="url(#grad-tire)" />
      <ellipse cx="-18" cy="-8" rx="4" ry="6.5" fill="url(#grad-tire)" />
      <ellipse cx="18" cy="26" rx="4" ry="6.5" fill="url(#grad-tire)" />
      <ellipse cx="-18" cy="26" rx="4" ry="6.5" fill="url(#grad-tire)" />
      <!-- Raios das rodas (simples) -->
      <line x1="18" y1="-14" x2="18" y2="-2" stroke="#ccc" stroke-width="1"/>
      <line x1="14" y1="-8" x2="22" y2="-8" stroke="#ccc" stroke-width="1"/>
    `,

    /* ========== Container 20 pés ========== */
    container_20: (cor, grad) => `
      <rect x="-12" y="-38" width="24" height="76" rx="2" fill="#2980b9" />
      <rect x="-12" y="-38" width="24" height="76" rx="2" fill="${grad}" opacity="0.3" />
      <!-- Nervuras -->
      <line x1="-12" y1="-25" x2="12" y2="-25" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <line x1="-12" y1="-10" x2="12" y2="-10" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <line x1="-12" y1="5" x2="12" y2="5" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <line x1="-12" y1="20" x2="12" y2="20" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
    `,

    /* ========== Container 40 pés ========== */
    container_40: (cor, grad) => `
      <rect x="-12" y="-45" width="24" height="90" rx="2" fill="#2980b9" />
      <rect x="-12" y="-45" width="24" height="90" rx="2" fill="${grad}" opacity="0.3" />
      <!-- Nervuras -->
      <line x1="-12" y1="-35" x2="12" y2="-35" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <line x1="-12" y1="-20" x2="12" y2="-20" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <line x1="-12" y1="-5" x2="12" y2="-5" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <line x1="-12" y1="10" x2="12" y2="10" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <line x1="-12" y1="25" x2="12" y2="25" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <line x1="-12" y1="40" x2="12" y2="40" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
    `,

    /* ========== Container Tanque de Troca ========== */
    container_tanque: (cor, grad) => `
      <rect x="-16" y="-30" width="32" height="60" rx="4" fill="url(#grad-metal)" />
      <ellipse cx="0" cy="0" rx="10" ry="25" fill="${cor}" />
      <ellipse cx="0" cy="0" rx="10" ry="25" fill="${grad}" opacity="0.5" />
      <rect x="-4" y="-10" width="8" height="8" rx="2" fill="#ecf0f1" opacity="0.6" />
    `,

    /* ========== Drone ========== */
    drone: (cor, grad) => `
      <ellipse cx="0" cy="0" rx="8" ry="6" fill="#7f8c8d" />
      <!-- Braços -->
      <line x1="-8" y1="0" x2="-28" y2="-15" stroke="#555" stroke-width="3" />
      <line x1="8" y1="0" x2="28" y2="-15" stroke="#555" stroke-width="3" />
      <line x1="-8" y1="0" x2="-28" y2="15" stroke="#555" stroke-width="3" />
      <line x1="8" y1="0" x2="28" y2="15" stroke="#555" stroke-width="3" />
      <!-- Motores -->
      <circle cx="-28" cy="-15" r="4" fill="#34495e" />
      <circle cx="28" cy="-15" r="4" fill="#34495e" />
      <circle cx="-28" cy="15" r="4" fill="#34495e" />
      <circle cx="28" cy="15" r="4" fill="#34495e" />
      <!-- Hélices -->
      <ellipse cx="-28" cy="-15" rx="12" ry="4" fill="none" stroke="#bdc3c7" stroke-width="1.5" stroke-dasharray="4,2" />
      <ellipse cx="28" cy="-15" rx="12" ry="4" fill="none" stroke="#bdc3c7" stroke-width="1.5" stroke-dasharray="4,2" />
      <ellipse cx="-28" cy="15" rx="12" ry="4" fill="none" stroke="#bdc3c7" stroke-width="1.5" stroke-dasharray="4,2" />
      <ellipse cx="28" cy="15" rx="12" ry="4" fill="none" stroke="#bdc3c7" stroke-width="1.5" stroke-dasharray="4,2" />
    `,

    /* ========== Empilhadeira ========== */
    empilhadeira: (cor, grad) => `
      <rect x="-12" y="-20" width="24" height="25" rx="3" fill="${cor}" />
      <rect x="-12" y="-20" width="24" height="25" rx="3" fill="${grad}" opacity="0.5" />
      <!-- Santo antônio -->
      <rect x="-10" y="-22" width="20" height="4" fill="#e67e22" />
      <!-- Garfos -->
      <rect x="-8" y="5" width="4" height="35" fill="url(#grad-metal)" />
      <rect x="4" y="5" width="4" height="35" fill="url(#grad-metal)" />
      <!-- Rodas -->
      <ellipse cx="10" cy="10" rx="3" ry="5" fill="url(#grad-tire)" />
      <ellipse cx="-10" cy="10" rx="3" ry="5" fill="url(#grad-tire)" />
    `,

    /* ========== Escavadeira (lagartas) ========== */
    escavadeira: (cor, grad) => `
      <!-- Lagartas -->
      <rect x="-22" y="15" width="44" height="16" rx="3" fill="#2c3e50" />
      <!-- Corpo -->
      <rect x="-10" y="-15" width="20" height="30" rx="3" fill="${cor}" />
      <rect x="-10" y="-15" width="20" height="30" rx="3" fill="${grad}" opacity="0.4" />
      <rect x="-6" y="-12" width="12" height="15" rx="2" fill="url(#grad-glass)" />
      <!-- Braço e caçamba -->
      <rect x="-4" y="-30" width="8" height="18" fill="#e67e22" />
      <rect x="-6" y="-42" width="6" height="15" fill="#e67e22" />
      <path d="M-10,-42 L10,-42 L8,-50 L-8,-50 Z" fill="#888" />
    `,

    /* ========== Escavadora (rodas) ========== */
    escavadora: (cor, grad) => `
      <!-- Chassi -->
      <rect x="-18" y="15" width="36" height="12" rx="2" fill="#555" />
      <!-- Corpo -->
      <rect x="-10" y="-15" width="20" height="30" rx="3" fill="${cor}" />
      <rect x="-10" y="-15" width="20" height="30" rx="3" fill="${grad}" opacity="0.5" />
      <rect x="-6" y="-12" width="12" height="15" rx="2" fill="url(#grad-glass)" />
      <!-- Braço e caçamba -->
      <rect x="-4" y="-30" width="8" height="18" fill="#f39c12" />
      <rect x="-6" y="-42" width="6" height="15" fill="#f39c12" />
      <path d="M-10,-42 L10,-42 L8,-50 L-8,-50 Z" fill="#888" />
      <!-- Rodas -->
      <rect x="-22" y="20" width="6" height="10" rx="2" fill="url(#grad-tire)" />
      <rect x="16" y="20" width="6" height="10" rx="2" fill="url(#grad-tire)" />
    `,

    /* ========== Motocicleta Esportiva (Sport) ========== */
    motocicleta_esportiva: (cor, grad) => `
      <!-- Rodas -->
      <ellipse cx="0" cy="-32" rx="4.5" ry="6.5" fill="url(#grad-tire)" />
      <ellipse cx="0" cy="-32" rx="2" ry="3" fill="#555" />
      <ellipse cx="0" cy="32" rx="4.5" ry="6.5" fill="url(#grad-tire)" />
      <ellipse cx="0" cy="32" rx="2" ry="3" fill="#555" />
      <!-- Garfo dianteiro -->
      <path d="M-2.5,-25 L-3,-12 M2.5,-25 L3,-12" stroke="#bdc3c7" stroke-width="2.5" fill="none" />
      <!-- Guidão esportivo (clip-on) -->
      <rect x="-16" y="-14" width="32" height="3" rx="1.5" fill="#555" />
      <rect x="-16" y="-14" width="5" height="3" rx="1.5" fill="#2980b9" />
      <rect x="11" y="-14" width="5" height="3" rx="1.5" fill="#2980b9" />
      <!-- Carenagem dianteira -->
      <path d="M-9,-30 Q-11,-38 0,-39 Q11,-38 9,-30 L11,-14 Q12,-8 8,-7 L-8,-7 Q-12,-8 -11,-14 Z" fill="${cor}" />
      <path d="M-9,-30 Q-11,-38 0,-39 Q11,-38 9,-30 L11,-14 Q12,-8 8,-7 L-8,-7 Q-12,-8 -11,-14 Z" fill="${grad}" opacity="0.5" />
      <!-- Faróis duplos -->
      <circle cx="-3" cy="-34" r="1.8" fill="#f1c40f" />
      <circle cx="3" cy="-34" r="1.8" fill="#f1c40f" />
      <!-- Para-brisa -->
      <path d="M-5,-28 Q-4,-32 0,-33 Q4,-32 5,-28 L4,-25 L-4,-25 Z" fill="url(#grad-glass)" opacity="0.8"/>
      <!-- Tanque de combustível -->
      <path d="M-7,-7 L7,-7 L8,5 L-8,5 Z" fill="${cor}" />
      <path d="M-7,-7 L7,-7 L8,5 L-8,5 Z" fill="${grad}" opacity="0.5" />
      <!-- Motor -->
      <rect x="-8" y="5" width="16" height="10" rx="2" fill="#555" />
      <rect x="-6" y="7" width="5" height="6" rx="1" fill="#777" />
      <rect x="1" y="7" width="5" height="6" rx="1" fill="#777" />
      <!-- Assento -->
      <rect x="-5" y="12" width="10" height="10" rx="3" fill="#111" />
      <!-- Rabeta -->
      <path d="M-5,22 Q-6,28 0,32 Q6,28 5,22 Z" fill="${cor}" />
      <path d="M-5,22 Q-6,28 0,32 Q6,28 5,22 Z" fill="${grad}" opacity="0.4" />
      <!-- Escapamento duplo -->
      <path d="M8, 12 Q13,18 11,32" stroke="#aaa" stroke-width="2.5" fill="none" stroke-linecap="round" />
      <path d="M-8,12 Q-13,18 -11,32" stroke="#aaa" stroke-width="2.5" fill="none" stroke-linecap="round" />
      <!-- Corrente -->
      <path d="M-3,18 Q-4,25 0,32" stroke="#666" stroke-width="1.5" fill="none" stroke-dasharray="2,2" />
    `,

    /* ========== Motocicleta Cruzada (Off-road) ========== */
    motocicleta_cruzada: (cor, grad) => `
      <!-- Rodas grandes com cravos -->
      <ellipse cx="0" cy="-30" rx="5" ry="7" fill="url(#grad-tire)" />
      <ellipse cx="0" cy="-30" rx="2.5" ry="4" fill="#555" />
      <ellipse cx="0" cy="28" rx="5" ry="7" fill="url(#grad-tire)" />
      <ellipse cx="0" cy="28" rx="2.5" ry="4" fill="#555" />
      <!-- Garfo alto -->
      <path d="M-3,-23 L-3,-8 M3,-23 L3,-8" stroke="#95a5a6" stroke-width="3" fill="none" />
      <!-- Guidão largo -->
      <rect x="-20" y="-12" width="40" height="3.5" rx="1.5" fill="#555" />
      <rect x="-20" y="-12" width="6" height="3.5" rx="1.5" fill="#e67e22" />
      <rect x="14" y="-12" width="6" height="3.5" rx="1.5" fill="#e67e22" />
      <!-- Tanque menor -->
      <path d="M-6,-7 L6,-7 L7,3 L-7,3 Z" fill="${cor}" />
      <path d="M-6,-7 L6,-7 L7,3 L-7,3 Z" fill="${grad}" opacity="0.5" />
      <!-- Motor descoberto -->
      <rect x="-7" y="3" width="14" height="10" rx="2" fill="#555" />
      <!-- Assento estreito -->
      <rect x="-4" y="12" width="8" height="8" rx="2" fill="#111" />
      <!-- Pára-lama alto -->
      <path d="M-9,-28 Q0,-34 9,-28" stroke="#f1c40f" stroke-width="3" fill="none" stroke-linecap="round" />
      <!-- Escapamento baixo -->
      <path d="M7,15 Q14,20 12,28" stroke="#aaa" stroke-width="2.5" fill="none" stroke-linecap="round" />
    `,

    /* ========== Plataforma de Reboque ========== */
    plataforma_reboque: (cor, grad) => `
      <!-- Lança -->
      <rect x="-3" y="-40" width="6" height="25" fill="url(#grad-metal)" />
      <!-- Eixo e rodas -->
      <rect x="-14" y="-12" width="28" height="6" rx="2" fill="#555" />
      <rect x="-16" y="-10" width="5" height="8" rx="2" fill="url(#grad-tire)" />
      <rect x="11" y="-10" width="5" height="8" rx="2" fill="url(#grad-tire)" />
      <!-- Plataforma -->
      <rect x="-16" y="-15" width="32" height="18" fill="${cor}" />
      <rect x="-16" y="-15" width="32" height="18" fill="${grad}" opacity="0.3" />
    `,

    /* ========== Reboque Gerador ========== */
    reboque_gerador: (cor, grad) => `
      <rect x="-16" y="-20" width="32" height="40" rx="4" fill="#2c3e50" />
      <rect x="-16" y="-20" width="32" height="40" rx="4" fill="${grad}" opacity="0.3" />
      <!-- Painel de controle -->
      <rect x="-6" y="-18" width="12" height="8" rx="2" fill="#e67e22" />
      <!-- Escape -->
      <rect x="-10" y="20" width="4" height="12" fill="#bdc3c7" />
      <!-- Rodas -->
      <rect x="-18" y="20" width="6" height="12" rx="2" fill="url(#grad-tire)" />
      <rect x="12" y="20" width="6" height="12" rx="2" fill="url(#grad-tire)" />
    `,

    /* ========== Reboque Reefer ========== */
    reboque_reefer: (cor, grad) => `
      <!-- Baú refrigerado -->
      <rect x="-18" y="-15" width="36" height="55" rx="4" fill="#ecf0f1" />
      <rect x="-18" y="-15" width="36" height="55" rx="4" fill="${grad}" opacity="0.3" />
      <!-- Unidade de refrigeração -->
      <rect x="-10" y="-25" width="20" height="12" rx="2" fill="#95a5a6" />
      <rect x="-6" y="-23" width="12" height="8" rx="1" fill="#e74c3c" />
      <!-- Rodas -->
      <rect x="-20" y="25" width="6" height="14" rx="2" fill="url(#grad-tire)" />
      <rect x="14" y="25" width="6" height="14" rx="2" fill="url(#grad-tire)" />
    `,

    /* ========== Reboque Tanque ========== */
    reboque_tanque: (cor, grad) => `
      <rect x="-18" y="-25" width="36" height="50" rx="14" fill="url(#grad-metal)" />
      <ellipse cx="0" cy="0" rx="8" ry="25" fill="${cor}" opacity="0.8" />
      <!-- Escotilha -->
      <circle cx="0" cy="-15" r="3" fill="#fff" opacity="0.4" />
      <!-- Rodas -->
      <rect x="-20" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)" />
      <rect x="14" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)" />
    `,

    /* ========== Reboque de Resíduos ========== */
    reboque_residuos: (cor, grad) => `
      <rect x="-16" y="-25" width="32" height="50" rx="10" fill="#7f8c8d" />
      <rect x="-16" y="-25" width="32" height="50" rx="10" fill="${grad}" opacity="0.3" />
      <!-- Porta traseira -->
      <rect x="-12" y="20" width="24" height="8" rx="2" fill="#e67e22" />
      <!-- Mangueira -->
      <path d="M0,25 Q15,30 10,35" stroke="#f1c40f" stroke-width="3" fill="none" stroke-linecap="round" />
      <!-- Rodas -->
      <rect x="-18" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)" />
      <rect x="12" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)" />
    `,

    /* ========== Reboque de Caixa ========== */
    reboque_caixa: (cor, grad) => `
      <rect x="-16" y="-20" width="32" height="50" rx="4" fill="${cor}" />
      <rect x="-16" y="-20" width="32" height="50" rx="4" fill="${grad}" opacity="0.4" />
      <line x1="-16" y1="0" x2="16" y2="0" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
      <!-- Rodas -->
      <rect x="-18" y="25" width="6" height="12" rx="2" fill="url(#grad-tire)" />
      <rect x="12" y="25" width="6" height="12" rx="2" fill="url(#grad-tire)" />
    `,

    /* ========== Reboque de Carro ========== */
    reboque_carro: (cor, grad) => `
      <!-- Plataforma -->
      <rect x="-18" y="-15" width="36" height="45" fill="#95a5a6" />
      <rect x="-18" y="-15" width="36" height="45" fill="${grad}" opacity="0.3" />
      <!-- Rampas -->
      <line x1="-18" y1="30" x2="-8" y2="45" stroke="#e67e22" stroke-width="2.5" />
      <line x1="18" y1="30" x2="8" y2="45" stroke="#e67e22" stroke-width="2.5" />
      <!-- Carro simplificado na plataforma -->
      <path d="M-8,-10 Q-10,-14 0,-14 Q10,-14 8,-10 L9,5 L-9,5 Z" fill="#f1c40f" />
      <!-- Rodas -->
      <rect x="-20" y="25" width="6" height="12" rx="2" fill="url(#grad-tire)" />
      <rect x="14" y="25" width="6" height="12" rx="2" fill="url(#grad-tire)" />
    `,

    /* ========== Reboque de Gerador Container ========== */
    reboque_container_gerador: (cor, grad) => `
      <rect x="-16" y="-25" width="32" height="50" rx="3" fill="#2c3e50" />
      <rect x="-16" y="-25" width="32" height="50" rx="3" fill="${grad}" opacity="0.3" />
      <!-- Aletas de ventilação -->
      <line x1="-10" y1="-15" x2="10" y2="-15" stroke="#ecf0f1" stroke-width="2" />
      <line x1="-10" y1="-5" x2="10" y2="-5" stroke="#ecf0f1" stroke-width="2" />
      <!-- Painel -->
      <rect x="-6" y="-22" width="12" height="5" rx="1" fill="#e67e22" />
      <!-- Rodas -->
      <rect x="-18" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)" />
      <rect x="12" y="22" width="6" height="12" rx="2" fill="url(#grad-tire)" />
    `,

    /* ========== Retroescavadeira ========== */
    retroescavadeira: (cor, grad) => `
      <!-- Corpo do trator -->
      <rect x="-14" y="-15" width="28" height="30" rx="4" fill="${cor}" />
      <rect x="-14" y="-15" width="28" height="30" rx="4" fill="${grad}" opacity="0.4" />
      <rect x="-10" y="-12" width="20" height="15" rx="2" fill="url(#grad-glass)" />
      <!-- Rodas traseiras grandes -->
      <ellipse cx="-12" cy="15" rx="5" ry="9" fill="url(#grad-tire)" />
      <ellipse cx="12" cy="15" rx="5" ry="9" fill="url(#grad-tire)" />
      <!-- Rodas dianteiras menores -->
      <ellipse cx="-10" cy="-20" rx="3" ry="5" fill="url(#grad-tire)" />
      <ellipse cx="10" cy="-20" rx="3" ry="5" fill="url(#grad-tire)" />
      <!-- Carregadeira frontal -->
      <rect x="-16" y="-28" width="32" height="8" rx="2" fill="#e67e22" />
      <!-- Braço da retro -->
      <rect x="14" y="-5" width="8" height="20" fill="#f39c12" />
      <rect x="18" y="12" width="6" height="10" fill="#f39c12" />
      <path d="M15,22 L24,25 L22,30 L16,24 Z" fill="#888" />
    `,

    /* ========== Aclo Compressor ========== */
    aclo_compressor: (cor, grad) => `
      <rect x="-14" y="-18" width="28" height="36" rx="4" fill="#7f8c8d" />
      <rect x="-14" y="-18" width="28" height="36" rx="4" fill="${grad}" opacity="0.4" />
      <!-- Ventilador -->
      <circle cx="0" cy="-10" r="7" fill="#34495e" />
      <line x1="-7" y1="-10" x2="7" y2="-10" stroke="#fff" stroke-width="1.5" opacity="0.5"/>
      <line x1="0" y1="-17" x2="0" y2="-3" stroke="#fff" stroke-width="1.5" opacity="0.5"/>
      <!-- Manômetro -->
      <circle cx="0" cy="8" r="4" fill="#ecf0f1" />
      <circle cx="0" cy="8" r="2" fill="#e74c3c" />
      <!-- Mangueira -->
      <path d="M-10,15 Q-18,10 -18,18" stroke="#2980b9" stroke-width="3" fill="none" stroke-linecap="round" />
    `,

    /* ========== Trator Agrícola ========== */
    trator: (cor, grad) => `
      <!-- Corpo -->
      <rect x="-14" y="-18" width="28" height="28" rx="3" fill="${cor}" />
      <rect x="-14" y="-18" width="28" height="28" rx="3" fill="${grad}" opacity="0.4" />
      <!-- Cabine -->
      <rect x="-10" y="-20" width="20" height="14" rx="2" fill="url(#grad-glass)" />
      <!-- Rodas traseiras -->
      <ellipse cx="-12" cy="10" rx="7" ry="10" fill="url(#grad-tire)" />
      <ellipse cx="12" cy="10" rx="7" ry="10" fill="url(#grad-tire)" />
      <!-- Rodas dianteiras -->
      <ellipse cx="-10" cy="-24" rx="4" ry="6" fill="url(#grad-tire)" />
      <ellipse cx="10" cy="-24" rx="4" ry="6" fill="url(#grad-tire)" />
      <!-- Exaustor -->
      <rect x="10" y="-30" width="4" height="12" fill="#bdc3c7" />
    `,

    /* ========== Taxi ========== */
    taxi: (cor, grad) => `
      <path d="M-15,-36 Q-17,-42 0,-42 Q17,-42 15,-36 L18,30 L-18,30 Z" fill="${cor}" />
      <path d="M-15,-36 Q-17,-42 0,-42 Q17,-42 15,-36 L18,30 L-18,30 Z" fill="${grad}" opacity="0.4" />
      <path d="M-13,-26 L13,-26 L14,2 L-14,2 Z" fill="url(#grad-glass)" />
      <path d="M-11,8 L11,8 L12,26 L-12,26 Z" fill="url(#grad-glass)" opacity="0.6" />
      <!-- Sinal de táxi no teto -->
      <rect x="-7" y="-22" width="14" height="5" rx="2" fill="#f1c40f" />
      <rect x="-5" y="-22" width="10" height="5" fill="#111" opacity="0.3" />
      <!-- Rodas -->
      <ellipse cx="16" cy="-5" rx="3" ry="5" fill="url(#grad-tire)" />
      <ellipse cx="-16" cy="-5" rx="3" ry="5" fill="url(#grad-tire)" />
      <ellipse cx="16" cy="20" rx="3" ry="5" fill="url(#grad-tire)" />
      <ellipse cx="-16" cy="20" rx="3" ry="5" fill="url(#grad-tire)" />
    `,

    /* ========== Van ========== */
    van: (cor, grad) => `
      <rect x="-17" y="-42" width="34" height="84" rx="5" fill="${cor}" />
      <rect x="-17" y="-42" width="34" height="84" rx="5" fill="${grad}" opacity="0.4" />
      <!-- Para-brisas -->
      <path d="M-14,-32 L14,-32 L15,-15 L-15,-15 Z" fill="url(#grad-glass)" />
      <!-- Janelas laterais -->
      <rect x="-14" y="-14" width="28" height="40" fill="url(#grad-glass)" opacity="0.5" />
      <!-- Porta lateral -->
      <rect x="-14" y="28" width="12" height="10" rx="1" fill="rgba(255,255,255,0.2)" />
      <!-- Rodas -->
      <ellipse cx="16" cy="-2" rx="3" ry="5.5" fill="url(#grad-tire)" />
      <ellipse cx="-16" cy="-2" rx="3" ry="5.5" fill="url(#grad-tire)" />
      <ellipse cx="16" cy="28" rx="3" ry="5.5" fill="url(#grad-tire)" />
      <ellipse cx="-16" cy="28" rx="3" ry="5.5" fill="url(#grad-tire)" />
    `,

    /* ========== Van Campista ========== */
    van_campista: (cor, grad) => `
      <!-- Corpo base mais alto -->
      <rect x="-17" y="-42" width="34" height="84" rx="5" fill="${cor}" />
      <rect x="-17" y="-42" width="34" height="84" rx="5" fill="${grad}" opacity="0.4" />
      <!-- Teto elevado (pop-top) -->
      <rect x="-13" y="-48" width="26" height="10" rx="3" fill="#ecf0f1" />
      <rect x="-13" y="-48" width="26" height="10" rx="3" fill="url(#grad-glass)" opacity="0.3" />
      <!-- Janelas -->
      <rect x="-13" y="-30" width="10" height="15" rx="2" fill="url(#grad-glass)" />
      <rect x="3" y="-30" width="10" height="15" rx="2" fill="url(#grad-glass)" />
      <rect x="-13" y="10" width="10" height="15" rx="2" fill="url(#grad-glass)" />
      <rect x="3" y="10" width="10" height="15" rx="2" fill="url(#grad-glass)" />
      <!-- Claraboia -->
      <rect x="-4" y="-38" width="8" height="4" rx="1" fill="url(#grad-glass)" />
      <!-- Rodas -->
      <ellipse cx="16" cy="-2" rx="3" ry="5.5" fill="url(#grad-tire)" />
      <ellipse cx="-16" cy="-2" rx="3" ry="5.5" fill="url(#grad-tire)" />
      <ellipse cx="16" cy="28" rx="3" ry="5.5" fill="url(#grad-tire)" />
      <ellipse cx="-16" cy="28" rx="3" ry="5.5" fill="url(#grad-tire)" />
    `,

    /* ========== Viatura ========== */
    viatura: (cor, grad) => `
      <path d="M-16,-38 Q-18,-44 0,-44 Q18,-44 16,-38 L19,32 L-19,32 Z" fill="${cor}" />
      <path d="M-16,-38 Q-18,-44 0,-44 Q18,-44 16,-38 L19,32 L-19,32 Z" fill="${grad}" opacity="0.4" />
      <path d="M-13,-26 L13,-26 L14,2 L-14,2 Z" fill="url(#grad-glass)" />
      <!-- Barra de luzes policial -->
      <rect x="-10" y="-22" width="8" height="5" rx="1.5" fill="#e74c3c" />
      <rect x="2" y="-22" width="8" height="5" rx="1.5" fill="#2980b9" />
      <!-- Rodas -->
      <ellipse cx="16" cy="-5" rx="3.5" ry="6" fill="url(#grad-tire)" />
      <ellipse cx="-16" cy="-5" rx="3.5" ry="6" fill="url(#grad-tire)" />
      <ellipse cx="16" cy="22" rx="3.5" ry="6" fill="url(#grad-tire)" />
      <ellipse cx="-16" cy="22" rx="3.5" ry="6" fill="url(#grad-tire)" />
    `,

    /* ========== Ônibus ========== */
    onibus: (cor, grad) => `
      <rect x="-19" y="-45" width="38" height="90" rx="5" fill="${cor}" />
      <rect x="-19" y="-45" width="38" height="90" rx="5" fill="${grad}" opacity="0.4" />
      <!-- Para-brisa -->
      <path d="M-16,-42 L16,-42 L17,-28 L-17,-28 Z" fill="url(#grad-glass)" />
      <!-- Janelas laterais -->
      <rect x="-16" y="-28" width="32" height="70" fill="url(#grad-glass)" opacity="0.6" />
      <!-- Porta -->
      <rect x="-16" y="-15" width="8" height="12" rx="1" fill="rgba(255,255,255,0.3)" />
      <!-- Rodas -->
      <rect x="-22" y="-5" width="6" height="12" rx="2" fill="url(#grad-tire)" />
      <rect x="16" y="-5" width="6" height="12" rx="2" fill="url(#grad-tire)" />
      <rect x="-22" y="30" width="6" height="12" rx="2" fill="url(#grad-tire)" />
      <rect x="16" y="30" width="6" height="12" rx="2" fill="url(#grad-tire)" />
    `
  }
};

// Para compatibilidade com chamadas diretas (ex: categoria 'moto'), adicionamos alias:
window.AL_ICONS_3D.shapes.moto = window.AL_ICONS_3D.shapes.motocicleta_esportiva;
window.AL_ICONS_3D.shapes.bike = window.AL_ICONS_3D.shapes.bicicleta;
