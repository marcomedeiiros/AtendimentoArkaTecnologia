# Fase 1 -- Investigacao: causas-raiz

Cada achado abaixo foi confirmado LENDO o caminho inteiro do dado, e os dois
primeiros foram reproduzidos executando o codigo real (nao inferidos).

---

## CR-1 -- Fluxos: o servidor recusa o proprio retrato (400 silencioso)

**Onde:** `server/src/modules/fluxos/fluxo.dto.js` x `server/src/shared/helpers/mapper.helper.js:190`

`mapPasso` devolve as colunas nulas do banco como `null`:

```js
desc: p.descricao,   // null quando a coluna e NULL
texto: p.texto,      // null
config: p.config,    // null
x: p.posX,           // null
```

O `passoSchema` do PUT declara esses campos como `z.string().optional()` /
`z.number().optional()` / `z.record(z.any()).optional()`. Em Zod, `.optional()`
aceita `undefined` -- **e recusa `null`**.

O ciclo, entao, e:

```
GET /fluxos      -> passos com texto:null, config:null, desc:null
editor carrega   -> guarda esses nulos no estado, intactos
PUT /fluxos/:id  -> devolve os mesmos nulos
validate()       -> 400 VALIDATION_ERROR, a requisicao morre na borda
```

Reproducao (executada):

```
$ node -e "...atualizarFluxoSchema.safeParse({passos:[<saida real do mapPasso>]})"
PUT aceito? false
 -> passos.0.desc     : Expected string, received null
 -> passos.0.descricao: Expected string, received null
 -> passos.0.texto    : Expected string, received null
 -> passos.0.config   : Expected object, received null
```

Basta UM bloco sem texto/config (uma anotacao, um gatilho) para o fluxo INTEIRO
deixar de salvar -- o `passos` e validado como array unico.

**Por que ninguem ve o erro:** `VisualFlowEditor.syncFlowToParent` termina em
`catch {}`. O estado local ja foi atualizado de forma otimista, entao a tela
mostra a alteracao aplicada. O F5 revela a verdade: o banco nunca mudou.

## CR-2 -- Fluxos: um PUT por tecla, e cada PUT troca o id de todos os blocos

**Onde:** `VisualFlowEditor.jsx:213` e `infrastructure/repositories/fluxo.repository.js:88`

Cada `onChange` do painel de propriedades chama `onChangeNode` -> `syncFlowToParent`
-> `PUT /fluxos/:id` com a lista completa de passos. Digitar "Bom dia" dispara 7
PUTs concorrentes, sem serializacao e sem cancelamento.

No servidor, `update()` faz `deleteMany` + `createMany` e `montarPassos` gera
`crypto.randomUUID()` NOVO para cada passo. Consequencias:

1. O id que o front tem em maos deixa de existir no banco a cada save.
2. Duas respostas fora de ordem gravam a versao mais velha por ultimo.
3. Qualquer referencia a bloco que nao seja `targetId` ou `config.opcoes` aponta
   para um id morto (o remapeamento so cobre esses dois).
4. `SessaoChatbot`/`LogExecucaoFluxo` que citem `passoId` ficam orfaos.

## CR-3 -- Transferencia: sem dono, sem trava, sem confirmacao de estado

**Onde:** `conversa.service.js:915` (`definirAtendente`) e `conversa.controller.js:154`

```js
async definirAtendente(id, atendenteId, userCargo = null) {
  const conversa = await conversaRepository.findById(id);
  exigirAcessoSetor(userCargo, conversa.setor);   // <- unica verificacao
  ...
  await conversaRepository.update(id, { atendenteId: novoId, ... });
```

Tres defeitos independentes:

- **Autorizacao:** so confere SETOR. Qualquer atendente do mesmo setor transfere
  a conversa de qualquer colega. O controller nem repassa `req.user.sub` -- o id
  de quem pede nao chega ao service, entao nao havia como conferir.
- **Corrida:** le-depois-escreve. Duas transferencias simultaneas passam as duas;
  a ultima a gravar vence, e ambas geram o aviso "Conversa transferida para X".
- **Idempotencia:** nao existe. Dois cliques = duas mensagens de sistema.

O front piora: `transferirConversa` (AtendimentoView.jsx:2893) nao tem estado de
pendencia, e o modal so fecha DEPOIS do await -- a lista inteira segue clicavel
durante a requisicao.

Contraste: `atender()` ja faz a coisa certa via `conversaRepository.assumirAtomico`
(UPDATE condicional, `versao: {increment: 1}`). A transferencia ficou de fora.

## CR-4 -- Midia: o XHR nao manda o token de CSRF

**Onde:** `client/src/services/api.js:657` (`ConversasAPI.enviarMidia`)

Todo o resto do painel passa por `request()`, que monta os cabecalhos com
`cabecalhosDeSessao()` -- e ali entra o `X-CSRF-Token`. O envio de midia usa XHR
cru (precisa de progresso e cancelamento) e monta os cabecalhos a mao:

```js
xhr.open('POST', `${API_BASE}/conversas/${id}/midia`);
xhr.setRequestHeader('Content-Type', 'application/json');
const token = getToken();
if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
// <- falta X-CSRF-Token
```

Depois da migracao para sessao em cookie, `getToken()` devolve null (o
`apagarLegado` limpou o localStorage). Entao o XHR chega ao servidor com o cookie
de sessao, sem Bearer e sem header de CSRF. O guard entra exatamente no ramo do
double submit e responde 403:

```
"Requisicao sem confirmacao de origem. Recarregue a pagina."
```

que a tela concatena em `'Falha ao enviar mídia: ' + e.message`
(AtendimentoView.jsx:1783) -- o texto reportado, palavra por palavra.

**Isso explica TODOS os tipos de uma vez.** Imagem, video, audio, documento e
localizacao saem pela mesma funcao; a requisicao morre no middleware, antes de
`enviarMidiaSchema`, do upload, do disco e da Evolution. Nao ha um problema por
tipo de midia -- ha um so, na porta.

Regressao introduzida em 7db6f61 (`feat(seguranca): a sessao passa a viver em
cookie HttpOnly, com CSRF`), que atualizou `request()` e esqueceu deste caminho.

## CR-5 -- Cadastro: a rota exige Turnstile e a tela nao o desenha

**Onde:** `client/src/pages/CadastroPage.jsx` x `server/src/modules/auth/auth.routes.js:125`

```js
router.post("/cadastrar", authLimiter, validate(cadastroSchema),
            bloqueioProgressivo, exigirTurnstile, ...)
```

`LoginPage.jsx` renderiza `<Turnstile onToken={setTurnstileToken} />` e passa o
token adiante. `CadastroPage.jsx` **nao importa o componente, nao tem o estado e
nao manda o campo** -- `cadastrar()` envia so nome/email/senha/codigo.

Com `TURNSTILE_SECRET_KEY` configurada, `turnstile.verificar(null)` devolve
`{ok:false, motivo:"token-ausente"}` e a rota responde 403:

```
"Não foi possivel confirmar que voce nao e um robo recarregue a pagina..."
```

O backend esta correto e nao deve ser tocado. Falta a metade da tela.
(De quebra: a mensagem esta sem pontuacao e sem acentos, ao contrario do resto.)

---

## O que foi verificado e NAO esta quebrado

- `enviarMidiaSchema` cobre os cinco tipos e valida tamanho/MIME (`inspecionarMedia`).
- `conversa.service.enviarMidia` trata cada tipo pelo caminho certo na Evolution
  (audio -> `sendWhatsAppAudio`, GIF -> documento, imagem/video -> `sendMedia`).
- `turnstile.client.js` esta correto, inclusive o fail-closed e o hostname.
- O guard de CSRF esta correto: as isencoes (metodos seguros, Bearer, rotas de
  entrada) sao justificadas e nao ha buraco.
- `assumirAtomico` ja e a referencia de concorrencia a seguir.
