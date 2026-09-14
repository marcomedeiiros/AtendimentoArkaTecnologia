# Auditoria de defeitos — 14/09/2026

**Escopo:** o projeto inteiro, procurando **o que está quebrado hoje** e **o que
tende a quebrar** — não uma descrição do sistema (essa é a
[auditoria-do-projeto.md](auditoria-do-projeto.md), de 09/09).

**Método:** execução, não leitura. Todo achado abaixo tem o comando que o
produziu e pode ser reproduzido. Onde a conclusão foi **deduzida** e não medida,
está dito com todas as letras.

**Medido em:** 232 arquivos `.js`/`.jsx` (150 no servidor, 82 no painel),
60 scripts `verificar-*.js`, 22 modelos no banco.

---

## Resumo

| # | Achado | Gravidade | Situação |
| --- | --- | --- | --- |
| 1 | Dois scripts não abrem: `SyntaxError` na própria mensagem de "obsoleto" | Média | **Corrigido** |
| 2 | O único teste vermelho da suíte é alarme falso | Média | **Corrigido** |
| 3 | Um util criado para acabar com uma duplicação não é importado por ninguém | Média | **Corrigido** |
| 4 | 6 vulnerabilidades nas dependências do servidor | Média | **3 corrigidas, 3 recusadas** — ver abaixo |
| 5 | `api` sem `healthcheck`; o `web` sobe mesmo com ela em crash-loop | Média | **Corrigido** |
| 6 | 39 variáveis de ambiente existem no código e em lugar nenhum mais | Baixa | **Documentado** em outro arquivo |
| 7 | 135 linhas de código morto no painel | Baixa | **Corrigido** |
| 8 | Nenhum linter configurado em 64.580 linhas | Baixa | **Corrigido** — e o resultado está no achado 10 |
| 9 | Bundle principal a 36 KB do limite de aviso | Informativo | Sem ação |
| 10 | 17 dependências de hook incompletas (achado NOVO, do linter) | Baixa | **Reportado, não corrigido** |

Todos os consertos foram feitos em 14/09/2026, com a bateria
(`cd server && npm test`) rodada depois: **TUDO PASSOU**, 0 falhas — a primeira
vez que a suíte fica inteiramente verde desde a medição inicial desta auditoria.

---

## 1. Dois scripts não abrem — e a mensagem que eles existem para dar nunca sai

**Gravidade: média. Quebrado agora. Conserto de um minuto.**

```bash
node --check server/corrigir-espera-identificacao.js
node --check server/ver-menu-principal.js
```

Os dois morrem com `SyntaxError`. A causa é a mesma nos dois, e é irônica: eles
foram desativados de propósito, e a mensagem de desativação tem aspas duplas
**dentro** de uma string de aspas duplas.

```js
"Motivo: apesar do nome "ver", ele faz update no bloco do menu."
//                      ^^^^^ fecha a string aqui
```

O efeito não é o script rodar errado — é ele **nunca dizer o que queria dizer**.
Quem rodar recebe um erro de sintaxe cru em vez de *"use `publicar-fluxo-arka.js`"*,
que era exatamente a informação que o aviso existia para entregar. E
`corrigir-espera-identificacao.js` ainda aparece recomendado em dois documentos
de `.planning/`, então alguém pode de fato tentar.

Conferi os outros 5 scripts com o mesmo cabeçalho de obsoleto
(`atualizar-botao-financeiro*.js`, `corrigir-espera-problema.js`,
`corrigir-fluxo-completo.js`, `editar-menu.js`): **todos abrem sem erro**. Só
quebram os dois cuja mensagem tem aspas internas — o que confirma o diagnóstico.

**Feito:** as aspas internas viraram simples nas duas linhas. Conferido com
`node --check` (passa) e rodando `node ver-menu-principal.js`, que agora imprime
o aviso e sai com 1, como sempre quis. Nenhum risco: o código abaixo já era
inalcançável (`process.exit(1)`).

---

## 2. O único teste vermelho da suíte é alarme falso

**Gravidade: média. É o teste que está errado, não o código.**

```bash
cd server && npm test     # 59 de 60 passam
node verificar-contato-encaminhado.js
#   FALHA o mapper repassa o metadata inteiro (o vCard chega na tela)
```

A asserção não testa comportamento — ela testa o **texto-fonte** do mapper:

```js
check(/midia:\s*tipo !== "texto" \? \{ \.\.\.meta/.test(mapper), ...)
```

E a linha mudou por um motivo **legítimo e de segurança**: hoje é
`{ ...semSegredo(meta), ... }`, porque `segredo` (a chave que decifra a edição da
mensagem) ia junto no espalhamento e acabava no payload do SSE — visível no
console de qualquer navegador aberto na Central.

O comportamento que a asserção queria garantir continua valendo. Medido:

```bash
node -e '...mapMensagem({metadata:{tipo:"contato",vcard:"...",segredo:"X"}})...'
#   vcard chega na tela: true
#   segredo vaza: false
```

**Por que isso importa mais do que parece:** um teste permanentemente vermelho
treina a equipe a ignorar a suíte inteira. Foi o que quase aconteceu comigo hoje
— precisei medir com `git stash` para separar "é meu" de "já estava assim". Um
harness com uma luz vermelha crônica deixa de ser harness.

**Feito:** a asserção deixou de olhar para o texto do arquivo e passou a chamar
`mapMensagem`, conferindo o que sai — que é o que a tela recebe. De quebra, ela
agora cobre o vazamento: uma segunda asserção falha se `segredo` voltar ao
payload. Teste que mede forma reprova refatoração certa e aprova regressão que
mantenha a linha parecida; este mede resultado.

---

## 3. Um util criado para acabar com uma duplicação não é importado por ninguém

**Gravidade: média. Latente — hoje as cópias ainda concordam.**

`client/src/utils/imagem.js` existe e diz no próprio cabeçalho por que existe:

> *"(a flutuante de reportar e a edição do relato na tela de Bugs). Com uma cópia
> em cada, os limites divergiriam do servidor no primeiro ajuste."*

Só que **nenhum arquivo o importa**. As duas telas que ele deveria servir têm
cada uma a sua cópia de `lerComoDataUrl` e das constantes:

| Onde | `lerComoDataUrl` | `MAX_IMAGENS` | `MAX_BYTES` |
| --- | --- | --- | --- |
| `client/src/utils/imagem.js` (não usado) | sim | 3 | 3 MB |
| `client/src/components/ReportarBug.jsx:30` | **cópia** | 3 | 3 MB |
| `client/src/pages/BugsPage.jsx:25` | **cópia** | 3 | 3 MB |
| `server/src/modules/bugs/bug.imagens.js` | — | 3 | 3 MB |

Medido: os quatro concordam **hoje**. O defeito é o próximo ajuste — mudar o
limite para 5 imagens exige lembrar de quatro lugares, e o primeiro esquecido
produz exatamente a divergência que o util foi escrito para impedir: a tela
aceita o arquivo e o servidor recusa depois do upload.

É a mesma classe do `empresaDaConversa`, resolvida em 14/09: a regra tem de ter
uma casa só. Aqui a casa já foi construída — faltou mudar para dentro.

**Feito:** `ReportarBug.jsx` e `BugsPage.jsx` agora importam `MAX_IMAGENS`,
`ACCEPT_ATTR` e `prepararImagens` de `utils/imagem`; as duas cópias saíram (−75
linhas). Sobrou **uma** definição de cada coisa no painel.

Uma diferença de comportamento, pequena e intencional: as duas telas tinham
textos de erro distintos para a mesma recusa ("Máximo de 3 imagens atingido." x
"Você pode anexar no máximo 3 imagens.") e a `BugsPage` mostrava a ÚLTIMA recusa
enquanto o util mostra a PRIMEIRA. Agora as duas dizem a mesma coisa, que é a
documentada no util.

---

## 4. Seis vulnerabilidades nas dependências do servidor

**Gravidade: média. Medido com `npm audit --omit=dev`.**

| Pacote | Via | Severidade | Alcançável? |
| --- | --- | --- | --- |
| `qs` (2 CVEs) | `express@4.22.2` → `body-parser` | moderada | **Sim** — query string de qualquer requisição |
| `deepmerge-ts` | `prisma` (CLI) | alta | Não em runtime — é ferramenta de build |

O `qs` é o que importa: DoS por entrada controlada pelo atacante, no caminho que
o Express usa para ler **toda** query string. O painel está atrás de Cloudflare e
tem rate limit, o que reduz — mas não elimina — a exposição.

O `deepmerge-ts` entra pelo CLI do Prisma, que não roda servindo requisição. A
severidade "alta" do relatório é do pacote, não da nossa exposição.

O cliente: **0 vulnerabilidades**.

**Feito:** `npm audit fix` no `server`. O Express foi de **4.22.2 para 4.22.3** e
o `qs` para **6.16.0** — as três moderadas, que eram as alcançáveis em runtime,
sumiram. Só o `package-lock.json` mudou; o `package.json` continua em
`express: ^4.21.2`. A bateria rodou depois: TUDO PASSOU.

**As 3 altas do `deepmerge-ts` ficam, e isto é uma decisão, não um esquecimento.**
O único caminho é subir o Prisma de 6.19 para 8.x — que hoje é **release
candidate** (`8.0.0-rc.15`). Nem `npm audit fix --force` oferece o salto. Trocar
o ORM de um sistema em produção por uma versão candidata, para corrigir um
esgotamento de pilha num *merge de configuração* que roda no deploy e nunca
servindo requisição, é aceitar um risco grande para eliminar um pequeno.

**Revisitar quando:** o Prisma 8 sair como estável. Aí o upgrade é trabalho
planejado, com a bateria rodando, e não remendo de auditoria.

---

## 5. A API não tem healthcheck, e o painel sobe mesmo com ela caída

**Gravidade: média. Deduzido da configuração, não reproduzido em produção.**

Em `docker-compose.prod.yml`:

- `evolution-api` tem `healthcheck`. `evolution-db` tem `healthcheck`.
- **`api` não tem.**
- `web` declara `depends_on: api: condition: service_started` — ou seja, basta o
  processo **iniciar**, não ficar de pé.

O cenário já aconteceu neste projeto (o 502 pós-deploy, quando uma mudança de
schema derrubava o `arka-api` em crash-loop): o nginx do `web` sobe normalmente,
responde 502, e `docker compose ps` mostra o `api` "Up" a cada reinício — sem
nenhum sinal de que ele está morrendo e voltando. O diagnóstico depende de
alguém pensar em `docker logs`.

**Feito:** `healthcheck` na `api` batendo em `/health` (rota existente, sem
autenticação, que não toca no banco), a cada 30s, com `start_period` de 40s.
Medido: subi o servidor e rodei o comando exato do healthcheck — **status 200**.

**Não mudei** o `web` para `condition: service_healthy`, de propósito: isso faria
o painel não subir enquanto a API estivesse doente, e numa central de atendimento
uma tela que abre com erro é melhor que uma tela que não abre. É sinalização,
exatamente a escolha que o compose já documenta para a Evolution — o health
vermelho aparece no `docker compose ps` sem derrubar ninguém.

O YAML foi validado (`js-yaml`). O healthcheck em si só pode ser observado com
Docker, que não existe nesta máquina — vale conferir no próximo deploy com
`docker compose ps`.

---

## 6. Trinta e nove variáveis de ambiente existem no código e em lugar nenhum mais

**Gravidade: baixa. Nenhuma quebra hoje — todas têm padrão no código.**

O servidor lê **71** variáveis. **39** não aparecem nem no `.env.example` nem no
`docker-compose.prod.yml`. Entre elas:

```
SESSAO_COOKIE_SECURE   SESSAO_COOKIE_SAMESITE   SESSAO_COOKIE_DOMINIO
SEG_FALHAS_ATE_BLOQUEIO   SEG_BLOQUEIO_MAX   SEG_JANELA   (bloqueio progressivo)
WHATSAPP_RECONEXAO_INTERVALO_MS   WHATSAPP_QUEDAS_PARA_FLAP   WHATSAPP_COFRE_DIR
CHATBOT_MAX_TENTATIVAS_CNPJ   CHATBOT_SESSAO_TTL_MIN   CHATBOT_PESQUISA
N8N_API_KEY   TRANSCRICAO_API_KEY   TURNSTILE_HOSTNAME
```

Confirmei que todas caem em padrão (`|| "lax"`, `Number(...) || 8`), então nada
falha na ausência. O problema é **descoberta**: quem opera não tem como saber que
esses botões existem. O `docker-compose.prod.yml` já traz o comentário de duas
chaves do WhatsApp que foram "escritas à mão no meio de um incidente" e
declaradas ali justamente para viajarem com o repositório — as outras 39 estão no
estado anterior a essa lição.

**Feito pela metade, e a metade que falta é sua.** Escrevi
[variaveis-de-ambiente.md](variaveis-de-ambiente.md) com as 39, agrupadas por
assunto, com o padrão real extraído do código e o arquivo:linha de cada uma.

O destino natural seria o `.env.example`, mas o ambiente onde esta auditoria
rodou **bloqueia escrita em arquivos `.env*`** (regra de proteção contra mexer em
segredo). Então ou o conteúdo é copiado para lá à mão, ou a página de docs passa
a ser a referência — e aí vale um ponteiro para ela no `.env.example`.

---

## 7. Código morto no painel

**Gravidade: baixa.**

Três arquivos nunca importados (medido varrendo todas as referências relativas):

| Arquivo | Linhas | Observação |
| --- | --- | --- |
| `client/src/utils/imagem.js` | 69 | **não é lixo** — é o achado nº 3, deveria estar em uso |
| `client/src/utils/wallpaper.js` | 55 | exporta `wallpaperStyle`, ninguém consome |
| `client/src/pages/HelpDeskPage.jsx` | 11 | a tela viva é `components/pages/HelpDeskPainel.jsx` |

No servidor: **0 arquivos órfãos** em 150.

---

## 8. Nenhum linter configurado

**Gravidade: baixa, mas é a origem provável de defeitos futuros.**

```bash
npx eslint src/    # ESLint couldn't find an eslint.config.* file
```

Não há `eslint.config.*`, `.eslintrc*` nem `eslintConfig` no `package.json`, nos
dois lados. Em 64.580 linhas — 6.114 só no `AtendimentoView.jsx` — nada verifica
automaticamente:

- **dependências de hooks do React** (`useEffect`/`useMemo`/`useCallback`), que
  produzem *stale closure*: a tela usa um valor velho e ninguém vê o erro,
  porque não há erro — há um número desatualizado;
- variável usada antes de declarar, import não usado, `case` sem `break`.

A suíte `verificar-*.js` é excelente no que cobre (regra de negócio medida contra
o banco), mas ela não olha para essa classe de problema.

**Conserto:** `eslint` + `eslint-plugin-react-hooks` só com as regras de hooks
ligadas, tratando o resto como aviso. Rodar uma vez para ver o tamanho do buraco
antes de decidir o que ligar.

---

## 9. O bundle está a 36 KB do limite de aviso

**Informativo. Sem ação.** `chunkSizeWarningLimit: 700` em `vite.config.js`; o
chunk principal está em **664 KB**. O limite já foi levantado uma vez. Cresce a
cada tela nova — as mudanças de hoje somaram ~3 KB.

Não mexi porque não há defeito: dividir o bundle é decisão de desempenho, com
medição própria (o `jspdf`/`html2canvas` já estão em chunk separado justamente
por isso). Levantar o limite de novo seria esconder o termômetro.

---

## 10. Dezessete dependências de hook incompletas — achado novo, do linter

**Gravidade: baixa. Reportado, NÃO corrigido — e a explicação importa.**

Assim que o linter do achado 8 entrou, ele mediu o que ninguém media:

```
✖ 17 problems (0 errors, 17 warnings)
   17  react-hooks/exhaustive-deps
```

**Zero erros** é a notícia boa, e não é pouca: em 64 mil linhas não há hook
dentro de `if`, variável inexistente, chave duplicada em objeto nem código
inalcançável. O código está mais são do que o tamanho sugere.

Os 17 avisos são dependências omitidas — `AtendimentoView.jsx` concentra 11
deles, `VisualFlowEditor.jsx` 4. **Não consertei nenhum de propósito.** Incluir
uma dependência que falta pode transformar um efeito que rodava uma vez num
efeito que roda a cada render — e, quando o efeito escreve no estado que ele
próprio observa, isso é laço infinito. A correção certa é caso a caso, com a
tela na frente, e vale uma sessão própria.

Um deles eu corrigi, porque não era uma decisão e sim um defeito:
`AtendimentoView.jsx:2855` tinha um `eslint-disable-next-line` **dentro** do
corpo do efeito, na mesma linha do `irParaFim(false)`. "Next line" apontava para
a linha seguinte, que não era a do aviso: a diretiva não desligava nada e ainda
era reportada como inútil. Agora ela está na linha anterior ao array de
dependências, com o motivo escrito — o efeito deve reagir à troca de conversa e
só a ela, senão a tela salta para o fim no meio da leitura de uma mensagem antiga.

---

## O que foi verificado e está limpo

Isto é metade de uma auditoria: dizer onde **não** há problema, para que ninguém
procure de novo.

| Verificação | Resultado |
| --- | --- |
| Sintaxe de todos os `.jsx`/`.js` do painel | **0 erros** (82 arquivos) |
| Sintaxe do servidor (`src/`) | **0 erros** (150 arquivos) |
| `import`/`require` apontando para arquivo inexistente | **0**, nos dois lados |
| Segredos versionados (`.env`, `.pem`, chaves) | **0** — só `.env.example`; `.gitignore` cobre `.env` e `.env.*` |
| Chave/token fixo no código | **0** |
| `dangerouslySetInnerHTML` | **0** |
| SQL cru com entrada do usuário | **0** — o único `$queryRawUnsafe` são PRAGMAs fixos do SQLite |
| Rotas sem autenticação | **0** em 20 arquivos de rota |
| Rotas de escrita sem validação | **0** |
| `console.log` no painel | **0** |
| `TODO`/`FIXME`/`HACK` de verdade | **0** (as 15 ocorrências são a palavra "todo" em português) |
| `catch {}` vazio | 2, ambos em `utils/sound.js` — áudio que pode falhar sem consequência |
| `await` faltando em chamada assíncrona | **0** confirmados (4 candidatos, todos falsos positivos: `Promise.all` e retorno de arrow) |
| Schema do Prisma | válido, e o banco está em dia (`migrate status`) |
| `unhandledRejection` / `uncaughtException` | tratados em `server.js` |
| `npm audit` do painel | **0 vulnerabilidades** |

---

## O que ficou de fora, e por quê

Três coisas não foram consertadas. Nenhuma por esquecimento:

| O quê | Por que não |
| --- | --- |
| As 3 vulnerabilidades altas do `deepmerge-ts` (achado 4) | O único caminho é o Prisma 8, que hoje é release candidate. Trocar o ORM de um sistema em produção por uma versão candidata, para corrigir um bug de build-time, é pagar caro por pouco. Revisitar quando sair estável. |
| As 17 dependências de hook (achado 10) | Incluir uma dependência que falta pode virar laço infinito de render. Exige a tela na frente, caso a caso. |
| O `.env.example` (achado 6) | O ambiente desta auditoria bloqueia escrita em `.env*`. O conteúdo está pronto em [variaveis-de-ambiente.md](variaveis-de-ambiente.md). |

## O que passou a existir

| Arquivo | O que é |
| --- | --- |
| `client/eslint.config.js` | linter enxuto: só regras que apontam defeito, não gosto |
| `client/package.json` | `npm run lint` e `npm run lint:erros` (só o que bloqueia) |
| `docs/variaveis-de-ambiente.md` | as 39 variáveis, com padrão e arquivo:linha |
| `docker-compose.prod.yml` | `healthcheck` da `api` |

## Como conferir tudo de novo

```bash
cd server && npm test        # TUDO PASSOU, 0 falhas
cd client && npm run lint    # 0 erros, 17 avisos (achado 10)
cd client && npm run build   # passa
cd server && npm audit --omit=dev   # 3 altas, todas do Prisma CLI
```
