# Auditoria de segurança — autorização, posse e escalada (20/09/2026)

Pedido: procurar vulnerabilidades, provar com teste automatizado, corrigir em
profundidade e **nunca confiar no front-end** — identidade sempre a partir do
token validado contra o banco.

O que saiu: **1 correção**, **1 esclarecimento de arquitetura** (RLS), **um
arquivo novo de teste** (`server/verificar-autorizacao.js`, 54 verificações em 6
blocos, registrado no `verificar-tudo`) e **11 frentes investigadas e
consideradas corretas** — que ficam listadas aqui para a próxima auditoria não
refazer o mesmo caminho.

---

## 0. RLS: o que existe aqui no lugar dele

Foi pedido "configurar o RLS e deixar sempre ativo". **RLS é um recurso do
PostgreSQL**, e o banco deste sistema é SQLite em desenvolvimento *e* em
produção (`prisma/schema.prisma:6`, `DATABASE_URL=file:/data/arka.db`). SQLite
não tem roles, `GRANT`, `CREATE POLICY` nem `current_user` — isso já havia sido
verificado contra o banco real, e não suposto (ver o cabeçalho de
`verificar-escopo-dados.js`, onde as seis primitivas foram tentadas e todas
deram erro de sintaxe).

Chamar de RLS o que existe seria mentir sobre a garantia. O equivalente nesta
pilha é **o recorte por dono dentro do service**, aplicado em toda leitura e
toda escrita, e é isso que passou a ser testado de fora, com um atacante
autenticado de verdade.

Se um dia a migração para PostgreSQL entrar na mesa, RLS deixa de ser
inaplicável e vira uma camada a mais (o banco recusaria até a consulta que
esqueceu o `WHERE`). Hoje, não.

---

## 1. Corrigido: `optionalAuth` montava a identidade a partir do token

**Arquivo:** `server/src/shared/middlewares/auth.middleware.js`
**Gravidade:** média (armadilha; nenhuma rota a usava)

O `authMiddleware` faz a coisa certa e faz bem: o token só prova *quem* é a
pessoa (`sub`); cargo, `ativo`, setores extras, equipe e a validade da sessão
saem do **banco a cada requisição**. Rebaixar alguém, desativar a conta ou
encerrar as sessões vale na requisição seguinte, e não quando o JWT vencer.

Ao lado dele, exportado no mesmo módulo, `optionalAuth` fazia o oposto:

```js
req.user = jwt.verify(token, env.jwt.secret);   // o payload VIRAVA a identidade
```

O que isso valeria na prática, para quem tivesse um token válido qualquer: o
`cargo` da requisição passaria a ser o que está escrito no token. Conta
desativada continuaria entrando; rebaixamento não valeria; `sair de todos` não
derrubaria nada. Nenhuma rota usava a função — então **não havia buraco aberto,
havia uma armadilha montada**: a primeira rota "pública com extras" que a
colocasse na cadeia, com um `exigirModulo` logo abaixo, herdaria uma permissão
escolhida por quem segura o token.

**Correção:** a função agora delega ao caminho autoritativo e só troca o
desfecho do erro — falhou (sem token, token velho, sessão revogada, conta
inativa), segue como visitante, sem `req.user`. A regra passa a morar num lugar
só.

**Preso por:** `verificar-autorizacao.js`, bloco 1f — chamada direta à função
com um token *legítimo* que mente o cargo. Com o código antigo: `FALHA ...
(Administrador)`. Com o novo: lê `Técnico`, do banco.

---

## 2. O teste novo: `server/verificar-autorizacao.js`

Roda dentro do `verificar-tudo`. Sobe o app de verdade, cria as contas, ataca
por HTTP como um invasor com sessão válida faria com `curl`, e confere o
**banco** no fim — não só o código HTTP.

| Bloco | Pergunta | Verificações |
|---|---|---|
| 1 | A identidade vem do banco? | token assinado mentindo `cargo=Administrador`; token de outro segredo; rebaixamento ao vivo; conta desativada; `sair de todos` matando o token já emitido; `optionalAuth` |
| 2 | IDOR nos relatórios | técnico B tentando **ler, baixar o PDF, ver a evidência, editar, devolver e apagar** o relatório do técnico A — e a lista dele não traz o do outro |
| 3 | O corpo promove alguém? | criar/editar mandando `tecnicoId`, `status: "aprovado"`, `validadoPorId`, `pontos`; `PATCH /perfil` mandando `cargo`, `ativo`, `equipeRanking`; bug em nome de terceiro |
| 3e | A segunda camada, sozinha | o service chamado **na mão**, sem a borda do Zod, com o mesmo corpo sujo |
| 4 / 4b | Varredura das barreiras | 17 rotas de administrador + 44 rotas de módulo negadas ao Técnico, todas exigidas em 403 |
| 5 | Vazamento | nenhuma leitura devolve hash de senha |

Duas decisões de desenho que valem para quem for mexer nele:

**As rotas são lidas do código, não de uma lista.** O mapa de montagem do
`app.js` é cruzado com os roteadores de cada módulo, respeitando a **ordem** do
arquivo (um `router.use(gate)` só vale para o que vem depois dele — a rota de
anexo das mensagens rápidas é declarada *antes* do `authMiddleware` de
propósito). Rota de admin criada amanhã entra na varredura sozinha. Escrever a
lista à mão teria deixado de fora o módulo WhatsApp inteiro, que usa outro nome
de roteador (`adminRouter`) e um apelido para a guarda
(`const somenteAdmin = exigirModulo("whatsapp")`).

**O bloco 4b pergunta à matriz de permissões o que esperar**, em vez de trazer
uma cópia dela. Assim o teste não quebra quando o administrador liga um módulo
novo para o Técnico — e continua exigindo 403 em tudo que a matriz nega hoje.
Só as rotas negadas são chamadas: uma permitida executaria o controlador de
verdade (conectar instância, apagar registro), e teste de autorização não
precisa mexer no mundo para saber disso.

### Os testes foram provados falhando

Teste que nasce verde não prova nada — pode estar medindo o próprio otimismo.
Cada bloco foi verificado contra uma versão **quebrada de propósito** do
servidor, e restaurado em seguida:

| Mutação aplicada | O que o teste disse |
|---|---|
| `cargo: payload.cargo \|\| usuario.cargo` no `authMiddleware` | FALHA 1a (403 virou 200) e FALHA 1c (rebaixado continuou admin) |
| recorte por dono de `mapeamento.obter` desligado | FALHA 2 (o técnico B leu o relatório do A) |
| `tecnicoId: dados.tecnicoId \|\| usuario.sub` no `criar` | **Passou** pela borda (o Zod descarta a chave) e **FALHOU** no bloco 3e, a chamada direta ao service |
| `optionalAuth` anterior | FALHA 1f, nas duas verificações |

A terceira linha é a mais instrutiva, e foi ela que fez o bloco 3e existir: o
Zod na borda escondia o defeito do service. As duas camadas são seguras — mas
só uma delas estava sendo *provada*, e é assim que a de dentro apodrece sem
ninguém ver.

---

## 3. Investigado e correto (não mexer sem motivo)

Fica registrado para não se refazer o caminho:

1. **Identidade e sessão** — cargo/`ativo`/setores/equipe relidos do banco a
   cada requisição; `sid` confere a família de refresh, então logout e reuso de
   token queimam a sessão na hora.
2. **Matriz de permissões** — nega por padrão (`moduloPermitido` só devolve
   `true` com o módulo conhecido e marcado); Administrador passa sempre.
3. **Recorte por dono nos relatórios** — `obter`, `atualizar`, `remover`,
   `arquivoDe`, `evidenciaDe` e `devolver` conferem `tecnicoId` ou supervisão.
   `atualizar` é mais estrito ainda: nem o supervisor edita o relatório alheio.
4. **Preferências** — chaveadas por `req.user.sub`; o corpo não escolhe usuário.
5. **Arquivo em disco** — o nome é sempre um UUID gerado no servidor, a
   extensão sai de uma lista fechada de mimetypes e a leitura confere que o
   caminho resolvido continua dentro da pasta base. Path traversal não tem por
   onde entrar, nem vindo do banco adulterado.
6. **Mídia por URL** — HMAC-SHA256 de `<mensagemId>.<expiração>` com o segredo
   do servidor, comparado em tempo constante: o token libera **uma** mensagem e
   expira. Trocar o id invalida.
7. **Injeção de SQL** — nada de concatenação; coberto por `verificar-injecao`.
8. **Escopo por setor** — coberto, e com profundidade, por
   `verificar-escopo-dados` (60 verificações).
9. **Mass assignment** — o `validate` grava `req.body = result.data`, e o Zod
   descarta chave desconhecida; os services montam o `data:` do Prisma campo a
   campo, sem espalhar o corpo.
10. **Campanhas, contatos, fluxos, n8n, configurações, parceiros** — todos com
    `router.use(authMiddleware, exigirModulo(...))` no arquivo inteiro.
11. **Hash de senha** — não aparece em nenhuma das leituras varridas.

---

## 4. O que NÃO foi coberto

Dito na frente, porque cobertura declarada sem prova é pior que buraco
conhecido:

- **Rotas que exigem o WhatsApp conectado** (conectar, QR code, envio em massa)
  foram exercitadas só pelo lado da recusa — a barreira. O caminho feliz depende
  da Evolution de pé e ficou de fora.
- **XSS e CSP** têm dono próprio (`verificar-cabecalhos`); não foram reavaliados
  aqui.
- **Força bruta e bloqueio progressivo** idem (`verificar-bloqueio`,
  `verificar-cadastro-turnstile`).
- **Teto de upload** é conferido por leitura de código (25 MB no storage), não
  por um envio real de arquivo grande.
- **A tela** não entra nesta auditoria: ela esconde botão, e esconder botão não
  é autorização. Tudo aqui foi medido no servidor.
