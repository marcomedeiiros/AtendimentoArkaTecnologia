# Variáveis de ambiente não declaradas

**O que é isto:** o servidor lê **71** variáveis de ambiente. **32** estão no
`.env.example` ou no `docker-compose.prod.yml`. As **39** desta página existem só
dentro do código — quem opera o sistema não tem como descobrir que elas existem.

**Nenhuma delas quebra nada se faltar:** todas caem num padrão (`|| "lax"`,
`Number(...) || 8`). O problema é de **descoberta**, não de funcionamento. Duas
chaves do WhatsApp já passaram por isso: foram escritas à mão no meio de um
incidente e só depois declaradas no `docker-compose.prod.yml`, com o comentário
de que assim "viajam com o repositório". As 39 abaixo continuam no estado
anterior a essa lição.

Levantado em 14/09/2026 varrendo `process.env.*` em `server/src`. Cada linha traz
o arquivo onde a variável é lida, para conferir o significado na fonte.

---

## Sessão e cookie

| Variável | Padrão | Onde |
| --- | --- | --- |
| `SESSAO_COOKIE_SECURE` | `true` em produção | `config/env.js:131` |
| `SESSAO_COOKIE_SAMESITE` | `lax` | `config/env.js:134` |
| `SESSAO_COOKIE_DOMINIO` | (nenhum) | `config/env.js:136` |

Mexer aqui afeta login em domínio diferente do painel. `SameSite=lax` é o que
faz o cookie sobreviver à navegação normal e não viajar em requisição de outro site.

## Bloqueio progressivo (defesa contra força bruta no login)

| Variável | Padrão | Onde |
| --- | --- | --- |
| `SEG_FALHAS_ATE_ATRASO` | `3` | `config/env.js:195` |
| `SEG_FALHAS_ATE_BLOQUEIO` | `8` | `config/env.js:197` |
| `SEG_BLOQUEIO_BASE` | `60s` | `config/env.js:199` |
| `SEG_BLOQUEIO_MAX` | `30min` | `config/env.js:200` |
| `SEG_JANELA` | `15min` | `config/env.js:202` |
| `SEG_ATRASO_MAX` | `2s` | `config/env.js:205` |

Os mínimos são forçados no código (`Math.max(2, ...)`): não dá para desligar a
proteção baixando o número a zero.

## WhatsApp — reconexão e cofre da sessão

| Variável | Padrão | Onde |
| --- | --- | --- |
| `WHATSAPP_RECONEXAO_INTERVALO_MS` | `15s` | `whatsapp.reconexao.js:44` |
| `WHATSAPP_JANELA_FLAP_MS` | `10min` | `whatsapp.reconexao.js:78` |
| `WHATSAPP_QUEDAS_PARA_FLAP` | `3` | `whatsapp.reconexao.js:81` |
| `WHATSAPP_COFRE_DIR` | derivado | `whatsapp.sessao.js:70` |
| `WHATSAPP_MENU_ENQUETE` | `false` | `chatbot.engine.js:1478` |

Estas são da mesma família das duas que já estão no compose
(`EVOLUTION_SYNC_FULL_HISTORY`, `WHATSAPP_LIMITE_CONNECTING_MS`) e foram
calibradas no incidente de 09/09. Ver
[integracao-whatsapp-estabilidade.md](integracao-whatsapp-estabilidade.md).

## Chatbot — limites do motor

| Variável | Padrão | Onde |
| --- | --- | --- |
| `CHATBOT_SESSAO_TTL_MIN` | `30` | `chatbot.config.js:19` |
| `CHATBOT_HUMANO_TTL_MIN` | `240` | `chatbot.config.js:21` |
| `CHATBOT_MAX_PASSOS` | `50` | `chatbot.config.js:27` |
| `CHATBOT_MAX_TENTATIVAS_CNPJ` | `3` | `chatbot.config.js:29` |
| `CHATBOT_MAX_TENTATIVAS_OPCAO` | `3` | `chatbot.config.js:32` |
| `CHATBOT_MAX_TENTATIVAS_MENU` | `3` | `chatbot.config.js:34` |
| `CHATBOT_MAX_DELAY_MS` | `5000` | `chatbot.config.js:36` |
| `CHATBOT_RESPOSTAS_AUTOMATICAS` | `false` | `chatbot.config.js:14` |
| `CHATBOT_INATIVIDADE_INTERVALO_MS` | `60s` | `chatbot.inatividade.js:34` |

`CHATBOT_MAX_PASSOS` é a trava contra fluxo em laço: sem ela, um fluxo mal
montado manda mensagem para sempre.

## Padrões de configuração (só valem na PRIMEIRA vez)

Estas alimentam o valor inicial de configurações que, depois de salvas pela tela,
passam a morar no banco. Mudar a variável **não** muda o que já foi salvo.

| Variável | Padrão | Onde |
| --- | --- | --- |
| `ATENDIMENTO_MODO` | `local` | `configuracao.service.js:76` |
| `CHATBOT_HORARIO` | (vazio) | `configuracao.service.js:107` |
| `CHATBOT_FILAS` | (vazio) | `configuracao.service.js:116` |
| `CHATBOT_PESQUISA` | (vazio) | `configuracao.service.js:133` |
| `PAINEL_META_DIARIA` | (vazio) | `configuracao.service.js:124` |
| `HELPDESK_SLA` | (vazio) | `configuracao.service.js:137` |

## Serviços externos

| Variável | Padrão | Onde |
| --- | --- | --- |
| `N8N_URL` | `http://localhost:5678` | `configuracao.service.js:64` |
| `N8N_API_KEY` | (vazio) — **segredo** | `configuracao.service.js:65` |
| `N8N_WEBHOOK_FLUXO` | (vazio) | `configuracao.service.js:67` |
| `TRANSCRICAO_URL` | Groq | `transcricao.client.js:13` |
| `TRANSCRICAO_API_KEY` | usa `GROQ_API_KEY` antes | `configuracao.service.js:80` |
| `CORRECAO_URL` | Groq | `correcao.client.js:28` |

## Outras

| Variável | Padrão | Onde |
| --- | --- | --- |
| `API_DOCS` | fechado em produção; `1` reabre | `app.js:172` |
| `TURNSTILE_HOSTNAME` | (vazio) | `config/env.js:177` |
| `FOTOS_RENOVACAO_INTERVALO_MS` | `1h` | `conversa.fotos.js:28` |
| `FOTOS_RENOVACAO_MAX` | `25` por rodada | `conversa.fotos.js:34` |

---

## Como manter esta página honesta

Ela envelhece igual a qualquer documento. Para refazer a conta:

```bash
# lista toda variável lida no servidor que não aparece no .env.example nem no compose
node -e '...' # o comando completo está na auditoria de 14/09
```

Ver [auditoria-defeitos-14-09.md](auditoria-defeitos-14-09.md), achado 6.
