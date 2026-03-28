# Banco de Dados do Traccar

## Visão geral

O Traccar gerencia seu próprio banco de dados, completamente separado do banco do AgilLock. As migrações são feitas automaticamente via **Liquibase** na inicialização do servidor.

**Bancos suportados:**
- **H2** (embutido) — apenas desenvolvimento/testes
- **MySQL 8+** — produção (menor escala)
- **PostgreSQL** — produção
- **TimescaleDB** — produção com grande volume (extensão do PostgreSQL otimizada para time-series)
- **Microsoft SQL Server** — produção enterprise

---

## Tabelas principais

### `tc_devices` — Dispositivos cadastrados

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INT PK | ID interno do Traccar |
| `name` | VARCHAR | Nome descritivo do veículo |
| `uniqueid` | VARCHAR | IMEI do aparelho (identificador único) |
| `status` | VARCHAR | `online` / `offline` / `unknown` |
| `lastupdate` | TIMESTAMP | Último contato |
| `positionid` | INT FK | ID da última posição registrada |
| `groupid` | INT FK | Grupo ao qual pertence (opcional) |
| `model` | VARCHAR | Modelo do dispositivo |
| `contact` | VARCHAR | Contato responsável |
| `phone` | VARCHAR | Telefone do chip |
| `category` | VARCHAR | Categoria: `car`, `motorcycle`, `truck`, etc. |
| `disabled` | BOOLEAN | Dispositivo desativado |
| `attributes` | TEXT (JSON) | Atributos personalizados |

### `tc_positions` — Histórico de posições (tabela maior)

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INT PK | ID da posição |
| `deviceid` | INT FK | Referência ao `tc_devices.id` |
| `servertime` | TIMESTAMP | Quando chegou ao servidor |
| `devicetime` | TIMESTAMP | Horário no dispositivo |
| `fixtime` | TIMESTAMP | Horário do fix GPS |
| `valid` | BOOLEAN | Posição com fix GPS válido |
| `latitude` | DOUBLE | Latitude decimal |
| `longitude` | DOUBLE | Longitude decimal |
| `altitude` | FLOAT | Altitude em metros |
| `speed` | FLOAT | Velocidade em **knots** (multiplicar por 1.852 para km/h) |
| `course` | FLOAT | Direção em graus (0-360) |
| `address` | VARCHAR | Endereço (geocodificação reversa, se configurada) |
| `attributes` | TEXT (JSON) | Atributos extras: ignição, bateria, alarmes, etc. |
| `accuracy` | DOUBLE | Precisão em metros |
| `network` | TEXT (JSON) | Dados de rede celular |
| `outdated` | BOOLEAN | Se a posição é antiga |

> Esta é a tabela com maior crescimento. Em produção, considerar particionamento ou TimescaleDB.

### `tc_users` — Usuários do Traccar

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INT PK | ID do usuário |
| `name` | VARCHAR | Nome |
| `email` | VARCHAR | E-mail (login) |
| `hashedpassword` | VARCHAR | Senha hasheada (bcrypt) |
| `administrator` | BOOLEAN | É administrador? |
| `disabled` | BOOLEAN | Conta desativada |
| `expirationtime` | TIMESTAMP | Expiração da conta |
| `readonly` | BOOLEAN | Somente leitura |
| `devicelimit` | INT | Limite de dispositivos (-1 = ilimitado) |

### `tc_events` — Eventos registrados

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INT PK | ID do evento |
| `deviceid` | INT FK | Dispositivo que gerou o evento |
| `positionid` | INT FK | Posição onde ocorreu |
| `servertime` | TIMESTAMP | Quando chegou ao servidor |
| `type` | VARCHAR | Tipo: `deviceOnline`, `geofenceEnter`, `ignitionOn`, etc. |
| `attributes` | TEXT (JSON) | Dados extras do evento |

### `tc_geofences` — Cercas virtuais

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INT PK | ID da geofence |
| `name` | VARCHAR | Nome da cerca |
| `description` | VARCHAR | Descrição |
| `area` | TEXT | Definição geométrica (WKT: `CIRCLE(lat lng radius)` ou `POLYGON(...)`) |
| `attributes` | TEXT (JSON) | Configurações extras |

### `tc_groups` — Grupos de dispositivos

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INT PK | ID do grupo |
| `name` | VARCHAR | Nome (ex: "Frota São Paulo") |
| `groupid` | INT FK | Grupo pai (hierarquia) |
| `attributes` | TEXT (JSON) | Atributos |

### `tc_notifications` — Configurações de alertas

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INT PK | ID da notificação |
| `userid` | INT FK | Usuário destinatário |
| `type` | VARCHAR | Tipo de evento a notificar |
| `web` | BOOLEAN | Notificar via web |
| `mail` | BOOLEAN | Notificar via e-mail |
| `sms` | BOOLEAN | Notificar via SMS |

### Tabelas de relacionamento (many-to-many)

| Tabela | Relacionamento |
|---|---|
| `tc_user_device` | Usuário ↔ Dispositivo |
| `tc_user_group` | Usuário ↔ Grupo |
| `tc_user_geofence` | Usuário ↔ Geofence |
| `tc_device_geofence` | Dispositivo ↔ Geofence |
| `tc_group_geofence` | Grupo ↔ Geofence |

---

## Relação entre bancos: Traccar vs AgilLock

Os dois bancos são completamente independentes. A integração é feita via API, não via JOIN de banco.

```
Banco AgilLock (Prisma)          Banco Traccar
─────────────────────            ───────────────────
Placa                            tc_devices
  id (AgilLock)         ←→         id (Traccar)
  traccarDeviceId ──────────────→   uniqueId (IMEI)
  clienteId
  ...
```

**Estratégia de vinculação:**
- Na tabela `Placa` do AgilLock, adicionar campo `traccarDeviceId` (INT) que guarda o `id` do dispositivo no Traccar.
- Ao cadastrar uma placa no AgilLock, o admin também registra o dispositivo no Traccar (via API) e salva o ID retornado.

```sql
-- Migration Prisma a ser criada
ALTER TABLE Placa ADD COLUMN traccarDeviceId INT;
```

---

## Configuração MySQL para produção

```sql
-- Criar banco e usuário no MySQL
CREATE DATABASE traccar CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'traccar'@'%' IDENTIFIED BY 'senha_segura';
GRANT ALL PRIVILEGES ON traccar.* TO 'traccar'@'%';
FLUSH PRIVILEGES;
```

> O banco deve ser criado **vazio**. O Traccar cria todas as tabelas automaticamente.
> Engine obrigatória: **InnoDB** (MyISAM não suporta as foreign keys usadas pelo Traccar).

---

## Considerações de performance

| Volume | Recomendação |
|---|---|
| < 50 dispositivos | H2 (desenvolvimento) ou MySQL |
| 50-500 dispositivos | MySQL com índices adequados |
| > 500 dispositivos | PostgreSQL + TimescaleDB |

**Índices importantes em `tc_positions`:**
```sql
-- Já criados pelo Traccar, mas relevante saber:
INDEX idx_positions_deviceid (deviceid)
INDEX idx_positions_fixtime (fixtime)
INDEX idx_positions_deviceid_fixtime (deviceid, fixtime)
```

**Limpeza automática de posições antigas:**
```xml
<!-- traccar.xml — limpar posições com mais de 365 dias -->
<entry key='database.positionsHistoryDays'>365</entry>
```
