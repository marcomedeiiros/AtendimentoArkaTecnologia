# Auditoria da automação dos fluxos do chatbot

**Data:** 2026-09-08 · **Escopo:** todo o caminho que decide o que o bot faz sozinho
· **Baseline da suíte antes e depois:** as mesmas 4 falhas pré-existentes, todas fora
da automação de fluxos (ver §5).

Este documento existe porque a pergunta "o bot está quebrado?" não tinha onde ser
respondida: o comportamento automático nasce em seis arquivos, e o sintoma que
chega — *"o bot não responde"* — é o mesmo para causas muito diferentes. Aqui está
o mapa do que roda sozinho, o que foi encontrado quebrado, o que foi corrigido e o
que ficou registrado como fragilidade sem alteração.

Tudo o que está marcado como **medido** foi reproduzido contra o motor real
(`ChatbotEngine`, via `chatbot.simulador`), não deduzido da leitura.

---

## 1. O mapa: o que roda sem ninguém pedir

| Arquivo | O que ele decide |
| --- | --- |
| `server/src/modules/fluxos/fluxo.automacao.js` | **Os parâmetros.** Todo texto, prazo e tentativa do bot sai do `config` de um passo, com padrão declarado. É a fonte única de "o que o bot faz". |
| `server/src/modules/chatbot/chatbot.engine.js` | **A execução.** Percorre os passos, casa a resposta do cliente, pede CNPJ, transfere, encerra, pesquisa satisfação. |
| `server/src/modules/chatbot/chatbot.inatividade.js` | **Os relógios.** Varredura de 60 s: cliente calado, prazo da avaliação, espera na fila, encerramento de quem chegou fora do horário. |
| `server/src/modules/chatbot/chatbot.horario.js` | **O expediente.** Módulo puro; ninguém mais decide se estamos fora do horário. |
| `server/src/infrastructure/repositories/fluxo.repository.js` | **As ligações entre blocos.** Quem salva, importa e apaga passo remapeia os destinos. |
| `server/src/modules/chatbot/chatbot.simulador.js` | **A tela "Testar".** Roda o motor real com repositórios falsos. |

As **quatro automações de relógio** — e elas são independentes, com prazos e textos
próprios:

1. **cliente não responde ao bot** (`semResposta`, 5 min): há pergunta em aberto;
2. **prazo da avaliação** (`timeoutAvaliacaoMin`, 5 min): a nota não veio;
3. **espera na fila de Pendentes** (`filaPendentes`, 10 min): ninguém assumiu;
4. **encerrar quem chegou fora do expediente** (`encerrarAposMin`).

Confundir 1 com 3 dá o comportamento errado nos dois casos, e é por isso que elas
vivem em blocos separados do fluxo.

---

## 2. O que estava quebrado

Dez defeitos. Os cinco primeiros (A1–A4 e A10) produzem o mesmo sintoma na ponta
— **um bot mudo, com tudo verde na tela** — e é por isso que pareciam "tudo
quebrando ao mesmo tempo".

### A1 · CRÍTICO — a palavra do cliente virava comando, e a primeira mensagem era a mais exposta

`detectarComando` casa a palavra-chave em **qualquer posição da frase**. Isso é
adequado para `atendente` ("quero falar com um atendente"), e é errado para `sair`
e `menu`, cujas palavras são o vocabulário normal do problema que o cliente está
contando: *cancelar, encerrar, parar, tchau, voltar, início*.

O motor já protegia os estados `opcao` e `texto` (`respostaEhDoFluxo`). O que não
estava protegido — e não podia estar, do jeito que a condição era escrita — é o caso
em que **não há sessão nenhuma: a primeira mensagem de toda conversa.**

**Medido** contra o motor, com um fluxo de menu comum:

| Primeira mensagem do cliente | O que acontecia |
| --- | --- |
| "Bom dia, preciso **cancelar** meu boleto" | `sair` → silêncio absoluto |
| "Preciso **encerrar** meu contrato de internet" | `sair` → silêncio absoluto |
| "quero **voltar** a usar o sistema antigo" | `menu` → fila, sem uma palavra |
| "**Tchau**, era só isso" | `sair` → silêncio absoluto |
| "**menu**" | `menu` → fila, sem uma palavra |

As três primeiras pessoas estavam **abrindo um chamado**. Receberam um bot que
nunca respondeu, e a equipe recebeu a OS na fila sem setor, sem CNPJ e sem
descrição — porque a triagem que preenche isso não rodou.

**Correção:** `sair` e `menu` passam a exigir que a mensagem **seja** o comando
(`detectarComandoExato`: igualdade com o termo, tolerando pontuação final e um "por
favor" colado). `atendente` continua casando dentro da frase — ali o falso positivo
não existe. E, dentro de um menu, a **opção do fluxo vence o atalho do motor**
("voltar" como rótulo de menu continua voltando ao menu); só quando a mensagem não
casa com opção nenhuma o comando volta a valer.

### A2 · CRÍTICO — "sair" não encerrava nada

`encerrarSessao` desligava a sessão e devolvia `encerrado: true`. Nada mais:
nenhuma mensagem para o cliente, e a **conversa continuava `pendente`, com a OS
aberta na fila**, como se ela esperasse atendimento. A mensagem seguinte, com a
sessão morta, reexecutava o fluxo do zero.

Agrava: `verificar-fluxo-arka.js` afirma, com todas as letras, que o menu principal
não precisa de uma opção "encerrar" porque *"o mecanismo global cobre isso"* — e o
mecanismo global não cobria.

**Correção:** "sair" manda a despedida que o **fluxo** declarou
(`farewellMessage`, o mesmo texto da opção `acao: "encerrar"`) e fecha conversa e OS
pelo caminho normal. **Sem pesquisa de satisfação**, de propósito: quem pede para
sair está interrompendo, não concluindo — perguntar a nota ali é insistir com quem
pediu para parar, e contamina o CSAT. Mesmo critério do fechamento por abandono.

### A3 · CRÍTICO — o comando "menu" jogava o cliente na fila, calado

O ramo lia `fluxoRepository.findAtivos()`, **descartava o resultado** e chamava
`enviarMenu`, que é `transferirParaHumano` com `avisar: false`. O cliente pedia o
menu e recebia silêncio, com a conversa empurrada para Pendentes sem triagem.

**Correção:** "menu" desliga a sessão em curso e roda o fluxo de boas-vindas
(gatilho `*`) desde o primeiro passo. Sem fluxo padrão cadastrado não há menu a
mostrar, e só nesse caso a conversa vai para um atendente.

### A4 · CRÍTICO — o fim do fluxo num bloco sem opções não entregava a conversa

`_entregarNoFimDoFluxo` existe exatamente para isto, mas o sinal que o aciona
(`fimDoFluxo`) só era levantado no ramo que tem `config.opcoes`. E o bloco de
confirmação mais comum **não tem opção nenhuma**: é um bloco de mensagem
("Chamado aberto com sucesso"), ligado a nada.

**Medido:**

```
turno 1  "oi"               ->  "Descreva sua solicitacao"
turno 2  "meu pc nao liga"  ->  "Chamado aberto com sucesso!"
turno 3  "alguma novidade?" ->  "Descreva sua solicitacao"      <-- a triagem inteira, de novo
```

Sem `garantirAtendimentoAberto`, sem setor gravado na OS, sem `aguardando:
"humano"` — e por isso o guard que impede o bot de reiniciar quem está na fila
(`naFilaDoAtendente`) não tinha o que reconhecer. O cliente pedia notícia do
chamado e recebia a triagem desde o início.

**Correção:** um bloco que **falou**, não espera nada e não tem para onde ir é fim
de fluxo — mesmo critério do outro ramo, com a exigência extra de ter falado (um
bloco mudo e sem saída não é o fim do roteiro, e um handoff ali seria invenção do
motor).

### A10 · CRÍTICO — a legenda da mídia era jogada no lixo

*Relatado depois da primeira rodada da auditoria, e reproduzido.*

O portão da mídia olhava só o **tipo** da mensagem. Com a automação em curso e
fora da resposta livre, ele devolvia `midia_recebida` e voltava — e a **legenda**,
que é texto que o cliente escreveu, nunca era lida.

**Medido** contra o fluxo da ARKA:

| O que o cliente manda | O que acontecia |
| --- | --- |
| "oi" → menu; **foto com a legenda "1"** | silêncio; sessão parada em `opcao` |
| "oi" → menu; **vídeo com a legenda "2"** | silêncio; sessão parada em `opcao` |
| pede o CNPJ; **PDF com o CNPJ na legenda** | silêncio; sessão parada em `cnpj` |
| o mesmo "1" **em texto puro** | segue para o Técnico, normalmente |

E cinco minutos depois a varredura encerrava com *"Não entendemos a sua demanda"*
— em cima de uma pessoa que **respondeu certo**. Mandar o print do erro junto com
a resposta é o jeito natural de usar o WhatsApp, e é assim que boa parte dos
chamados de suporte começa.

O raciocínio original do portão continua valendo, e vale **só para mídia muda**:
uma foto sem legenda no meio de um menu não é "resposta errada" — tratar como
erro gastaria as tentativas do cliente e poderia encerrar o atendimento dele.
Uma foto **com** legenda não é "outra coisa": é uma mensagem de texto que veio
acompanhada de um anexo.

**Correção:** a legenda destrava todos os estados (menu, CNPJ, confirmação,
pesquisa); mídia sem legenda mantém o comportamento de antes. Nada mais mudou —
o que o fluxo enxerga (`textoParaFluxo`), o comando global, o gatilho e a
validação de CNPJ **já** liam a legenda; eles simplesmente nunca eram
alcançados. O rótulo inventado pelo motor ("[Imagem]") continua fora dessas
decisões, e é por isso que a condição é `textoLimpo` e não `textoParaFluxo`.

### A5 · ALTO — a tela "Testar" reportava `erro_interno` em todo fluxo que encerra

O simulador roda o motor real com repositórios falsos escritos à mão. Quando
`fecharConversa` passou a gravar o motivo do ciclo (`definirMotivoAtualSeVazio`) e a
pesquisa passou a fazer o mesmo (`definirMotivoSeVazio`), nenhum dos dois foi
acrescentado ao ambiente falso. O motor os chama **sem guarda**, porque são o
contrato do repositório e não um recurso opcional.

Resultado: `TypeError`, engolido pelo `catch` geral de `_processarMensagemEntrada`,
que transfere para humano. **Medido** no fluxo mínimo "menu → 1 → Tchau!": a
simulação terminava `transferido / erro_interno` em vez de encerrada — e não havia
como distinguir um fluxo com defeito de um fluxo correto rodando num simulador com
defeito.

**Correção:** os stubs faltantes (`definirMotivoAtualSeVazio`,
`definirMotivoSeVazio`, `ultimaMensagemBotComErro`, `findMensagemPorWaId`,
`sendPoll`) e — mais importante — **`verificar-simulador-contrato.js`**, que lê o
motor, extrai toda chamada `this.deps.<dep>.<metodo>()` não guardada e exige que o
ambiente ofereça cada uma. A classe de falha deixa de depender de alguém lembrar.

### A6 · ALTO — apagar um bloco deixava as ramificações apontando para o vazio

O cabeçalho de `fluxo.repository.js` diz *"TODA LIGAÇÃO ENTRE BLOCOS PRECISA SER
REMAPEADA. TODA."* — e `removerPasso` limpava só a coluna `targetId`. As
ramificações moram em `config.opcoes[].targetId`, e a saída alternativa do CNPJ em
`config.targetIdNaoCadastrado`: apagar um bloco pelo painel de propriedades deixava
cada uma delas apontando para um id que não existe mais.

O defeito não aparece no editor — o fio desaparece da tela porque o bloco
desapareceu — e sim na conversa do cliente: `aplicarOpcao` não acha o destino e cai
em `ramificacao_sem_destino`, ou seja, **a opção do menu passa a jogar o cliente na
fila**. Pior: `decidirEsperaDoPasso` conta a ramificação morta como saída válida,
então o bloco continua estacionando a conversa como se houvesse para onde ir.

**Correção:** a limpeza das ligações do `config` acontece na mesma transação da
remoção, e só nos blocos que realmente citam o id removido.

### A7 · MÉDIO — enquete: bolha duplicada, e invisível para a equipe

No fallback, `_enviarMenuEnquete` chamava `enviarBot`, que **cria outra mensagem**.
A bolha da enquete ficava para sempre em `status: "enviando"` e o mesmo texto
aparecia duas vezes no histórico. E este era o único caminho de envio do bot **sem
`_emitirConversa`**: o menu que o cliente estava vendo só aparecia na Central no F5
seguinte.

**Correção:** o fallback carimba a bolha existente com o desfecho (mesmo tratamento
do menu interativo) e o método emite a conversa no fim.

### A8 · MÉDIO — a flag global atropelava a exibição declarada no bloco

`WHATSAPP_MENU_ENQUETE=true` transformava em enquete **qualquer** menu, inclusive um
bloco que declara `exibicao: "buttons"` ou `"list"`. Quem monta o fluxo escolhia
botões na tela e o cliente recebia uma votação, sem nada no log dizendo que a
escolha do desenho havia sido descartada. Contradiz a regra do resto do sistema
("o bloco vence").

**Correção:** a flag decide apenas em `exibicao: "auto"` — que é justamente o valor
que diz "não declarei nada".

### A9 · MÉDIO — o painel "Automações do BOT" mostrava meia verdade

O painel é a superfície de auditoria: é onde alguém responde "o que o bot faz" sem
ler código. Dois furos:

- só o **primeiro** bloco de CNPJ e o **primeiro** de avaliação eram listados
  (`passos.find`), então um fluxo com dois caminhos de identificação escondia as
  regras de um deles;
- `memoriaCnpj: "fluxo"` aparecia como **"Ligado"**, igual a `true` — mas são
  comportamentos diferentes (com `"fluxo"` o motor adota o documento e quem
  confirma é um bloco do desenho). Quem investigasse "por que o bot não pediu
  confirmação?" leria no painel que a confirmação estava ligada.

**Correção:** todos os blocos são listados, e a memória é reportada com os três
valores ("Ligado, confirmado pelo bot" / "Ligado, confirmado por um bloco do fluxo"
/ "Desligado").

---

## 3. Registrado, sem alteração

Não são defeitos observados. São fragilidades que a auditoria encontrou e que ficam
escritas para não serem redescobertas do zero.

- **O1 · `AGUARDANDO.MENU` é estado morto.** Nada grava `aguardando: "menu"` nem
  `contexto.menuOpcoes` — `enviarMenu` virou handoff. O ramo que o trata continua
  no motor e está na allowlist de inatividade sem efeito; e, se algum dia fosse
  alcançado, `interpretarEscolhaMenu` devolve o **objeto** da opção onde o ramo
  espera um `fluxoId`. Remover pede uma passada própria.
- **O2 · O prazo da avaliação corre sobre `sessao.atualizadoEm`.** É um
  `@updatedAt` da linha — o padrão que o resto do motor abandonou em favor de
  `aguardandoDesde` justamente porque qualquer escrita o reinicia. Hoje não há
  escrita alheia à sessão durante a pesquisa, e nenhum defeito foi observado; a
  fragilidade é a de sempre: uma escrita nova em outro caminho estica o prazo em
  silêncio.
- **O3 · `varrerEsperaNaFila` age fora da fila do cliente.** As outras três
  automações tomam `comLock(instancia:telefone)`; essa não. O aviso de espera pode
  correr em paralelo com a mensagem que está chegando.
- **O4 · Nenhuma allowlist de chaves no `config` do passo.** O DTO aceita
  `z.record(z.any())`; a defesa é na leitura (`fluxo.automacao` valida tipo e faixa
  de cada parâmetro). A defesa em profundidade está do lado certo, mas a borda não
  recusa chave desconhecida.

---

## 4. O que passou a ser verificado

`verificar-simulador-contrato.js`, registrado em `verificar-tudo.js` **antes** da
matriz do fluxo (ele prova que a ferramenta de teste está de pé; sem isso a matriz
falharia sem nada estar errado com o fluxo). Ele confere:

1. toda chamada `this.deps.<dep>.<metodo>()` não guardada do motor existe no
   ambiente do simulador — 33 chamadas hoje;
2. um fluxo com opção `encerrar` termina **encerrado**, com a despedida do fluxo;
3. o fim de fluxo num bloco sem saída **entrega** a conversa, e o bot não reabre a
   triagem no turno seguinte;
4. frase com "cancelar" / "encerrar" / "voltar" / "tchau" **abre o fluxo**;
5. o comando deliberado ("menu" sozinho) reabre o fluxo.

Provado que pega a regressão: removendo o stub de `definirMotivoAtualSeVazio`, o
script falha em 3 pontos e aponta o método.

`verificar-midia-e-pontuacao.js` ganhou os cenários do §A10: legenda `"1"` / `"2"`
/ `"tecnico"` em imagem, vídeo e PDF escolhendo no menu; o CNPJ na legenda de um
PDF respondendo a etapa de identificação; o pedido de atendente na legenda; e a
contraprova — mídia **sem** legenda continua sem atropelar menu e CNPJ. Provado
que pega a regressão: sem a correção no motor, falha nos 5 cenários novos.

E `verificar-fluxos-crud.js` ganhou o cenário do §A6: um bloco que aponta para
outro pelos **dois** caminhos do `config` (`opcoes[].targetId` e
`targetIdNaoCadastrado`), apagado em seguida. Confere que as duas ligações ficam
nulas e que as **outras** ramificações do mesmo bloco não são tocadas. Provado que
pega a regressão: sem a correção no repositório, falha em 3 pontos.

---

## 5. Baseline da suíte

`npm test` **não passa 100%**, e não passava antes desta auditoria. As quatro falhas
são as mesmas antes e depois, e nenhuma delas é da automação de fluxos:

- `verificar-ranking-equipe.js`
- `verificar-rankings.js`
- `verificar-fotos-contatos.js`
- `verificar-responsivo.js`

Todos os scripts de chatbot/fluxo passam: contrato do simulador, fluxo da ARKA,
mídia e pontuação, visual do WhatsApp, inatividade, botões e listas, CRUD de fluxos
e blocos, sessão órfã, reentrada de horário.

---

## 6. Como investigar "o bot não respondeu"

A ordem importa — a primeira pergunta é a mais barata e é a que mais explica.

1. **O fluxo está ATIVO?** Fluxo pausado = nenhuma automação, em todos os caminhos.
2. **O gatilho casa?** Palavra-chave vence, e o fluxo de boas-vindas precisa do
   gatilho `*` para abrir em qualquer mensagem.
3. **O painel "Automações do BOT"** mostra o valor **efetivo** de cada parâmetro
   (§A9 corrigiu o que ele escondia).
4. **A sessão está em `humano`?** Então o bot está calado de propósito — a conversa
   espera uma pessoa.
5. **`diagnosticar-instalacao.js`** confere o motor que subiu contra o fluxo que
   está no banco daquela VM. `verificar-tudo.js` prova o código do repositório —
   são perguntas diferentes.
