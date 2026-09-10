# Auditoria: a citação em toda resposta do cliente (10/09/2026)

**Escopo:** o relato de que **tudo** o que o cliente responde no chat aparece
citando a última fala do atendente. Evidência: captura da conversa #OS00222
(Valdirene Ribeiro · Setor Técnico · Rangel), 08:33–08:38.

**Conclusão antecipada:** isto **não é um defeito** — é uma decisão de produto
tomada em 09/09/2026, documentada, e cujo custo foi previsto por escrito. O que
a captura mostra é que a previsão **subestimou** o custo. O pedido de mudança é
legítimo e a reversão é barata: o mecanismo foi construído com marca de origem
justamente para poder ser desfeito.

---

## 1. O que a captura prova

Cinco mensagens do cliente, cinco citações. Nenhuma delas foi citada por ele:

| Hora | Mensagem do cliente | Citação que a Central desenhou | Era resposta àquilo? |
| --- | --- | --- | --- |
| 08:34 | "Isso aí…" | *quer instalar o google drive agora certo?* | **sim** |
| 08:36 | "Show… obrigada" | *pronto* | plausível |
| 08:36 | "Mais uma coisa" | *pronto* | **não** — assunto novo |
| 08:37 | "Temos um note que compramos o carregador tipo C com vcs…" | *só me dizer* | **não** — assunto novo |
| 08:38 | "Pode pedir alguém para vir olhar?" | *só me dizer* | **não** |

Dois detalhes que explicam por que isso incomoda tanto na tela:

* **duas citações aparecem repetidas.** "pronto" cita duas bolhas seguidas, e
  "só me dizer" também. Quando o cliente manda duas ou três mensagens em
  sequência, a mesma citação se repete em todas — e é aí que ela deixa de
  informar e passa a ser ruído visual;
* **de cinco, só duas fazem sentido.** "Mais uma coisa" citando "pronto" é o
  caso mais claro: o cliente está literalmente anunciando que vai mudar de
  assunto, e a bolha afirma que ele está respondendo ao "pronto".

E o WhatsApp do cliente **não mostra citação em nenhuma dessas cinco** — porque
ele não citou nada. É essa diferença que o relato aponta, e ela é real.

---

## 2. Por que acontece: é código deliberado, não acidente

O trecho é este, em
[chatbot.engine.js:4196](../server/src/modules/chatbot/chatbot.engine.js#L4196):

```js
if (!respondendoAId && !retrato && !cicloReaberto) {
  const anterior = await this.deps.conversaRepository.ultimaMensagemNossa?.(conversa.id);
  const textoAnterior = String(anterior?.texto || "").trim();
  if (anterior?.id && textoAnterior) {
    respondendoAId = anterior.id;
    retrato = { texto: textoAnterior.slice(0, 500), derivada: true };
  }
}
```

Em uma frase: **quando o WhatsApp não manda citação nenhuma, a Central inventa
uma** apontando para a última mensagem que saiu daqui — do bot ou do atendente,
tanto faz.

Como a esmagadora maioria das mensagens do cliente chega **sem** `contextInfo`
(digitar uma mensagem nova nunca produz citação no WhatsApp), essa condição é
verdadeira quase sempre. Daí "tudo que o cliente responde" ganhar citação.

### 2.1 Qual problema isso resolvia

A motivação está escrita no próprio comentário, e era boa: **tocar num botão** do
menu volta com o menu citado (o WhatsApp manda o `contextInfo` da resposta de
botão), mas **digitar "1"** não — para o WhatsApp é mensagem nova. A mesma
conversa ficava com metade das respostas de menu citando e a outra metade solta,
sem nada na tela explicando a diferença.

A citação derivada igualou os dois casos. O problema é que ela não conseguiu
distinguir "digitou a resposta do menu" de "está falando de outra coisa" — e o
segundo caso é a maior parte de uma conversa com atendente humano.

### 2.2 O custo estava previsto — e a previsão errou de tamanho

[auditoria-citacao-derivada.md](auditoria-citacao-derivada.md) §3 diz, textualmente:

> Quando o cliente manda quatro mensagens seguidas, o WhatsApp cita só aquelas
> em que ele realmente respondeu; nós vamos citar as quatro. **É citação a mais,
> não citação errada** — todas apontam para a última coisa que ele recebeu, que
> é o que ele estava respondendo em quase todo caso real.

A captura de 10/09 é o teste dessa aposta, e ela não se sustentou. Duas
correções ao raciocínio de 09/09:

1. **"em quase todo caso real" não se confirmou.** Numa conversa conduzida por
   atendente, o cliente muda de assunto, agradece, faz pedido novo. Foram 3 de 5;
2. **"citação a mais, não citação errada" era uma distinção sem diferença na
   tela.** A bolha não diz "isto chegou depois daquilo" — ela desenha o mesmo
   retrato que uma citação real, e quem lê entende "o cliente respondeu a isto".
   Quando isso é falso, é citação errada, independentemente de como foi derivada.

O raciocínio de origem definia a citação como a afirmação *"esta mensagem chegou
depois daquela"* — verdade verificável. Mas essa não é a frase que a interface
comunica, e a interface é o que existe para o operador.

---

## 3. O que o comportamento pedido exige

O pedido é **paridade com o WhatsApp**: citação na Central se e somente se o
cliente citou no aparelho.

Isso é exatamente **remover o bloco do §2** — nada mais. Todo o resto do caminho
da citação já é o real e fica intocado:

| Caminho | Origem | Depois da mudança |
| --- | --- | --- |
| cliente citou no aparelho | `citacao.stanzaId` → `findMensagemPorWaId` | **continua igual** |
| citou algo que não temos no banco | `retrato = { desconhecida: true }` | **continua igual** |
| tocou num botão do menu | `contextInfo` real da resposta de botão | **continua igual** |
| mídia citada sem legenda | `retrato = { tipo }` | **continua igual** |
| atendente citou ao responder | `respondendoAId` gravado pela Central | **continua igual** |
| **nada disso** | citação derivada | **deixa de existir** |

`cicloReaberto` deixa de importar para este trecho (ele só existia para impedir
a citação derivada de atravessar chamados).

### 3.1 O que se perde, dito por extenso

**A resposta de menu digitada volta a não citar.** Cliente que digita "1" em vez
de tocar no botão terá uma bolha solta — que é justamente o problema que a
citação derivada foi criada para resolver em 09/09.

Vale aceitar, por dois motivos: é **exatamente o que o WhatsApp faz** (o pedido é
paridade, e o cliente também vê a bolha solta no aparelho dele), e o menu ainda
está visível logo acima na conversa. O caso das respostas por **botão** — que é
o caminho recomendado e o mais usado — não é afetado: aquela citação é real.

### 3.2 O que precisa mudar junto

* **`chatbot.engine.js`** — remover o bloco (e o comentário longo passa a
  registrar por que a citação derivada foi retirada, não como ela funciona);
* **os testes que travam a decisão antiga**, em
  [verificar-mensagem-recebida.js](../server/verificar-mensagem-recebida.js):
  `"e leva o retrato, marcado como derivado"`, `"a resposta digitada aponta para
  a pergunta do bot"`, `"a resposta ao ATENDENTE cita a fala dele, nao a do bot"`
  e `"e o retrato e o texto do atendente"`. Eles afirmam o comportamento que
  está sendo revertido — **precisam ser invertidos, não apagados**: passam a
  garantir que texto puro **não** gera citação. Apagá-los deixaria o defeito
  livre para voltar;
* **`mapper.helper.js`** — o campo `derivada` pode ficar (mensagens antigas no
  banco têm `derivada: true` gravado e continuarão desenhando a citação delas;
  removê-lo do mapper não apaga o dado, só esconde a origem);
* **`verificar-botoes.js`** — não muda: os três elos que ele testa são de citação
  real.

### 3.3 O histórico já gravado

As mensagens que já estão no banco com `metadata.citacao.derivada = true`
**continuam mostrando a citação**, porque o retrato está gravado na linha. A
mudança vale para o que chegar dali em diante.

Se for desejado limpar o histórico também, é um `UPDATE` que remove `citacao` e
`respondendoAId` das mensagens de cliente com `derivada: true` — operação
separada, destrutiva, e que **não** deve ser feita junto: primeiro se confirma
que o comportamento novo é o desejado na prática.

---

## 4. O acerto de 09/09 que torna isto barato

A decisão de 09/09 foi tomada com uma saída deliberada, e ela está no lugar:

> `derivada: true` continua gravado. A bolha desenha igual (foi a decisão), mas o
> dado nunca perde a origem.

Por causa disso, dá para saber exatamente quais citações do banco são inventadas
e quais são reais — sem adivinhar, sem reprocessar webhook. É o que permite
reverter com confiança e, se quiser, medir depois.

Vale notar o outro lado: **a marca foi gravada e nunca usada na tela.** O
`mapper` entrega `derivada` ao cliente e
[AtendimentoView.jsx](../client/src/components/pages/AtendimentoView.jsx) não lê
o campo em lugar nenhum — as duas citações desenham idênticas, como a decisão
previa. Se a bolha derivada tivesse nascido com alguma diferença visual (um
"referente a" em vez do retrato citado, por exemplo), o problema desta auditoria
provavelmente não teria chegado a incomodar.

---

## 5. Lição

A de 09/09 foi sobre *decidir por exclusão em campo de estado*. Esta é outra, e
vale registrar ao lado:

> **Uma inferência correta não vira uma afirmação honesta só porque está
> marcada como inferência no banco.**

"Esta mensagem chegou depois daquela" é verdade. "O cliente respondeu a isto" é
o que a bolha diz. Enquanto as duas frases forem desenhadas do mesmo jeito, é a
segunda que vale — e ela precisa de evidência do aparelho, não da ordem da
conversa.

---

## 6. O que foi feito

| Onde | O quê |
| --- | --- |
| `chatbot.engine` | o bloco da citação derivada saiu; no lugar ficou o registro de **por que** saiu, para não voltar por outro caminho |
| `conversa.repository` | `ultimaMensagemNossa` removida — existia só para aquele bloco, e deixá-la parada convidaria a religar o comportamento |
| `verificar-mensagem-recebida` | as quatro asserções **invertidas**: texto puro do cliente não gera citação, nem com a sessão em `humano` |
| `verificar-mensagem-recebida` | duas asserções **novas** para a metade preservada: citou no aparelho → a bolha aponta para a mensagem citada e leva o retrato, sem marca de derivado |
| `verificar-mensagem-recebida` | o dublê de `ultimaMensagemNossa` agora **lança exceção** (ver abaixo) |

**A armadilha deliberada no dublê.** A chamada original era
`ultimaMensagemNossa?.(...)`, com encadeamento opcional. Se alguém reintroduzir
a chamada, um método ausente devolveria `undefined` **em silêncio** e a citação
derivada voltaria sem nenhum teste reclamando — e ela é, por construção,
invisível na tela: desenha igual a uma citação real. Por isso o dublê existe e
explode, com a explicação na mensagem do erro.

O cliente não mudou: a citação derivada simplesmente para de chegar, e o
`mapper` continua entregando o retrato das mensagens antigas que já o têm
gravado.

### 6.1 Verificação

Rodado contra um SQLite temporário (o repositório não tem `.env` local, e sem
banco estes testes não saem do chão):

* `verificar-mensagem-recebida.js` — **37 asserções, 0 falhas**, incluindo as
  invertidas e as novas;
* `verificar-botoes.js`, `verificar-webhook-entrada.js`,
  `verificar-simulador-contrato.js`, `verificar-fluxo-arka.js` — verdes. O
  primeiro é o que importa mais aqui: ele cobre os três elos da citação **real**
  vinda de toque em botão, que é a metade preservada;
* suíte completa (`verificar-tudo.js`) — tudo confere, com **duas** falhas
  (`verificar-inatividade.js`, `verificar-cadastro-turnstile.js`) que **já
  falhavam antes desta mudança**, confirmado com as alterações guardadas.

Um achado de passagem, não corrigido porque está fora do escopo: os scripts de
verificação só criam a instância quando não existe nenhuma, e nesse caminho
falta `webhookSecret` — obrigatório no schema. Na VM nunca aparece, porque já
há uma instância no banco. Em banco vazio, o script morre antes da primeira
asserção.
