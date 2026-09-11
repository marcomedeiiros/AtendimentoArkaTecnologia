# Auditoria: regra de negócio no front-end -- o projeto inteiro (10/09/2026)

**Escopo:** os 81 arquivos de `client/src` (30.725 linhas), não só a tela de
Rankings. Uma pergunta: **o que o cliente decide que deveria ser decidido no
servidor?**

Cinco coisas foram procuradas, porque cada uma falha de um jeito diferente:

| o que | por que importa |
| --- | --- |
| **autorização** decidida no cliente | esconder botão não é proteção: a chamada sai no `curl` |
| **régua ou limite** cravado no cliente | envelhece calado no dia em que alguém muda a configuração |
| **cálculo** de número de negócio no cliente | duas contas para a mesma pergunta divergem, e ninguém sabe qual é a certa |
| **validação** só no cliente | um pedido montado à mão grava o que a tela recusaria |
| **lista canônica** duplicada | some uma opção nova, ou oferece uma que o servidor recusa |

**Veredito:** o front está, no geral, **do lado certo** -- e em vários pontos com
a decisão escrita e defendida no comentário. **Nenhuma autorização depende do
cliente** e **nenhum segredo vive nele**. Mas há **uma exceção grave**, que faz
um indicador mostrar números diferentes para pessoas diferentes, e um punhado de
duplicações que envelhecem.

---

## Quadro dos achados

| # | Achado | Onde | Gravidade |
| --- | --- | --- | --- |
| F1 | A Visão Geral calcula a satisfação inteira no cliente, sobre uma lista recortada por setor | `Dashboard.jsx` | **alta** |
| F2 | A importação de fluxo converte semântica de bot no cliente, e o servidor grava o que vem | `fluxoJson.js` | média |
| F3 | A completude do relatório de visita é recalculada no cliente, com o limiar cravado | `Mapeamentos.jsx` | média |
| F4 | Relatos de Bugs decide acesso por cargo cravado; o servidor decide por módulo configurável | `BugsPage.jsx` | média/baixa |
| F5 | Listas canônicas duplicadas -- e uma delas na MESMA tela que já lê a do servidor | 4 lugares | baixa |
| F6 | Tetos espelhados (20 MB, 3 imagens, 60/30 motivos, primeira competência) | 5 lugares | baixa |

---

## F1. A satisfação da Visão Geral é calculada no cliente -- e sobre a lista errada

`Dashboard.jsx` monta o painel de satisfação a partir de `conversas`, o estado
da Central:

```js
const total = avaliadas.length;
const soma  = avaliadas.reduce((s, c) => s + c.avaliacao, 0);
const media = total > 0 ? (soma / total) : 0;
const promotores = distribuicao.filter(d => d.nota >= 4)...
const detratores = distribuicao.filter(d => d.nota <= 2)...
```

São **três problemas em cima do mesmo cálculo**, e o primeiro é o grave.

### 1. O número muda com quem está logado

`conversa.service.listar` recorta a lista por setor para quem não é
Administrador:

```js
if (!acesso || acesso.cargo === "Administrador") return dto;
return dto.filter((c) => podeAcessarSetor(acesso, c.setor));
```

Como o painel calcula a partir dessa lista, **a "média de avaliação" de um
Técnico é a média do setor Técnico** -- com o rótulo de média geral, e sem nada
na tela indicando o recorte. Duas pessoas olhando a mesma tela, no mesmo
instante, leem números diferentes e não têm como saber por quê.

**E o projeto já aprendeu exatamente isso, em outro lugar.** Está escrito em
`services/api.js`, em cima de `RelatoriosAPI`:

> Vem do SERVIDOR, e nao das `conversas` que o painel ja tem em maos: a listagem
> da Central e filtrada por setor para quem nao e Administrador, e um relatorio
> montado a partir dela sairia sem os chamados dos outros setores -- sem nada na
> tela indicando a falta.

A lição foi aplicada aos relatórios por CNPJ e **não** ao painel de satisfação.

### 2. Não há janela de tempo, e o Modo TV responde outra coisa

O servidor tem a sua conta (`painel.service._csat`), e ela é da **janela do
ciclo**:

```js
_csat(atendimentos) {
  const notas = atendimentos.filter((a) => typeof a.avaliacao === "number")...
  return { media: notas.length ? media(notas) : null, total: notas.length };
}
```

O cliente usa **tudo que está carregado**, sem recorte de período. Então a
mesma pergunta ("como está a satisfação?") tem duas respostas no sistema: a da
parede, do ciclo corrente, e a da Visão Geral, de toda a história -- e elas nunca
vão coincidir.

Vale notar o que o servidor faz de certo e o cliente não: `_csat` devolve
`media: null` quando não há nota, e o total **sempre** junto. O cliente devolve
`media: 0` -- que é uma afirmação ("foi mal") sobre um mês em que não há o que
julgar. É o mesmo cuidado que `notaGeral` tinha e que o `pisoDoMes` tem.

### 3. "Promotor" e "detrator" só existem no cliente

Os limiares `nota >= 4` e `nota <= 2` são **definição de negócio** -- é a régua
que decide se o mês foi bom -- e não existem no servidor. Quem quiser mudar para
"promotor é só 5" mexe num `.jsx`, faz deploy, e nenhuma outra tela acompanha.

### O conserto, e a decisão que ele exige

O caminho é o mesmo dos relatórios: **um endpoint que devolva o painel de
satisfação pronto**, com a janela explícita e a régua (limiares) no servidor.

A decisão que não é técnica: **o painel deve mostrar a empresa inteira ou o
setor de quem olha?** As duas respostas são defensáveis -- e é justamente por
isso que ela não pode continuar sendo tomada por acidente, pelo recorte de uma
listagem feita para outra finalidade.

---

## F2. A importação de fluxo vira semântica de bot no cliente

`components/flow/fluxoJson.js` converte um arquivo de formato externo
(`nodeList`) na forma de fluxo do projeto: blocos, opções, alvos e **ações**.

```js
const ACAO_CONDICAO = { 0: 'ir', 1: 'transferir', 3: 'encerrar' };
```

O mapa em si é adaptador de formato -- legítimo. O problema é o que está em volta:
**a conversão inteira acontece no navegador**, e o servidor grava o resultado
quase sem olhar. É decisão registrada no próprio arquivo (`config.opcoes` é
`Json?` no Prisma e `z.record(z.any())` no DTO, "para importar sem migração de
banco e sem perder informação no caminho de volta") -- e o preço dela é que um
defeito de conversão vira **comportamento do bot**.

**Isso já aconteceu.** O gatilho de fluxo importado sai como `importado_<n>` em
vez do `"*"` que `docs/fluxo-arka.json` declara, e o resultado é um bot que não
dispara -- sem erro em lugar nenhum.

Não é caso de fechar o `z.any()`: é caso de o servidor **conferir o que recebeu**
depois de gravar (existe fluxo? há bloco inicial? há gatilho que casa?) e dizer
na resposta, em vez de deixar a descoberta para o primeiro cliente que escrever
no WhatsApp. A tela de Automações já tem onde mostrar isso.

---

## F3. A completude do relatório é recalculada no cliente

`Mapeamentos.jsx` reimplementa `pontuacao.externa.completudeDe`:

```js
const comResumo = analise?.lido || resumo.trim().length >= 20 ? 1 : 0;
return Math.round(((cobertos + comResumo) / (itensRegra.length + 1)) * 100);
```

O comentário é honesto -- *"a MESMA conta do servidor [...] se as duas
divergirem, a do servidor é a que vale"* -- e a necessidade é real: o número
aparece **enquanto se digita**, e para isso não dá para ir ao servidor a cada
tecla.

O que está errado é o limiar cravado: **20 caracteres de resumo** e o **`+ 1`**
do denominador são régua, e vivem em dois arquivos. O checklist já vem do
servidor (foi o conserto do achado 3 da auditoria da tela); o limiar não veio
junto. Publicar `minimoResumo` na mesma régua fecha isso sem tirar a prévia.

**E a prévia não é decorativa:** é por ela que a pessoa decide se o relatório
está pronto para entregar. Um número que sobrevive à mudança da regra é um número
que convida a entregar incompleto.

---

## F4. Relatos de Bugs: duas regras para a mesma pergunta

`BugsPage.jsx` fecha a tela inteira por cargo:

```js
const ehAdmin = usuario?.cargo === 'Administrador';
...
if (!ehAdmin) { /* recusa */ }
```

O servidor decide por **módulo**, que é configurável por cargo na matriz de
permissões:

```js
router.get("/", exigirModulo("bugs"), ...)
```

O cliente é mais **estrito** que o servidor, então não há furo de segurança -- há
contradição: no dia em que um administrador conceder "Relatos de Bugs" ao cargo
Técnico, **o menu passa a mostrar o item** (o menu lê `usuario.permissoes`, do
servidor) **e a página recusa a abrir**. É o sintoma que o
`utils/equipeRanking.js` descreve em maiúsculas no próprio arquivo: *"o sintoma
seria um menu que mostra uma tela que a tela recusa a abrir"*.

Conserto: a página perguntar `permissoes.includes('bugs')`, como o menu já faz.

---

## F5. Listas canônicas duplicadas

| lista | no cliente | no servidor | efeito da divergência |
| --- | --- | --- | --- |
| **Cargos** | `EquipePage.jsx:34` (`CARGOS`, cravado) | `CARGOS_EDITAVEIS`, **publicado** em `paraEditor()` | cargo novo não aparece no seletor |
| **Setores** | `AtendimentoView.jsx:191` e `RegistroConversas.jsx:54` (duas cópias) | `setor.helper.SETORES` | setor novo cai em "Sem Setor" na tela |
| **Sentinela do histórico** | `AtendimentoView.jsx:25` | `atendimentoSintetico.helper` | OS sintética volta a contar como atendente |

O caso dos **cargos é o mais claro de todos**, porque a mesma tela faz as duas
coisas: ela já usa `perm.cargosEditaveis` do servidor na matriz de permissões
(linhas 139, 558, 597) e usa a cópia local no seletor de cargo (linha 353). A
resposta do servidor está a três linhas de distância.

Nos outros dois casos, a lista é constante de código também no servidor -- então
uma mudança exigiria deploy dos dois lados de qualquer forma, e o risco é menor.
Ainda assim: quem lê a tela não tem como saber que a lista é parcial.

---

## F6. Tetos espelhados -- e por que estes estão aceitáveis

| limite | cliente | servidor aplica? |
| --- | --- | --- |
| anexo de mensagem rápida (20 MB) | `MensagensRapidas.jsx:18` | ✅ `mensagemRapida.service` |
| imagens de bug (3, 3 MB cada) | `ReportarBug.jsx:16-17` | ✅ `bug.imagens.js` |
| motivos de encerramento (60 chars, 30 itens) | `HelpDeskPainel.jsx:120-121` | ✅ `configuracao.service`, **na leitura** |
| primeira competência do ranking (`2026-09`) | `Rankings.jsx:108` | -- (fato da operação, não dedutível do banco) |

Os três primeiros são **espelho para dar erro antes do upload**, com o servidor
aplicando de verdade -- é o padrão certo, e o comentário de um deles até diz
"mesmo teto do servidor". O risco que sobra é só o número divergir, e o sintoma
seria benigno (a tela recusa o que o servidor aceitaria, ou deixa subir para
receber um 400). Fica registrado, não como defeito.

---

## O que está certo, e vale não estragar

Levantado porque o padrão bom aparece mais vezes que o ruim:

* **autorização, em tudo que foi verificado, é do servidor.** `req.user` vem do
  **banco** a cada requisição (não do JWT), então trocar o cargo de alguém vale
  na requisição seguinte. As telas escondem botão, e só;
* **o escopo de dados por setor é do servidor** (`exigirAcessoSetor` em oito
  pontos de escrita e leitura de conversa), e não um filtro de tela;
* **o menu vem de `usuario.permissoes`**, e o arquivo diz em maiúsculas que
  esconder item não é proteção;
* **campanhas são o modelo a seguir.** O intervalo anti-bloqueio, o teto de
  destinatários e o tamanho da mensagem são do servidor, que **normaliza e
  devolve** os valores -- e o cabeçalho registra que "o intervalo entre
  mensagens era só uma regra de tela", exatamente o defeito desta auditoria,
  já corrigido lá;
* **a régua do ranking vem do servidor** nas duas abas (foi o conserto de hoje);
* **nenhum segredo no cliente.** O `.env.example` do front diz "o client nao
  precisa mais de variaveis de ambiente" e registra que houve um tempo em que
  `VITE_ADMIN_SENHA` ia no bundle. A sitekey do Turnstile vem da API e a secret
  nunca chega ao navegador; os campos de API Key da tela de Configurações são
  mascarados pelo servidor.

---

## O que fazer, em ordem

**1. F1 (o painel de satisfação).** É o único que faz a tela mentir hoje, e
precisa da decisão "empresa inteira ou setor de quem olha?" antes do código.
Enquanto não for movido, vale saber: **aquele número não é comparável entre duas
pessoas de cargos diferentes.**

**2. F4 (Bugs por permissão).** Uma linha, e tira uma contradição que só espera
alguém mexer na matriz.

**3. F3 (o limiar do resumo).** Publicar `minimoResumo` na régua dos relatórios
e a tela lê -- o caminho já está aberto pelo conserto de hoje.

**4. F5 (cargos).** Trocar `CARGOS` por `perm.cargosEditaveis` no seletor. As
outras duas listas ficam registradas, com o risco medido.

**5. F2 (importação de fluxo).** O mais caro, e o que pede desenho: uma
conferência no servidor depois de importar, que responda "este fluxo dispara?"
em vez de deixar a descoberta para o primeiro cliente no WhatsApp.

---

## Nota de método

Esta auditoria **não mexeu em código** -- é levantamento. Cada achado foi
confirmado nos dois lados: o trecho no cliente e a rota (ou a ausência dela) no
servidor. O que não foi verificado, e fica dito: as 5.800 linhas de
`AtendimentoView.jsx` foram varridas por padrão (constantes, checagens de cargo,
cálculo), e não linha a linha -- um cálculo de negócio escondido no meio de
lógica de interface pode ter escapado.
