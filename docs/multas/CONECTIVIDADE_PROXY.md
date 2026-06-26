# Conectividade e Proxy

Documenta o bloqueio de rede entre o servidor de produção e o Detran CE, e a solução (proxy BR).

## Diagnóstico (2026-06-26)

Testes rodados **no servidor de produção** (Hostinger, `srv1513597`, IP `72.62.13.73`, São Paulo/BR):

| Teste | Resultado | Conclusão |
|---|---|---|
| `curl https://www.google.com` | `200` | Saída HTTPS do servidor funciona |
| `getent hosts sistemas.detran.ce.gov.br` | `189.90.170.40` | DNS resolve normalmente |
| `curl -v https://sistemas.detran.ce.gov.br/central` | `Trying 189.90.170.40:443...` trava → `000` | TCP 443 sem resposta |
| `curl -v http://sistemas.detran.ce.gov.br` | `Trying 189.90.170.40:80...` trava | TCP 80 também sem resposta |

**Conclusão:** o servidor sai para a internet e resolve o DNS, mas **todo** tráfego TCP para o IP do Detran (`189.90.170.40`, portas 80 e 443) é **descartado silenciosamente** (timeout, sem SYN-ACK). É um **bloqueio do lado do Detran/firewall** contra o IP/faixa do datacenter (ASN Hostinger AS47583). Não é configuração do nosso código nem do firewall de saída.

Da máquina local (rede residencial/outra) o acesso ao Detran funciona 100% — confirma que o problema é a **origem** (IP do servidor) recusada pelo destino.

### Reproduzir o diagnóstico
```bash
curl -s -o /dev/null -w "google: %{http_code}\n" https://www.google.com --connect-timeout 15
getent hosts sistemas.detran.ce.gov.br
curl -v --connect-timeout 20 https://sistemas.detran.ce.gov.br/central 2>&1 | head -40
curl -s -o /dev/null -w "ip-base: %{http_code}\n" https://sistemas.detran.ce.gov.br --connect-timeout 15
```

## Solução: rotear as chamadas do Detran por um proxy BR

Apenas as requisições do `detran-ce.service` devem sair por um IP que o Detran aceite. O service suportará a variável de ambiente **`HTTPS_PROXY`** (e/ou um agente de proxy configurável). O resto do backend continua direto.

> ⚠️ Precisa ser proxy **residencial BR** (ou "ISP / static residential" BR). Proxy de **datacenter NÃO serve** — seria bloqueado pelo mesmo motivo que o servidor atual.

## Volume de dados (base do custo)

Por consulta de um veículo trafega ~250 KB — dominado pelo PDF do boleto (~130 KB); o HTML é pequeno. Estimativa com 2 consultas/dia:

| Frota | Dados/mês | Observação |
|---|---|---|
| ~50 veículos | ~0,7 GB | cabe no plano mínimo de qualquer provedor |
| ~200 veículos | ~3 GB | volume ainda pequeno |

Dá para reduzir ainda mais não pré-gerando o PDF "de todas" a cada rodada (gerar só sob demanda no pagamento).

## Custo estimado

Valores de mercado (variam por provedor e podem mudar — confirmar no momento da contratação):

| Tipo | Modelo de cobrança | Faixa aprox. | Serve? |
|---|---|---|---|
| **Residencial rotativo BR** | por GB | ~US$ 2–8/GB; plano mínimo ~US$ 5–15/mês | ✅ recomendado |
| **Residencial fixo (ISP/static) BR** | por IP/mês | ~US$ 2–6/IP/mês | ✅ ótimo (previsível, pouca banda) |
| **Datacenter** | por IP/mês | ~US$ 1/IP/mês | ❌ provavelmente bloqueado |

**Custo prático para começar: ~US$ 5–15/mês (~R$ 30–80/mês).** Para nosso volume, o plano mínimo sobra.

Provedores conhecidos: IPRoyal, Webshare, Decodo (ex-Smartproxy), Bright Data, Oxylabs.

### Alternativa de custo zero em proxy
Rodar um **mini-worker numa máquina da rede do cliente** (que já alcança o Detran) que executa só as chamadas ao Detran; o backend da Hostinger conversa com esse worker. Sem mensalidade de proxy — em troca, precisa de uma máquina sempre ligada e de expor um endpoint interno seguro. (Ver [ARQUITETURA](ARQUITETURA.md), decisão de escopo geográfico.)

## Validar um proxy antes de contratar

Alguns IPs residenciais também podem estar bloqueados. Ao ter um candidato, testar:
```bash
# substitua usuario:senha@host:porta pelo proxy
curl -x http://usuario:senha@host:porta -s -o /dev/null -w "%{http_code}\n" \
  --connect-timeout 20 https://sistemas.detran.ce.gov.br/central
```
Esperado **`200`**. Se vier `000`/timeout, o IP do proxy também está bloqueado — trocar de IP/provedor.

## Configuração no backend (quando houver proxy)
- Definir `HTTPS_PROXY` (e `HTTP_PROXY`) no ambiente do backend **ou** uma env dedicada (ex. `DETRAN_PROXY_URL`) lida pelo `detran-ce.service` para isolar o proxy só às chamadas do Detran.
- Recomendado isolar (env dedicada) para não rotear todo o tráfego do backend pelo proxy — só o do Detran.
- Sem proxy definido, o service tenta conexão direta (funciona em dev/local; falha no servidor atual de produção).
