# Referências Reutilizadas pelo App

Atualizado em: 2026-05-04

Este documento lista as partes da documentação existente que devem ser usadas na implementação do app React Native Expo. A coluna `Parágrafo/seção` usa o título que aparece no documento original.

## Projeto

| Uso no app | Parágrafo/seção | Onde encontra |
|---|---|---|
| Visão do portal cliente e JWT | `Visão geral` | `docs/projeto/PORTAL_CLIENTE.md` |
| Login do app | `Login do cliente` | `docs/projeto/PORTAL_CLIENTE.md` |
| Perfil, avatar e veículos associados | `Perfil e Avatar (App Mobile)` | `docs/projeto/PORTAL_CLIENTE.md` |
| Snapshot e preferências do mapa | `Rastreamento` | `docs/projeto/PORTAL_CLIENTE.md` |
| Regra de bloqueio por boleto atrasado | `Bloqueio por inadimplência` | `docs/projeto/PORTAL_CLIENTE.md` |
| Relatório e exportação | `Histórico e relatórios` | `docs/projeto/PORTAL_CLIENTE.md` |
| Upload da foto do veículo | `Foto do veículo` | `docs/projeto/PORTAL_CLIENTE.md` |
| Comandos sensíveis | `Comandos` | `docs/projeto/PORTAL_CLIENTE.md` |
| Boletos no app | `Pagamentos` | `docs/projeto/PORTAL_CLIENTE.md` |
| Geocercas do cliente | `Geocercas` | `docs/projeto/PORTAL_CLIENTE.md` |
| Preferências e eventos de notificação | `Notificações` | `docs/projeto/PORTAL_CLIENTE.md` |
| Registro de token Expo | `Notificações` | `docs/projeto/PORTAL_CLIENTE.md` |
| WebSocket no app | `WebSocket no app` | `docs/projeto/PORTAL_CLIENTE.md` |
| Plano geral de telas mobile | `Observações para o plano mobile` | `docs/projeto/PORTAL_CLIENTE.md` |
| Rotas REST do app | `Portal do cliente e app mobile` | `docs/projeto/API.md` |
| Rotas de geocercas do cliente | `Geocercas do cliente` | `docs/projeto/API.md` |
| Rotas de notificações do cliente | `Notificações do cliente` | `docs/projeto/API.md` |
| Rotas de manutenções, caso sejam adicionadas ao app | `Manutenções do cliente` | `docs/projeto/API.md` |
| Limites e campos de upload | `Uploads` | `docs/projeto/API.md` |
| Ordem de carregamento e segurança de comandos | `Observações para o app mobile` | `docs/projeto/API.md` |
| Modelos de banco para cliente, login, avatar, dispositivos e notificações | `ClienteLogin`, `Dispositivo`, `DispositivoCliente`, `EventoNotificacao`, `PreferenciaNotificacao` | `docs/projeto/DATABASE.md` |
| Arquitetura geral do backend e frontend | `Visão geral` e documentos de arquitetura | `docs/projeto/ARQUITETURA.md` |
| Pagamentos/EFI quando abrir boleto ou exibir estados financeiros | Seções sobre EFI e boletos | `docs/projeto/EFI.md` |

## Traccar

| Uso no app | Parágrafo/seção | Onde encontra |
|---|---|---|
| Regra de não acessar Traccar diretamente | `Papel do Traccar` | `docs/traccar/README.md` |
| Pontos principais do mobile | `Pontos importantes para o app mobile` | `docs/traccar/README.md` |
| Diferenças entre admin e cliente/app | `Diferenças em relação ao admin` | `docs/traccar/PORTAL_CLIENTE.md` |
| Sequência de login, status, snapshot e WebSocket | `Fluxo recomendado` | `docs/traccar/PORTAL_CLIENTE.md` |
| Campos do snapshot usado no mapa | `Snapshot` | `docs/traccar/PORTAL_CLIENTE.md` |
| Bloqueio financeiro no rastreamento | `Bloqueio por inadimplência` | `docs/traccar/PORTAL_CLIENTE.md` |
| Histórico, viagens, paradas, eventos e resumo | `Histórico, viagens, paradas, eventos e resumo` | `docs/traccar/PORTAL_CLIENTE.md` |
| Relatórios e exportação XLSX | `Relatórios em lote` | `docs/traccar/PORTAL_CLIENTE.md` |
| Upload de foto exibida nos cards | `Foto do veículo` | `docs/traccar/PORTAL_CLIENTE.md` |
| Comandos do dispositivo | `Comandos` | `docs/traccar/PORTAL_CLIENTE.md` |
| Geocercas visíveis e gerenciáveis pelo cliente | `Geocercas` | `docs/traccar/PORTAL_CLIENTE.md` |
| Mensagens de tempo real | `WebSocket` | `docs/traccar/PORTAL_CLIENTE.md` |
| Push via Expo | `Push notification no mobile` | `docs/traccar/PORTAL_CLIENTE.md` |
| Bases REST e WebSocket | `Bases` | `docs/traccar/API.md` |
| IDs locais e IDs Traccar | `Identificadores` | `docs/traccar/API.md` |
| Acesso cliente/app filtrado | `Autenticação e acesso` | `docs/traccar/API.md` |
| Modelo normalizado da posição | `Modelo de posição normalizada` | `docs/traccar/API.md` |
| Snapshot do app | `Cliente/app - snapshot` | `docs/traccar/API.md` |
| Reverse geocode do app | `Reverse geocode` | `docs/traccar/API.md` |
| Contratos de histórico e relatórios | `Histórico`, `Viagens`, `Paradas`, `Eventos`, `Resumo` | `docs/traccar/API.md` |
| Fluxo REST backend-Traccar | `Fluxo REST` | `docs/traccar/INTEGRACAO_BACKEND.md` |
| Fluxo WebSocket e filtro por cliente | `Fluxo WebSocket` | `docs/traccar/INTEGRACAO_BACKEND.md` |
| Normalização de telemetria | `Normalização de telemetria` | `docs/traccar/INTEGRACAO_BACKEND.md` |
| Geocercas integradas com Traccar | `Geocercas` | `docs/traccar/INTEGRACAO_BACKEND.md` |
| Eventos persistidos e preferências | `Eventos e notificações` | `docs/traccar/INTEGRACAO_BACKEND.md` |
| Rotas expostas para app | `Rotas expostas pelo backend` | `docs/traccar/INTEGRACAO_BACKEND.md` |

## Site Cliente

| Uso no app | Fonte | Onde encontra |
|---|---|---|
| Login visual e logo | Página de login do cliente | `AgillockSite/cliente/login.html` |
| Logo usada no login | Asset | `AgillockSite/img/logo_agillock_new.png` |
| Símbolo reduzido do drawer e splash animada | Asset | `AgillockSite/img/agillock_new_symbol.png` |
| Tela de mapa base | HTML cliente | `AgillockSite/cliente/rastreamento.html` |
| Comportamento do mapa cliente | JS cliente | `AgillockSite/js/rastreamento-cliente.js` |
| Cards, preferências, eventos no mapa | CSS/HTML/JS da tela de rastreamento | `AgillockSite/cliente/rastreamento.html` e `AgillockSite/js/rastreamento-cliente.js` |
| Ícones SVG 3D de veículos | `window.AL_ICONS_3D` | `AgillockSite/js/config.js` |
| Tela de relatórios | HTML/JS cliente | `AgillockSite/cliente/relatorio.html` e `AgillockSite/js/relatorio-cliente.js` |
| Tela de notificações | HTML/JS cliente | `AgillockSite/cliente/notificacoes.html` e `AgillockSite/js/notificacoes-cliente.js` |
| Tela de geocercas | HTML/JS cliente | `AgillockSite/cliente/geocercas.html` e `AgillockSite/js/geocercas-cliente.js` |
| Tela de pagamentos | HTML cliente | `AgillockSite/cliente/pagamentos.html` |

## Backend

| Uso no app | Fonte | Onde encontra |
|---|---|---|
| Registro das rotas do cliente | `app.use('/api/cliente/perfil', ...)` e `app.use('/api/cliente', ...)` | `backend/src/app.ts` |
| Perfil e avatar | Rotas `GET /api/cliente/perfil` e `POST /api/cliente/perfil/avatar` | `backend/src/routes/cliente-perfil.routes.ts` |
| Login cliente | Rotas `POST /api/auth/login` e `POST /api/auth/cliente` | `backend/src/routes/auth.routes.ts` |
| Rastreamento cliente, geocercas, foto, boletos e relatórios | Rotas `/api/cliente/*` | `backend/src/routes/cliente-portal.routes.ts` |
| Notificações do cliente e tokens Expo | Rotas `/api/cliente/notificacoes/*` | `backend/src/routes/notificacoes.routes.ts` |
| WebSocket de rastreamento | Bridge Traccar para clientes | `backend/src/services/traccar.ws.ts` |

## Bibliotecas do App

| Uso no app | Fonte | Onde encontra |
|---|---|---|
| Inputs com label animada/floating label | `TextInput` do React Native Paper | `https://oss.callstack.com/react-native-paper/docs/components/TextInput/` |
| Provider e tema Material | `PaperProvider` e tema MD3 | Documentação oficial do `react-native-paper` |
| Wrapper local de inputs | `AppTextInput` | `app/src/components/AppTextInput.tsx` |
| Tema local do Paper | `paperTheme` | `app/src/theme/paperTheme.ts` |
| Sessão do app | `AuthProvider`, `authService`, `sessionStorage` | `app/src/auth/` |
| Notificações Expo | `NotificationBootstrap`, `pushTokenService`, `pushTokenStorage` | `app/src/notifications/` |

## Observações de implementação

- O app deve consumir o backend AgilLock, não o Traccar diretamente.
- `deviceId` em rotas de relatório do cliente é o `dispositivoId` local.
- `deviceId` em mensagens WebSocket é o `traccarId`.
- `imagemUrlCliente` é a foto do veículo enviada pelo cliente; `avatarUrl` é a foto do usuário.
- Push mobile usa Expo, sem Firebase.
- A configuração de ícones SVG fica em `AgillockSite/js/config.js` e deve ser portada para React Native.
- Inputs devem usar `react-native-paper` por meio do wrapper local `AppTextInput`.
