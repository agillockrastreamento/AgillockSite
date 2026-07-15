# Reconhecimento técnico — Detran CE

Resultado da investigação do site do Detran CE (2026-06-26). Tudo abaixo foi **testado e confirmado** com um veículo real (placa `OSU6H88`, renavam `01241525924`, que possui 2 multas + débito de IPVA).

## Conclusões principais

- ✅ A consulta de multas/taxas é feita pela **Central de Serviços** (Ruby on Rails): `https://sistemas.detran.ce.gov.br/central`.
- ✅ O fluxo **"Veículo → Taxas / Multas" NÃO exige captcha nem certificado digital**.
- ✅ Tudo é possível com **HTTP puro** (cookie de sessão + token CSRF). Não precisa de navegador headless.
- ✅ Dá pra obter: tabela de multas, situação de IPVA, situação de licenciamento, **Pix** (copia-e-cola + QR) e **boleto PDF**.
- ⚠️ Existe um `reload_hcaptcha` carregado na Central, mas o login passou **sem** resolvê-lo (não é exigido no fluxo de consulta). Monitorar caso passe a ser exigido.

### Caminho que NÃO deve ser usado
Existe também a "Consulta Completa" em `https://erenavam.detran.ce.gov.br/getran/consultaInternet.do` (Java/Struts, Tomcat 5.5.36). Esse caminho **exige certificado digital e tem captcha de imagem** — foi descartado. Detalhe para registro: nele o `GET ?method=prepareConsultaCompleta` retorna 403 (WAF) e só `POST` funciona; captcha em `/getran/captcha.jpg`. **Não usamos esse caminho.**

---

## Fluxo HTTP completo (passo a passo)

Todos os passos compartilham a mesma sessão (cookie `_central_session`). Base: `https://sistemas.detran.ce.gov.br/central`.

### 1. `GET /central` — obter sessão + CSRF
- Seta o cookie de sessão `_central_session`.
- O token CSRF está em `<meta name="csrf-token" content="...">` (o `csrf-param` é `authenticity_token`).

### 2. `POST /central/veiculos/login` — informar o veículo
Body `application/x-www-form-urlencoded`:
```
authenticity_token=<csrf>
veiculo[tipo_formulario]=1
veiculo[placa]=OSU6H88
veiculo[renavam_chassi]=01241525924
```
- O campo `veiculo[renavam_chassi]` aceita **renavam OU chassi**.
- Resposta JSON: `{"status":"succ","errors":""}`. Em caso de dados inválidos, `errors` é preenchido (usar para detecção de erro).
- Enviar header `X-Requested-With: XMLHttpRequest`.

### 3. `GET /central/veiculos/principal` — resumo do veículo (HTML)
Retorna HTML com a situação. Trechos relevantes a parsear:
- **Multas:** `O veículo possui <b>N multas, CLIQUE AQUI</b> se deseja imprimir` (dentro de `div.alert.alert-danger.multas`). Se não houver, o bloco não aparece / texto diferente.
- **IPVA:** `Seu veículo possui débito(s) de IPVA. Clique AQUI para emitir o boleto.` → presença = possui débito.
- **Licenciamento:** `Clique AQUI se deseja imprimir seu licenciamento.` → indica situação de licenciamento.

> IPVA é apenas **informativo** (possui / não possui). O **licenciamento**, quando pendente,
> agora também gera **Pix + boleto** (ver passo 7). Não geramos boleto de IPVA.

### 4. `GET /central/veiculos/multas` — tabela de multas (HTML)
Enviar header `X-Requested-With: XMLHttpRequest`. Retorna um `<table>` com as colunas:

| Coluna | Observação |
|---|---|
| `#` | checkbox `multas[<AIT>]` com `value="213890*<AIT>*5550*0"` e `data-valor="132.85"` |
| AIT | ex. `VM00331695` |
| AIT Originária | geralmente `--` |
| Motivo | ex. `ESTACIONAR EM LOCAL/HORARIO PROIBIDO ESPECIFICAMEN...` |
| Data Infração | `23/12/2025` |
| Data Vencimento | `13/04/2026` |
| Valor | `R$ 130,16` |
| Valor a Pagar | `R$ 132,85` (td `class="valor"`) |

O **`value` do checkbox** (`213890*VM00331695*5550*0`) é o identificador usado para selecionar a multa na geração do boleto/Pix — deve ser capturado e armazenado.

### 5. `POST /central/veiculos/emitir_extrato_multas` — gerar Pix (e preparar boleto)
Body:
```
authenticity_token=<csrf>
multas[VM00331695]=213890*VM00331695*5550*0
multas[VM00311778]=213890*VM00311778*5550*0
```
- Inclua **um campo `multas[...]` por multa selecionada** (uma, várias ou todas).
- Header `X-Requested-With: XMLHttpRequest`.
- Resposta JSON:
```json
{
  "extrato": "6606260648",
  "emv": "00020101021226850014br.gov.bcb.pix...5802BR5907SEFAZCE6011FORTALEZACE6304XXXX",
  "qr_code": "iVBORw0KGgoAAAANSUhEUgAA... (PNG base64)"
}
```
  - `extrato`: id do extrato (também usado no nome do PDF e no parcelamento).
  - `emv`: **Pix copia-e-cola** (BR Code) pronto para pagamento à vista.
  - `qr_code`: **PNG do QR Code Pix** em base64 (renderizar com `data:image/png;base64,<qr_code>`).

### 6. `GET /central/veiculos/gerar_boleto` — baixar boleto (PDF)
- Usa o estado de sessão definido pelo passo 5 (também aceita `?extrato=<id>`).
- Resposta: `Content-Type: application/pdf`, `Content-Disposition: inline; filename="Extrato_<id>.pdf"`, ~134 KB, `%PDF-1.4`.
- É o "Baixar boleto para pagamento à vista".

> Parcelamento (não usado nesta feature): `GET /central/servicos/inicia_parcelamento_veiculo?extrato=<id>`.

### 7. `GET /central/veiculos/licenciamento` — Pix + boleto do licenciamento (HTML)
Quando o `principal` indica licenciamento pendente (`div.links-veiculo.licenciamento` com `alert-danger`),
este endpoint devolve um **fragmento HTML** (o conteúdo do modal) que já traz tudo:
- Tabela `#emissao-multas`: itens (ex.: "Licenciamento 2026", "Expedição de CRV/CRLV 2026"), valores e `#total`.
- **Pix copia-e-cola**: `input#pix` (atributo `value`).
- **QR Code**: `img#qrCodeImage` (`src="data:image/png;base64, ..."` — atenção ao espaço após a vírgula).
- Form `#extrato_licenciamento` (action `/veiculos/gerar_boleto`, POST) com `authenticity_token`.

Enviar header `X-Requested-With: XMLHttpRequest`. Este GET **prepara a sessão**: em seguida,
`GET /central/veiculos/gerar_boleto` (o mesmo do passo 6) devolve o **PDF do boleto do licenciamento**
(`application/pdf`, ~134 KB). Testado com a placa `PMX1H85` (licenciamento 2026, total R$ 220,45).

> O Detran **não informa data de vencimento** do licenciamento (só o ano e o valor) — por isso não há
> notificação de "7 dias / no dia" para licenciamento, apenas o aviso de "licenciamento pendente".

---

## Exemplo real (placa OSU6H88)

Resumo `principal`: "O veículo possui **2 multas**", "possui débito(s) de IPVA", link de licenciamento presente.

Tabela `multas`:

| AIT | Motivo | Infração | Vencimento | Valor | A Pagar | value (checkbox) |
|---|---|---|---|---|---|---|
| VM00331695 | ESTACIONAR EM LOCAL/HORARIO PROIBIDO… | 23/12/2025 | 13/04/2026 | R$ 130,16 | R$ 132,85 | `213890*VM00331695*5550*0` |
| VM00311778 | ESTACIONAR EM LOCAL/HORARIO PROIBIDO… | 05/12/2025 | 27/03/2026 | R$ 130,16 | R$ 134,27 | `213890*VM00311778*5550*0` |

`emitir_extrato_multas` (ambas) → `extrato=6606260648` + `emv` + `qr_code`.
`gerar_boleto` → `Extrato_6606260648.pdf` (134.723 bytes, válido).

---

## Notas de robustez (para a implementação)

- **Charset:** as páginas legadas vêm em ISO-8859-1 em algumas partes; a Central (Rails) responde UTF-8. Tratar acentuação ao parsear (ex.: "Código de Segurança").
- **CSRF:** o token mascarado do `<meta>` é válido por toda a sessão; reextrair a cada nova sessão.
- **Sessão:** manter o cookie `_central_session` durante todo o fluxo de um veículo.
- **User-Agent:** enviar um UA de navegador real.
- **TLS:** o certificado pode exigir tolerância (`-k`/`rejectUnauthorized:false`) em curl; validar no Node se o cert do `sistemas.detran.ce.gov.br` é aceito sem ajustes.
- **Valores monetários:** vêm como `R$ 130,16` (vírgula decimal) — normalizar para número.
- **Erro de dados:** `login` com placa/renavam errados → JSON com `errors` preenchido; tratar como "veículo não encontrado / dados divergentes".
