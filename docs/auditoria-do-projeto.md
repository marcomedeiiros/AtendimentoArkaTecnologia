# Auditoria do projeto

**Data:** 2026-09-09 · **Escopo:** o sistema inteiro — servidor, painel, banco,
rede de testes, segurança e operação.
**Método:** leitura do código e **execução** da suíte. Tudo o que está marcado
como **medido** foi rodado, não deduzido.

Este documento existe para responder três perguntas que não tinham onde ser
respondidas: *o que este sistema é, o que nele está frágil, e o que não se pode
quebrar.*

---

## 1. O sistema, em números

| | |
| --- | --- |
| Servidor (`server/src`) | **30.319** linhas, 20 módulos |
| Painel (`client/src`) | **29.957** linhas |
| Modelos no banco | **22** (SQLite via Prisma) |
| Rotas | 20 arquivos de rota |
| Scripts de verificação | **58** (`verificar-*.js`) |
| Commits | 440 |
| Documentos de auditoria | 6, contando este |

Em uma frase: é uma **central de atendimento por WhatsApp** com chatbot de fluxo
configurável, fila por setor, OS por atendimento, pesquisa de satisfação,
rankings de equipe e relatórios — servindo uma operação real, hoje, em produção.

---

## 2. Onde o peso está concentrado

| Arquivo | Linhas | O que decide |
| --- | --- | --- |
| `chatbot.engine.js` | **4.987** | tudo o que o bot faz sozinho |
| `conversa.service.js` | 1.940 | o ciclo de vida do atendimento |
| `whatsapp.service.js` | 1.468 | a porta de entrada (webhook) |
| `conversa.repository.js` | 1.130 | as consultas que sustentam a Central |
| `painel.service.js` | 1.026 | a Visão Geral |
| `evolution-api.client.js` | 766 | a conversa com a Evolution |
| `whatsapp.reconexao.js` | 652 | o vigia do pareamento |

**O motor é o risco estrutural do projeto.** Quase 5.000 linhas num arquivo só,
e é o arquivo onde um erro é mais caro: ele fala com o cliente sem ninguém
olhando. Os dois defeitos de citação corrigidos hoje nasceram ali, e o segundo
nasceu **de dentro do próprio arquivo** — a lista certa
(`AGUARDA_RESPOSTA_DO_CLIENTE`) estava setenta linhas acima da condição errada.

Isso não é argumento para reescrevê-lo. É argumento para que toda mudança nele
venha com cenário, o que hoje acontece.

---

## 3. A rede de proteção: 58 scripts, e o que eles realmente cobrem

O projeto não usa framework de teste. Usa scripts próprios que rodam contra o
código real e imprimem `OK`/`FALHA`. Na prática funciona melhor do que parece:
eles são legíveis, contam o *porquê* de cada checagem, e travam comportamento —
não implementação.

**Cobertura real, por área** (pelos nomes dos 58 scripts):

* **forte** — chatbot e fluxos, WhatsApp/webhook, conversas e mídia,
  transferência, inatividade, horário, rankings, segurança;
* **fraca** — agenda, campanhas/envio em massa, helpdesk, preferências, n8n;
* **ausente** — nada cobre o painel administrativo de configurações.

O ponto cego que mais custou hoje já foi corrigido: nada exercitava o
**repositório de verdade** no caminho da reação, e por isso um defeito que
apagava mídia sobreviveu meses sob um teste que dizia cobri-lo.

---

## 4. As quatro falhas antigas — agora diagnosticadas

`verificar-tudo.js` **não passa 100%**, e há tempos se convive com "as 4 falhas
pré-existentes" sem que ninguém soubesse o que eram. **Medido hoje, uma por
uma:**

### 4.1 · `verificar-rankings.js` — CRASH, e é bug de produção

```
TypeError: itens.filter is not a function
  at completudeDe (pontuacao.externa.js:116)
  at Array.map (pontuacao.externa.js:222)
```

A causa é uma armadilha clássica de JavaScript:

```js
const mediaCompletude = media(entregues.map(completudeDe));
```

`Array.prototype.map` chama a função com **três** argumentos — `(item, índice,
array)`. E a assinatura é:

```js
function completudeDe(m, itens = ITENS_MAPEAMENTO)
```

Então `itens` recebe o **índice** (um número), o valor padrão nunca entra, e
`0.filter(...)` estoura. **Não é artefato de teste:** isso quebra sempre que
existir ao menos um relatório entregue — ou seja, o ranking externo está
derrubado em produção desde que a linha existe.

E há um segundo defeito escondido no mesmo lugar: o checklist configurável
(`itensEmVigor`, calculado na linha 185, dez linhas acima) **é ignorado**. Mesmo
sem o crash, a conta usaria a lista de fábrica, não a que a empresa configurou —
que é a razão de ser da funcionalidade.

**Correção (uma linha):**

```js
const mediaCompletude = media(entregues.map((m) => completudeDe(m, itensEmVigor)));
```

### 4.2 · `verificar-ranking-equipe.js` — quem tem zero ponto some da Visão Geral

Oito checagens falhando, todas do mesmo tronco:

```
FALHA quem tem zero ponto aparece na Visao Geral
FALHA Carla com undefined pts (so tem OS aberta, nada fechado)
FALHA quem so tem OS ABERTA tambem tem ultimo atendimento
```

Quem ainda não fechou nenhuma OS **não entra na lista** — e quando entra, entra
com `undefined pts` em vez de `0`. O teste é explícito sobre a intenção: entra
todo mundo, e a "parede" (o pódio público) é que corta no top 3. Hoje a
exclusão acontece antes, no cálculo.

Efeito prático: um atendente novo, ou alguém que só tem atendimento em curso,
desaparece do painel da equipe.

### 4.3 · `verificar-fotos-contatos.js` — o avatar não cai para o boneco

```
FALHA o Avatar cai para o boneco quando o link da foto vence (403)
```

A URL da foto de perfil do WhatsApp expira. Quando expira, o `<img>` falha e
falta o `onError` que troca pelo boneco — a lista de contatos fica com ícones
quebrados. Cosmético, mas visível para todo mundo o tempo todo.

### 4.4 · `verificar-responsivo.js` — duas violações pontuais

```
components/LimiteDeErro.jsx:52   min-h-[60vh]      -> use dvh, ou prefixe com sm:
components/ModoTv.jsx:843        min-w-[330px]     sem max-w-full
```

`vh` no celular conta a barra do navegador e corta conteúdo; `min-w` sem
`max-w-full` estoura a largura em tela pequena. **São duas linhas.**

### O veredito sobre o baseline

Das quatro, **uma é um crash de produção** (4.1), **uma é uma regra de negócio
não cumprida** (4.2) e **duas são de uma linha** (4.3, 4.4).

Conviver com um baseline vermelho tem um custo que já se pagou hoje: quando a
suíte sempre falha, ninguém confia nela para dizer se **a sua** mudança quebrou
algo — e a pergunta "isto é meu ou é antigo?" tem que ser respondida na mão toda
vez. **Zerar as quatro é a maior devolução por esforço que este projeto tem
disponível.**

---

## 5. Segurança

O que existe, e é mais do que a média para um projeto deste porte:

| Middleware | Cobre |
| --- | --- |
| `auth` + `sessaoCookie` | sessão em cookie, refresh com rotação e família revogável |
| `csrf` | escrita protegida |
| `admin` / `permissoes` | autorização por cargo |
| `rateLimit` + `bloqueioProgressivo` | força bruta |
| `turnstile` | cadastro |
| `webhook` | token no webhook da Evolution |
| `validate` | Zod na borda |
| `seguranca-headers.conf` | CSP e cabeçalhos no nginx |

E o princípio está escrito e seguido: **a autorização nunca confia no front** —
o token é validado no banco, e a rota reconfere o que o DTO já filtrou.

Cinco scripts cobrem isso (`exposicao`, `escopo-dados`, `sessao-cookie`,
`bloqueio`, `cabecalhos`, `cadastro-turnstile`) e **todos passam**.

**Ressalva honesta:** não refiz hoje uma revisão de segurança linha a linha.
O que está afirmado acima é o que a estrutura e a suíte mostram, não o resultado
de um pentest.

Um ponto operacional que **não** é código: o `deploy/backup.sh` avisa que
`enviar-backup.sh` não está configurado — nenhuma cópia sai da VM. Foi discutido
e há snapshot externo da VM, então está coberto por outro caminho.

---

## 6. Operação: o que hoje mostrou

A integração WhatsApp ganhou documento próprio
(`integracao-whatsapp-estabilidade.md`), e o resumo que interessa aqui é:

* **o que protege funcionou** — o cofre da sessão, a classificação de 401 vs 408,
  a escada de reconexão que não desiste, o servidor decidindo se o QR aparece;
* **o que faltava era observabilidade.** Três pontos cegos foram fechados hoje:
  evento não roteado agora sai em `info`, o diagnóstico de payload cobre todos os
  eventos, e a conferência do boot **compara** a assinatura em vez de só
  imprimi-la — foi ela que revelou, na primeira execução, que a instância
  assinava três eventos enquanto o contêiner autorizava cinco;
* **o que ainda depende de disciplina** — recriar o contêiner da Evolution é
  operação de janela, e a cascata que ela pode disparar (408 → credencial
  apagada → QR automático → `QRCODE_LIMIT` → logout real) leva seis minutos.

---

## 7. Dívidas e fragilidades, em ordem de retorno

| # | O quê | Custo | Efeito |
| --- | --- | --- | --- |
| 1 | **Ranking externo quebrado** (§4.1) | 1 linha | página derrubada em produção |
| 2 | **Zero ponto some da Visão Geral** (§4.2) | pequeno | atendente novo invisível |
| 3 | **Avatar e responsivo** (§4.3, §4.4) | 3 linhas | baseline verde — e a suíte volta a valer |
| 4 | Cobertura ausente em agenda, campanhas, helpdesk | médio | áreas sem rede |
| 5 | `chatbot.engine.js` com 4.987 linhas | alto | risco estrutural, sem urgência |
| 6 | `QRCODE_LIMIT: 3` | exige janela | converte queda em logout real |
| 7 | Citação de resposta em texto | sem conserto nosso | regressão da Evolution (#2065) |

Os três primeiros somam **menos de um dia** e transformam o baseline de
"4 falhas que ninguém sabe o que são" em "verde".

---

## 8. O que está saudável, e vale não estragar

Vale dizer, porque uma auditoria só de problemas mente por omissão:

* **as decisões estão escritas onde acontecem.** Os comentários deste projeto
  explicam *por que*, não *o que* — e contam o incidente que originou a regra.
  Isso é raro, e é o que permitiu diagnosticar em minutos coisas que levariam
  horas;
* **as invariantes do domínio são explícitas e respeitadas** — conversa nasce sem
  setor, quem responde é quem atende, o CNPJ liga conversa e empresa pelo banco,
  o evento de tempo real leva só a cauda, nunca se deduz pela aparência;
* **o histórico do cliente é intocável.** Apagar é sempre soft-delete; excluir a
  instância da Evolution não afeta o banco da Central;
* **a suíte de 58 scripts é um ativo**, não burocracia. Ela pegou hoje um defeito
  que apagava mídia — depois de ganhar o cenário que faltava.

---

## 9. A recomendação, em uma frase

**Zere o baseline.** Enquanto `verificar-tudo.js` terminar em vermelho, ele
responde "alguma coisa está quebrada" em vez de "a sua mudança quebrou algo" — e
essa diferença é a única coisa que separa uma suíte de testes de uma decoração.
São quatro correções, três delas triviais, e uma delas é um crash que está em
produção agora.
