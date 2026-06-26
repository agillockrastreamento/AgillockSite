# Frontend — Admin (AgillockSite)

Convenções: Bootstrap 3, jQuery, `window.AL` (`apiGet/Post/Patch`, `showAlert`, `fmtMoney`, `fmtDate`, `badgeStatus`), tema dark via `html.dark-theme`. Ver `MEMORY.md`.

## 1. Botão de habilitar em `admin/clientes.html`

Seguir exatamente o padrão do botão de medidores (`.btn-medidores`, ver `project_cliente_editar_medidores.md`):

- Nova ação na coluna "Ações" de cada cliente: botão `.btn-multas` com ícone (ex. `fa-exclamation-triangle` ou `fa-gavel`), **verde/ativo quando ligado**, cinza quando desligado.
- `GET /api/clientes` já deve trazer `multasHabilitado` (findMany sem select restrito).
- Ao clicar: `await AL.apiPatch('/clientes/'+id+'/multas-habilitado')` (auto-toggle) → atualiza o ícone e mostra toast ("Consulta de multas habilitada/desabilitada para o cliente").
- Tooltip: "Habilitar consulta de multas (Detran)".

## 2. Nova tela `admin/multas.html`

Página no padrão das demais telas do admin (mesma topbar/sidebar, anti-FOUC de tema no `<head>`). Duas abas (tabs Bootstrap):

### Aba "Multas" (default)
- **Filtros no topo:** busca (placa / nome / CPF-CNPJ), select de status (`OK/ERRO/DADOS_INVALIDOS/...`), checkbox "somente com multas", select de cliente.
- **Tabela** (via `GET /api/multas`): Placa | Cliente | Qtd multas | Valor total | IPVA (badge) | Licenciamento (badge) | Última consulta | Status (badge) | Ações.
  - Ações por linha: **Ver detalhes** (abre o detalhe), **Buscar agora** (`POST /api/multas/:id/consultar`, mostra spinner e atualiza a linha).
- **Botão geral:** "Consultar todos agora" (`POST /api/multas/consultar-todos`) com confirmação; mostra que entrou na fila.

### Detalhe do veículo (modal ou seção)
`GET /api/multas/:dispositivoId`:
- Cabeçalho: placa, cliente, badges IPVA e licenciamento, "atualizado em".
- **Tabela completa de multas:** AIT | Motivo | Data infração | Vencimento | Valor | Valor a pagar | checkbox de seleção.
- **Dados de pagamento:**
  - Botões "Selecionar todas" / seleção individual.
  - "Gerar pagamento das selecionadas" → `POST /api/multas/:id/pagamento` com `{aits}` → exibe:
    - **QR Code** (`<img src="data:image/png;base64,<qrCodeBase64>">`)
    - **Pix copia-e-cola** (campo + botão "Copiar")
    - **Baixar boleto (PDF)** → link/stream `GET /api/multas/:id/boleto?aits=...`
  - Aviso: "Dados consultados no Detran CE. Atualização automática 2×/dia (10h e 17h)."

### Aba "Histórico de consulta"
`GET /api/multas/historico`:
- Tabela: Início | Origem (Agendada/Manual) | Status (badge) | Duração | Clientes | Veículos (sucesso/erro) | Multas coletadas.
- Útil para o admin auditar: "às 10h rodou, ok, levou 3min12s, 24 veículos, 23 ok / 1 erro, 41 multas".
- Pode ter um resumo no topo (última execução + próxima prevista).

## 3. Acesso/menu
Adicionar "Multas" na sidebar/menu do admin (mesma forma das outras entradas). Visível para ADMIN/COLABORADOR.

## Notas
- Usar `AL.fmtMoney` para valores e `AL.fmtDate` para datas/horas.
- Badges de status com `AL.badgeStatus` (ou classes Bootstrap `label-success/label-danger/label-warning`).
- Spinners nos botões de "buscar agora" / "gerar pagamento" (operações que falam com o Detran levam alguns segundos).
