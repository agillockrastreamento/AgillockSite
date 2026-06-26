# Consulta Automática de Multas — Detran CE

Documentação completa da funcionalidade de **consulta automática de multas, débitos de IPVA e situação de licenciamento** de veículos, integrada ao Detran CE, com geração de boleto (PDF) e Pix.

> Status: **Especificação / pré-implementação** (recon técnico concluído em 2026-06-26). Nada foi implementado ainda — estes documentos definem o que será construído.

## Índice

| Documento | Conteúdo |
|---|---|
| [RECONHECIMENTO_DETRAN_CE.md](RECONHECIMENTO_DETRAN_CE.md) | Como o site do Detran CE funciona: endpoints, fluxo HTTP, payloads, boleto/Pix. **Base técnica de tudo.** |
| [ARQUITETURA.md](ARQUITETURA.md) | Visão geral, fluxo de dados entre backend/site/app, decisões de design |
| [BANCO_DE_DADOS.md](BANCO_DE_DADOS.md) | Modelos Prisma novos, flag em `Cliente`, migrações |
| [API.md](API.md) | Rotas do backend (admin e cliente), payloads e respostas |
| [SCHEDULER.md](SCHEDULER.md) | Consulta automática 2×/dia (10h e 17h), retry, logging |
| [NOTIFICACOES.md](NOTIFICACOES.md) | Notificações ao cliente (multa nova, vencimento 7 dias e no dia) e ao admin (resumo de cada consulta) |
| [CONECTIVIDADE_PROXY.md](CONECTIVIDADE_PROXY.md) | Bloqueio de rede do servidor → Detran, solução por proxy BR, custos e como validar |
| [FRONTEND_ADMIN.md](FRONTEND_ADMIN.md) | Botão de habilitar em clientes + tela de multas do admin + aba de histórico |
| [FRONTEND_CLIENTE_APP.md](FRONTEND_CLIENTE_APP.md) | Tela "Multas" no site do cliente e no app |
| [PLANO_IMPLEMENTACAO.md](PLANO_IMPLEMENTACAO.md) | Ordem de execução, fases e checklist |

## Resumo da funcionalidade

1. **Habilitação por cliente (admin):** na tela de clientes do admin, um botão em "Ações" liga/desliga a consulta de multas para aquele cliente. Default **desligado**.
2. **Ao habilitar:** a tela "Multas" passa a aparecer no site e no app daquele cliente, e o veículo entra na rotina de consulta automática.
3. **Consulta automática 2×/dia (10h e 17h, horário de Brasília):** para cada veículo de cliente habilitado, o backend consulta o Detran CE e armazena:
   - Tabela completa de multas (AIT, motivo, datas, valores)
   - Situação de **IPVA** (possui débito / não possui)
   - Situação de **licenciamento** (pendente / em dia)
   - **Pix** (copia-e-cola + QR Code) e **boleto PDF** para pagamento à vista
4. **Tela do admin:** acesso às multas de todos os clientes habilitados, com filtros, dados de pagamento, busca individual sob demanda e uma **aba de histórico** das execuções (horário, sucesso/erro, duração, nº de multas coletadas, nº de clientes/veículos).
5. **Tela do cliente (site + app):** lista de multas dos seus veículos com tabela completa, download do PDF, QR Code/Pix, opção de pagar **uma** multa ou **todas**, e o aviso de que os dados vêm do Detran e são atualizados 2×/dia (10h e 17h).
6. **Notificações** (ver [NOTIFICACOES.md](NOTIFICACOES.md)):
   - **Cliente** recebe (site + app) quando há **multa nova** (só quando surge AIT inédita — não repete), e lembretes a **7 dias do vencimento** e **no dia do vencimento**.
   - **Admin** recebe a cada consulta (10h/17h) um resumo: concluída com X multas de Y clientes em Z tempo — ou aviso de falha.

## Infraestrutura

- **Servidor de produção:** Hostinger, IP `72.62.13.73` (`srv1513597.hstgr.cloud`), São Paulo/BR (AS47583 Hostinger).
- ⚠️ **Bloqueio confirmado:** o Detran **descarta todo o tráfego** desse servidor (TCP 80/443 sem resposta → `000`). Será necessário um **proxy residencial BR**. Diagnóstico, custos (~US$ 5–15/mês) e validação em [CONECTIVIDADE_PROXY](CONECTIVIDADE_PROXY.md). O código independe disso (é uma env `HTTPS_PROXY`); em dev local funciona direto.
- **Parser:** `cheerio` (confirmado).
- **Sem captcha** no fluxo usado (ver RECONHECIMENTO). **Não requer Puppeteer** — apenas HTTP (a integração será feita com `fetch`/`axios` + cheerio).
