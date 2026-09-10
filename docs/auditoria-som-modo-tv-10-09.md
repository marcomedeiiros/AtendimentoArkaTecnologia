# Auditoria: o som de notificação parou de funcionar no Modo TV (10/09/2026)

**Escopo:** o relato de que o som de notificação dentro do Modo TV não funciona
mais, depois da separação dos dois áudios entregue em `792a784`.

**Conclusão: o relato está certo, e há DUAS causas — uma decisão errada minha e
um defeito real que eu introduzi.** Não é o mesmo problema visto de dois
ângulos: as duas causas são independentes, e cada uma sozinha bastaria para
produzir o silêncio.

---

## 1. Como o som chega ao Modo TV

Vale estabelecer, porque não é óbvio pela tela:

* o Modo TV **não toca som nenhum por conta própria**. Ele busca
  `/dashboard/painel` a cada 30 segundos, e isso alimenta só os números;
* quem toca é o `AppContext`, num efeito que observa a lista `conversas`
  (alimentada por SSE). O Modo TV é um overlay dentro do `AtendimentoView`,
  então aquele efeito continua rodando com a TV aberta;
* portanto "som no Modo TV" é o **mesmo** disparo do resto do painel, com uma
  decisão a mais: qual dos dois áudios usar.

---

## 2. Causa 1 — a regra deixava o Modo TV mudo de propósito

A regra entregue em `792a784`:

```js
if (modoTvRef.current) {
  if (houveChamadoNovo) tocarSomChamadoNovo();   // e nada no else
} else {
  tocarSomMensagem();
}
```

Com o Modo TV aberto, mensagem de conversa **já conhecida** não produzia som
nenhum. Só chamado novo tocava.

### 2.1 Isso foi uma decisão minha, e ela contrariava o pedido

O pedido original dizia, textualmente:

> na primeira mensagem que o cliente enviar apareça no modo TV esse
> ARKACHATMonitoramento.mp3 e daí **quando o atendente atender o cliente começar
> a blipar** esse audio blipnotificacaomensagem.mp3

Ou seja: o blip **deveria** tocar no atendimento em curso. Eu perguntei sobre
esse caso e **recomendei silêncio**, com o argumento de que painel de parede não
precisa blipar a cada mensagem de conversa em andamento. A recomendação foi
aceita — mas ela partia de uma premissa errada sobre o uso: o Modo TV **é** como
a equipe monitora, não uma tela decorativa sem operador.

Registro sem rodeio: **a pergunta foi feita, mas eu não devia ter recomendado
essa opção.** O pedido já respondia, e eu propus o contrário dele com um
argumento genérico sobre "painel de parede" que não descrevia esta operação.

### 2.2 E o modo de falha era o pior possível

Silêncio decidido em código é **indistinguível de defeito** para quem está
olhando. Não há mensagem, não há indício, não há o que investigar: a pessoa
manda uma mensagem de teste, nada acontece, e a conclusão é "quebrou". Foi
exatamente essa a leitura, e ela estava correta em substância.

Isto é o mesmo formato de erro que esta base já registrou duas vezes em outras
telas: **ausência apresentada como se fosse resposta.** Aqui a ausência era de
som.

---

## 3. Causa 2 — um defeito real: `null` não é `undefined`

Independente da decisão acima, o teste de "esta conversa é nova?" estava errado.

```js
const marcas = {};
conversas.forEach(c => { marcas[c.id] = marcaDaUltima(c); });   // pode ser null
...
if (anterior[c.id] === undefined) houveChamadoNovo = true;
```

`marcaDaUltima` devolve `null` quando a conversa ainda **não tem mensagem de
cliente legível** — e esse `null` era gravado no retrato anterior. A sequência,
que acontece sempre que o SSE entrega a conversa antes da mensagem:

| | o que chega | o que é gravado | som |
| --- | --- | --- | --- |
| tick A | conversa sem mensagem legível | `marcas[id] = null` | nenhum (correto: nada a anunciar) |
| tick B | a mensagem do cliente aparece | `anterior[id]` é **`null`** | **nenhum** ❌ |

No tick B a conversa **é** nova — nunca foi anunciada. Mas
`anterior[c.id] === undefined` responde **falso**, porque a chave existe com
valor `null`. `houveChamadoNovo` fica `false`, e no Modo TV, onde só chamado novo
tocava, o resultado é **silêncio num chamado novo de verdade**.

Ou seja: mesmo aceitando a regra da causa 1, o Modo TV ainda ficaria mudo no
único caso em que ele deveria tocar — dependendo da ordem em que o SSE entrega
conversa e mensagem, que não é algo que este código controle.

**Este defeito é meu, entrou em `792a784`, e nenhum teste o pegava** porque a
distinção "nova x conhecida" nasceu naquele commit sem cobertura própria.

---

## 4. O que foi corrigido

**Causa 2 — na origem.** O retrato passa a registrar **só marcas reais**:

```js
conversas.forEach(c => {
  const m = marcaDaUltima(c);
  if (m) marcas[c.id] = m;
});
```

Quem nunca teve mensagem conhecida continua **ausente** do retrato — e ausente é
o que "novo" quer dizer. Não há risco de aviso duplicado: no tick A nada foi
anunciado. Corrigir aqui, e não no `=== undefined`, é o que faz a resposta ser
única em vez de depender de qual sentinela alguém escolheu.

**Causa 1 — a regra passa a ser a do pedido:**

| | chamado novo | mensagem em conversa conhecida |
| --- | --- | --- |
| **Modo TV** | Monitoramento | **blip** |
| **Central** | blip | blip |

O chamado novo é o único que muda de som, e é o mais alto de propósito: é o que
precisa ser ouvido do outro lado da sala.

A condição virou **combinada** (`modoTv && houveChamadoNovo`), e isso não é
cosmético: com um `else` cobrindo todo o resto, não existe mais caminho sem som.
A forma aninhada é o que deixava um caso sem saída.

Se algum dia o som incomodar numa TV sem operador, o caminho é um **controle
explícito** naquela tela — não silêncio decidido no contexto.

---

## 5. O teste que faltava

`verificar-avisos-mensagem.js` ganhou a garantia que estava só no comentário:

```js
if (!/if \(modoTvRef\.current && houveChamadoNovo\)/.test(app)) {
  problemas.push("a escolha do som deixou de ser uma condicao combinada -- Modo TV pode ter voltado a ficar mudo");
}
```

Ele trava a **forma combinada** de propósito, e vale explicar por quê, já que
este mesmo arquivo acabou de perder uma checagem por travar forma em excesso: a
cobertura aqui é uma propriedade da estrutura. Com a condição combinada num ramo,
o `else` pega tudo; aninhada, sobra um caso mudo. Não há como afirmar "nenhum
caminho fica sem som" por grep sem olhar a forma que garante isso.

O ideal seria exercitar a função e ouvir o resultado — mas o disparo vive dentro
de um efeito React que depende de SSE, e este verificador lê fonte, não roda
navegador. A checagem é o que dá para garantir sem montar essa infraestrutura.

---

## 6. O que este episódio deixa registrado

**1. Não recomende o contrário do pedido com argumento genérico.** "Painel de
parede não precisa blipar" é uma frase razoável sobre painéis de parede em geral,
e falsa sobre este. Quem descreveu o uso foi quem pediu.

**2. Silêncio nunca é uma boa resposta padrão em alerta.** Ele não se anuncia, e
o custo de investigar é do usuário. Onde a escolha for silenciar, que seja por um
controle visível — assim a pessoa sabe que existe e que está desligado.

**3. Sentinela dupla é bug esperando data.** `null` e `undefined` respondendo à
mesma pergunta em lugares diferentes deu silêncio aqui, e é o mesmo formato do
"ausência de dado tratada como veredito" já registrado em duas outras auditorias
desta semana. A correção que vale é a que elimina o segundo estado, não a que
passa a testar os dois.
