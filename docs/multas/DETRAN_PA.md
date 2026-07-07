# Detran PA — Consulta de Infrações

Reconhecimento técnico do Detran do Pará (2026-06-26), segundo estado da funcionalidade de consulta de multas (o primeiro é o [Detran CE](RECONHECIMENTO_DETRAN_CE.md)).

> Página de consulta: `https://sistemas-renavam.detran.pa.gov.br/sistransito/detran-web/servicos/infracao/indexConsultaInfracao.jsf`
> Entrada: **placa + renavam** + botão "Confirmar".

## Conclusões principais

- ✅ Viável por **HTTP puro** (não precisa de navegador para o fluxo/gate/JSF).
- ⚠️ **Diferença crítica em relação ao CE:** o PA usa **Cloudflare Turnstile** e ele é **exigido no servidor**. Sem um token válido, a consulta é recusada. Precisa de um **solver de Turnstile** (serviço pago).
- App é **JSF** (JavaServer Faces): usa `javax.faces.ViewState` e `jsessionid` na URL de action (URL rewriting).
- O site **não** está atrás de Cloudflare (servidor nginx). O Turnstile é só o widget de captcha embutido no formulário.

Comparativo rápido:

| Aspecto | Detran CE | Detran PA |
|---|---|---|
| Tecnologia | Ruby on Rails | **JSF** (ViewState, jsessionid) |
| Gate de acesso | direto | cookie `veio_da_home=1` (visitar a home antes) |
| Captcha | nenhum exigido | **Cloudflare Turnstile (exigido)** |
| Precisa navegador? | não | não (só o Turnstile precisa de solver) |
| Custo por consulta | zero | ~R$ 0,006 (solve do Turnstile) |

---

## Gate de acesso (`veio_da_home`)

Acessar o deep link direto retorna **302 → `https://www.detran.pa.gov.br`** (redireciona pra fora). O app exige que o usuário tenha passado pela home primeiro.

Solução (confirmada):
1. `GET https://www.detran.pa.gov.br/` → responde 200 e seta o cookie:
   `Set-Cookie: veio_da_home=1; Domain=.detran.pa.gov.br; Path=/; Secure; HttpOnly; SameSite=Lax`
2. `GET .../indexConsultaInfracao.jsf` **com esse cookie** → retorna o formulário (200, ~7,8 KB).

Sem o cookie o deep link sempre redireciona. Não é Cloudflare (nginx 1.20/1.8) — é um gate de aplicação simples, contornável via HTTP.

## Formulário (`indexForm`)

`<form id="indexForm" method="post" action=".../indexConsultaInfracao.jsf;jsessionid=<SID>" ...>`

Campos a enviar no POST (`application/x-www-form-urlencoded`):

| Campo | Valor | Observação |
|---|---|---|
| `indexForm` | `indexForm` | hidden (nome do form) |
| `placa` | ex. `ABC1D23` | maxlength 7 |
| `renavam` | ex. `01234567890` | maxlength 11 |
| `confirma` | `Confirmar` | botão submit |
| `javax.faces.ViewState` | `<valor>` | **extrair do HTML a cada sessão** (hidden `name="javax.faces.ViewState"`) |
| `cf-turnstile-response` | `<token>` | **token do Turnstile** (injetado pelo widget; ver abaixo) |

- O POST vai para a **action URL com `;jsessionid=<SID>`** (URL rewriting do JSF). Extrair a action do próprio HTML.
- O `ViewState` é obrigatório no JSF e muda a cada sessão/render — sempre reextrair do form recém-carregado.

## Captcha — Cloudflare Turnstile

- No HTML: `<div class="cf-turnstile" data-sitekey="0x4AAAAAADpvM_lNoEdBJ3cR"></div>` + `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js">`.
- O widget injeta um `<input name="cf-turnstile-response" value="<token>">` no form ao ser resolvido; esse token vai no POST.
- Havia também um **mCaptcha próprio** (`mcaptcha.detran.pa.gov.br`), mas está **comentado/desativado** no HTML — ignorar.

### Confirmação de que é exigido
POST com placa/renavam + ViewState **sem** `cf-turnstile-response` → resposta 200 re-renderizando o form com:
```
<ul class="alert-errorbox"><li> Verificação de segurança inválida. Tente novamente.</li></ul>
```
Ou seja, **o Turnstile é validado no servidor** (diferente do hCaptcha do CE, que era ignorado).

### Solver
- Serviços que resolvem Turnstile: **2captcha, CapMonster, Anti-Captcha** etc. Entrada: `sitekey=0x4AAAAAADpvM_lNoEdBJ3cR` + `pageurl=<URL da .jsf>`. Saída: token.
- Custo: ~US$ 1–3 por 1000 solves (~R$ 0,006 cada). Com 2 consultas/dia por veículo, ~US$ 3–9/mês no total (ver estimativa em [CONECTIVIDADE_PROXY](CONECTIVIDADE_PROXY.md) para a lógica de volume).
- Token é **single-use**, TTL ~5 min, atrelado a `sitekey+pageurl` — resolver e usar em seguida no POST.
- Latência: ~10–30s por solve. Aceitável numa rotina 2×/dia.
- Alternativa **instável** (sem custo): navegador real (Puppeteer não-headless) numa máquina da rede pode fazer o Turnstile "managed" passar sozinho, sem interação — mas não é confiável. O solver pago é o caminho recomendado.

---

## Fluxo completo previsto (HTTP)

```
1. GET  https://www.detran.pa.gov.br/                    → cookie veio_da_home=1
2. GET  .../indexConsultaInfracao.jsf   (com cookie)     → HTML: ViewState + action(;jsessionid)
3. Solver resolve Turnstile (sitekey 0x4AAAAAADpvM_lNoEdBJ3cR, pageurl = a .jsf) → token
4. POST <action;jsessionid>   body:
       indexForm=indexForm
       placa=<PLACA>
       renavam=<RENAVAM>
       confirma=Confirmar
       javax.faces.ViewState=<valor extraído>
       cf-turnstile-response=<token>
5. Parsear a tabela de infrações do HTML de resposta (cheerio)
```

Reaproveitar cookies/sessão entre os passos 1–4 (mesma sessão).

## Integração na arquitetura

- Novo service `backend/src/services/detran-pa.service.ts`, espelhando o contrato do `detran-ce.service.ts` (`login/consultar` → estrutura comum de infrações).
- A orquestração (`multas.service.ts`) seleciona o service pelo **estado (UF)** do veículo/dispositivo. O `Dispositivo` tem `placa/renavam/chassi`; a UF pode vir do cadastro do veículo/cliente.
- Precisa de uma env para o solver, ex. `TURNSTILE_SOLVER_API_KEY` (+ provedor). Sem ela, o PA fica indisponível (CE não é afetado).
- Reaproveita todo o resto: modelos (`VeiculoMultaSituacao`, `Multa`, `ConsultaMultaLog`, `NotificacaoMultaEnvio`), scheduler 10h/17h, notificações e telas admin/cliente.

## Pendências para fechar o PA

1. **Chave de solver de Turnstile** (2captcha/CapMonster) para resolver `0x4AAAAAADpvM_lNoEdBJ3cR`.
2. **Placa + renavam de um veículo do Pará** para validar a estrutura da **tabela de infrações** de resposta (a placa de teste do CE, `OSU6H88`, não consta na base do PA).
3. Definir de onde vem a **UF** do veículo para o roteamento CE vs PA.

## Amostras/exemplos
Guardar HTML de exemplo (form e resultado) em `docs/multas/exemplos/` quando houver uma consulta bem-sucedida, para servir de base/teste ao parser (o HTML do JSF muda pouco, mas o parser deve tolerar variações).
