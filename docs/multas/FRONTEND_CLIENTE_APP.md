# Frontend — Cliente (Site + App)

A tela "Multas" aparece para o cliente **somente** se `cliente.multasHabilitado === true`. Quando desabilitado, a entrada de menu/tab nem aparece.

## Regras comuns (site e app)
- Fonte de dados: `GET /api/cliente/multas` (lista todos os veículos do cliente com suas multas e situação).
- Pagamento: `POST /api/cliente/multas/:dispositivoId/pagamento` com `{ aits: [...] }` (vazio = todas) → retorna `{ pix: { emv, qrCodeBase64 }, boletoUrl, extratoId }`.
- Boleto: `GET /api/cliente/multas/:dispositivoId/boleto?aits=...`.
- **Aviso obrigatório na tela:** "As multas são consultadas diretamente no Detran. A atualização é feita automaticamente 2 vezes ao dia, às 10h e às 17h."
- O cliente **não** dispara consulta ao Detran — apenas vê o que foi consultado e gera o pagamento.

## Site (`AgillockSite`)

Nova página `multas.html` no portal do cliente (mesmo padrão das telas do cliente: header, tema, `window.AL` com `al_cliente_token`).

Layout:
- **Cabeçalho** com o aviso de atualização (Detran, 10h/17h) e "atualizado em <data>".
- **Por veículo** (card/accordion): placa + apelido, badges de IPVA e licenciamento, total de multas e valor.
  - **Tabela completa:** AIT | Motivo (descrição) | Data infração | Vencimento | Valor | Valor a pagar | checkbox.
  - Botões: "Pagar selecionadas" e "Pagar todas".
  - Ao gerar pagamento, exibir:
    - **QR Code Pix** (`<img src="data:image/png;base64,...">`)
    - **Pix copia-e-cola** com botão "Copiar"
    - **Baixar boleto (PDF)**
- Se o veículo não tem multas: mensagem "Nenhuma multa encontrada" + badges de IPVA/licenciamento.

Adicionar "Multas" ao menu do portal do cliente (condicionado à flag — o backend pode expor a flag no perfil/login do cliente para o front decidir exibir o menu).

## App (React Native / Expo)

Nova tela "Multas" na navegação do cliente (aparece condicional à flag).

- Reusar componentes/Toast existentes (Toast só `info|success|error`).
- Lista de veículos → ao expandir, tabela/cards das multas com seleção (checkbox/seleção múltipla).
- Botões "Pagar selecionadas" / "Pagar todas".
- Pagamento exibe:
  - **QR Code** a partir do base64 (`<Image source={{ uri: 'data:image/png;base64,'+qr }} />`).
  - **Pix copia-e-cola** com botão copiar (`expo-clipboard`).
  - **Baixar/abrir boleto PDF** — usar `expo-file-system` **v18** (API por classes: `FileSystem.File.downloadFileAsync`, `FileSystem.Paths.cache` — ver `MEMORY.md`; **não** usar `downloadAsync`/`cacheDirectory`). Abrir com share/visualizador.
- Aviso fixo no topo: consulta no Detran, 2×/dia (10h e 17h).
- Exibir condicional: a flag `multasHabilitado` deve vir no payload de login/perfil do cliente (como outras flags do app, ex. `podeEditarMedidores`).

## Veículo sem renavam/chassi (banner + modal)

O Detran identifica o veículo por placa + renavam (ou chassi). Veículos sem esses dados não são consultados. No site e no app, a tela de multas mostra o **mesmo banner do admin**, mas com ação:

- **Banner âmbar** (`incompletos` do `GET /api/cliente/multas`): "N veículo(s) sem RENAVAM/chassi no cadastro: PLACA1, PLACA2…" + botão **"Preencher agora"** — o botão aparece conforme `podeEditarDocumentos`, que reflete a permissão granular **`multas.editarDocumentos`** (responsável sempre tem; sub-usuário depende do toggle "Preencher RENAVAM / chassi do veículo" no formulário de usuários). Sem a permissão, o banner orienta a pedir ao responsável da conta.
- **Modal "Completar dados do veículo"**: seletor de veículo (quando há mais de um incompleto), campo RENAVAM (9–11 dígitos) e chassi (17 caracteres, opcional) → `PATCH /api/cliente/multas/:dispositivoId/documentos`.
- Salvar **atualiza o cadastro do dispositivo** (`Dispositivo.renavam` / `Dispositivo.chassi`) e **enfileira a consulta** ao Detran na hora.
- Enquanto a consulta roda, o veículo entra em `aguardando` e a tela mostra um aviso "Consultando o Detran para PLACA…", recarregando sozinha (poll de 15s, até 8 tentativas) até a situação aparecer.

## Estados de UI
- **Carregando:** skeleton/spinner.
- **Sem veículos consultáveis:** "Nenhum veículo habilitado para consulta de multas".
- **Erro na última consulta** (status ERRO): mostrar dado anterior + aviso discreto "última atualização pode estar desatualizada".
- **Veículo sem renavam/chassi:** banner + modal de preenchimento (acima) — o cliente resolve sozinho, sem acionar o suporte.
