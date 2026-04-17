# Portal do Cliente — Rastreamento (especificação técnica)

Esta parte cobre exclusivamente a **tela de rastreamento do portal do cliente** — as diferenças em relação à tela admin, a barra de veículos, os overlays e o bloqueio por inadimplência.

Para a especificação completa (login, auth, JWT, pagamentos, sidebar, index.html, banco de dados, rotas de backend) ver: `docs/projeto/PORTAL_CLIENTE.md`.

---

## Diferenças em relação ao admin

| Aspecto | Admin | Cliente |
|---|---|---|
| Sidebar de veículos | Busca + card detalhe (280px) | Busca + card detalhe (mesma lógica) |
| Barra inferior | Não existe | Cards de veículos com foto (ver seção 2) |
| Botão "Relatório" | Navega para `relatorio.html` | Abre overlay na mesma tela |
| Botão "Histórico" | Navega para `rastreamento-detalhe.html` | Abre overlay na mesma tela |
| Cluster/spider | Igual | Igual |
| Modo foco | Igual | Igual |
| Foto do veículo | Foto cadastrada pelo admin em `dispositivo.html` | Foto enviada pelo próprio cliente |
| Bloqueio por inadimplência | Não existe | Sim (ver seção 4) |

---

## 1. Layout geral

```
┌─ sidebar (minimizável) ─────────────────────────────────────────┐
│ ┌─ topbar ─────────────────────────────────────────────────────┐ │
│ └──────────────────────────────────────────────────────────────┘ │
│ ┌─ área principal ─────────────────────────────────────────────┐ │
│ │  ┌─ #sidebar-rastr (280px) ──┐  ┌─ #mapa (flex:1) ─────────┐│ │
│ │  │  [busca]                  │  │                           ││ │
│ │  │  [contadores]             │  │   Leaflet map             ││ │
│ │  │  [resultados busca]       │  │   marcadores / cluster    ││ │
│ │  │  [card dispositivo]       │  │                           ││ │
│ │  └───────────────────────────┘  └───────────────────────────┘│ │
│ │  ┌─ #barra-veiculos ──────────────────────────────────────────┐│ │
│ │  │  [card v1]  [card v2]  [card v3]  ...  ← scroll horizontal ││ │
│ │  └────────────────────────────────────────────────────────────┘│ │
│ └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Barra de veículos (rodapé do mapa)

Cards horizontais com todos os veículos do cliente. Fixos na parte inferior da área do mapa.

### Card

```
┌────────────────────────────┐
│  [foto 60×60 ou ícone fa]  │
│  ABC-1234                  │  ← placa
│  Fiat Uno                  │  ← marca/modelo
│  ● Em movimento  42 km/h   │  ← status atual
└────────────────────────────┘
```

- Foto: imagem enviada pelo próprio cliente (não a foto do admin). Se não tiver, usa ícone FontAwesome da categoria do veículo (igual ao marcador do mapa)
- Clique no card: `focar(dispositivoId)` — flyTo no mapa + abre card no sidebar lateral
- Ícone de câmera sobre a foto permite o cliente fazer upload diretamente da barra

### Comportamento da altura

- **Padrão**: altura fixa (~90px, 1 linha de cards), overflow-x scroll
- **Ao rolar horizontalmente** (wheel ou touch): a barra **expande verticalmente** para facilitar a navegação (ex: 180px = 2 linhas)
- **Após selecionar um veículo**: barra volta ao tamanho padrão automaticamente

```javascript
// Expandir ao rolar
barraVeiculos.addEventListener('wheel', () => {
  barraVeiculos.classList.add('expandida');
});

// Recolher após selecionar
window.focarCliente = function (dispositivoId) {
  barraVeiculos.classList.remove('expandida');
  focar(dispositivoId); // reutiliza lógica do rastreamento.js
};
```

```css
#barra-veiculos {
  height: 90px;
  transition: height 0.25s ease;
  overflow-x: auto;
  overflow-y: hidden;
  display: flex;
  gap: 10px;
  padding: 8px 12px;
}
#barra-veiculos.expandida {
  height: 200px;
  overflow-y: auto;
  flex-wrap: wrap;
}
```

---

## 3. Overlays de histórico e relatório

Ao clicar em "Histórico" ou "Relatório" no card do sidebar, abre um overlay sobre o mapa em vez de navegar para outra página.

```
┌─ overlay (position:fixed, inset:0, z-index:2000) ─────────────┐
│ ┌─ topbar ──────────────────────────────────────────────────┐  │
│ │ [← Voltar]  Nome do veículo — ABC-1234                    │  │
│ └───────────────────────────────────────────────────────────┘  │
│ ┌─ conteúdo (igual rastreamento-detalhe.html) ──────────────┐  │
│ │  sidebar detalhe + mapa histórico                         │  │
│ └───────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

- Botão "Voltar" fecha o overlay e retorna para o mapa ao vivo
- O overlay reutiliza a lógica de `rastreamento-detalhe.js` (injetado dinamicamente ou incluído via `<script>`)
- `history.pushState` pode ser usado para que o botão voltar do browser funcione

---

## 4. Bloqueio por inadimplência

Ao entrar na tela de rastreamento, o frontend chama:

```
GET /api/cliente/rastreamento/status-acesso
Response: { bloqueado: false }
       ou { bloqueado: true, diasAtraso: 15 }
```

Se `bloqueado: true`:
- Modal bloqueante (não pode fechar sem ação)
- Texto: "Seu acesso ao rastreamento está suspenso. Existe um boleto em atraso de X dias. Regularize o pagamento para voltar a acessar."
- Botão "Ver boletos" → `pagamentos.html` (se responsável) ou exibe telefone/WhatsApp da empresa (se vinculado)
- O mapa carrega em segundo plano mas não é interativo enquanto o modal está ativo

**Regra de negócio (backend):**
```
bloqueado = existe boleto com status ATRASADO
            E (hoje - vencimento) > 10 dias
            E pertence ao clienteId do token
```

As rotas de posição também retornam `403 { error: 'acesso_bloqueado' }` enquanto houver inadimplência — o bloqueio não pode ser burlado pelo frontend.

---

## 5. Foto do veículo pelo cliente

```
POST /api/cliente/dispositivos/:dispositivoId/foto
     multipart/form-data, campo "foto"
     Máximo 2MB — JPG / PNG / WEBP
     Response: { imagemUrlCliente: "/uploads/cliente/uuid.webp" }

DELETE /api/cliente/dispositivos/:dispositivoId/foto
```

A foto fica em `imagemUrlCliente` no banco (campo separado de `imagemUrl` que é do admin).

Visibilidade:
- `imagemUrl` → mostrada apenas no card do dispositivo na tela do admin
- `imagemUrlCliente` → mostrada apenas na barra de veículos do portal do cliente
