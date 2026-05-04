# App Mobile Cliente - React Native Expo

Atualizado em: 2026-05-04

Esta pasta documenta o app React Native Expo Android/iOS exclusivo para clientes AgilLock. O app deve reutilizar os contratos do portal do cliente web e da integração Traccar, mantendo uma experiência mobile própria, em tema claro único.

## Documentos

| Documento | Uso |
|---|---|
| [ESPECIFICACAO.md](./ESPECIFICACAO.md) | Escopo funcional, telas, navegação, mapa, notificações, perfil e recomendações técnicas |
| [ROADMAP.md](./ROADMAP.md) | Etapas de implementação, critérios de saída e referências por fase |
| [REFERENCIAS.md](./REFERENCIAS.md) | Seções existentes em `docs/projeto` e `docs/traccar` que devem ser usadas pelo app |

## Escopo do app

O app é exclusivo para usuários com JWT `role: "CLIENTE"` e deve expor as mesmas funções do portal cliente web, adaptadas ao mobile:

- Login.
- Mapa/rastreamento como primeira tela após login.
- Relatórios.
- Notificações.
- Geocercas.
- Pagamentos.
- Perfil no drawer, com avatar e lista de veículos associados.

## Status Atual

| Fase | Estado |
|---|---|
| Fase 0 - Preparação | Concluída |
| Fase 1 - Autenticação e sessão | Implementada |
| Fase 2 - Shell do app, drawer e perfil | Implementada |
| Fase 3 - Mapa base e snapshot | Implementada |

## Decisão de mapa

Para o app Expo, a recomendação é usar `react-native-maps` com `provider={PROVIDER_GOOGLE}` em Android e iOS. Assim o app usa o SDK nativo do Google Maps, com melhor integração em React Native do que tentar embutir o Google Maps JavaScript API em WebView.

Motivos:

- Integração nativa com marcadores, polylines, circles, geocercas e câmera do mapa.
- Melhor desempenho e gestos nativos em Android/iOS.
- Funciona bem com Expo/EAS Build quando as chaves de Google Maps são configuradas no `app.json`/`app.config`.
- Evita acoplar o app a uma WebView com a API web do Google Maps.

Uso recomendado:

- Android: `react-native-maps` com Google provider.
- iOS: `react-native-maps` com Google provider para manter consistência visual e funcional entre plataformas.
- Rotas, eventos, snapshot e tempo real continuam vindo do backend AgilLock; o app não deve acessar o Traccar diretamente.

## Assets obrigatórios

| Asset | Uso no app |
|---|---|
| `AgillockSite/img/logo_agillock_new.png` | Tela de login, igual ao site |
| `AgillockSite/img/agillock_new_symbol.png` | Splash animada e marca reduzida no topo do drawer |
| `AgillockSite/js/config.js` | Fonte da configuração atual dos ícones SVG 3D dos veículos |

## Contratos base

O app deve consumir a API pública do backend AgilLock:

- Produção REST: `https://api.agillock.com.br/api`
- Produção WebSocket: `wss://api.agillock.com.br/ws/rastreamento`

Ver referências detalhadas em [REFERENCIAS.md](./REFERENCIAS.md).

## Desenvolvimento Expo Go

Para testar no Expo Go:

```bash
cd app
npx expo start
```

No PowerShell do Windows, se houver bloqueio de execução de script:

```bash
cmd /c npx expo start
```

Quando houver mudança em `babel.config.js`, assets, dependências nativas ou configuração do Expo, reiniciar com cache limpo:

```bash
cmd /c npx expo start --clear
```

Observações da Fase 0:

- O app usa `react-native-paper` para inputs e componentes Material.
- `PaperProvider` deve envolver a navegação com o tema `app/src/theme/paperTheme.ts`.
- Campos comuns devem usar o wrapper `app/src/components/AppTextInput.tsx`, não `TextInput` direto na tela.
- Inputs devem manter o início do valor visível; textos longos ocultam o final.
- Campo de senha deve ter ação de visualizar/ocultar dentro do input.
- O app usa `react-native-reanimated` por causa do drawer.
- `app/babel.config.js` deve manter `react-native-reanimated/plugin`.
- `react-native-worklets` deve ficar fixado na versão esperada pelo Expo SDK 54 (`0.5.1`) para casar com o Expo Go.
- `newArchEnabled` fica `true` no SDK 54, compatível com Expo Go e Reanimated 4.
- `react-native-gesture-handler` deve ser importado no entrypoint `index.ts`.
- `expo-notifications` é usado para pedir permissão após a splash e registrar o Expo Push Token após login.
- Projeto EAS vinculado: `@pedro_castro/agillock-cliente`.
- EAS Project ID: `63e4131c-1fd9-4366-9bf7-d2bbbfafabd2`.
- O `projectId` fica em `app.json` em `expo.extra.eas.projectId`; `EXPO_PUBLIC_EAS_PROJECT_ID` pode sobrescrever esse valor quando configurado.
- Textos de permissão para câmera, fotos e localização ficam em `app.json`; fluxos Android que não aceitam texto nativo customizado devem explicar o motivo na própria tela antes de pedir acesso.
- `expo-image-picker` é usado no bottom sheet de perfil para selecionar e enviar avatar.
- `app/src/components/BottomSheet.tsx` é o componente reutilizável para gavetas inferiores, com animação, toque fora e arraste para fechar.
- `react-native-maps` renderiza a tela Mapa com `PROVIDER_GOOGLE`, snapshot inicial, marcadores e foco por dispositivo.
- `expo-location` atende o botão de localização da tela Mapa.
