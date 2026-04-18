# Frontend — Telas de Rastreamento

## Telas implementadas

| Tela | Arquivo | Status |
|---|---|---|
| Rastreamento ao vivo | `AgillockSite/admin/rastreamento.html` | ✅ Implementado |
| Detalhe / histórico | `AgillockSite/admin/rastreamento-detalhe.html` | ✅ Implementado |

JavaScript externo em `AgillockSite/js/` (não inline no HTML, compartilhado pelo admin).

---

## Arquitetura de comunicação

```
GET /api/rastreamento/posicoes   (snapshot inicial)
         │
         ▼
rastreamento.js
    ├── renderMarcadores()    — mapa com cluster/spider
    ├── renderSidebar()       — contadores online/offline
    └── conectarWebSocket()   ──► ws://.../ws/rastreamento
                                      │
                                      ▼ { positions, devices, events }
                                  processarMensagemWs()
                                      ├── atualizarMarcador()
                                      └── atualizarCardAtivo()
```

**Fluxo de inicialização:**
1. Cache do `localStorage` (`rastr_pos_v1`) é renderizado instantaneamente
2. WebSocket é aberto imediatamente (já tem o mapeamento do cache)
3. REST `/posicoes` carrega em segundo plano e atualiza o mapa

---

## Tela 1: `rastreamento.html` — Mapa ao vivo

### Layout

```
┌─ sidebar admin (admin.css) ─────────────────────────────────────┐
│ ┌─ topbar ─────────────────────────────────────────────────────┐ │
│ │ Rastreamento                                                  │ │
│ └───────────────────────────────────────────────────────────────┘ │
│ ┌─ #rastreamento-layout ────────────────────────────────────────┐ │
│ │ ┌─ #sidebar-rastr (280px) ──┐ ┌─ #mapa (flex:1) ───────────┐ │ │
│ │ │  [input busca]            │ │                             │ │ │
│ │ │  [contadores online/off]  │ │   Leaflet map               │ │ │
│ │ │  #lista-resultados-busca  │ │   + marcadores              │ │ │
│ │ │  #device-detail-card      │ │   + clusters                │ │ │
│ │ └───────────────────────────┘ └─────────────────────────────┘ │ │
│ └───────────────────────────────────────────────────────────────┘ │
│                                 [#ws-status badge fixo]           │
└─────────────────────────────────────────────────────────────────────┘
```

### Mapa — tiles e controles

Três camadas de tile disponíveis no seletor (canto superior direito):
- **CartoDB Voyager** (padrão) — visual limpo, bom contraste
- **OpenStreetMap** — mais detalhado
- **ESRI Street** — satélite/street da Esri

```javascript
tilesCartoDB.addTo(map);
L.control.layers({ 'CartoDB Voyager': tilesCartoDB, 'OpenStreetMap': tilesOsm, 'ESRI Street': tilesEsri }).addTo(map);
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
```

### Marcadores — ícone por categoria

Ícone FontAwesome dentro de círculo colorido. Mapeamento categoria → `fa-*` definido em `_ICONE_CATEGORIA`:

| Categoria Traccar | Ícone |
|---|---|
| `carro`, `carro_*`, `viatura` | `fa-car` |
| `caminhao`, `caminhao_*`, `pickup`, `reboque_*`, `trator` | `fa-truck` |
| `motocicleta`, `motocicleta_cruzada` | `fa-motorcycle` |
| `onibus`, `van`, `caravana` | `fa-bus` |
| `taxi` | `fa-taxi` |
| `ambulancia` | `fa-ambulance` |
| `bicicleta` | `fa-bicycle` |
| outros | `fa-car` (fallback) |

**Cor do círculo:**
- Azul `#2980b9` — online + em movimento
- Verde `#27ae60` — online + parado
- Laranja `#e67e22` — offline com última posição conhecida
- Vermelho `#e74c3c` — velocidade acima do `limiteVelocidade`

### Cluster customizado (sem biblioteca externa)

Agrupa marcadores por **proximidade em pixels** (40px padrão), não por distância geográfica. Adapta automaticamente ao zoom.

```javascript
const CLUSTER_PX = 40;

function _agruparPorPixel() {
  // Para cada id não visitado, forma grupo com todos os outros dentro de CLUSTER_PX pixels
  // Usa map.latLngToContainerPoint() para comparar em pixels de tela
  // Resultado: { chave → { ids: [...], lat (centróide), lng (centróide) } }
}
```

Badge do cluster: círculo roxo `#8e44ad` com contador. Clique no badge abre o **spider**.

### Spider — expansão do cluster

Ao clicar em um badge de cluster, os marcadores do grupo se espalham em arco ao redor do centróide, ligados por linhas tracejadas. Clique em um marcador spiderfied:
1. Fecha o spider
2. Abre o card do dispositivo e entra em modo foco

```javascript
function _abrirSpider(chave, centroLatLng) {
  // Distribui ids em arco circular (raio 55px) ao redor do centro
  // Linha tracejada + marcador individual com popup simples
  // sm.on('click') → L.DomEvent.stopPropagation + focar(id)
}
```

### Modo foco

Quando um dispositivo é selecionado (via busca ou clique no mapa):
- Todos os outros marcadores e badges de cluster são ocultados
- O mapa faz `flyTo` para o dispositivo selecionado
- Ao receber atualização de posição via WS, o mapa faz `panTo` automático

```javascript
function ativarFoco(id) { /* modoFoco = true; esconde tudo exceto ativoId */ }
function desativarFoco() { /* modoFoco = false; renderMarcadores() reconstrói tudo */ }
```

Foco é desativado ao fechar o card (botão ×) ou fechar o popup pelo X do Leaflet.

### Sidebar — busca e card

**Busca:** ao digitar no input, `#lista-resultados-busca` aparece com até 8 resultados ordenados por status (movendo > parado > offline). Tempo decorrido calculado a partir de `fixTime || serverTime || lastUpdate`.

**Card do dispositivo** (`#device-detail-card`):
- Foto do veículo (se `imagemUrl` preenchido)
- Velocímetro SVG animado (verde ≤80, laranja ≤limite, vermelho > limite)
- Ignição (`p.ignicao`) com `fa-key`, bateria (`p.bateria_nivel`) com `fa-battery-*` adaptado ao nível
- 3 timestamps com segundos: Servidor / Dispositivo / GPS
- Geocodificação reversa via Nominatim com cache em memória (`_geocodeCache`)
- Botões: "Relatório" → `relatorio.html?id=` e "Histórico" → `rastreamento-detalhe.html?id=`

```javascript
// Velocímetro SVG — arc de 180° proporcional à velocidade
function svgVelocimetro(velocidade, limite) {
  const max = Math.max(limite || 120, 120);
  const f = Math.min(velocidade / max, 1);
  // Calcula ponto final do arco com trigonometria, cor varia pelo limite
}
```

Tema escuro é suportado: o velocímetro e o card detectam `document.documentElement.classList.contains('dark-theme')` e ajustam cores. O `MutationObserver` re-renderiza o card quando o tema muda.

### Campos de posição — contrato entre backend e frontend

Todos os campos abaixo estão disponíveis tanto no snapshot REST (`/posicoes`) quanto nas mensagens WebSocket (`positions[]`). Gerados pela função `normalizeAttributes()` em `traccar.service.ts` — funcionam para qualquer protocolo suportado pelo Traccar.

| Campo | Tipo | Descrição | Fonte no dispositivo |
|---|---|---|---|
| `latitude` | number | Latitude WGS-84 | GPS |
| `longitude` | number | Longitude WGS-84 | GPS |
| `velocidade` | number | Velocidade em km/h (convertido de knots) | GPS |
| `curso` | number | Direção em graus (0–360) | GPS |
| `altitude` | number | Altitude em metros | GPS |
| `fixTime` | string | Timestamp do fix GPS | GPS |
| `deviceTime` | string | Timestamp do dispositivo | Dispositivo |
| `serverTime` | string | Timestamp de chegada ao servidor | Traccar |
| `valida` | boolean | Posição GPS válida | GPS |
| `endereco` | string\|null | Endereço geocodificado | Traccar |
| `ignicao` | boolean\|null | Ignição ligada/desligada | `attributes.ignition` |
| `emMovimento` | boolean\|null | Veículo em movimento | `attributes.motion` |
| `alarme_codigo` | string\|null | Código bruto do alarme (ex: `sos`, `powerCut`) | `attributes.alarm` |
| `alarme` | string\|null | Alarme em português (ex: `"SOS / Pânico"`) | `ALARM_LABELS[alarm]` |
| `sinal` | number\|null | Intensidade do sinal GSM/4G (RSSI) | `attributes.rssi` |
| `satelites` | number\|null | Número de satélites GPS | `attributes.sat` |
| `tensao` | number\|null | Tensão do veículo/fonte externa (V) | `attributes.power` |
| `bateria_nivel` | number\|null | Nível da bateria interna (0–100 %) | `attributes.batteryLevel` |
| `bateria_tensao` | number\|null | Tensão da bateria interna (V) | `attributes.battery` |
| `carregando` | boolean\|null | Dispositivo carregando | `attributes.charge` |
| `odometro` | number\|null | Odômetro total (metros) | `attributes.totalDistance` |
| `distancia_segmento` | number\|null | Distância percorrida neste ponto (metros) | `attributes.distance` |
| `horas_motor` | number\|null | Horas de motor (h, com 1 decimal) | `attributes.hours` (ms → h) |
| `combustivel` | number\|null | Nível de combustível | `attributes.fuel` |
| `bloqueado` | boolean\|null | Veículo bloqueado/imobilizado | `attributes.blocked` |
| `entrada_digital` | number\|null | Bitmask de entradas digitais | `attributes.input` |
| `saida_digital` | number\|null | Bitmask de saídas digitais | `attributes.output` |
| `motorista_id` | string\|null | ID único do motorista | `attributes.driverUniqueId` |

> Campos `null` significam que o dispositivo não enviou aquele dado — comportamento normal para protocolos que não suportam o atributo.

### Eventos WebSocket — campo `tipoLabel`

As mensagens de evento (`events[]`) agora incluem `tipoLabel` com a descrição em português:
```javascript
// Antes: só tinha e.type = "ignitionOn"
// Agora também tem:
e.tipoLabel // → "Ignição ligada"
```
O frontend pode usar `e.tipoLabel` diretamente no lugar de manter sua própria tabela de tradução.

---

### WebSocket — reconexão automática

```javascript
ws.onclose = () => {
  setWsStatus('desconectado', 'Reconectando...');
  wsReconectTimer = setTimeout(conectarWebSocket, 5000); // tenta a cada 5s
};
```

URL do WS montada a partir de `window.API_URL` (definido em `config.js`):
```javascript
const wsUrl = `${API_URL.replace(/^http/, 'ws')}/ws/rastreamento?token=${token}`;
```

---

## Tela 2: `rastreamento-detalhe.html` — Histórico

Acessada via `?id=DISPOSITIVO_ID`. Carrega posições, viagens e exibe no mapa.

### Layout

```
┌─ topbar: [← voltar] [Nome do veículo]  [Relatório PDF] ──────────┐
│ ┌─ #sidebar-detalhe (300px) ──┐ ┌─ #mapa-wrap (flex:1) ─────────┐│
│ │  [info-veiculo]              │ │  Leaflet + polyline rastro     ││
│ │  [seletor período]           │ │  marcadores início/fim         ││
│ │  [stats: km, velmax, tempo] │ │  marcador posição atual        ││
│ │  [lista de viagens]          │ │  [loading overlay]             ││
│ └──────────────────────────────┘ └────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────┘
```

### Carregamento de dados

Três requisições em paralelo:
```javascript
const [listaPosicoes, resHistorico, viagens] = await Promise.all([
  apiGet('/api/rastreamento/posicoes'),                         // para info/status do veículo
  apiGet(`/api/rastreamento/dispositivos/${id}/historico?...`), // polyline
  apiGet(`/api/rastreamento/dispositivos/${id}/viagens?...`),   // lista de viagens
]);
```

### Seletor de período

Botões Hoje / Ontem / 7 dias pré-preenchem os inputs de data. Datas são convertidas para ISO com fuso horário local (`isoComFuso()`), evitando virada de dia por fuso UTC.

```javascript
function isoComFuso(dateStr, fimDoDia) {
  const off = new Date().getTimezoneOffset(); // Brasil = 180 (UTC-3)
  // Retorna ex: "2026-04-17T00:00:00-03:00"
}
```

### Mapa

- **Polyline azul** — rastro histórico (posições com `valida !== false`)
- **Círculo verde** — início do rastro; **círculo vermelho** — fim do rastro
- **Marcador com ícone** — posição atual do veículo (mesmo estilo de `rastreamento.js`)
- Ao clicar em uma viagem na lista: **polyline vermelha** destaca o trecho correspondente

```javascript
function destacarViagem(inicio, fim) {
  // Filtra historicoCache pelo intervalo de tempo da viagem
  // Desenha polyline vermelha (weight 5, opacity 0.9) e faz fitBounds
}
```

### Stats e viagens

Stats calculados a partir do array de viagens:
- `distancia` = soma de `v.distancia` (já em km)
- `velMax` = máximo de `v.velocidadeMaxima`
- `totalMin` = soma de `v.duracao` (em minutos)

Viagem card: clique destaca trecho no mapa. Item ativo recebe classe `.ativo`.

### Impressão (PDF)

`@media print` no CSS esconde sidebar admin, topbar, mapa e loading. A sidebar de detalhe com stats e lista de viagens é renderizada em largura total, permitindo imprimir como relatório.

Botão "Relatório PDF" chama `window.print()`.
