# Fluxo ARKA — regras de interface e de espera

Documento de referência do fluxo publicado em [`fluxo-arka.json`](fluxo-arka.json).
Ele responde a três perguntas que antes só se respondiam lendo o motor:

1. **quais blocos usam botão, e quantos;**
2. **quais blocos esperam texto livre;**
3. **como o motor sabe a diferença.**

---

## 1. O desenho

```
                         ┌──────────────────┐
                         │  MENU PRINCIPAL  │  3 botões
                         └────────┬─────────┘
              ┌───────────────────┼───────────────────┐
              ↓                   ↓                   ↓
         ┌─────────┐        ┌──────────┐        ┌────────────┐
         │ TÉCNICO │        │COMERCIAL │        │ FINANCEIRO │
         │3 botões │        │  DADOS   │        │   DADOS    │
         └────┬────┘        │  texto   │        │   texto    │
              │             └────┬─────┘        └─────┬──────┘
      ┌───────┼───────┐          ↓                    ↓
      ↓       ↓       ↓    ┌────────────┐      ┌─────────────┐
   ┌──────┐ ┌──────┐ menu │FILA COMERC.│      │FILA FINANC. │
   │ CNPJ │ │AVULSO│      └────────────┘      └─────────────┘
   │texto │ │VALORES│
   └──┬───┘ │3 botões│
      │     └───┬────┘
      │         ↓
      │   ┌───────────┐
      │   │AVULSO DADOS│ texto
      │   └─────┬─────┘
      ↓         │
 ┌──────────┐   │
 │ CONFIRMA │   │      CNPJ válido fora da base de clientes
 │   CNPJ   │   │      ─────────────────────────────────────►  AVULSO VALORES
 │ 2 botões │   │      (config.targetIdNaoCadastrado)
 └────┬─────┘   │
      ↓         │
┌─────────────┐ │
│IDENTIFICAÇÃO│ │ texto
└──────┬──────┘ │
       ↓        │
┌─────────────┐ │
│  DESCRIÇÃO  │ │ texto
└──────┬──────┘ │
       └────────┴──────────►  ┌──────────────┐
                              │ FILA TÉCNICA │
                              └──────────────┘
```

Fora do caminho, porque **não são passos da conversa**:

| Bloco | O que é |
|---|---|
| `Configurações do bot` | textos de fallback e os dois relógios do fluxo |
| `Pesquisa de Satisfação` | configuração da pesquisa; disparada pelo **encerramento** |
| `Sem resposta` | timeout A — o bot perguntou e o cliente sumiu |
| `Espera na fila` | timeout B — ninguém assumiu a conversa |

---

## 2. Blocos que USAM BOTÃO

O layout do WhatsApp aceita **no máximo 3 botões por mensagem**. É limite do
protocolo (a Evolution responde `400 Maximum of 3 reply buttons allowed`), não
da configuração — e por isso é validado em três lugares: no envio
(`MAX_BOTOES_POR_MENSAGEM`), no publicador (`publicar-fluxo-arka.js`) e no
painel de automações do editor.

| Bloco | Botões | Rótulos |
|---|---|---|
| MENU PRINCIPAL | **3** | `🔧 Técnico` · `💼 Comercial` · `💰 Financeiro` |
| TÉCNICO | **3** | `Tenho contrato` · `Atendimento avulso` · `Voltar ao menu` |
| CONFIRMA CNPJ | **2** | `✅ Sim, é esse` · `🔄 Não, outro CNPJ` |
| AVULSO — VALORES | **3** | `✅ Sim, seguir` · `❌ Não, obrigado` · `🏠 Voltar ao menu` |

**O menu principal não tem "Encerrar atendimento".** As três vagas são dos
setores. O encerramento é o mecanismo global do motor: as palavras de
`chatbot.config.palavrasChave.sair` (`sair`, `cancelar`, `encerrar`, `parar`,
`tchau`), liberadas pelo fluxo em `configuracoesGlobais.permitirComandosGlobais`.

### Duas regras de rótulo, e o porquê

**O número fica no corpo, a palavra fica no botão.** Todo bloco de menu lista as
opções numeradas no texto:

```
🔧 *Atendimento Técnico*

Como podemos ajudar?

1️⃣ Tenho contrato
2️⃣ Atendimento avulso
3️⃣ Voltar ao menu
```

Não é redundância com os botões. `enviarBotComOpcoes` cai para texto puro em
dois casos reais — a Evolution recusar o payload interativo, e a instalação rodar
sem `WHATSAPP_BOTOES_INTERATIVOS` — e nesses casos o que sai é o texto do bloco.
Sem a lista, o cliente receberia "Como podemos ajudar?" e **nenhuma opção**.

No caminho com botões essas linhas **não aparecem**: `_corpoInterativo` remove do
corpo do card toda linha que começa com número. O cliente que recebe botões lê
exatamente a mensagem sem a lista.

**O rótulo não repete o número.** O WhatsApp corta o botão em 20 unidades
UTF-16, e o emoji de teclado (`1️⃣`) custa **três** delas. Medido:
`2️⃣ Atendimento avulso` tem 22 e sairia como `2️⃣ Atendimento` — perdendo a
palavra que distingue a opção de `Tenho contrato`. Sem o número, `Atendimento
avulso` tem 18 e cabe inteiro. Emoji de significado (🔧 💼 💰 ✅ 🔄 ❌ 🏠) custa 2
e cabe, então fica.

---

## 3. Blocos que USAM TEXTO LIVRE

Nenhum tem botão, nenhum tem opção no `config`, e nenhum mostra o rodapé
"Selecione uma opção".

| Bloco | Declaração | Coleta | Segue para |
|---|---|---|---|
| CNPJ | `aguardar: "cnpj"` | o CNPJ — **só de quem não é reconhecido pelo telefone** (ver §4b) | CONFIRMA CNPJ (ou AVULSO, se fora da base) |
| IDENTIFICAÇÃO | `aguardar: "texto"` | nome + setor | DESCRIÇÃO |
| DESCRIÇÃO DA SOLICITAÇÃO | `aguardar: "texto"` | o que o cliente precisa | FILA TÉCNICA |
| AVULSO — DADOS | `aguardar: "texto"` | nome + demanda | FILA TÉCNICA |
| COMERCIAL — DADOS | `aguardar: "texto"` | nome + demanda | FILA COMERCIAL |
| FINANCEIRO — DADOS | `aguardar: "texto"` | nome + demanda | FILA FINANCEIRO |

---

## 4. Como o motor sabe a diferença

`config.aguardar` responde **"o que este bloco espera do cliente?"**. Três
valores, e a declaração vence qualquer leitura da forma das opções:

| Valor | Comportamento | Usado em |
|---|---|---|
| ausente | o bloco tem opções: envia como botão/lista e espera a **escolha** | os 4 menus |
| `"cnpj"` | envia como texto e espera o **CNPJ** (valida, consulta a base) | CNPJ |
| `"texto"` | envia como texto e espera **qualquer mensagem**; segue pelo `targetId` | os 5 blocos de coleta |
| `"nada"` | fala e **entrega na mesma volta** (transferir/encerrar) | as 3 filas |

### Por que `"texto"` precisou existir

Antes havia **um** jeito de o motor parar e esperar: o bloco precisava ter
`config.opcoes`. Como boa parte do fluxo pede **informação** e não escolha, esses
blocos eram montados com uma opção curinga — e a opção virava **um botão**, com
o texto interno do fluxo:

```
📝 Descreva sua solicitação
┌──────────────────┐
│  resposta livre  │   ← o botão que não deveria existir
└──────────────────┘
Selecione uma opção
```

A tentativa oposta — tirar as opções e deixar só o `targetId` — produzia o outro
defeito relatado: sem opções o bloco **não estaciona**, `percorrer` segue na mesma
volta, e o cliente recebia a identificação, a descrição e a confirmação em
sequência, sem chance de responder.

### Por que `"nada"` precisou existir

Pela topologia, o bloco de **entrega** ("✅ Solicitação recebida! …encaminhamos
para a equipe técnica") é indistinguível de um bloco que **pergunta** e transfere
com a resposta. Na dúvida, `decidirEsperaDoPasso` estacionava — e o cliente
recebia "encaminhamos seu atendimento" com o bot parado esperando uma mensagem
que ninguém tinha motivo para mandar.

Com a declaração a ambiguidade acaba: quem pergunta diz `"texto"`, quem entrega
diz `"nada"`. Fluxos antigos, que não declaram nada, continuam caindo na regra
conservadora de antes.

## 4b. Memória do perfil — quem já é cliente não digita o CNPJ

`memoriaCnpj: "fluxo"` no bloco de CNPJ. Duas fontes, nesta ordem:

1. **o cadastro de parceiros** (`Parceiro.telefones`) — a forte, e a que funciona
   no **primeiro** contato. Medido na base real: **179 dos 183** parceiros têm
   telefone cadastrado, contra **4** conversas com CNPJ confirmado;
2. **a conversa anterior** (`ultimoCnpjDoTelefone`) — cobre quem informou o CNPJ
   digitando, sem estar no cadastro.

Reconhecido, o fluxo pula o pedido do CNPJ e vai direto para CONFIRMA CNPJ:

```
CLIENTE > Tenho contrato
    bot > 🔐 Confirmação do cadastro
          Encontramos este cadastro:
          🏢 CNPJ: 11.222.333/0001-81
          🏢 Empresa: METALURGICA HORIZONTE LTDA
          O CNPJ continua sendo este?      [✅ Sim, é esse]  [🔄 Não, outro CNPJ]
```

### Os três valores de `memoriaCnpj`, e por que são três

| Valor | Quem confirma | Uso |
|---|---|---|
| `false` | ninguém — o cliente digita | quando não se quer memória |
| `true` | o **motor**, com os botões fixos dele, antes de o fluxo seguir | comportamento histórico, preservado |
| `"fluxo"` | o **bloco seguinte do desenho** | este fluxo |

`"fluxo"` existe por um defeito que a matriz de testes pegou: com `true` e um
bloco de confirmação no desenho, o cliente confirmava **duas vezes seguidas** —
tocava "Sim, é esse" nos botões do motor e o bloco seguinte perguntava a mesma
coisa. Com `"fluxo"` a pergunta acontece uma vez, no bloco cujo texto o operador
controla no editor.

### O que a memória NÃO faz

- **Não adivinha entre duas empresas.** Número cadastrado em mais de um parceiro
  (contador, matriz e filial) devolve nada, e o fluxo pede o CNPJ — que é a
  pergunta certa nesse caso. Escolher uma abriria o chamado no CNPJ errado.
- **Não presume nada por ser lembrado.** O CNPJ adotado passa pela **mesma**
  validação de quem digita: se a empresa saiu da lista de clientes, o cliente é
  avisado e segue pelo caminho avulso.
- **Não reoferece o que foi recusado.** "Não, outro CNPJ" marca a recusa no ciclo
  (`cnpjRecusado` na sessão). Sem isso a opção virava laço: desassocia a conversa,
  volta ao bloco de CNPJ, consulta o cadastro pelo telefone e acha o mesmo
  parceiro — para sempre. `_desassociarCnpj` solta a conversa, mas não pode apagar
  o telefone do cadastro.
- **Não casa telefone por aproximação.** `(27)9999-8888` e `(27)99999-8888` são a
  mesma linha (nono dígito da Anatel, 2012) e casam; `(27)3222-8888` (fixo) e
  `(27)93222-8888` (móvel) **não**. Comparar "os últimos 8 dígitos" — a saída
  fácil — casaria os dois, e num fluxo que adota o CNPJ isso é atender uma empresa
  como se fosse outra. Ver `variantesTelefoneBr`.

---

### A palavra do cliente é dado, não comando

Num bloco que espera resposta (`OPCAO` ou `TEXTO`), as palavras de controle do
motor **não** são interpretadas. Medido:

| O cliente escreve | `detectarComando` devolve | Sem o guard |
|---|---|---|
| "Preciso encerrar meu contrato de internet" | `sair` | encerrava o atendimento |
| "quero cancelar um pedido" | `sair` | encerrava o atendimento |
| "preciso voltar a usar o sistema antigo" | `menu` | voltava ao menu |

O pedido **explícito** de atendente continua atravessando o fluxo: quem pede uma
pessoa consegue uma pessoa.

---

## 5. Filas e setores

Não existe tabela de filas neste projeto. A "fila" é a dupla
(`setor`, `statusAtendimento: pendente`), e `setor` vem da lista canônica de
`setor.helper.SETORES`: `Geral`, `Técnico`, `Comercial`, `Financeiro`.

| Bloco | `setor` declarado | `filaId` |
|---|---|---|
| FILA TÉCNICA | `Técnico` | `33` |
| FILA COMERCIAL | `Comercial` | `35` |
| FILA FINANCEIRO | `Financeiro` | **nenhuma** |

`filaId` é o `queueId` do editor de origem; ele só tem efeito através do mapa
`chatbot.filas` de Configurações, e **só quando o `setor` não está declarado**.
Como todas as três declaram o setor, o roteamento não depende do mapa.

**O Financeiro não declara fila de propósito.** O fluxo anterior usava `35` — a
fila do **Comercial**. Não roteava errado só porque o setor declarado vencia, mas
era uma mentira à espera de efeito. Não há id conhecido para a fila financeira
nesta instalação; declarar o errado é pior do que não declarar nenhum.
→ **pendência: confirmar o `queueId` da fila financeira e preencher.**

---

## 6. Os relógios

São **três**, deliberadamente separados — confundi-los daria a mensagem errada
nos três casos. Todos contados pelo servidor (`chatbot.inatividade.js`), nunca
pelo navegador: o prazo tem de correr com a aba fechada e atravessar restart.

| Relógio | Quando corre | Prazo | Depois disso |
|---|---|---|---|
| **Sem resposta** | o bot perguntou e o cliente sumiu | **5 min** | encerra a OS |
| **Espera na fila** | ninguém assumiu a conversa em Pendentes | **10 min** | avisa o cliente, uma vez |
| **Espera pela avaliação** | a pesquisa perguntou a nota | **5 min** | agradece e finaliza |

Precedência dos dois primeiros (`fluxo.automacao.paramsTempos`): **bloco no
canvas** > `configuracoesGlobais` > campo legado `notResponseMessage` > padrão do
sistema. O bloco vence porque é o que a pessoa vê na tela. O terceiro sai do
`config` do bloco de avaliação (`timeoutAvaliacaoMin`).

| | Bloco no canvas | `configuracoesGlobais` | Efetivo |
|---|---|---|---|
| Cliente não responde ao bot | 5 min, encerrar | 5 min, encerrar | **5 min, encerrar** |
| Espera na fila de Pendentes | 10 min, avisa uma vez | 10 min, avisa uma vez | **10 min** |

Os dois lugares declaram o **mesmo** valor de propósito: se divergirem, o painel
mostraria um número que o campo escondido contradiz. O campo legado
`notResponseMessage` **não** está no fluxo — ele criaria uma terceira fonte para
o mesmo prazo (e no fluxo anterior os dois discordavam: o legado dizia 10 min, o
bloco dizia 5, e o bot esperava 5).

O timeout A alcança **todos** os estados que têm pergunta em aberto, resposta
livre incluída (`AGUARDA_RESPOSTA_DO_CLIENTE`). Não alcança quem já foi entregue
à fila: a transferência grava `concluidoEm`, e dali em diante não há resposta a
cobrar.

---

## 7. Horário de atendimento

Configuração **independente do fluxo**, na chave `chatbot.horario`, com tela
própria em Configurações. Interpretada por
[`chatbot.horario.js`](../server/src/modules/chatbot/chatbot.horario.js).

- dia ligado/desligado individualmente;
- **vários períodos no mesmo dia** (o intervalo de almoço);
- fuso próprio (o container roda em UTC);
- **feriados/exceções** por data — fechado, ou com expediente especial;
- mensagem com `{{horarios}}` e `{{excecao}}`, para o texto **nunca** repetir os
  horários à mão;
- o aviso **não se repete** a cada mensagem (`reavisarAposMin`, padrão 2 h).

Fora do horário o bot não inicia fluxo nenhum: avisa e **preserva** o atendimento
em Pendentes — a estrutura que a Central já usa para "chegou e ninguém assumiu".
Quem já está no meio de um menu, de uma resposta livre ou da pesquisa **continua**,
para o expediente virar sem abandonar o cliente na metade.

Configuração ilegível (hora fora de formato, fuso inexistente, JSON quebrado)
devolve "estamos **dentro** do expediente": na dúvida, atender.

---

## 8. Como publicar e como verificar

```bash
node publicar-fluxo-arka.js --dry     # confere as invariantes, sem gravar
node publicar-fluxo-arka.js           # mostra o plano e pede confirmação
node publicar-fluxo-arka.js --backup  # salva o fluxo atual em docs/ antes
```

```bash
npm test                              # roda as quatro verificações
node verificar-tudo.js --lista        # o que cada uma cobre
```

| Script | O que prova |
|---|---|
| `verificar-horario.js` | a regra de expediente, caso a caso (módulo puro) |
| `verificar-fluxo-arka.js` | a matriz do fluxo, conversando com o motor real |
| `verificar-visual-whatsapp.js` | o **payload** que chega ao WhatsApp; gera [`verificacao-visual-arka.html`](verificacao-visual-arka.html) |
| `verificar-inatividade.js` | os dois relógios (a Parte B exige `DATABASE_URL`) |
