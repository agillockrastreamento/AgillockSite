# Especificação do App Cliente

Atualizado em: 2026-05-04

## Visão geral

App React Native Expo para Android/iOS, exclusivo para cliente. Deve reutilizar as funções do portal cliente web, mas com navegação e componentes próprios para mobile.

Regras globais:

- Tema claro único, sem alternância para tema escuro.
- Todas as telas autenticadas usam topbar com botão de drawer à esquerda e título centralizado.
- A área à direita da topbar pode ter ações específicas da tela.
- O drawer concentra navegação, marca, perfil e logout.
- O app deve aceitar apenas login com `role: "CLIENTE"`.
- Mensagens transitórias devem usar toast centralizado do app. `Alert.alert` nunca deve ser usado no app.
- Confirmações bloqueantes ou decisões sensíveis devem usar o modal universal de confirmação em `app/src/components`.
- Ao iniciar, o app deve exibir uma splash animada com `AgillockSite/img/agillock_new_symbol.png`: símbolo começa pequeno, aumenta, treme no final e desaparece com opacidade.
- Inputs de texto devem usar `react-native-paper` via wrapper próprio `AppTextInput`, para manter tema, animação de label/placeholder e estados visuais consistentes.

## Boot, splash e feedback

A splash animada é parte da infraestrutura inicial do app. Ela usa o mesmo símbolo reduzido do drawer:

```text
AgillockSite/img/agillock_new_symbol.png
```

Comportamento:

- Fundo claro.
- Símbolo centralizado.
- Inicia pequeno.
- Aumenta até o tamanho principal.
- Faz tremor curto no final.
- Some com transição de opacidade.

O toast centralizado é o mecanismo padrão para feedback não bloqueante:

- Sucesso de salvamento/upload.
- Erros de formulário ou API recuperáveis.
- Confirmações simples.
- Avisos de estado.

`Alert.alert` nunca deve ser usado.

Confirmações bloqueantes devem usar o modal universal do app:

- Confirmação de comandos sensíveis, como bloqueio/desbloqueio do veículo.
- Confirmação de exclusão.
- Confirmação de logout quando houver risco de perda de estado local.
- Qualquer decisão em que o usuário precise escolher entre confirmar e cancelar.

O modal universal deve ficar em `app/src/components` e ser acessado por provider/hook global, assim como o toast.

## Notificações Expo no boot

Após a splash animada terminar, o app deve solicitar permissão de notificações usando `expo-notifications`.

Fluxo:

- Splash termina.
- `NotificationBootstrap` solicita permissão do sistema.
- No Android, `pushTokenService` configura o canal `default` antes de solicitar permissão.
- Se a permissão for concedida e houver `EAS projectId`, o app obtém o Expo Push Token.
- O token é salvo localmente.
- Após login ou restauração de sessão, o app registra o token em `POST /api/cliente/notificacoes/app-tokens`.
- No logout, o app tenta desativar o token no backend antes de limpar a sessão local.

Arquivos:

- `app/src/notifications/NotificationBootstrap.tsx`
- `app/src/notifications/pushTokenService.ts`
- `app/src/notifications/pushTokenStorage.ts`

Configuração:

- `expo-notifications` deve estar no `app.json`.
- Projeto EAS vinculado: `@pedro_castro/agillock-cliente`.
- EAS Project ID atual: `63e4131c-1fd9-4366-9bf7-d2bbbfafabd2`.
- `expo.extra.eas.projectId` deve ficar configurado no `app.json` para gerar Expo Push Token em builds.
- `EXPO_PUBLIC_EAS_PROJECT_ID` pode sobrescrever esse valor em ambiente local, mas valores vazios devem ser ignorados pelo app.

## Permissões e textos de aprovação

Toda permissão solicitada pelo app deve ter uma justificativa clara para revisão das lojas e para o usuário.

Regras:

- iOS: descrições obrigatórias devem ficar em `app.json`, em `expo.ios.infoPlist`.
- Android: permissões declaradas ficam em `app.json`, em `expo.android.permissions`; quando o sistema não exibir texto customizado, a tela que dispara a permissão deve explicar o motivo antes da solicitação.
- Notificações: o prompt nativo não usa descrição customizada via `app.json`; o app deve pedir permissão somente quando o fluxo de notificação estiver pronto.
- Câmera: usada para foto de perfil e fotos dos veículos.
- Fotos/galeria: usada para selecionar imagens de perfil, veículos e comprovantes.
- Localização: usada para centralizar o mapa na posição do usuário e facilitar visualização dos veículos próximos.
- Storage/arquivos: usado apenas em ações explícitas do usuário, como exportar relatórios ou salvar comprovantes.
- Nenhuma tela deve solicitar permissão sem contexto visual da ação que motivou o pedido.

Configuração atual no `app.json`:

- `NSCameraUsageDescription`
- `NSPhotoLibraryUsageDescription`
- `NSPhotoLibraryAddUsageDescription`
- `NSLocationWhenInUseUsageDescription`
- Android: `CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `READ_MEDIA_IMAGES`

## Inputs e formulários

O app usa `react-native-paper` como base para inputs e formulários.

Regras:

- Usar `AppTextInput` em `app/src/components/AppTextInput.tsx` em vez de importar `TextInput` diretamente nas telas.
- Usar `PaperProvider` com `paperTheme` em `app/src/theme/paperTheme.ts`.
- Inputs devem usar o modo `outlined` por padrão.
- Labels animadas/floating labels devem vir do `TextInput` do `react-native-paper`.
- Cores de borda, foco, cursor, texto, erro e superfície devem vir do tema AgilLock.
- Conteúdo dos inputs deve ser LTR, alinhado à esquerda e com o início do valor fixo; quando o texto for maior que o campo, o final deve ficar oculto.
- Campos de senha devem ter botão de visualizar/ocultar senha no próprio input.
- `TextInput` nativo do React Native só deve ser usado se houver uma necessidade técnica específica e documentada.

## Navegação

Fluxo principal:

```text
Login
  -> Mapa
     -> Drawer
        -> Mapa
        -> Relatório
        -> Notificações
        -> Geocercas
        -> Pagamentos
        -> Avatar/Perfil
        -> Sair
```

Telas autenticadas:

| Tela | Título | Ações na topbar |
|---|---|---|
| Mapa | Mapa | Pesquisar, notificações |
| Relatório | Relatório | Exportar |
| Notificações | Notificações | Nenhuma |
| Geocercas | Geocercas | Nenhuma |
| Pagamentos | Pagamentos | Nenhuma |

## Drawer e perfil

Ao abrir o drawer:

- Exibir a marca reduzida `AgillockSite/img/agillock_new_symbol.png` no topo.
- Exibir links das telas do cliente.
- Na área onde hoje fica o nome do usuário, exibir um avatar circular com a foto do cliente.
- Ao tocar no avatar, abrir modal de perfil.
- Abaixo do avatar, exibir botão `Sair`.

Modal de perfil:

- Mostra avatar atual e ação de upload de foto.
- Faz upload com `POST /api/cliente/perfil/avatar`, campo `avatar`.
- Mostra dados do usuário: nome, email, telefone, CPF/CNPJ quando disponíveis.
- Lista veículos associados, separados entre faturamento/responsável e vinculados.

Contrato base:

- `GET /api/cliente/perfil`
- `POST /api/cliente/perfil/avatar`

Referência: `docs/projeto/PORTAL_CLIENTE.md`, seção `Perfil e Avatar (App Mobile)`.

## Login

Tela igual ao login atual do site cliente, usando a imagem:

```text
AgillockSite/img/logo_agillock_new.png
```

Visual:

- Fundo da tela igual ao login do site: base escura `#1e2530`.
- Logo dentro do painel claro, em uma área interna com a mesma cor escura do login web, mantendo margem branca visível do painel ao redor dessa área.
- Painel/formulário com superfície clara do app.
- Abaixo do botão Entrar, exibir `© 2026 AgilLock — Gestão de Rastreamento`.
- Campo de senha com botão para alternar visualização.

Contrato:

```text
POST /api/auth/login
```

O app deve rejeitar respostas cujo `user.role` não seja `CLIENTE`, limpar sessão e exibir erro de acesso.

Armazenamento recomendado:

- JWT em `expo-secure-store`.
- Dados mínimos do usuário cliente em storage local para restaurar sessão e montar a navegação inicial.
- Preferências visuais e estado de UI em AsyncStorage ou MMKV.
- Dados sensíveis nunca em storage simples.

Implementação atual:

- `app/src/auth/authService.ts`: chama `POST /auth/login` e aceita apenas `role: "CLIENTE"`.
- `app/src/auth/AuthProvider.tsx`: controla sessão, restauração, login e logout.
- `app/src/auth/sessionStorage.ts`: persiste JWT em SecureStore e dados mínimos do usuário em AsyncStorage.
- `app/src/navigation/AppNavigator.tsx`: mostra Login quando não autenticado e Drawer do cliente quando autenticado.
- `app/src/screens/LoginScreen.tsx`: usa logo `logo_agillock_new.png`, `AppTextInput`, toast centralizado e bloqueio de envio enquanto autentica.

Referência: `docs/projeto/PORTAL_CLIENTE.md`, seção `Login do cliente`.

## Mapa

Primeira tela do usuário logado. Equivale à tela de rastreamento do cliente no site.

Componentes principais:

- Mapa nativo ocupando a área principal.
- Bottom Sheet inferior com cards rápidos dos veículos.
- Marcadores dos dispositivos vinculados/responsáveis do cliente.
- Botões compactos sobre o mapa.
- Bottom Sheet principal do veículo ao focar um dispositivo.

### Fonte dos dispositivos

Carregar:

```text
GET /api/cliente/rastreamento/status-acesso
GET /api/cliente/rastreamento/posicoes
```

Se `status-acesso` retornar bloqueado ou o snapshot retornar `403 { "error": "acesso_bloqueado" }`, exibir estado de bloqueio com acesso a pagamentos para cliente responsável.

O app deve montar o índice:

```text
traccarId -> dispositivoId
```

Esse índice é obrigatório para filtrar mensagens do WebSocket.

Referências:

- `docs/traccar/PORTAL_CLIENTE.md`, seção `Fluxo recomendado`.
- `docs/traccar/PORTAL_CLIENTE.md`, seção `Snapshot`.
- `docs/projeto/API.md`, seção `Portal do cliente e app mobile`.

### Tempo real

Abrir:

```text
wss://api.agillock.com.br/ws/rastreamento
```

Aplicar no mapa somente mensagens cujo `deviceId` pertença ao snapshot do cliente. No WebSocket, `deviceId` é o ID do Traccar, não o `dispositivoId` local.

Referência: `docs/traccar/PORTAL_CLIENTE.md`, seção `WebSocket`.

### Botões sobre o mapa

Botões compactos, sem texto abaixo:

- Tipo de mapa: Google Maps como padrão.
- Camadas: satélite, terreno, híbrido quando suportado.
- Localização: centraliza a posição atual do aparelho.
- Preferências: labels, cercas, rastro, alarmes e dispositivos.

As bandejas abertas por esses botões devem ser compactas, iconográficas e sem descrições longas para poupar espaço.

Preferências persistidas via:

```text
GET /api/cliente/rastreamento/prefs
POST /api/cliente/rastreamento/prefs
POST /api/cliente/rastreamento/prefs/merge
```

Referência: `docs/projeto/PORTAL_CLIENTE.md`, seção `Rastreamento`.

### Cards rápidos no Bottom Sheet

O Bottom Sheet inferior mostra cards de acesso rápido dos veículos:

- Pode ficar totalmente fechado.
- Pode abrir mostrando os cards.
- Cada card mantém a mesma informação do card web, com ajustes de densidade e toque para mobile.
- Ao tocar no card, fechar/substituir a lista pelo Bottom Sheet principal do veículo e focar o marcador no mapa.
- Como não há hover no app, o card rápido deve mostrar um ícone de câmera ao lado da área da foto para indicar upload de foto do veículo.

Foto do veículo:

```text
POST /api/cliente/dispositivos/:dispositivoId/foto
DELETE /api/cliente/dispositivos/:dispositivoId/foto
```

Campo multipart: `foto`.

Referências:

- `docs/traccar/PORTAL_CLIENTE.md`, seção `Foto do veículo`.
- `docs/projeto/API.md`, seção `Uploads`.

### Card principal do veículo

No site, o card principal abre sobre o mapa. No app, ele deve abrir como Bottom Sheet no lugar dos cards rápidos.

Conteúdo:

- Foto/ícone do veículo.
- Nome, placa, status, velocidade, ignição, movimento e última atualização.
- Endereço quando disponível ou carregado por reverse geocode.
- Ações equivalentes às do portal cliente que fizerem sentido no mobile.
- Alertas/notificações do veículo quando aberto a partir de evento.

Ao selecionar dispositivo no mapa ou no card:

- Fechar Bottom Sheet de pesquisa/notificações se estiver aberto.
- Focar câmera do mapa no dispositivo.
- Abrir Bottom Sheet principal do veículo.

### Pesquisa na tela de mapa

Ação na topbar: pesquisar.

Ao tocar:

- Abrir Bottom Sheet com 80% da altura da tela.
- Mostrar input de busca.
- Mostrar filtros.
- Listar dispositivos abaixo.
- Ao selecionar dispositivo, fechar Bottom Sheet, focar no mapa e abrir card principal.

Busca mínima:

- Nome do veículo/dispositivo.
- Placa.
- IMEI quando disponível no payload.

### Notificações na tela de mapa

Ação na topbar: notificações.

Ao tocar:

- Abrir Bottom Sheet com 80% da altura da tela.
- Listar eventos/notificações recentes.
- Permitir filtros compactos por período/tipo quando necessário.

Ao tocar em uma notificação:

- Se o evento tiver dispositivo associado, fechar Bottom Sheet.
- Focar dispositivo no mapa.
- Abrir card principal com contexto da notificação.
- Se o evento não envolver dispositivo, navegar para tela de Notificações ou exibir detalhe em modal.

Contrato:

```text
GET /api/cliente/notificacoes/eventos
```

Referências:

- `docs/projeto/PORTAL_CLIENTE.md`, seção `Notificações`.
- `docs/traccar/PORTAL_CLIENTE.md`, seção `Push notification no mobile`.

### Ícones SVG 3D dos veículos

O app deve levar a mesma configuração de ícones SVG usada no site:

```text
AgillockSite/js/config.js
window.AL_ICONS_3D
```

Partes a portar:

- `SIZE`
- `getSvgHtml(categoria, cor, course)`
- `mapCategoria(categoria)`
- `shapes`

No React Native, há duas opções aceitáveis:

- Converter a biblioteca para TypeScript e renderizar com `react-native-svg`.
- Gerar SVG string e renderizar via componente compatível com SVG string, mantendo cache por `categoria`, `cor` e `course`.

Para marcadores do `react-native-maps`, usar `Marker` com child customizado baseado em `SvgXml`/`react-native-svg`. Evitar WebView por marcador.

## Relatório

Tela equivalente ao relatório do cliente no site, adaptada ao app.

Topbar:

- Título centralizado `Relatório`.
- Botão de exportar ao lado do título.

Funções:

- Selecionar um ou mais dispositivos.
- Selecionar tipo de relatório: histórico, viagens, paradas, eventos, resumo.
- Selecionar período.
- Exibir resultado em lista/tabela mobile.
- Exibir rota no mapa quando o tipo tiver coordenadas.
- Exportar arquivo XLSX.

Contratos:

```text
GET /api/cliente/rastreamento/relatorios/batch/historico
GET /api/cliente/rastreamento/relatorios/batch/viagens
GET /api/cliente/rastreamento/relatorios/batch/paradas
GET /api/cliente/rastreamento/relatorios/batch/eventos
GET /api/cliente/rastreamento/relatorios/batch/resumo
GET /api/cliente/rastreamento/relatorios/exportar
GET /api/cliente/rastreamento/dispositivos/:id/exportar
```

No app, `deviceId` em query deve ser o `dispositivoId` local.

Referências:

- `docs/traccar/PORTAL_CLIENTE.md`, seção `Relatórios em lote`.
- `docs/projeto/PORTAL_CLIENTE.md`, seção `Histórico e relatórios`.

## Notificações

Tela igual à do site cliente, adaptada para mobile.

Funções:

- Selecionar veículo.
- Configurar preferências por evento e canal.
- Ver eventos gerados.
- Configurar troca de óleo por km.
- Confirmar troca de óleo quando aplicável.

Contratos:

```text
GET /api/cliente/notificacoes/preferencias/:dispositivoId
POST /api/cliente/notificacoes/preferencias
GET /api/cliente/notificacoes/eventos
PATCH /api/cliente/notificacoes/km-troca-oleo/:dispositivoId
POST /api/cliente/notificacoes/confirmar-troca-oleo/:dispositivoId
GET /api/cliente/notificacoes/km-config/:dispositivoId
```

Push:

- Obter token com `expo-notifications`.
- Registrar token após login.
- Remover token no logout.

```text
POST /api/cliente/notificacoes/app-tokens
DELETE /api/cliente/notificacoes/app-tokens
```

Referência: `docs/projeto/API.md`, seção `Notificações do cliente`.

## Geocercas

Tela igual à do site cliente, adaptada para mobile.

Funções:

- Listar geocercas visíveis.
- Criar geocerca própria.
- Editar/remover apenas geocercas próprias do cliente.
- Vincular geocerca a dispositivos permitidos.
- Exibir geocercas no mapa quando a preferência estiver ativa.

Contratos:

```text
GET /api/cliente/rastreamento/cercas
GET /api/cliente/rastreamento/dispositivos/:dispositivoId/cercas
POST /api/cliente/rastreamento/cercas
DELETE /api/cliente/rastreamento/cercas/:id
GET /api/cliente/rastreamento/geocercas
GET /api/cliente/rastreamento/geocercas/:id
POST /api/cliente/rastreamento/geocercas
PUT /api/cliente/rastreamento/geocercas/:id
DELETE /api/cliente/rastreamento/geocercas/:id
```

Referências:

- `docs/traccar/PORTAL_CLIENTE.md`, seção `Geocercas`.
- `docs/traccar/INTEGRACAO_BACKEND.md`, seção `Geocercas`.

## Pagamentos

Tela igual à do site cliente, adaptada para mobile.

Disponível para cliente responsável.

Funções:

- Listar boletos.
- Filtrar por status, vencimento e placa/dispositivo.
- Abrir link de boleto.
- Exibir estados de vencido, pendente, pago e cancelado.
- Ser ponto de saída do bloqueio de rastreamento por inadimplência.

Contrato:

```text
GET /api/cliente/boletos
```

Referência: `docs/projeto/PORTAL_CLIENTE.md`, seção `Pagamentos`.

## Recomendação técnica para mapa

Usar `react-native-maps` com Google Maps nativo:

```tsx
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

<MapView
  provider={PROVIDER_GOOGLE}
  mapType="standard"
  showsUserLocation
/>
```

Preferir essa abordagem ao Google Maps JavaScript API em WebView.

Justificativa:

- `react-native-maps` usa SDK nativo e entrega gestos, câmera, marcadores e overlays com melhor desempenho.
- Google Maps via API JavaScript exigiria WebView, ponte JS e integração manual com eventos do app.
- O app precisa de marcadores customizados, foco por dispositivo, geocercas, rotas e localização do aparelho, todos cobertos por `react-native-maps`.
- O backend já entrega os dados normalizados; não há necessidade de usar APIs diretas do Traccar ou mapa web.

Configuração esperada:

- Chave Google Maps Android no build Expo/EAS.
- Chave Google Maps iOS no build Expo/EAS.
- Restrições de chave por package/bundle.
- Fallback visual para falha de permissão de localização.

## Bibliotecas recomendadas

| Necessidade | Biblioteca sugerida |
|---|---|
| Navegação | `@react-navigation/native`, drawer e native stack |
| Inputs e componentes Material | `react-native-paper` |
| Mapa | `react-native-maps` |
| Bottom Sheet | `@gorhom/bottom-sheet` |
| SVG dos veículos | `react-native-svg` |
| Push | `expo-notifications` |
| Upload de imagens | `expo-image-picker` |
| Arquivos exportados | `expo-file-system`, `expo-sharing` |
| Token seguro | `expo-secure-store` |
| Estado remoto/cache | TanStack Query ou equivalente |

## Critérios de aceite

- Login aceita somente cliente e abre Mapa como primeira tela.
- Drawer mostra símbolo AgilLock, telas, avatar, modal de perfil e botão Sair.
- App inteiro permanece em tema claro.
- Mapa carrega snapshot, atualiza por WebSocket e filtra eventos por `traccarId`.
- Pesquisa do mapa abre Bottom Sheet de 80% e foca dispositivo selecionado.
- Notificações do mapa abrem Bottom Sheet de 80% e focam dispositivo quando houver evento associado.
- Cards rápidos e card principal reproduzem informações do site com ajustes mobile.
- Ícones SVG dos veículos seguem `AgillockSite/js/config.js`.
- Relatório exporta usando endpoint do cliente.
- Geocercas, notificações e pagamentos usam as mesmas regras do portal cliente.
