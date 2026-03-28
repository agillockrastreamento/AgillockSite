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

## Portas dos protocolos mais comuns

| Protocolo | Porta | Fabricantes/Modelos |
|---|---|---|
| **GT06** | **5023** | Concox, Coban GT06N/GT06E, Xexun TK103-2B, muitos clones |
| GPS103 | 5001 | TK103, GPS103 genéricos |
| TK103 | 5002 | TK103 (variante) |
| H02 | 5013 | H02 genéricos |
| Teltonika | 5027 | FMB, FMC, FMM, FM series (Teltonika) |
| GL200 | 5004 | Queclink GL200, GL300, GL500 |
| Meitrack | 5020 | MT90, T1, T333, T399 |
| JT600 | 5002 | JT600, JT601, JT603 |
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
