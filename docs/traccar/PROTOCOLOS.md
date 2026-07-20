# Protocolos GPS e Configuração de Dispositivos

## Como funciona a conexão do dispositivo

Os aparelhos GPS **não usam HTTP**. Eles se comunicam via **TCP/UDP** usando protocolos binários proprietários, cada fabricante com o seu. O Traccar conhece +200 desses protocolos e escuta em portas separadas para cada um.

```
Aparelho GT06
    |
    | 1. Obtém IP via SIM card (4G/2G)
    | 2. Conecta TCP no IP_SERVIDOR:5023
    | 3. Envia pacote binário com IMEI + dados
    |
    ↓
Traccar (escuta na porta 5023)
    |
    | 4. Decodifica o protocolo GT06
    | 5. Identifica o dispositivo pelo IMEI
    | 6. Salva posição no banco
```

---

## Portas abertas na nossa instância

Estas são as portas expostas em `backend/docker-compose.yml`. A lista de modelos vem da
[tabela oficial de dispositivos suportados do Traccar](https://www.traccar.org/devices/)
(conferida em 2026-07-20) — só entram aqui os modelos que caem nas portas que abrimos.

| Porta | Protocolo (nome interno no Traccar) | Modelos suportados |
|---|---|---|
| **5001** | `gps103` | **STG T10**, GPS-103, GPS-103-A, GPS102, GPS102B, GPS104, GPS105B, 306A, A306, TW-MD1101, TK-102B, TK303B, TK303G, Coban GPS106, GPS107, GPS301, GPS302, GPS303, GPS303-G, GPS304, GPS305, GPS306, Coban 303F |
| **5011** | `suntech` | ST200, ST210, ST215, ST215I, ST215E, ST230, ST240, ST410, ST900, ST910, ST-910, ST-940 |
| **5023** | `gt06` | GT06N, GT06D, GT09, GT100, GS503, ET100, JM01, JM08, IB-GT102, CRX1, JV200, Heacent 908, Concox GT03/GT03A/GT03B, GT07, GT02D, GK301, GK503, CRX3 (+ dezenas de clones) |
| **5058** | `khd` | **STG T100**, KG100, KG200, KG300, KC200, VT600, VT600X, VT800, VT900X, AL900, AL-900E, TFB-303, T360-101A, T360-101P, T360-101E, T360-103, T360-106, T360-108, T360-269, T360-269B, T360-269JT |
| **5087** | `mxt` (Maxtrack) | MXT-100, MXT-101, MXT-140, MXT-141, MXT-142, MX-100, i-MXT, MTC-700, MTC-780, IDP-780, TD-50, TD-60, WT-110, G-100 |
| **5207** | `pst` (Positron) | PST |
| **5216** | `mobilogix` | MT2000, MT2000S, MT4x00, BAT-M1, BAT-X |
| 5055 | `osmand` | App OsmAnd / Traccar Client (não exposto publicamente) |

> ⚠️ **Atenção aos apelidos das variáveis de ambiente.** No `docker-compose.yml` usamos
> `TK_PORT`, `SGT_PORT`, `MAXTRACK_PORT` e `POSITRON_PORT`, mas o Traccar só reconhece
> `<PROTOCOLO>_PORT` com o **nome interno** do protocolo — ou seja, `GPS103_PORT`,
> `KHD_PORT`, `MXT_PORT` e `PST_PORT`. Hoje isso não quebra nada porque os valores que
> passamos são exatamente as portas padrão desses protocolos, mas **mudar o número na
> variável errada não terá efeito**.

> ⚠️ **STG T10 ≠ STG T100.** Mesma marca (Singapore Technology Group, Blumenau/SC),
> ODMs diferentes. O **T100** aparece na lista oficial do Traccar como `khd`/**5058**;
> o **T10 não está na lista oficial**, mas o manual (v2.2, 09/2020) mostra o conjunto
> de comandos SMS do Coban/GPS103 (`begin123456`, `admin123456`, `apn123456`,
> `adminip123456 IP PORT`, `check123456`), então ele vai na **5001**. Não assuma a
> porta pela marca — confira o dialeto dos comandos SMS no manual do modelo.

### Outras portas comuns (não abertas aqui)

| Protocolo | Porta | Fabricantes/Modelos |
|---|---|---|
| TK103 | 5002 | TK103 (variante), JT600/JT601/JT603 |
| H02 | 5013 | H02 genéricos |
| Teltonika | 5027 | FMB, FMC, FMM, FM series |
| GL200 | 5004 | Queclink GL200, GL300, GL500 |
| Meitrack | 5020 | MT90, T1, T333, T399 |
| Watch | 5093 | Relógios GPS infantis/idosos |

> Para abrir todas as portas ao mesmo tempo no Docker: `-p 5000-5300:5000-5300` (não recomendado em produção — abrir apenas as necessárias)

---

## Protocolo GT06 — Configuração do dispositivo

### Identificar seu dispositivo

O protocolo GT06 é usado por **dezenas de modelos** de fabricantes diferentes (Concox, Coban, e muitos genéricos chineses). Os comandos de configuração são enviados por **SMS** para o chip do aparelho.

### Comandos SMS de configuração (GT06N / compatíveis)

**1. Configurar o APN da operadora** (necessário para acesso à internet)
```
APN,NOME_DO_APN#
```
Exemplos por operadora:
- Vivo: `APN,zap.vivo.com.br#`
- Claro: `APN,claro.com.br#`
- TIM: `APN,timbrasil.com.br#`
- Oi: `APN,gprs.oi.com.br#`

**2. Configurar o servidor Traccar**
```
SERVER,0,IP_OU_DOMINIO,5023,0#
```
Exemplo com IP local (testes):
```
SERVER,0,SEU_IP_LOCAL,5023,0#
```
Exemplo com domínio (produção):
```
SERVER,0,rastreamento.agillock.com.br,5023,0#
```

**3. Verificar configurações atuais**
```
PARAM#
```

**4. Reiniciar o dispositivo**
```
RESET#
```

**5. Intervalo de envio (em segundos)**
```
TIMER,30#   ← envia posição a cada 30 segundos
```

> Atenção: os comandos exatos variam por modelo. Alguns usam senha antes do comando: `[SENHA]APN,nome#`. A senha padrão geralmente é `123456` ou `000000`.

---

## Protocolo GPS103 — STG T10 (porta 5001)

Fonte: manual oficial "Manual STG T10 Versão 2.2" (09/2020), Singapore Technology Group.
Senha padrão: **123456** (colada no próprio comando, sem espaço).

### Sequência mínima de configuração

```
apn123456 APN,USER,PSW          ← ex.: apn123456 tim.br,tim,tim
adminip123456 IP PORT           ← ex.: adminip123456 1.2.3.4 5001
```

> Alguns firmwares GPS103 só aceitam **IP** no `adminip`, não domínio. Se o aparelho
> não conectar, use o IP direto do servidor.

### Demais comandos

| Função | Comando |
|---|---|
| Inicializar configuração de fábrica | `begin123456` |
| Verificar status | `check123456` |
| Bloquear veículo | `DY123456 1` |
| Desbloquear veículo | `TY123456 1` |
| Definir número central | `centernum123456 NUMERO` |
| Cancelar número central | `centernum123456` |
| Número de autorização | `admin123456 NUMERO` / `noadmin123456 NUMERO` |
| Alarme de corte de energia | `extpower123456 1` (liga) / `extpower123456 0` (desliga) |
| Fuso horário | `timezone123456 FUSO` — fuso **multiplicado por 60** (Brasília: `-180`) |
| Intervalo de envio | `ITV123456 SEGUNDOS` |
| Alarme de velocidade | `speed123456 80` / `speed123456 0` (cancela) |
| Alarme de ignição | `ACC123456 1` / `ACC123456 0` |
| Nível de vibração | `vibrate123456 1\|2\|3` / `vibrate123456 0` (cancela) |
| Alarme por SMS / por chamada | `KC123456 1` / `KC123456 2` |
| Sleep mode do GPS | `Allgps123456 0` (ativa) / `Allgps123456 1` (cancela) |
| Alterar senha | `password123456 NOVA_SENHA` |

### Notas de hardware

- Chicote de 4 vias: **1 VCC** (vermelho, 9–32 Vdc), **2 GND** (preto),
  **3 Saída/Out1** (amarelo, bloqueio — aciona o relê com negativo),
  **4 Pós-chave** (verde, entrada de ignição por positivo).
- Relé de bloqueio recomendado (NF): 12 Vdc / 40 A para carros e caminhões; 12 Vdc / 10 A para motos.
- Entra em **sleep após 3 min** sem movimento (todos os LEDs apagam); acorda com vibração.
- LEDs: vermelho = alimentação, verde = GSM/GPRS, azul = GPS. Piscando = procurando; aceso = conectado.
- Todos os alarmes são enviados **apenas para o número central**.

---

## Como registrar o dispositivo no Traccar

Após subir o servidor Traccar:

1. Acessar `http://localhost:8082`
2. Login com a conta admin
3. Menu lateral → **Devices** → botão **+**
4. Preencher:
   - **Name**: Nome do veículo/cliente (ex: "Fiat Uno - João Silva")
   - **Identifier**: IMEI do aparelho (número de 15 dígitos, impresso no dispositivo)
5. Salvar

O dispositivo aparecerá como **offline** até que o aparelho se conecte.

---

## Identificando qual protocolo seu dispositivo usa

Se você não tem certeza do protocolo, o Traccar tem uma ferramenta de identificação:

1. Configurar o dispositivo para se conectar ao Traccar (qualquer porta, ex: 5023)
2. Verificar os logs do Traccar: `docker-compose logs traccar | grep "connected"`
3. O log vai mostrar qual protocolo foi detectado e o IMEI

Alternativamente, ativar o modo de debug nos logs para ver os pacotes brutos:
```xml
<!-- traccar.xml — adicionar para debug -->
<entry key='logger.level'>ALL</entry>
```

---

## Teste local sem dispositivo físico

Para testar a integração sem ter o aparelho em mãos, é possível simular o envio de posições via ferramenta de linha de comando ou script. Isso será documentado em [INTEGRACAO_BACKEND.md](./INTEGRACAO_BACKEND.md).

---

## Atributos extras enviados pelo GT06

Dependendo do modelo e firmware, o GT06 pode enviar dados adicionais além da posição:

| Atributo | Chave no JSON | Descrição |
|---|---|---|
| Ignição | `ignition` | `true` / `false` — chave ligada/desligada |
| Movimento | `motion` | `true` / `false` |
| Sinal GSM | `rssi` | Intensidade do sinal em dBm |
| Satélites | `sat` | Número de satélites GPS capturados |
| Bateria | `power` | Tensão da bateria/veículo em Volts |
| Alarme | `alarm` | Tipo de alarme (vibration, sos, powerCut, etc.) |
| Odômetro | `totalDistance` | Distância total acumulada em metros |

---

## Velocidade: conversão de unidades

O Traccar armazena velocidade em **knots (nós)**. Para exibir em km/h no frontend:

```javascript
const kmh = position.speed * 1.852;
```

---

## Troubleshooting de conexão

| Problema | Causa provável | Solução |
|---|---|---|
| Dispositivo não aparece online | APN errado | Verificar APN da operadora no SMS |
| Dispositivo não aparece online | IP/porta errado | Verificar comando `SERVER,0,...` |
| Dispositivo não aparece online | Firewall bloqueando | Abrir porta 5023 TCP no servidor/router |
| Posições não chegam | Sem sinal GPS | Testar em área aberta |
| Posições com coordenadas zeradas | Filtro habilitado | Verificar `filter.zero=true` no traccar.xml |
| IMEI não reconhecido | UniqueId errado | Verificar IMEI no dispositivo — pode ser diferente do que aparece nos logs |
