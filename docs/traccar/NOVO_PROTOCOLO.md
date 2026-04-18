# Guia: Adicionar Novo Protocolo/Dispositivo GPS

Passo a passo completo para cadastrar um dispositivo GPS de protocolo diferente dos já configurados.
Baseado na experiência real com o Suntech ST300 (protocolo `suntech`, porta 5011).

---

## 1. Descobrir qual protocolo e porta o dispositivo usa

Consulte a lista oficial do Traccar:
- https://www.traccar.org/devices/ — busque pelo modelo exato
- https://www.traccar.org/traccar-server/ — lista de portas por protocolo

Exemplos de referência rápida:

| Protocolo | Porta padrão | Fabricantes/Modelos |
|---|---|---|
| GT06 | 5023 | Concox, Coban GT06N, clones chineses |
| Suntech | 5011 | ST300, ST310, ST340, ST600 |
| Teltonika | 5027 | FMB, FMC, FMM series |
| Meitrack | 5020 | MT90, T1, T333 |
| Queclink (GL200) | 5004 | GL200, GL300, GL500 |
| Topflytech | 5500 | TLD1-A, TLP1-SF |
| Ruptela | 5044 | FM-Eco4, FM-Pro4 |

> Se não souber a porta, veja na documentação do Traccar ou pesquise `traccar [modelo do dispositivo] port`.

---

## 2. Abrir a porta no firewall do servidor

No servidor via SSH:

```bash
ufw allow PORTA/tcp
ufw reload
ufw status  # confirmar que a regra foi adicionada
```

> Se o ufw estiver inativo, a regra é adicionada mas só vai valer se o firewall for ativado.
> A Hostinger também pode ter firewall próprio no painel — verificar se necessário.

---

## 3. Editar o docker-compose.yml (local)

Arquivo: `backend/docker-compose.yml`

Adicionar duas coisas no serviço `traccar`:

**a) Mapeamento de porta:**
```yaml
ports:
  - "5023:5023"   # GT06
  - "5011:5011"   # Suntech
  - "NOVA_PORTA:NOVA_PORTA"   # ← adicionar aqui
```

**b) Variável de ambiente com o nome do protocolo:**
```yaml
environment:
  - GT06_PORT=5023
  - SUNTECH_PORT=5011
  - NOME_PROTOCOLO_PORT=NOVA_PORTA   # ← adicionar aqui
```

O nome da variável segue o padrão `PROTOCOLO_PORT` em maiúsculas.
Exemplos: `TELTONIKA_PORT=5027`, `MEITRACK_PORT=5020`, `GL200_PORT=5004`.

> O Traccar usa `CONFIG_USE_ENVIRONMENT_VARIABLES=true`, então não é necessário editar XML —
> basta definir a variável de ambiente com o nome correto.

---

## 4. Commit, push e deploy

```bash
# Local
git add backend/docker-compose.yml
git commit -m "feat: expose [PROTOCOLO] protocol port [PORTA] for [MODELO] devices"
git push origin main

# Servidor
cd /opt/agillock/backend
git pull origin main
docker compose up -d --no-deps traccar
```

O `--no-deps` garante que só o container `traccar` seja recriado, sem derrubar postgres/backend/nginx.

---

## 5. Confirmar que a porta está escutando

```bash
ss -tlnp | grep NOVA_PORTA
```

Saída esperada:
```
LISTEN 0  4096  0.0.0.0:PORTA  0.0.0.0:*  users:(("docker-proxy",...))
LISTEN 0  4096     [::]:PORTA     [::]:*  users:(("docker-proxy",...))
```

Se não aparecer nada, o mapeamento não funcionou — verificar o `docker-compose.yml` e recriar o container.

---

## 6. Cadastrar o dispositivo no Traccar

Acessar o painel Traccar via túnel SSH (porta 8082 não é pública):

```powershell
# Rodar no terminal local e manter aberto
ssh -L 18082:localhost:8082 root@72.62.13.73
```

Acessar `http://localhost:18082` → Login → **Devices** → **+**

Preencher:
- **Name**: identificação do veículo/cliente
- **Identifier**: número serial ou IMEI do dispositivo (ver etiqueta no aparelho)

> O identificador deve ser **exatamente** o que o dispositivo envia. Se houver dúvida, veja os logs após a conexão.

---

## 7. Configurar o dispositivo para apontar para o servidor

Cada fabricante tem seus comandos. Geralmente via SMS para o chip do aparelho.

**Suntech ST300 (exemplo já feito):**
```
SA200CMD;{serial};{senha};01;SetIp%;72.62.13.73;5011%
SA200CMD;{serial};{senha};01;SetApn%;{apn};{user};{pass}%
```

**GT06 (já documentado em PROTOCOLOS.md):**
```
SERVER,0,72.62.13.73,5023,0#
APN,NOME_DO_APN#
```

**Teltonika:**
```
setparam 2004:72.62.13.73;2005:5027
```

> Consulte o manual do fabricante para os comandos exatos do modelo.

---

## 8. Verificar logs do Traccar

Ver logs em tempo real:

```bash
cd /opt/agillock/backend
docker compose logs -f traccar
```

Ver apenas as últimas linhas:

```bash
docker compose logs --tail=100 traccar
```

Buscar por dados de um dispositivo específico (pelo identificador):

```bash
docker compose logs traccar 2>&1 | grep "511842559"
```

Acessar o arquivo de log diretamente dentro do container:

```bash
docker exec traccar tail -f /opt/traccar/logs/tracker-server.log
```

> Os logs do `docker compose logs` mostram a saída padrão do processo.
> O arquivo `/opt/traccar/logs/tracker-server.log` dentro do container tem mais detalhes de conexão/protocolo.

---

## 9. Ativar modo debug (opcional — apenas para diagnóstico)

Se o dispositivo está conectando mas os dados não chegam corretamente,
ativar o log detalhado ajuda a ver os pacotes brutos.

Adicionar no `docker-compose.yml`:
```yaml
environment:
  - LOGGER_LEVEL=ALL
```

Recriar o container e monitorar os logs — serão exibidos os bytes enviados pelo dispositivo.
**Remover após o diagnóstico** — gera muito volume de log.

---

## 10. Checklist rápido

- [ ] Identificei o protocolo e a porta correta no site do Traccar
- [ ] Abri a porta no firewall do servidor (`ufw allow PORTA/tcp`)
- [ ] Adicionei o mapeamento de porta no `docker-compose.yml`
- [ ] Adicionei a variável `PROTOCOLO_PORT=PORTA` no `docker-compose.yml`
- [ ] Fiz commit + push + `git pull` no servidor
- [ ] Rodei `docker compose up -d --no-deps traccar`
- [ ] Confirmei que a porta está escutando com `ss -tlnp | grep PORTA`
- [ ] Cadastrei o dispositivo no painel Traccar com o identificador correto
- [ ] Configurei o dispositivo via SMS/comando para apontar para `72.62.13.73:PORTA`
- [ ] Verifiquei nos logs ou na tela de rastreamento que os dados chegaram

---

## Dispositivos já configurados neste projeto

| Dispositivo | Protocolo | Porta | Data |
|---|---|---|---|
| Coban GT06N (genérico) | GT06 | 5023 | 2026-03 |
| Suntech ST300 | suntech | 5011 | 2026-04 |
