# Auditoria: o ranking "zerado" e o pedido de pontos sem teto (10/09/2026)

**Escopo:** duas capturas do mesmo dia, 13:10, mostrando números incompatíveis
para o mesmo mês  e o pedido de mudar a pontuação de índice 0–100 para
acumulação sem teto.

**Conclusão antecipada, e é a que importa: nada foi zerado.** Os atendimentos, as
avaliações e os pontos estão todos no banco. O que existe são **três janelas de
tempo diferentes** para a mesma pergunta "que mês é este?", e uma delas aponta
para o futuro.

---

## 1. A evidência

| Tela | O que mostra |
| --- | --- |
| **Painel da Equipe (TV)**, 13:10:02 | Gabriel F., Marco M. e Rangel com **84 pts** cada · `6 aval · 5,0 ★ · 3 min` · rodapé `24 + 35 + 25 = 84` |
| **Ranking do Time**, `setembro/2026` | os seis com **0 pts** e **0 avaliados**  mas com "Último atendimento" preenchido (10/09, 09/09, 08/09) |

Os 84 pts da TV conferem parcela por parcela com a régua do código: 6
atendimentos → 24 (`FAIXAS_VOLUME`), nota 5,0 × `PESO_NOTA` 7 → 35, agilidade →
25. **A conta da TV está certa.**

E a coluna "Último atendimento" da outra tela é a prova de que os dados existem:
ela é calculada **fora** da janela do mês. Os atendimentos estão lá; o que não os
alcança é a janela dos pontos.

---

## 2. Três janelas, três respostas

| Quem | Como calcula o "mês" | Resultado em 10/09 |
| --- | --- | --- |
| `painel.obter()`  a TV | `inicioDoMes()`: dia **1** do mês corrente | 01/09 → agora ✅ |
| `painel.rankingEquipe()`  `/dashboard/ranking-equipe` | `inicioDoMes()`, sem limite superior | 01/09 → agora ✅ |
| `ranking.service`  a tela Ranking do Time | `ciclo.janela(ano, mes)` | **28/09 → 28/10** ❌ |

As duas primeiras **ignoram o ciclo configurado** e usam o mês do calendário. A
terceira aplica o ciclo. Com o dia 28, ela cai numa janela que ainda não começou.

### 2.1 Provado, não deduzido

Rodando a própria `ciclo.js` com o ciclo no dia 28 e o relógio em 10/09/2026:

```
competencia CORRENTE segundo o servidor (competenciaDe): 2026-08

competencia 2026-08: 01/08/2026 00:00  ->  01/09/2026 00:00
competencia 2026-09: 28/09/2026 00:00  ->  28/10/2026 00:00   <<< JANELA INTEIRA NO FUTURO
competencia 2026-10: 28/10/2026 00:00  ->  28/11/2026 00:00   <<< JANELA INTEIRA NO FUTURO
```

A convenção está documentada em `ciclo.js` e é deliberada: **a competência
`2026-09` com dia 28 vai de 28/09 a 28/10**  não de 28/08 a 28/09. Ou seja,
"setembro/2026" no seletor significa um ciclo que **começa em 18 dias**.

Zero pontos e zero avaliados é a resposta **correta** para essa pergunta. A
pergunta é que está errada.

---

## 3. A causa: a centralização do ciclo ficou pela metade

O cabeçalho de `ciclo.js` descreve o problema que ele veio resolver:

> O ciclo era o mês do calendário, cravado em quatro lugares diferentes
> (`painel.service`, `ranking.service` duas vezes, `mapeamento.service`). Cada
> um escrevia `new Date(ano, mes - 1, 1)` por conta própria  quatro cópias da
> mesma regra, que é o começo de quatro respostas diferentes para "que mês é
> este?".

**Duas dessas cópias nunca foram migradas.** `inicioDoMes()` continua vivo e em
uso em [painel.service.js:342](../server/src/modules/dashboard/painel.service.js#L342)
e [painel.service.js:718](../server/src/modules/dashboard/painel.service.js#L718)
 a TV e o `/ranking-equipe`. O arquivo que centralizou a regra passou a ser
usado por um consumidor só.

Enquanto o ciclo era o padrão (dia 1), as duas formas davam o **mesmo**
resultado, e a divergência ficou invisível. Ela só apareceu no dia em que o
administrador moveu o dia do ciclo  que é exatamente o dia em que o recurso
passou a ser usado.

> **O formato do engano, que vale registrar:** centralizar uma regra sem remover
> as cópias antigas não centraliza nada  cria uma quarta versão dela. E a
> divergência fica latente até alguém mudar a configuração, o que faz o defeito
> aparecer **longe** da mudança que o causou.

---

## 4. E há um buraco de 27 dias, dependendo de quando a regra foi salva

`ciclo.js` protege o passado: competência anterior a `vigenteDesde` continua
sendo mês de calendário, para que meses já premiados não mudem de conteúdo.
A proteção está certa  mas ela **abre um vão no presente**.

Se `vigenteDesde` for `2026-09` (o caso provado acima):

* competência `2026-08` → janela `01/08 → 01/09` (calendário, por ser anterior à
  vigência);
* competência `2026-09` → janela `28/09 → 28/10`.

**O intervalo `01/09 → 28/09` não pertence a competência nenhuma.** Hoje é 10/09:
estamos dentro do vão. E `competenciaDe` responde `2026-08`, cuja janela termina
em 01/09  então **nem escolhendo a competência "correta"** a tela alcançaria os
atendimentos de hoje.

Se `vigenteDesde` for `2026-08`, não há vão (a janela de `2026-08` seria
`28/08 → 28/09`, contendo hoje)  **mas a tela ainda falha**, por outro motivo:

```js
const PRIMEIRA_COMPETENCIA = '2026-09';   // Rankings.jsx
```

`mesesDisponiveis()` monta a lista pelo **calendário** (`d.getMonth() + 1`) e
descarta tudo abaixo de `2026-09`. A competência `2026-08`  que é a corrente
segundo o servidor  **não é oferecida no seletor**. Não há como escolhê-la.

Os dois ramos levam à tela zerada, por caminhos diferentes. O comando do §6 diz
qual é o caso.

### 4.1 O servidor já sabia a resposta certa

`ranking.service` usa `ciclo.competenciaDe(new Date(), ...)` como **padrão**
quando nenhuma competência é enviada ([linhas 344 e 469](../server/src/modules/rankings/ranking.service.js#L344)).
Se o cliente não mandasse nada, o servidor escolheria `2026-08`  a competência
corrente de verdade.

O cliente **sempre** manda, e manda o valor derivado do calendário. Ele
sobrescreve a resposta certa do servidor com um palpite.

---

## 5. O que NÃO é o problema

Vale dizer, porque as duas coisas estão à vista na tela e convidam à conclusão
errada:

* **não é a "limpeza".** O marco de zeragem (`marcoDeZeragem`) recorta as duas
  janelas, mas ele nunca apaga atendimento  grava um instante a partir do qual
  contar, e "Restaurar dados" o remove. A TV mostra `84 pts` **com** o recorte
  aplicado, então a limpeza não está engolindo nada;
* **não é a régua de pontos.** A conta da TV fecha exatamente (`24 + 35 + 25`).
  Os pesos e os mínimos estão funcionando como configurados.

---

## 6. Como determinar qual dos dois ramos é o caso

Uma consulta, só de leitura, no banco de produção:

```bash
docker compose -f docker-compose.prod.yml exec api node -e "const p=require('/app/src/infrastructure/database/prisma.client');p.configuracao.findUnique({where:{chave:'ranking.ciclo'}}).then(r=>{console.log(r?.valor||'(nao configurado)');process.exit(0)})"
```

* `"vigenteDesde":"2026-09"` → é o caso do vão de 27 dias (§4, primeiro ramo);
* `"vigenteDesde":"2026-08"` → é o caso do seletor que não oferece a competência
  corrente (§4, segundo ramo);
* `(nao configurado)` ou `"dia":1` → o ciclo **não** está no dia 28, e a causa da
  tela zerada é outra  reabrir a investigação.

---

## 7. O segundo pedido: pontos sem teto

Pedido, textualmente: *"não quero que os pontos sejam até 100, quero que os
pontos sejam infinitos e sejam resetados conforme foi decidido pelo
administrador"*.

Isto é **independente** do defeito acima e não se resolve com ele. É uma mudança
de natureza da métrica, e vale entender o que se ganha e o que se perde.

### 7.1 O que existe hoje

Um **índice de 0 a 100**, três parcelas:

| Parcela | Como | Teto |
| --- | --- | --- |
| volume | escada `FAIXAS_VOLUME` (10+ → 35, 8 → 30, 6 → 24, 4 → 17, 2 → 9, 1 → 4) | 35 |
| nota | média × `PESO_NOTA` (7) | 35 (5,0 × 7) |
| agilidade | escada `FAIXAS_AGILIDADE`, pela **mediana** do tempo até assumir | 30 |

`sede.regras.validar` **recusa** pesos que não somem 100
(`PESOS_NAO_SOMAM_100`)  o teto não é um acidente, é uma invariante gravada.

### 7.2 Por que o teto foi escolhido  a objeção que ele responde

Está escrito em `painel.service.js:44-79`, e é o argumento mais forte contra a
mudança:

> Este arquivo passou a vida RECUSANDO uma pontuação única, e o motivo estava
> escrito aqui: juntar volume e nota obriga a inventar um peso ("cada estrela
> vale quantos atendimentos?"), e o peso escolhido decide o vencedor.

E a escada de volume existe por uma razão específica:

> Ponto por unidade transforma o último dia do mês em corrida: fechar mais uma OS
> vale exatamente X, sempre, e há como perseguir isso fechando conversa que ainda
> não acabou. A faixa premia a ORDEM DE GRANDEZA do mês e para de premiar dentro
> dela  entre 6 e 7 atendimentos não há vantagem a caçar.

**Com pontos sem teto, o incentivo se inverte:** cada atendimento fechado passa a
valer pontos, para sempre, e fechar conversa que ainda não terminou volta a ser
uma jogada vantajosa. Foi para fechar essa porta que a escada foi desenhada.

### 7.3 O que "infinito" exige, concretamente

Três decisões, e nenhuma é técnica:

1. **quanto vale um atendimento**, em pontos por unidade (a escada por faixa
   deixa de fazer sentido sem teto);
2. **como a nota entra.** Média não acumula  ela é uma média. Ou vira
   multiplicador do volume (`pontos = atendimentos × nota`), ou vira bônus por
   avaliação recebida (`+X por nota 5`). São incentivos diferentes: a primeira
   pune quem tem volume e nota baixa; a segunda premia quem pede avaliação;
3. **como a agilidade entra.** Hoje é a **mediana** do tempo até assumir, e a
   mediana é uma propriedade do conjunto  ela não tem versão acumulável. Ou vira
   bônus por atendimento assumido rápido, ou sai da conta.

E duas consequências a aceitar de saída:

* **`sede.regras` muda de forma.** Pesos que somam 100 e `alvoAtendimentos`
  perdem sentido; a tela de configuração e o `validar` acompanham. A régua-irmã
  do ranking externo (`relatorio.regras`) tem a mesma forma **de propósito**, e
  divergir cria duas telas de configuração para aprender em vez de uma;
* **o histórico muda de conteúdo.** Nada de ranking é guardado  tudo é
  recalculado a cada consulta. Trocar a fórmula **reescreve todos os meses
  passados**, inclusive os já premiados, e a premiação registrada passa a
  apontar para quem não é mais o primeiro. É o mesmo risco que `ciclo.js`
  resolveu com `vigenteDesde`, e a fórmula precisaria da mesma proteção.

### 7.4 Sobre "resetados conforme o administrador decidiu"

Essa parte **já é o comportamento desenhado**  é o `ciclo.js`, com dia
configurável de 1 a 28. O reset no dia 28 não precisa ser construído; precisa
**passar a valer nas três telas**, que é o §3.

Ou seja: das duas coisas pedidas, uma é um defeito com correção clara, e a outra
é uma decisão de produto que não depende dela.

---

## 8. O que fazer, em ordem

**1. Descobrir o ramo** (§6). Uma consulta de leitura, e ela decide o resto.

**2. Corrigir a divergência de janela**  é o defeito, e é o que faz a tela
mentir hoje:

* `painel.service` passa a usar `ciclo.janela`/`ciclo.competenciaDe` nos dois
  pontos onde ainda usa `inicioDoMes()`, e `inicioDoMes` some. Enquanto ele
  existir, a quinta cópia da regra vai nascer;
* `Rankings.jsx` para de derivar a competência corrente do calendário. Quem
  sabe qual é o ciclo corrente é o servidor (`competenciaDe`), e ele já responde
   a lista de meses e o valor inicial precisam vir dele;
* `PRIMEIRA_COMPETENCIA` deixa de ser comparado contra um valor de calendário.

**3. Fechar o vão do §4**, se for o caso. Ele é um efeito de segunda ordem da
proteção do passado, e a correção honesta não é remover a proteção  é a
competência de transição cobrir de `01/09` a `28/09`, ou a vigência passar a
valer do ciclo seguinte. Precisa de decisão, porque muda o que "agosto/2026"
contém.

**4. Só então discutir os pontos sem teto** (§7), com as três decisões
respondidas e a proteção do histórico definida.

Fazer 4 antes de 2 esconderia o defeito atrás de uma fórmula nova: a tela
continuaria zerada, agora com outra régua, e ninguém saberia se a culpa era da
janela ou da conta.

---

## 9. O que foi feito (o conserto da tela)

O item 2 do §8, e o item 3 junto  porque **o item 2 não funciona sem o 3**:
fazer o painel de parede passar a usar o ciclo o jogaria dentro do vão do §4, e
a TV pararia de mostrar os 84 pontos que hoje ela acerta.

### 9.1 `ciclo.js`  a competência de transição absorve o vão

A primeira competência sob a regra nova passa a **começar no dia 1**, e não no
dia do ciclo. Com dia 28 e vigência em 2026-09:

| | antes | agora |
| --- | --- | --- |
| 2026-08 (passado) | 01/08 → 01/09 | 01/08 → 01/09 (intocado) |
| 2026-09 (transição) | 28/09 → 28/10 | **01/09 → 28/10** |
| 2026-10 em diante | 28/10 → 28/11 | 28/10 → 28/11 |

O primeiro ciclo fica mais longo **uma vez**; do seguinte em diante é 28 a 28
para sempre. `personalizada` ganhou um irmão, `transicao`, para a tela poder
explicar por que este ciclo é maior  sem isso, "01/09 a 28/10" parece erro de
cálculo.

A alternativa era esticar o **fim** da última competência de calendário (agosto
iria até 28/09). Recusada: aquele mês pode já ter sido premiado, e mudar o
conteúdo dele é exatamente o que `vigenteDesde` existe para impedir. Entre
alongar um ciclo que está começando e reescrever um que já fechou, só a primeira
é reversível.

`competenciaDe` acompanhou: no mês da vigência ele devolve a própria competência
de transição, em vez de apontar para a anterior  que era o passo que produzia
uma competência **cuja janela não continha o instante que a escolheu**.

### 9.2 `painel.service.js`  as duas cópias não migradas

`inicioDoMes()` **foi deletado** e os dois pontos passaram a usar o ciclo
(`cicloCorrente()`). As consultas ganharam também o limite superior `lt: fimCiclo`
 sem ele, passada a virada, a parede somaria dias de dois ciclos.

Deletar em vez de deixar sem uso é o ponto: enquanto a função existisse, a
quinta cópia da regra ia nascer. Foi assim que esta chegou aqui.

### 9.3 `Rankings.jsx`  a tela para de adivinhar o mês corrente

`competenciaAtual()` (derivado do calendário) **saiu**. `competencia` nasce
`null` = "a corrente, seja qual for", o servidor resolve com `competenciaDe` e
devolve qual usou; a lista de meses é construída de trás para frente **a partir
dessa resposta**.

E o corrente **entra sempre** no seletor, mesmo que anterior a
`PRIMEIRA_COMPETENCIA`  era esse o beco do §4, segundo ramo: a tela mostrava um
mês vazio e não oferecia o mês com os dados.

### 9.4 A invariante que faltava, e o teste que a trava

`competenciaDe` era conferida pelo **rótulo** que devolvia e `janela` pelas
**datas**  separadamente. Podiam discordar sem que nenhum teste reclamasse, e
foi assim que o vão passou.

`verificar-ciclo-ranking.js` ganhou a regra em uma linha:

> Para **qualquer** instante, a janela da competência que `competenciaDe`
> escolher tem de **conter** aquele instante.

Ela varre 18 meses dia a dia em cinco configurações de ciclo. Sem ela existe dia
que não pertence a ranking nenhum  e o trabalho feito nele desaparece da tela
sem nada explicar.

**Um dos casos antigos era, ele mesmo, uma instância do defeito.** O teste
afirmava que "começo de janeiro pertence ao ciclo de dezembro" com a vigência em
janeiro  mas a janela de dezembro terminava em 01/01, então o caso pedia um
rótulo cuja janela não continha a data. Corrigido movendo a vigência do cenário
para o passado (que é o regime que ele quer medir) e criando caso próprio para a
transição.

### 9.5 Verificação

`verificar-ciclo-ranking`, `verificar-ranking-equipe`, `verificar-rankings`,
`verificar-premiacao-justa` e `verificar-modo-tv`: **verdes**. Suíte completa de
volta ao baseline  as mesmas duas falhas pré-existentes (`inatividade`,
`cadastro-turnstile`), confirmadas com as alterações guardadas. Build do cliente
limpo.

**Uma regressão minha, encontrada e corrigida aqui:** o commit dos dois sons
(792a784) quebrou `verificar-avisos-mensagem.js`, e eu não vi porque só rodei o
build naquele momento. A checagem exigia o texto literal
`if (novas.length > 0) {\n playPing();`  travava a **forma**, não a garantia. A
garantia (nenhuma preferência gateia o aviso; na Central o som é incondicional)
continuava de pé. Reescrita para medir isso, mais o chamado novo do Modo TV.

### 9.6 O que continua pendente

Os **pontos sem teto** (§7). Nada disso foi tocado: a régua continua 0–100, e as
três decisões do §7.3 seguem em aberto.
