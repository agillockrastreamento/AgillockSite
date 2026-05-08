# Roadmap do App Cliente

Atualizado em: 2026-05-05

Roadmap de implementação do app React Native Expo Android/iOS exclusivo para cliente. Cada etapa aponta para a documentação existente que deve ser usada como fonte de contrato e comportamento.

## Fase 0 - Preparação (Implementada)

Objetivo: iniciar o app com base técnica estável.

Entregas:

- Criar projeto Expo com TypeScript.
- Configurar navegação com stack e drawer.
- Configurar tema claro único.
- Configurar cliente HTTP com base `/api`.
- Configurar storage seguro para JWT.
- Configurar `react-native-paper` com `PaperProvider`, tema claro AgilLock e wrapper `AppTextInput`.
- Configurar splash animada inicial com `AgillockSite/img/agillock_new_symbol.png`.
- Configurar toast centralizado global para feedback não bloqueante.
- Configurar modal universal de confirmação para substituir qualquer uso de `Alert.alert`.
- Configurar `babel.config.js` com `react-native-reanimated/plugin` para o drawer.
- Fixar `react-native-worklets@0.5.1`, versão esperada pelo Expo SDK 54 no Expo Go.
- Manter `newArchEnabled: true` no SDK 54 para compatibilidade com Expo Go e Reanimated 4.
- Importar `react-native-gesture-handler` no entrypoint `index.ts`.
- Preparar ambientes local, homologação e produção.

Critério de saída:

- App abre em Android/iOS.
- Navegação básica funciona.
- Configuração de API troca por ambiente.
- `react-native-paper` renderiza inputs com tema AgilLock e label animada.
- Telas usam `AppTextInput` em vez de `TextInput` direto para campos comuns.
- Splash animada aparece no boot e libera a navegação.
- Toast centralizado pode ser acionado.
- Modal universal de confirmação pode ser acionado.
- Nenhuma tela usa `Alert.alert`.

Referências:

| Uso | Parágrafo/seção | Onde encontra |
|---|---|---|
| Bases REST e WebSocket | `Bases` | `docs/traccar/API.md` |
| Arquitetura geral | `Visão geral` | `docs/projeto/ARQUITETURA.md` |
| Contratos base do app | `Portal do cliente e app mobile` | `docs/projeto/API.md` |
| Símbolo da splash/drawer | Asset `agillock_new_symbol.png` | `AgillockSite/img/agillock_new_symbol.png` |
| Inputs do app | `TextInput` com label animada | Documentação oficial do `react-native-paper` |

## Fase 1 - Autenticação e sessão (Implementada)

Objetivo: permitir login apenas de cliente e manter sessão segura.

Entregas:

- Tela de login baseada no site cliente.
- Logo `AgillockSite/img/logo_agillock_new.png`.
- Fundo e área da logo alinhados ao login web.
- Campo de senha com ação de visualizar/ocultar.
- Rodapé `© 2026 AgilLock — Gestão de Rastreamento`.
- Chamada `POST /api/auth/login`.
- Validação obrigatória de `user.role === "CLIENTE"`.
- Persistência do JWT em `expo-secure-store`.
- Persistência do usuário cliente em storage local para restauração da sessão.
- Autenticação Biométrica (Face ID / Touch ID) após o primeiro login, disparada automaticamente após o splash.
- Registro do Expo Push Token no backend após login quando o token já estiver disponível.
- Logout com limpeza de token e usuário local, incluindo tentativa de remoção do token Expo no backend.

Critério de saída:

- Cliente válido entra no app.
- Usuários admin, colaborador e vendedor são recusados.
- Sessão é restaurada ao reabrir o app.
- Autenticação Biométrica é exibida automaticamente após carregar caso o cliente tenha salvo as credenciais em um acesso prévio com senha, aguardando o fim da animação da tela de splash.
- Botão "Acessar com Biometria / Face ID" sempre disponível na tela de login, caso o hardware suporte.
- Logout limpa sessão local e retorna para a tela de login.
- Após login, o app tenta registrar o Expo Push Token salvo em `/api/cliente/notificacoes/app-tokens`.
- No Android, o canal de notificação `default` é configurado antes do pedido de permissão.

Referências:

| Uso | Parágrafo/seção | Onde encontra |
|---|---|---|
| Login do cliente | `Login do cliente` | `docs/projeto/PORTAL_CLIENTE.md` |
| Payload JWT do cliente | `Visão geral` | `docs/projeto/PORTAL_CLIENTE.md` |
| Rotas de autenticação | `Autenticação` | `docs/projeto/API.md` |
| Tela visual base | Página de login do cliente | `AgillockSite/cliente/login.html` |
| Serviço de login do app | `loginCliente` | `app/src/auth/authService.ts` |
| Provider de sessão | `AuthProvider` | `app/src/auth/AuthProvider.tsx` |
| Storage da sessão | `sessionStorage` | `app/src/auth/sessionStorage.ts` |
| Registro de push token após login | `ensureExpoPushTokenRegistered` | `app/src/notifications/pushTokenService.ts` |

## Fase 2 - Shell do app, drawer e perfil (Implementada)

Objetivo: implementar a estrutura autenticada comum.

Entregas:

- Topbar em todas as telas com drawer à esquerda e título centralizado.
- Drawer com símbolo `AgillockSite/img/agillock_new_symbol.png`.
- Links: Mapa, Relatório, Notificações, Geocercas e Pagamentos.
- Avatar no drawer.
- Bottom sheet de perfil ao tocar no avatar, ocupando 80% da tela, com animação, toque fora e arraste para fechar.
- Upload de avatar.
- Dados do perfil e listas de veículos de faturamento/responsável e vinculados.
- Botão Sair abaixo do avatar.

Critério de saída:

- Todas as telas autenticadas compartilham topbar/drawer.
- Perfil carrega dados reais da API.
- Upload troca avatar e atualiza drawer.

Implementação atual:

- `app/src/navigation/AppNavigator.tsx`: drawer autenticado, topbar centralizada e ações de Mapa/Relatório.
- `app/src/components/BottomSheet.tsx`: componente reutilizável para bottom sheets do app.
- `app/src/profile/ProfileModal.tsx`: bottom sheet de perfil com avatar, dados, CPF/CNPJ mascarado e listas de veículos.
- `app/src/profile/profileService.ts`: chamadas `GET /cliente/perfil` e `POST /cliente/perfil/avatar`.
- `app/src/profile/profileTypes.ts`: contratos do perfil no app.
- `backend/src/routes/cliente-perfil.routes.ts`: usa `clienteAuthMiddleware`, compatível com JWT do app cliente.
- `expo-image-picker`: seleção de imagem para upload do avatar.

Referências:

| Uso | Parágrafo/seção | Onde encontra |
|---|---|---|
| Perfil e avatar | `Perfil e Avatar (App Mobile)` | `docs/projeto/PORTAL_CLIENTE.md` |
| Endpoint de perfil | Rotas `GET /api/cliente/perfil` e `POST /api/cliente/perfil/avatar` | `backend/src/routes/cliente-perfil.routes.ts` |
| Limites de upload | `Uploads` | `docs/projeto/API.md` |
| Navegação esperada | `Observações para o plano mobile` | `docs/projeto/PORTAL_CLIENTE.md` |

## Fase 3 - Mapa base e snapshot (Implementada)

Objetivo: entregar a primeira tela logada com dispositivos do cliente.

Entregas:

- Tela Mapa como primeira tela após login.
- `react-native-maps` com `PROVIDER_GOOGLE`.
- Chamada `GET /api/cliente/rastreamento/status-acesso`.
- Chamada `GET /api/cliente/rastreamento/posicoes`.
- Estado de bloqueio por inadimplência.
- Índice `traccarId -> dispositivoId`.
- Marcadores dos dispositivos.
- Foco no dispositivo ao tocar marcador.
- Botões compactos sobre o mapa: tipo de mapa, camadas, localização e preferências.

Critério de saída:

- Mapa renderiza em Android/iOS.
- Snapshot aparece com dispositivos corretos do cliente.
- Cliente bloqueado vê estado de bloqueio e não acessa rastreamento.

Implementação atual:

- `app/src/screens/MapScreen.tsx`: tela de mapa com `react-native-maps`, `PROVIDER_GOOGLE`, marcadores, foco e painel rápido inicial.
- `app/src/tracking/trackingService.ts`: chamadas `GET /cliente/rastreamento/status-acesso` e `GET /cliente/rastreamento/posicoes`.
- `app/src/tracking/trackingTypes.ts`: contratos do snapshot e índice `traccarId -> dispositivoId`.
- `expo-location`: centraliza a posição atual do aparelho pelo botão de localização.
- Marcadores usam renderização simples nesta fase; ícones SVG 3D e cards completos ficam para a Fase 4.

Referências:

| Uso | Parágrafo/seção | Onde encontra |
|---|---|---|
| Fluxo inicial do app | `Fluxo recomendado` | `docs/traccar/PORTAL_CLIENTE.md` |
| Snapshot cliente/app | `Snapshot` | `docs/traccar/PORTAL_CLIENTE.md` |
| Campos do snapshot | `Cliente/app - snapshot` | `docs/traccar/API.md` |
| Bloqueio financeiro | `Bloqueio por inadimplência` | `docs/traccar/PORTAL_CLIENTE.md` |
| Preferências do mapa | `Rastreamento` | `docs/projeto/PORTAL_CLIENTE.md` |

## Fase 4 - Ícones SVG 3D e cards do mapa (Implementada)

Objetivo: portar a experiência visual dos veículos para mobile.

Entregas:

- Portar `window.AL_ICONS_3D` para TypeScript.
- Renderizar ícones com `react-native-svg`.
- Usar categoria, cor e curso/heading nos marcadores.
- Bottom Sheet inferior com cards rápidos em estados fechado, 30% e 50%.
- Animação de abrir/fechar por toque no puxador e arraste vertical.
- Ícone de câmera visível nos cards rápidos.
- Upload/remover foto do veículo.
- Bottom Sheet principal do veículo ao focar dispositivo, sem backdrop escuro para manter o mapa visível.

Critério de saída:

- Marcadores usam os mesmos desenhos/categorias do site.
- Cards rápidos e card principal mostram dados equivalentes ao portal cliente.
- Foto enviada pelo cliente aparece no card rápido e no card principal.

Implementação atual:

- `app/src/tracking/VehicleIcon.tsx`: componente nativo com `react-native-svg`, baseado nas categorias e formas de `window.AL_ICONS_3D`.
- `app/src/tracking/VehicleCards.tsx`: card rápido em grade mobile e card principal do veículo com foto, status, métricas, endereço e ações já suportadas no app.
- `app/src/tracking/vehiclePhotoService.ts`: upload/remover foto do veículo em `POST/DELETE /cliente/dispositivos/:dispositivoId/foto`.
- `app/src/screens/MapScreen.tsx`: marcadores com SVG, Bottom Sheet inferior recolhível/30%/50%, card principal em Bottom Sheet sem backdrop e atualização da foto no snapshot local.

#### Correção técnica:-Marcadores no Android

Problema: `react-native-maps` no Android com nova arquitetura tem problemas conhecidos ao renderizar children customizados dentro de `Marker`. O bitmap é capturado incorretamente ou aparece cortado no mapa.

Solução implementada:

- `app/src/tracking/useMarkerBitmaps.tsx`: usa `react-native-view-shot` para capturar cada ícone offscreen como PNG.
- Container oculto em `position: absolute; left: -9999; opacity: 0` para renderização sem interação.
- `captureRef` com formato PNG e qualidade 1.
- Cache em memória para persistir URIs entre re-renders.
- `app/src/screens/MapScreen.tsx` passa a imagem via `Marker.image={ { uri: bitmapUri } }` quando disponível.
- Fallback para renderização direta de `VehicleIcon` permanece enquanto bitmap não carrega.
- Requerido `react-native-view-shot` versão 4.0.3 no `package.json`.

Referência: issue [react-native-maps#5906](https://github.com/react-native-maps/react-native-maps/issues/5906).

Referências:

| Uso | Parágrafo/seção | Onde encontra |
|---|---|---|
| Biblioteca SVG dos veículos | `window.AL_ICONS_3D` | `AgillockSite/js/config.js` |
| Cards e comportamento do mapa | Tela de mapa base | `AgillockSite/cliente/rastreamento.html` |
| Lógica do rastreamento cliente | Comportamento do mapa cliente | `AgillockSite/js/rastreamento-cliente.js` |
| Foto do veículo | `Foto do veículo` | `docs/traccar/PORTAL_CLIENTE.md` |
| Uploads | `Uploads` | `docs/projeto/API.md` |

## Fase 5 - WebSocket, notificações do mapa e pesquisa (Implementada)

Objetivo: tornar o mapa vivo e concluir as ações da topbar.

Entregas:

- Conectar em `wss://api.agillock.com.br/ws/rastreamento`.
- Filtrar mensagens por `traccarId`.
- Atualizar posição/status dos marcadores em tempo real.
- Recarregar snapshot após reconexão.
- Botão Pesquisar na topbar do mapa.
- Bottom Sheet de pesquisa com 80% da tela, input, filtros e dispositivos.
- Botão Notificações na topbar do mapa com badge de contagem.
- Bottom Sheet de notificações com 80% da tela.
- Ao tocar notificação com dispositivo, focar dispositivo e abrir card com contexto.

Critério de saída:

- Posição muda em tempo real sem mostrar dispositivos de outro cliente.
- Pesquisa foca o dispositivo selecionado.
- Notificação de dispositivo leva ao mapa e abre card contextual.

Implementação atual:

- `app/src/tracking/trackingWebSocket.ts`: conexão WebSocket com `trackingWebsocket URL`, reconnect automático, filtro por `traccarId` e estados CONNECTING/CONNECTED/DISCONNECTED.
- `app/src/tracking/useTrackingWebSocket.ts`: hook React que gerencia conexão, desconecta ao desmontar e retorna status.
- `app/src/screens/MapScreen.tsx`: usa `useTrackingWebSocket` para atualizar dispositivos em tempo real.
- `app/src/components/SearchBottomSheet.tsx`: bottom sheet de pesquisa com 2 colunas em grid, input de busca por nome/placa, cards com foto/nome/placa usando `QuickVehicleCard`.
- `app/src/components/NotificationsBottomSheet.tsx`: bottom sheet de notificações com filtros de período (Hoje, Ontem, 7 dias, Personalizado), modal de tipo com ScrollView, cards com cores e ícones por tipo, tempo relativo "há X min/h/dias", expansão ao tocar para ver detalhes/data/coordenadas, botões Maps/StreetView e fallback para posição atual do dispositivo em eventos sem coordenadas.

### Tipos de Notificação Suportados (15 tipos)

O app suporta os mesmos 15 tipos de notificação da web:

| Tipo | Label |
|---|---|
| ignitionOn | Ignição Ligada |
| ignitionOff | Ignição Desligada |
| geofenceEnter | Entrada na Cerca |
| geofenceExit | Saída da Cerca |
| overspeed | Excesso de Velocidade |
| powerCut | Alimentação Cortada |
| alarm | Alarme |
| deviceLocked | Veículo Bloqueado |
| deviceUnlocked | Veículo Desbloqueado |
| kmExcedida | Km Excedida |
| kmReduzida | Km Reduzida |
| trocaOleo | Troca de Óleo |
| trocaOleoFeita | Troca de Óleo Realizada |
| manutencaoAlerta | Alerta de Manutenção |
| manutencaoAtrasada | Manutenção Atrasada |
| manutencaoFeita | Manutenção Realizada |

### Lógica de Localização das Notificações

A localização exibida no bottom sheet de notificações segue esta ordem de prioridade:

1. **Endereço do evento** (`item.endereco`) - quando o evento tem coordenada salva
2. **Coordenadas do evento + geocode** - tenta geocode se coords diferentes da posição atual
3. **Posição atual do dispositivo** - fallback quando evento não tem coords (ex: manutenção)
4. **"Localização indisponível"** - quando nada está disponível

Para eventos de manutenção que não têm coordenadas, usa a posição atual do dispositivo como fallback (mesmo comportamento que a web em `rastreamento-cliente.js:761`).

Referências:

| Uso | Parágrafo/seção | Onde encontra |
|---|---|---|
| WebSocket do cliente/app | `WebSocket` | `docs/traccar/PORTAL_CLIENTE.md` |
| Fluxo WebSocket backend | `Fluxo WebSocket` | `docs/traccar/INTEGRACAO_BACKEND.md` |
| Eventos persistidos | `Eventos e notificações` | `docs/traccar/INTEGRACAO_BACKEND.md` |
| Eventos da API | `Notificações do cliente` | `docs/projeto/API.md` |
| Notificações do portal | `Notificações` | `docs/projeto/PORTAL_CLIENTE.md` |
| Backend - contagem não lidas | `GET /cliente/notificacoes/nao-lidas/count` | `backend/src/routes/notificacoes.routes.ts` |
| Backend - marcar lidas | `POST /cliente/notificacoes/marcar-lidas` | `backend/src/routes/notificacoes.routes.ts` |
| App - contagem não lidas | `getUnreadCount` | `app/src/notifications/notificationService.ts` |
| App - marcar todas lidas | `markAllAsRead` | `app/src/notifications/notificationService.ts` |
| App - listar eventos | `getNotificationEvents` | `app/src/notifications/notificationService.ts` |
| WebSocket hook | `useTrackingWebSocket` | `app/src/tracking/useTrackingWebSocket.ts` |
| Cards de pesquisa | `SearchVehicleCard` | `app/src/components/SearchBottomSheet.tsx` |
| Cards de notificação | `getTipoConfig` | `app/src/components/NotificationsBottomSheet.tsx` |
| API eventos | `/cliente/notificacoes/eventos` | `backend/src/routes/notificacoes.routes.ts` |

## Fase 6 - Push notification Expo (Implementada)

Objetivo: ativar notificações push mobile.

Entregas:

- Solicitação de permissão após splash. Implementado na Fase 1.
- Obtenção de token com `expo-notifications`. Implementado na Fase 1, depende de `EAS projectId`.
- Registro do token em `POST /api/cliente/notificacoes/app-tokens`. Implementado após login na Fase 1.
- Remover token em logout. Implementado na Fase 1.
- Tratar abertura do app por push. Implementado nesta atualização.
- Encaminhar eventos com dispositivo para Mapa focado. Implementado nesta atualização.
- Encaminhar eventos financeiros para Pagamentos ou Notificações. Implementado nesta atualização.

Critério de saída:

- Token Expo aparece no backend.
- Push recebido abre o destino correto.
- Logout desativa o token do aparelho.

Implementação atual:

- `app/src/notifications/NotificationHandlers.tsx`: handler de notificação com `addNotificationResponseReceivedListener` que direciona para:
  - `dispositivoId` → Mapa com highlight
  - `action: 'pagamentos'` ou `tipo: 'boleto'/'cobranca'` → Pagamentos
  - `action: 'notificacoes'` ou `tipo` starts with 'manutencao' → Notificações
  - 默认 → Mapa
- `app/src/notifications/pushTokenService.ts`: `requestExpoPushToken()`, `ensureExpoPushTokenRegistered()`, `unregisterStoredExpoPushToken()`
- `app/src/notifications/pushTokenStorage.ts`: persistência de token e deviceId
- `app/App.tsx`: configura canal Android na splash
- `app/src/navigation/AppNavigator.tsx`: passa `navigationRef` para `NotificationHandlers`
- `app/src/screens/MapScreen.tsx`: recebe params `dispositivoId` e abre card ao navegar de notificação

### Dados esperados da notificação push

| Campo | Tipo | Ação |
|---|---|---|
| `dispositivoId` | string | Abre Mapa com dispositivo focado |
| `tipo` | 'boleto' \| 'cobranca' | Abre Pagamentos |
| `action` | 'pagamentos' | Abre Pagamentos |
| `action` | 'notificacoes' | Abre Notificações |
| `tipo` starts 'manutencao' | - | Abre Notificações |

Referências:

| Uso | Parágrafo/seção | Onde encontra |
|---|---|---|
| Push no app | `Push notification no mobile` | `docs/traccar/PORTAL_CLIENTE.md` |
| Rotas de token Expo | `Notificações do cliente` | `docs/projeto/API.md` |
| Eventos financeiros | `Notificações` | `docs/projeto/PORTAL_CLIENTE.md` |
| Tokens Expo no backend | Rotas `/api/cliente/notificacoes/*` | `backend/src/routes/notificacoes.routes.ts` |
| Handler push app | `NotificationHandlers` | `app/src/notifications/NotificationHandlers.tsx` |
| MapScreen params | `dispositivoId` params | `app/src/screens/MapScreen.tsx` |

## Fase 7 - Relatórios (Implementada)

Objetivo: implementar a tela Relatório com exportação.

Entregas:

- Tela Relatório com topbar e botão Exportar.
- Seleção de dispositivo(s), tipo e período.
- Listagem mobile para histórico, viagens, paradas, eventos e resumo.
- Mapa de rota quando houver coordenadas.
- Exportação XLSX.
- Compartilhamento/abertura do arquivo exportado no aparelho.

Critério de saída:

- Relatórios carregam usando `dispositivoId` local.
- Exportação baixa e compartilha o arquivo.
- Estados vazios e erros ficam claros no mobile.

Implementação atual:

- `app/src/reporting/reportTypes.ts`: contratos TypeScript de `HistoricoResponse`, `Viagem`, `Parada`, `Evento`, `Resumo`, `ReportPeriodo`, `ReportTab`, `ExportType`.
- `app/src/reporting/reportService.ts`: chamadas `GET /cliente/rastreamento/dispositivos/:id/historico|viagens|paradas|eventos|resumo` e `GET /cliente/rastreamento/dispositivos/:id/exportar`.
- `app/src/screens/ReportScreen.tsx`: tela completa com seletor de veículo, filtros de período (Hoje/Ontem/7 dias/Personalizado) com `DateTimePicker`, abas Rota/Eventos/Viagens/Paradas/Resumo/Gráfico, mapa de trajeto com `react-native-maps` + `Polyline`, gráfico de velocidade SVG com `react-native-svg`, e exportação XLSX via `expo-file-system` + `expo-sharing`.
- Botão Exportar no cabeçalho do drawer configurado via `navigation.setOptions` dentro da própria tela.
- `expo-file-system` e `expo-sharing` adicionados ao `package.json`.

Normalização de campos: helpers que suportam tanto o formato normalizado do backend (`inicio`, `fim`, `distancia`, `duracao`) quanto o formato bruto do Traccar (`startTime`, `endTime`, `distance`, `duration`) para compatibilidade.

Referências:

| Uso | Parágrafo/seção | Onde encontra |
|---|---|---|
| Relatórios em lote | `Relatórios em lote` | `docs/traccar/PORTAL_CLIENTE.md` |
| Histórico e relatórios | `Histórico e relatórios` | `docs/projeto/PORTAL_CLIENTE.md` |
| Contratos detalhados | `Histórico`, `Viagens`, `Paradas`, `Eventos`, `Resumo` | `docs/traccar/API.md` |
| Tela web base | Tela de relatórios | `AgillockSite/cliente/relatorio.html` e `AgillockSite/js/relatorio-cliente.js` |
| Tipos do app | `reportTypes` | `app/src/reporting/reportTypes.ts` |
| Serviço do app | `reportService` | `app/src/reporting/reportService.ts` |
| Tela do app | `ReportScreen` | `app/src/screens/ReportScreen.tsx` |

## Fase 8 - Notificações (Implementada)

Objetivo: adaptar a tela de notificações do cliente ao app.

Entregas:

- Lista de veículos.
- Preferências por evento e canal.
- Configurações de km/troca de óleo.
- Confirmação de troca de óleo.
- Lista de eventos gerados.
- Abertura de evento associado no mapa.

Critério de saída:

- Preferências salvam e recarregam por dispositivo.
- Eventos aparecem filtráveis no app.
- Eventos com dispositivo navegam para Mapa focado.

Referências:

| Uso | Parágrafo/seção | Onde encontra |
|---|---|---|
| Preferências e eventos | `Notificações` | `docs/projeto/PORTAL_CLIENTE.md` |
| Rotas de notificações | `Notificações do cliente` | `docs/projeto/API.md` |
| Tela web base | Tela de notificações | `AgillockSite/cliente/notificacoes.html` e `AgillockSite/js/notificacoes-cliente.js` |

Implementação atual:

- `app/src/screens/NotificationsScreen.tsx`: tela de notificações com seletor de veículos via BottomSheet, preferências de canais por tipo de evento, configuração de velocidade e quilometragem por período.
- `app/src/notifications/notificationService.ts`: serviço com funções para preferências, configuração de km e confirmação de troca de óleo.

## Fase 9 - Geocercas (Implementada)

Implementação atual:

- `app/src/tracking/geofenceService.ts`: serviço com funções para listar, criar e excluir geocercas, além de parser para área de círculo.
- `app/src/tracking/VehicleCards.tsx`: botão de cerca na seção de ações do MainVehicleCard. Ao clicar, cria uma cerca de 150m ao redor do veículo (sem dialog). Botão fica destacado (laranja) quando há cerca ativa. Ao clicar com cerca ativa, exclui todas as cercas do dispositivo.
- `app/src/screens/MapScreen.tsx`: 
  - Barra de camadas com botões de alternância: Labels (rótulos), Cercas e Rastro.
  - Labels: mostra/oculta rótulos (placa/nome) sobre os ícones dos veículos.
  - Cercas: mostra/oculta círculos das geocercas no mapa via `MapView.Circle`.
  - Rastro: mostra/oculta rotas (polilinhas) dos veículos via `MapView.Polyline`.
  - Ao criar uma cerca via MainVehicleCard, a visualização no mapa é ativada automaticamente.

## Fase 10 - Pagamentos

Objetivo: adaptar boletos do cliente ao app.

Entregas:

- Tela Pagamentos.
- Listagem de boletos.
- Filtros por status, vencimento e veículo.
- Abertura do link de boleto.
- Destaque para atrasados.
- Integração com estado de bloqueio do mapa.

Critério de saída:

- Cliente responsável vê boletos.
- Cliente vinculado não acessa área restrita de faturamento quando backend negar.
- Boleto abre corretamente no navegador/app externo.

Referências:

| Uso | Parágrafo/seção | Onde encontra |
|---|---|---|
| Pagamentos cliente | `Pagamentos` | `docs/projeto/PORTAL_CLIENTE.md` |
| Rota de boletos | `Portal do cliente e app mobile` | `docs/projeto/API.md` |
| EFI e boletos | Seções sobre EFI e boletos | `docs/projeto/EFI.md` |
| Tela web base | Tela de pagamentos | `AgillockSite/cliente/pagamentos.html` |

## Fase 11 - Qualidade, permissões e publicação

Objetivo: preparar publicação Android/iOS.

Entregas:

- Testes manuais em Android e iOS.
- Testes de login, mapa, WebSocket, upload, push, relatório e pagamentos.
- Permissões de localização, câmera/galeria, storage/arquivos e notificações.
- Revisar descrições de permissões no `app.json` e mensagens contextuais antes dos prompts.
- Configuração EAS Build.
- Chaves Google Maps por plataforma.
- Ícones e splash screen.
- Builds internas para validação.

Critério de saída:

- Build Android e iOS gerado com sucesso.
- Fluxos críticos testados em aparelho real.
- Chaves e permissões configuradas.
- App pronto para envio às lojas ou distribuição interna.

Referências:

| Uso | Parágrafo/seção | Onde encontra |
|---|---|---|
| Plano de testes de rastreamento | Fases de teste de API, WebSocket e frontend | `docs/traccar/TESTES.md` |
| Deploy do projeto | Documentos de deploy | `docs/projeto/DEPLOY.md` e `docs/projeto/DEPLOY_OPCOES.md` |
| Bases de produção | `Bases` | `docs/traccar/API.md` |

## Ordem recomendada

```text
0. Preparação (Implementada)
1. Autenticação e sessão (Implementada)
2. Shell, drawer e perfil (Implementada)
3. Mapa base e snapshot (Implementada)
4. Ícones/cards do mapa (Implementada)
5. WebSocket, pesquisa e notificações no mapa (Implementada)
6. Push notification Expo
7. Relatórios (Implementada)
8. Notificações (Implementada)
9. Geocercas
10. Pagamentos
11. Qualidade e publicação
```

Essa ordem coloca o mapa funcional cedo, porque ele é a tela principal do app e a base para notificações, geocercas, relatórios e push.
