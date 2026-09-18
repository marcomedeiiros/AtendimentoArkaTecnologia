# Auditoria: a tela de Relatórios (18/09/2026)

**Escopo:** a aba **Relatórios** inteira -- o formulário de mapeamento com a
prévia do PDF, o histórico, a Configuração e a fronteira dela com a pontuação do
ranking externo. Duas perguntas, as mesmas de sempre:

1. onde a tela **erra, mente ou trava**;
2. **sobrou regra ou número de negócio no front-end** -- toda cópia da regra no
   cliente é uma segunda fonte da verdade, e ela envelhece calada.

**Por que agora:** a tela foi reescrita em 17 e 18/09 (o PDF passou a ser montado
na plataforma, o relato ganhou campo próprio, a pontuação perdeu o teto e o mês
ganhou fechamento). São sete mudanças em dois dias no mesmo lugar, e foi o
usuário -- e não o harness -- quem percebeu duas delas quebrando.

**O que foi lido:** `rankings/{mapeamento.service, pontuacao.externa,
relatorio.regras, ranking.controller, ranking.service, ranking.dto,
ranking.routes, analise.relatorio}`, `client/src/components/pages/Mapeamentos.jsx`,
`client/src/utils/{documentoMapeamento, exportarPdf}.js`,
`client/src/services/api.js` e o schema.

**O que foi rodado:** `verificar-tudo.js` inteiro (**verde**), mais roteiros
próprios para cada achado -- nenhum deles foi deduzido da leitura.

**Conclusão antecipada:** os dois defeitos que o usuário sentiu (o checklist que
só aparecia depois do F5 e a completude de 22%) tinham a mesma forma: **duas
cópias da mesma verdade, uma delas velha**. A varredura achou outros dois do
mesmo feitio -- um deles trancava a correção de um relatório devolvido, e
nenhum teste cobria esse caminho.

---

## Quadro dos achados

| # | Achado | Onde | Gravidade |
| --- | --- | --- | --- |
| 1 | A correção de um relatório devolvido ficava **trancada** depois da virada do mês | servidor | **alta** · ✅ corrigido (§1) |
| 2 | Checklist novo só aparecia no formulário depois de recarregar a página | **front** | média · ✅ corrigido (§2) |
| 3 | A lista media a completude com o checklist **de fábrica**: 100% no formulário, 22% na lista | servidor | **alta** · ✅ corrigido (§3, commit `8fd7d74`) |
| 4 | "Salvar regras" desabilitado para sempre: comparava com 100, e a soma virou 75 | **front** | **alta** · ✅ corrigido (§4, commit `8fd7d74`) |
| 5 | O prazo sugerido era "visita + 3 dias" cravado no cliente | **front** | média · ✅ corrigido (§5, commit `2e9bf18`) |
| 6 | `\D` perdido num script de edição: a logo sumia com CNPJ digitado com máscara | **front** | média · ✅ corrigido (§6) |
| 7 | O campo de data travava a edição de um relatório de mês anterior | **front** | baixa · ✅ corrigido (§7) |
| 8 | `RankingsAPI.analisarMapeamento` ficou sem chamador | **front** | baixa · 🟡 mantido (§8) |

---

## §1 -- A correção devolvida ficava trancada (alta)

**O que acontecia.** A regra "a visita tem de ser do mês em disputa" valia em
toda gravação, inclusive na edição. O caminho real:

1. técnico entrega no dia 28 o relatório da visita do dia 28;
2. o supervisor devolve para correção no dia 2 do mês seguinte;
3. o técnico abre, corrige e salva → **`FORA_DA_COMPETENCIA`**.

A data da visita é do mês passado e não pode ser reescrita -- mudá-la seria
mentir sobre quando a visita aconteceu. A devolução virava um beco sem saída,
com o desconto de retrabalho já aplicado e sem caminho de volta.

**Por que passou.** O teste que entrou com a regra cobria a criação (mês
passado, mês que vem, entrega depois do fechamento) e não a **edição** -- o
caminho que só existe depois de alguém devolver.

**A correção.** As duas regras foram separadas, porque são duas:

- `conferirMesDaVisita` -- vale ao **criar** e ao **mudar a data**. É o que
  impede mover um relatório de mês.
- `conferirFechamento` -- vale só na **primeira entrega**. Reenviar uma correção
  de algo que já saiu da mão do técnico continua liberado.

A correção não inventa ponto: `entregueEm` é gravado na primeira entrega e não
se move (é ele que decide o "no prazo"); o que muda é a qualidade de um
relatório que já estava contado naquele mês.

**Provado em teste** (`verificar-rankings`, seção 8a-bis): a correção de um
relatório entregue no mês passado passa, a data da primeira entrega não se move,
e mudar a data para outro mês continua recusado.

---

## §2 -- O checklist que só aparecia depois do F5 (média)

**O que acontecia.** As regras (checklist, prazo, mínimo) são lidas **uma vez**,
quando a tela de Relatórios abre, e é delas que o formulário monta os campos.
Salvar na aba Configuração atualizava só o estado daquela aba: o item recém-
criado só aparecia em "Novo mapeamento" depois de recarregar a página.

Quem acabou de adicionar o item não tem por que desconfiar que a tela está com
uma cópia velha -- a leitura possível é "não salvou".

**A correção.** A Configuração avisa a tela em volta (`onSalvo`), que relê **só
as regras**. Recarregar a lista inteira de relatórios a cada "Salvar regras"
seria pedir 300 linhas para atualizar um checklist. A releitura falha em
silêncio: as regras antigas continuam valendo até a próxima abertura, e nada do
que a pessoa estava fazendo se perde.

---

## §3 -- Duas réguas para a mesma completude (alta, já corrigido)

`_mapear` chamava `completudeDe(m)` **sem o checklist em vigor** -- e sem ele a
função usa a lista de fábrica (8 itens). Numa empresa com checklist de 2, o
mesmo relatório dava **100% no formulário** e **11% na lista**.

Medido antes e depois, com um checklist de 2 itens: formulário 100% / lista 11%
→ formulário 100% / lista 100%. O checklist em vigor passou a chegar em
`listar`, `obter`, `criar`, `atualizar` e `devolver`.

---

## §4 -- O botão que nunca habilitava (alta, já corrigido)

"Salvar regras" tinha `disabled={somaPesos !== 100}`. Quando o volume saiu dos
pesos (virou ponto por relatório), a soma passou a ser **75**: o botão ficava
desabilitado para sempre, e nada na tela dizia por quê -- a Configuração inteira
parecia não salvar.

Hoje ele compara com a soma que vale, e o título explica quando trava.

---

## §5 -- O prazo que não era o configurado (média, já corrigido)

O formulário abria propondo "visita + 3 dias", um número escrito no cliente. Com
a Configuração em 7, a tela dizia 21/09 e o servidor gravava 24/09: a pessoa
decidia em cima de uma data que não era a do relatório dela.

O prazo em vigor passou a viajar no mesmo endpoint que já servia o checklist, e
a tela faz a mesma conta do servidor -- inclusive a regra combinada (vale a mais
apertada entre o prazo por relatório e o vencimento mensal). Conferido nos dois
lados: 17/09 → 24/09 e 28/09 → 05/10.

---

## §6 -- Um `\D` perdido, e a logo sumindo (média)

`urlLogoDaEmpresa` estava com `replace(/D/g, '')` em vez de `/\D/g`: um script
de edição comeu a contrabarra. O efeito era invisível no caminho feliz (o CNPJ
escolhido na lista vem só com dígitos) e aparecia quando alguém **digitava** o
CNPJ com pontuação -- a máscara sobrevivia, o comprimento não batia com 14, e a
logo simplesmente não aparecia.

Corrigido, e a varredura por outros danos do mesmo tipo (`/D/g`, classes de
acento, `\d` em regex escrito por script) não achou mais nenhum. Fica a nota:
**editar arquivo por heredoc de bash come contrabarra** -- em `.js` que contém
regex, escrever o script num arquivo e rodá-lo com `node` é o caminho seguro.

---

## §7 -- O campo de data travando a edição (baixa)

`min`/`max` do campo de data prendiam ao mês corrente também na **edição**. Num
relatório de mês anterior (a correção do §1), o formulário abria com um valor
fora da faixa -- inválido para o navegador -- por causa de um dado que ninguém
está mudando.

Agora o limite vale só para o relatório novo. Quem decide sobre mudança de data
é o servidor, que recusa mover de mês.

---

## §8 -- O que ficou de fora, e por quê

`RankingsAPI.analisarMapeamento` ficou **sem chamador** quando o upload de PDF
saiu da tela. A rota do servidor continua de pé e continua exercitada pelo
`verificar-rankings` (ela é o caminho do relatório antigo, lido de um PDF feito
fora da plataforma). Tirar só a função do cliente é seguro; tirar a rota é
decidir que nenhum PDF externo será lido de novo -- e isso é decisão de produto,
não de faxina.

---

## O que este conjunto de defeitos tem em comum

Sete dos oito achados são **a mesma forma**: um número ou uma lista existindo em
dois lugares, e um deles envelhecendo sem avisar.

- a completude, no formulário e na lista (§3);
- a soma dos pesos, na regra e no botão (§4);
- o prazo, na Configuração e no cliente (§5);
- o checklist, no servidor e na cópia que a tela guardou ao abrir (§2);
- a regra do mês, escrita uma vez e aplicada a dois caminhos diferentes (§1).

O antídoto que o projeto já usa -- servir a régua junto do dado e nunca
reescrevê-la no cliente -- funcionou em todos os lugares onde foi aplicado. Os
defeitos apareceram justamente onde a mudança nova esqueceu de aplicá-lo.

**O que fica para a próxima mudança nesta tela:** quando uma regra mudar de
forma (um peso que sai, um campo que passa a contar), procurar **todos** os
lugares que já sabiam da forma antiga -- `select:` do ranking, `disabled` de
botão, valor inicial de campo, e o teste que descrevia a regra velha. Foi essa
varredura que achou o §1, que nenhum sintoma tinha reportado ainda.
