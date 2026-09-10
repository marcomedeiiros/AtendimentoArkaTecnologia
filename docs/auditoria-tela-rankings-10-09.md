# Auditoria: a tela de Rankings -- sede e fora da sede (10/09/2026)

**Escopo:** a aba Rankings da Visão Geral, as duas competições, e a fronteira
entre o que o servidor decide e o que a tela decide. Duas perguntas:

1. onde a tela **erra, mente ou quebra**;
2. **sobrou regra ou dado no front-end** -- qualquer número de negócio escrito
   no cliente é uma segunda fonte da verdade, e nenhuma decisão pode depender
   dele.

**O que foi lido:** `rankings/{ranking.service, ranking.controller, ranking.dto,
ranking.routes, pontuacao.externa, premiados, ciclo, relatorio.regras}`,
`dashboard/{painel.service, dashboard.controller, dashboard.routes, sede.regras}`,
`shared/helpers/equipeRanking.helper.js`, `client/src/components/pages/Rankings.jsx`,
`client/src/utils/equipeRanking.js`, `client/src/services/api.js` e o schema.

**O que foi rodado:** os cinco verificadores de ranking (`verificar-rankings`,
`verificar-ranking-equipe`, `verificar-ciclo-ranking`, `verificar-pontuacao-sede`,
`verificar-premiacao-justa`) -- **todos verdes** --, mais um roteiro próprio para
provar cada achado abaixo em vez de deduzi-lo.

**Conclusão antecipada:** a separação das duas competições está sólida e a tela
não recalcula pontuação nenhuma -- isso foi conferido linha por linha. Mas a
retirada do teto da sede (commit `c1627d6`) **passou por cima de três lugares que
ainda supõem 0 a 100**, e um deles decide desempate nos dois rankings. Além
disso, o pódio configurável tem um caminho que o servidor recusa, e a legenda do
"Fora da Sede" é o único texto de régua ainda cravado no cliente.

---

## Quadro dos achados

| # | Achado | Onde | Gravidade |
| --- | --- | --- | --- |
| 1 | A "nota geral" deixou de ser 0 a 100 -- e é o desempate dos DOIS rankings | servidor | **alta** · ✅ corrigido (§11) |
| 2 | Pódio acima de 3 lugares: a tela oferece o botão, o servidor recusa | os dois | **alta** · ✅ corrigido (§11) |
| 3 | A legenda do "Fora da Sede" está escrita no front -- e já mente | **front** | média |
| 4 | "1 de 3" no externo: o mínimo é chute do cliente | **front** | média |
| 5 | "A caminho da nota" ignora o mínimo configurado | servidor | média |
| 6 | Mudar o ciclo pela segunda vez reescreve os ciclos do primeiro | servidor | média |
| 7 | O histórico e a tabela podem discordar da posição da mesma pessoa | servidor | média · ✅ fechou junto com o 1 (§11.1) |
| 8 | `PUT /dashboard/regras` é a única escrita de ranking sem validação na borda | servidor | média |
| 9 | O ranking da sede cruza por NOME: homônimo soma junto, renomear apaga o mês | servidor | baixa/média |
| 10 | Restos: payload de regra que ninguém usa, textos e comentários vencidos | os dois | baixa |

---

## 1. A nota geral não é mais de 0 a 100 -- e ela desempata os dois rankings

`notaGeral` é a média das duas notas ponderada pelo volume de cada lado, e o
cabeçalho dela afirma, textualmente: *"Continua de 0 a 100, na mesma escala das
duas -- é média, não soma."* Isso era verdade **até a sede perder o teto**.

### Provado, não deduzido

```
sede 250 (10 aval) + externo 80 (10 rel) ->  165
so externo 95 (10 rel)                   ->   95
```

E a consequência não é cosmética: `classificar` usa a geral como **primeiro
desempate**, com `(b.geral ?? b.pontos)`. Para quem atua num lado só, a geral é
a própria pontuação; para quem está nas duas equipes, ela pode passar de 100.

**No ranking EXTERNO, onde todo mundo vale no máximo 100, quem também atende na
sede chega ao desempate com um número em outra escala.** Empate em 62 pontos
entre um técnico e alguém que acumula as duas funções: o segundo desempata com
165 contra 62, e sobe -- por trabalho que aconteceu **na outra competição**. É
exatamente a mistura que o cabeçalho de `ranking.service` proíbe em maiúsculas,
entrando pela porta do desempate.

**E o teste concorda com o texto, não com o código.** `verificar-premiacao-justa`
tem uma checagem chamada `"continua de 0 a 100 -- e media, nao soma"`, e ela
passa -- porque alimenta a função com `{ pontos: 100 }` dos dois lados, uma
régua da sede que não existe mais. O caso que quebra (sede em 250) nunca é
exercitado.

**Decisão necessária, e ela não é técnica:** ou a geral normaliza os dois lados
antes de pesar (e volta a ser comparável), ou ela deixa de ser desempate no
ranking externo. Aparar sem decidir só troca o defeito de lugar.

---

## 2. Pódio configurável acima de 3: o botão existe, o servidor recusa

`premiados` aceita de 1 a 50 por competição, e a tela obedece: o pódio desenha
`vagas` cartões e os botões de prêmio saem de
`Array.from({ length: dados?.premiados ?? 1 })`. Mas a gravação do prêmio está
travada em três posições, em **dois** lugares independentes -- `premiacaoSchema`
(`posicao.max(3)`) e `registrarPremiacao` (`![1,2,3].includes(...)`).

### Provado

```
premiados.validar({sede:5})  ->  { sede: 5, externo: 1 }
POST /premiacoes posicao 4   ->  RECUSADO: Number must be less than or equal to 3
```

Com 5 no campo "Premiados no pódio", a tela mostra cinco botões e **os dois
últimos falham sempre**, com uma mensagem de validação em inglês que não diz o
que fazer.

Junto vem uma quebra visual: `MEDALHAS` tem três cores, e tanto o pódio
(`MEDALHAS[p.posicao - 1]`) quanto a linha da tabela leem por índice. Da quarta
posição em diante o valor é `undefined` e a cor sai como
`rgb(var(undefined) / 1)` -- CSS inválido, cartão sem cor, sem nada explicando.
(Na tabela há a proteção `|| '--quieto'`; no pódio, não.)

**O campo permite 50; o resto do sistema suporta 3.** Ou o limite passa a ser 3
no formulário (e a explicação diz por quê), ou o schema, o service e a paleta
acompanham os 50. O estado atual é o pior dos três.

---

## 3. A legenda do "Fora da Sede" é a única régua ainda escrita no cliente

O rodapé da tabela, na aba externa (`Rankings.jsx`):

> Pontuação de 0 a 100: mapeamentos **aprovados** (25), relatório completo (25),
> entrega no prazo (20), evidências por visita (15) e ausência de retorno para
> correção (15) · as três parcelas de qualidade só contam a partir de
> **3 relatórios** entregues

Três problemas na mesma frase, e todos são o mesmo problema:

* **"aprovados" não existe mais.** A aprovação saiu; `pontuarExterno` conta os
  **entregues**, e o próprio código explica que esperar carimbo zeraria a
  parcela para sempre. A tela ainda manda o técnico buscar um aval que ninguém dá;
* **os cinco pesos são configuráveis** (`relatorio.regras`, tela Relatórios →
  Configuração). Trocar completude para 30 e prazo para 15 é salvar e pronto --
  e este texto continua dizendo 25 e 20;
* **o mínimo de relatórios é configurável** (`minimoRelatorios`, 1 a 20) e está
  cravado em 3 aqui.

Compare com a aba da sede, três linhas acima: ela lê `dados?.pesos?.unidades`,
`dados?.minimoAvaliacoes` e `dados?.pesos?.bonusAgilidade` **do servidor**, com
um comentário dizendo exatamente por que -- *"um texto com os números copiados
envelhece calado no dia em que alguém mexe na régua"*. **O padrão certo já está
na mesma função, aplicado a um lado só.**

E o conserto não é só no cliente: `_rankingExterno` devolve apenas
`{ classificacao }`, então `pesos: atual.pesos || null` chega **null** na aba
externa. A tela não tem de onde ler porque o servidor não manda. Ele precisa
mandar (pesos em vigor, mínimo em vigor), como a sede já faz.

---

## 4. "1 de 3": no externo, o mínimo exibido é chute do front

`valorCriterio` escreve a amostra insuficiente com `c.minimo ?? 3`. Na sede o
servidor manda `minimo: doMes.minimoAvaliacoes` -- correto. No externo,
`_rankingExterno` monta completude, prazo e evidências **sem o campo `minimo`**,
então o `?? 3` sempre entra.

Com `minimoRelatorios: 5` configurado, um técnico com 4 relatórios lê
**"4 de 3"** -- e a leitura possível é "já bati o mínimo e o sistema não está
contando". O número que a tela usa para explicar a regra é o único que ela não
recebeu de quem aplica a regra.

---

## 5. "A caminho da nota" ignora o mínimo configurado

Em `painel.service._ranking`, a parcela da nota respeita o mínimo configurado
(`minimoNotas`), mas a lista `aCaminho` -- que existe justamente para explicar
por que a parcela está zerada -- filtra pela **constante** `MINIMO_AVALIACOES`.

### Provado

```
minimo=5, Ana com 4 notas -> nota.conta: false | aCaminho: []
minimo=2, Bia com 2 notas -> nota.conta: true  | aCaminho: [{"nome":"Bia","amostra":2}]
```

Os dois lados do mesmo aviso discordam: com o mínimo **acima** de 3, a Ana
pontua zero em qualidade e a tela não a lista como "a caminho" -- a explicação
desaparece justo quando é mais necessária. Com o mínimo **abaixo** de 3, a Bia já
pontua e a tela continua anunciando que falta.

Uma linha: `p.notas.length < minimoNotas`.

---

## 6. Mudar o ciclo pela segunda vez reescreve o que a primeira preservou

`ciclo.js` guarda **um** `vigenteDesde`, e ele é recarimbado a cada mudança de
dia/hora. Como não existe histórico de ciclos, as competências vividas sob a
regra anterior deixam de ser "posteriores à vigência" e voltam a ser mês de
calendário.

### Provado (dia 28 vigente em 2026-09; depois dia 15, vigente em 2026-11)

| competência | sob a regra de setembro | depois da 2ª mudança |
| --- | --- | --- |
| 2026-09 | 01/09 → 28/10 | 01/09 → **01/10** |
| 2026-10 | 28/10 → 28/11 | **01/10 → 01/11** |
| 2026-11 | 28/11 → 28/12 | 01/11 → 15/12 |

O ciclo de outubro **muda de conteúdo inteiro**, e é o que estava valendo quando
o mês foi vivido e possivelmente premiado. É o mesmo defeito que `vigenteDesde`
foi criado para impedir -- ele protege o passado **anterior à primeira**
configuração, e não o passado de cada configuração.

O conserto honesto é guardar as vigências em lista (`[{desde, dia, hora}]`) e
`janela` escolher a que valia naquela competência. Enquanto isso não existir,
vale saber: **mexer no dia de fechamento uma segunda vez remexe os ciclos
recentes**, e as premiações registradas neles podem passar a apontar para outra
pessoa. O aviso da tela hoje afirma o contrário -- *"o dia de fechamento não mexe
no passado"*.

---

## 7. O histórico e a tabela podem discordar da posição da mesma pessoa

`obter` classifica com a nota geral anexada (`comGeral`). `historico` chama
`_rankingSede`/`_rankingExterno` **direto**, sem `comGeral` -- então lá a `geral`
é `undefined` e o desempate cai em `pontos → volume → nome`.

As duas listas aparecem **na mesma tela**, uma abaixo da outra. Havendo empate em
pontos e alguém nas duas equipes, a tabela de cima diz "2º" e a coluna daquele
mês na "Evolução dos últimos meses" diz "3º", para a mesma pessoa, no mesmo mês.
Não há como o usuário resolver a contradição -- e ela é lida como defeito de
cálculo, não de apresentação.

---

## 8. `PUT /dashboard/regras` é a única escrita de ranking sem validação na borda

A rota irmã (`PUT /rankings/configuracao`) tem `validate(regrasRelatorioSchema)`.
A da sede não tem middleware nenhum: o corpo cru vai para `painelService.salvarRegras`
e, no mesmo pedido, para `ciclo.salvar` e `premiados.salvar`.

Os três validadores de destino são sólidos (aparam faixa, ignoram chave
desconhecida, carimbam a vigência no servidor e recusam régua toda zero) -- então
**não há aqui um caminho conhecido para gravar valor inválido**. O que falta é a
primeira camada da defesa em profundidade que o resto do projeto aplica, e ela é
mais que estilo: `ciclo` e `premiados` são gravados a partir de
`req.body.ciclo`/`req.body.premiados` sem que a borda declare a forma desses dois
objetos, e a rota pode ganhar um campo novo amanhã sem ninguém notar a ausência.

Junto, dois comentários vencidos **na mesma função**: `salvarRegras` diz que
grava o ciclo depois *"porque `salvarRegras` recusa pesos que nao somam 100"* --
regra removida em `c1627d6` --, e o aviso de sucesso da tela fala de
*"Pesos, **alvo** e mínimo de avaliações"*, sendo que `alvoAtendimentos` deixou
de existir.

---

## 9. A sede cruza por NOME

`_rankingSede` casa a equipe com a pontuação por `u.nome`
(`porNome.get(u.nome)`), e `_ultimoAtendimento(nome)` também. `Atendimento`
guarda `atendenteNome` como texto, e `Usuario.nome` **não é único** no schema
(só `email` é). Duas consequências reais:

* **homônimos compartilham a pontuação.** Dois "Marco Medeiros" marcados na sede
  recebem a mesma linha -- os mesmos pontos, o mesmo último atendimento -- e nada
  na tela indica isso;
* **renomear uma pessoa apaga o mês dela.** O histórico é recalculado, mas os
  atendimentos antigos continuam com o nome velho: a pontuação passada vai a
  zero e não há como recuperá-la pela tela.

O helper documenta a escolha (é por nome que o atendimento guarda o atendente, e
usar id criaria dois critérios de igualdade). A escolha é defensável; o que falta
é `Usuario.nome` ser único -- sem isso, a premissa de que nome identifica pessoa
não é garantida por nada.

---

## 10. Restos

* **`GET /rankings/regras` publica os pesos de FÁBRICA.** O controller monta a
  resposta com as constantes `PESOS`, `FAIXAS_*`, `CUSTO_POR_DEVOLUCAO`,
  `MINIMO_MAPEAMENTOS` -- e não com `regrasRelatorio.obter()`. Só `itens` vem da
  configuração. Hoje não causa dano visível (`Mapeamentos.jsx` usa apenas
  `itens`), mas é um payload que se chama "as regras" e responde outra coisa: o
  próximo a consumi-lo herda o defeito. Ou passa a mandar o que está em vigor, ou
  se chama `padrao`;
* **`removerPremiacao` usa `deleteMany` e devolve `{ removido: true }` sempre**,
  inclusive para um id que não existe. Registro de premiação é o que foi pago a
  quem -- "removido" sem nada removido é a resposta que ninguém confere;
* **`PRIMEIRA_COMPETENCIA = '2026-09'` no cliente.** É regra de negócio no front,
  e o comentário sustenta a escolha (a data de início da operação não é dedutível
  do banco, porque atendimento é mais velho que o ranking). Fica registrado como
  **consciente**, com a ressalva de que o lugar natural dela é a configuração --
  hoje, mudar isso exige deploy.

---

## O front-end guarda dado ou decide regra? -- o levantamento

Era a segunda pergunta desta auditoria, e a resposta é **quase sempre não**. O
que a tela faz:

| Assunto | Quem decide | Situação |
| --- | --- | --- |
| Pontuação, parcelas, total | servidor (`_ranking`, `pontuarExterno`) | ✅ a tela só exibe; não há uma linha de cálculo de pontos no cliente |
| Competência corrente | servidor (`ciclo.competenciaDe`) | ✅ `competencia` nasce `null` e o servidor responde qual usou |
| Intervalo do ciclo | servidor (`janela`) | ✅ a tela só formata, e recua um dia porque o `fim` é exclusivo |
| Quantos sobem ao pódio | servidor (`premiados`) | ✅ lido de `dados.premiados` -- mas ver o achado 2 |
| Quem ganhou o prêmio | servidor | ✅ o corpo do POST manda só a **posição**; o vencedor é lido do ranking calculado |
| Recorte por equipe / exclusão de quem não concorre | servidor | ✅ no `_ranking`, na entrada -- não é filtro de tela |
| "Contando a partir de" (limpeza) | servidor (`zeradoEm`, `zeradoNoMes`) | ✅ inclusive a regra sutil de o marco não valer para mês já fechado (`pisoDoMes`) |
| Régua da sede no rodapé | servidor (`dados.pesos.unidades`) | ✅ |
| **Régua do externo no rodapé** | **cliente, cravado** | ❌ achado 3 |
| **Mínimo de amostra do externo** | **cliente, `?? 3`** | ❌ achado 4 |
| Primeira competência do ranking | cliente, constante | ⚠️ consciente e documentado (achado 10) |
| Menu/visibilidade por equipe (`utils/equipeRanking.js`) | cliente | ✅ **não é autorização** -- está escrito no arquivo, e o servidor relê o cadastro a cada chamada (`podeVerRelatoriosDeVisita` + recorte por dono no `mapeamento.service`) |

**Autorização:** as rotas de escrita da tela estão todas atrás de
`adminMiddleware` (régua, ciclo, premiados, limpar, restaurar, premiação), e
`req.user` vem do **banco** a cada requisição -- tirar o cargo de alguém vale na
requisição seguinte, não quando o token vencer. `ehAdmin` no cliente esconde
botão, e só. Nada aqui depende de o front se comportar.

---

## O que fazer, em ordem

**1. Decidir o que a nota geral significa agora** (achado 1). É a única
pendência que muda **classificação**, e ela precisa de decisão antes de código:
normalizar os dois lados, ou tirar a geral do desempate do externo. O teste que
afirma "0 a 100" precisa passar a exercitar a régua sem teto -- hoje ele protege
uma alegação vencida.

**2. Fechar o pódio acima de 3** (achado 2), escolhendo um lado: limitar o campo
a 3 ou abrir schema, service e paleta. Enquanto está aberto, existe um botão que
sempre falha.

**3. Fazer o externo mandar a régua, e a tela ler** (achados 3 e 4). O padrão
está na aba vizinha; é aplicá-lo. Isso conserta o texto vencido ("aprovados") e o
"4 de 3" de uma vez -- e tira do cliente o último número de negócio que ele
inventa.

**4. As duas linhas** (achados 5 e 7): `aCaminho` passar a usar `minimoNotas`, e
`historico` passar pelo mesmo `comGeral` que `obter` usa -- ou, se a geral sair do
desempate no passo 1, conferir que os dois caminhos ordenam igual.

**5. Vigência de ciclo em lista** (achado 6). É o mais caro, e é o que protege
premiação já registrada. Até existir, não mexer no dia de fechamento sem
conferir as premiações dos ciclos recentes.

**6. Higiene** (achados 8, 9, 10): `validate` na rota da sede, `Usuario.nome`
único, `/rankings/regras` dizendo o que está em vigor (ou trocando de nome),
`removerPremiacao` respondendo 404, e os textos vencidos ("alvo", "somar 100").

Fazer 3 antes de 1 é seguro -- são independentes. Fazer 1 depois de 5 não: a
ordem de classificação mudar duas vezes, por dois motivos, no mesmo intervalo,
tira de qualquer um a chance de saber qual mudança causou o quê.

---

## Baseline da verificação, para constar

`verificar-rankings`, `verificar-ranking-equipe`, `verificar-ciclo-ranking`,
`verificar-pontuacao-sede` e `verificar-premiacao-justa`: **todos verdes** nesta
data (o único pendente é a seção de PDF de `verificar-rankings`, que não roda sem
um arquivo de exemplo apontado por `RANKINGS_PDF_EXEMPLO`).

Vale registrar o que isso significa e o que não significa: **nenhum dos dez
achados acima é pego por teste hoje**. Sete deles estão em terreno que os
verificadores não visitam (a escala da geral com a régua nova, o pódio acima de
3, a legenda do externo, o mínimo do externo na tela, `aCaminho`, a segunda
mudança de ciclo, a divergência entre histórico e tabela). Suíte verde aqui quer
dizer "o que já quebrou continua consertado" -- e é para isso que ela serve.

---

## 11. O que foi feito (os achados 1 e 2)

Os dois de gravidade alta foram corrigidos no mesmo dia da auditoria. Os outros
oito seguem abertos, na ordem do §"O que fazer".

### 11.1 A média entre as duas escalas saiu

**A decisão foi parar de fazer média**, e não normalizar. Normalizar exigia um
denominador, e o único disponível numa escala sem teto é o primeiro colocado do
mês: a nota de cada um passaria a depender de quanto os **outros** trabalharam,
mudaria sozinha quando alguém fechasse mais um atendimento, e reescreveria o
passado a cada consulta -- porque nada de ranking é guardado. Trocar um número
sem sentido por um número instável não é conserto.

| | antes | agora |
| --- | --- | --- |
| coluna | "Geral" -- média ponderada das duas notas | o **outro lado**, na escala dele: `80/10` (pontos/registros) |
| desempate | geral → volume → nome | **volume próprio** → nome |
| mês anterior | recalculava o outro ranking também | não recalcula: dele só sai a posição |

O que a coluna respondia -- *"essa pessoa também trabalha na rua?"* -- continua
respondido, agora com os dois números lado a lado e um `title` dizendo, em
palavras, que são réguas diferentes e não se somam. O cabeçalho da coluna é o
nome da outra competição ("Fora da sede" / "Na sede"), e não mais "Geral".

**`notaGeral` foi DELETADA, e não deixada sem uso.** Régua antiga parada no
arquivo é convite para religá-la -- foi o que aconteceu com `inicioDoMes`, na
auditoria anterior. No lugar ficou o bloco que explica por que ela não volta.

**De brinde, o achado 7 fechou junto:** `comOutroLado` não reclassifica mais, e
`historico` nunca reclassificou -- então a tabela e a "Evolução dos últimos
meses" voltaram a ordenar pelo mesmo critério. A contradição de posição na mesma
tela deixou de existir sem que nada tenha sido escrito para isso: ela era um
efeito da geral valendo num caminho e não no outro.

**E o mês anterior ficou uma rodada de consultas mais barato.** Ele recebia o
tratamento completo porque, com a geral ordenando, um desempate valendo num mês
e não no outro faria a tela anunciar um "subiu" que não aconteceu. Sem a geral,
os dois meses saem do mesmo critério.

### 11.2 O pódio: um teto só, e ele vale até o banco

O campo aceitava 50 e o resto do sistema aceitava 3. **O teto agora é 3 e mora
em um lugar** -- `premiados.MAXIMO` --, de onde o Zod da rota, o serviço e o
formulário importam. Três é o número honesto: as medalhas são ouro, prata e
bronze, e um "4º lugar" não tem medalha de quê. Abrir para 50 exigiria inventar
cor, refazer o desenho do pódio (que é 2-1-3 e não generaliza) e decidir o que
significa premiar dois terços da equipe -- muito mais do que o campo prometia.

Um valor de 5 já gravado no banco não fica mandando na tela: `validar` roda
também na **leitura**, então ele volta como 3.

**E o pódio configurado passou a ser limite de verdade.** Com um campeão só,
registrar prêmio do 2º lugar era premiar quem a regra não premia -- a tela já
oferecia apenas as vagas existentes, mas esconder botão nunca foi proteção: a
mesma chamada sai no `curl`. O serviço agora recusa com `FORA_DO_PODIO` e uma
frase que diz o que fazer ("aumente Premiados no pódio na configuração"), em vez
do `Number must be less than or equal to 3` em inglês que aparecia antes.

### 11.3 A verificação

`verificar-premiacao-justa.js` foi reescrito onde media a coisa errada. **A
checagem "continua de 0 a 100 -- e media, nao soma" era, ela mesma, uma
instância do defeito:** alimentava a função com `pontos: 100` dos dois lados --
uma régua da sede que já não existia -- e por isso passava enquanto a produção
somava 165. Ela protegia a alegação do comentário, e não o comportamento.

No lugar entraram quatro garantias, e todas falham alto se alguém desfizer o
conserto:

* **não há média entre as duas escalas** -- `notaGeral` não voltou, e o bloco
  que explica por quê continua no arquivo (sem ele, alguém a recria numa tarde);
* **o desempate é o da própria competição** -- `classificar` não menciona a
  geral, e a ordem é pontos → volume próprio → nome;
* **o outro lado é exibição, não ordem** -- `comOutroLado` não chama
  `classificar`, e leva os pontos e registros próprios do outro ranking;
* **um teto só para o pódio, do formulário ao banco** -- `MAXIMO` é 3, valor
  acima dele é aparado na leitura, a borda aceita a última posição e recusa a
  seguinte, o serviço tem o guarda do pódio configurado, e a tela não oferece
  50 nem crava o teto (lê `premiadosMaximo` do servidor).

**Suíte completa: `TUDO PASSOU`** -- inclusive as duas que estavam vermelhas no
baseline anterior (`inatividade`, `cadastro-turnstile`), que já haviam sido
consertadas antes desta auditoria. Build do cliente limpo.

### 11.4 O que isto muda para a equipe

**A ordem de alguns meses pode mudar**, e é o ponto: onde havia empate em pontos
com alguém que acumula as duas funções, a posição sai agora do volume daquela
competição em vez da pontuação da outra. É a correção, não um efeito colateral
-- mas vale conferir as premiações registradas antes de anunciar, pelo mesmo
motivo de sempre: o histórico é recalculado a cada consulta.

**Quem tinha configurado mais de 3 premiados** volta a ver 3 no formulário (e o
ranking premia 3), sem precisar salvar nada.

---

## 12. Fora da auditoria: o fechamento passou a aceitar o dia 30

Pedido no mesmo dia, e não é um dos achados -- é funcionalidade que faltava:
*"fechar a nota todo dia 30, ou selecionar a data do calendário já que o horário
já tem"*.

O dia era limitado a **28**, e a justificativa estava escrita em `ciclo.js`:
fevereiro não tem 30, e `new Date(2026, 1, 30)` não estoura -- **transborda**
para 02 de março. Um ciclo no dia 31 mudaria de janela sozinho, mês a mês.

**O limite resolvia o problema errado.** Quem fecha folha no dia 30 precisa que
o ranking feche no dia 30, e "escolha 28" custa dois dias de trabalho caindo no
ciclo seguinte, todo mês.

### 12.1 A regra: o dia escolhido, ou o último que o mês tiver

`diaQueExiste(ano, mes, dia)` apara a data para um dia que existe naquele mês.
Com dia 30:

| competência | janela |
| --- | --- |
| 2026-01 | 30/01 → **28/02** |
| 2026-02 | **28/02** → 30/03 |
| 2026-03 | 30/03 → 30/04 |
| 2028-01 (bissexto) | 30/01 → **29/02** |
| 2028-02 | **29/02** → 30/03 |

E o **dia 31** passou a significar, na prática, *"sempre no último dia do mês"* --
31 em janeiro, 30 em abril, 28 ou 29 em fevereiro. A tela escreve exatamente
isso quando o valor é 31, em vez de deixar a pessoa deduzir.

**A aparagem vale nas DUAS pontas**, e o mês de referência de cada uma é
diferente (o fim é o dia do ciclo no mês seguinte). Aparar só o início abriria um
vão de dias sem competência entre um mês curto e o seguinte -- a mesma família de
defeito da auditoria de 10/09.

### 12.2 Por que não uma data de calendário

Porque o ciclo é uma regra que **repete**. Uma data escolhida no calendário
("30/09/2026") responde por um mês só: alguém teria de voltar à configuração
todo mês, e no mês em que esquecesse o ranking não fecharia. O dia do mês é a
regra; a hora, que já existia, é o refinamento dela. Um seletor de data daria a
impressão de mais controle e entregaria menos.

### 12.3 A verificação

A invariante que já existia -- *"para qualquer instante, a janela da competência
que `competenciaDe` escolher tem de conter aquele instante"* -- passou a varrer
**30 meses** (até meados de 2028, para pegar o fevereiro bissexto) em **oito**
configurações, agora incluindo dia 29, 30 e 31. É ela que prova que a janela e a
competência corrente concordam sobre onde fevereiro vira; quando as duas
discordam, nasce o dia órfão que fez a tela mostrar a equipe zerada.

O teste que travava o teto em 28 foi reescrito: ele afirmava que 29, 30 e 31
*não podiam passar*, e passou a afirmar que **passam e são aparados** -- mais a
aparagem caso a caso (fevereiro comum, bissexto, dia 31 em abril) e o efeito na
janela.

Suíte completa: `TUDO PASSOU`. Build do cliente limpo.

### 12.4 O irmão veio junto: o vencimento do relatório

`vencimentoDiaDoMes` -- o **vencimento mensal do relatório de visita**, em
Relatórios → Configuração -- tinha o mesmo teto de 28 e a mesma justificativa,
escrita quase com as mesmas palavras. Foi corrigido no mesmo commit, a pedido.

E aqui a aparagem **não é conforto, é correção**: sem ela,
`new Date(2026, 1, 30)` não falha -- transborda para 02/03, e o vencimento de
fevereiro passaria a cair em março. Dois dias de folga que ninguém concedeu, num
mês só, sem nada na tela explicando.

| visita | vencimento configurado | vence em |
| --- | --- | --- |
| 20/01/2026 | dia 30 | **28/02/2026** |
| 20/01/2028 (bissexto) | dia 30 | **29/02/2028** |
| 10/03/2026 | dia 31 | **30/04/2026** |
| 20/09/2026 | dia 30 | 30/10/2026 (mês tem o dia, nada é aparado) |

### 12.5 A aparagem mora em UM lugar

As duas regras faziam a mesma pergunta ao calendário, e a resposta estava
escrita duas vezes -- as duas com o mesmo teto de 28 e a mesma frase sobre
fevereiro. Isso é o começo de dois calendários diferentes na mesma tela, e é
literalmente o formato do engano que a auditoria anterior registrou sobre
`inicioDoMes`.

`shared/helpers/calendario.helper.js` passou a ser o único lugar onde a
aparagem existe (`diaQueExiste`), e `ciclo.js` e `relatorio.regras.js`
importam de lá. O helper mora em `shared` pelo mesmo motivo que
`equipeRanking.helper`: **quem pergunta são dois.**

`verificar-rankings` ganhou o fevereiro comum, o bissexto, o dia 31 em abril, o
mês que tem o dia (para provar que nada é aparado sem necessidade) e a faixa nova
na configuração (30 aceito, 40 aparado para 31).
