# Roadmap: Correcoes -- Fluxos, Transferencia, Midia e Cadastro

## Overview

Cinco defeitos independentes, cada um com causa-raiz confirmada na Fase 1. As
fases 2-6 corrigem uma area por vez, cada uma com sua propria prova executavel;
a Fase 7 roda tudo junto e procura regressao.

## Phases

- [x] **Phase 1: Investigacao** - Mapear as areas e confirmar as causas-raiz
- [x] **Phase 2: CRUD de fluxos** - Contrato do PUT, identidade dos passos, CRUD de bloco
- [x] **Phase 3: Salvar bloco** - Rascunho local + botao Salvar + erro visivel
- [x] **Phase 4: Transferencia** - Autorizacao por dono, atomicidade, sem duplicata
- [x] **Phase 5: Midia WhatsApp** - CSRF no XHR e confiabilidade de envio
- [x] **Phase 6: CAPTCHA no cadastro** - Turnstile na tela de criar conta
- [x] **Phase 7: Validacao** - Suite completa, build, e caca a regressao

## Phase Details

### Phase 1: Investigacao
**Goal**: Saber onde cada dado se perde, com prova.
**Success Criteria**:
  1. As cinco causas-raiz estao escritas com arquivo e linha.
  2. A falha de persistencia de fluxo foi REPRODUZIDA executando codigo.
  3. Esta claro o que NAO esta quebrado, para nao reescrever o que funciona.
**Artefato**: `.planning/phases/01-investigacao/FINDINGS.md`

### Phase 2: CRUD de fluxos
**Goal**: O que o servidor emite, o servidor aceita de volta -- e o id de um bloco
sobrevive ao save.
**Depends on**: Phase 1
**Success Criteria**:
  1. `PUT /fluxos/:id` aceita o retrato devolvido pelo `GET` sem alterar nada.
  2. O id de um passo continua o mesmo depois de salvar o fluxo.
  3. Criar / ler / atualizar / apagar bloco e reordenar funcionam e persistem.
  4. Erro de validacao chega ao cliente com o campo culpado.

Plans:
- [x] 02-01: DTO tolerante a `null` + normalizacao na borda
- [x] 02-02: `update` preserva ids (diff em vez de delete+recreate)
- [x] 02-03: CRUD de passo individual (`/fluxos/:id/passos[/:passoId]`)

### Phase 3: Salvar bloco
**Goal**: Editar bloco vira rascunho local; salvar e um ato explicito que ou
persiste, ou diz que falhou.
**Depends on**: Phase 2
**Success Criteria**:
  1. Digitar no painel NAO dispara requisicao.
  2. O botao Salvar mostra pendente -> salvo, e nao aceita clique duplo.
  3. Falha aparece na tela; o rascunho permanece para nao perder o texto.
  4. Apos salvar, o F5 mostra exatamente o que foi salvo.
  5. Fechar o painel com rascunho pendente avisa antes de descartar.

Plans:
- [x] 03-01: Rascunho + Salvar no `FlowPropertyPanel`
- [x] 03-02: Fim do `catch {}` no editor; salvamento serializado

### Phase 4: Transferencia
**Goal**: So quem responde pela conversa a transfere, uma vez so.
**Depends on**: Phase 1
**Success Criteria**:
  1. O atendente responsavel transfere.
  2. Outro atendente do mesmo setor recebe 403 -- inclusive por curl.
  3. Administrador transfere (escalonamento continua possivel).
  4. Conversa sem dono pode ser atribuida por quem tem acesso ao setor.
  5. Dois cliques produzem UMA transferencia e UM aviso no historico.
  6. Duas transferencias simultaneas: uma vence, a outra recebe conflito.

Plans:
- [x] 04-01: Autorizacao de dono no service + `req.user` no controller
- [x] 04-02: Troca atomica no repositorio (UPDATE condicional + versao)
- [x] 04-03: Estado de pendencia e trava de clique no front

### Phase 5: Midia WhatsApp
**Goal**: Imagem, video, audio, documento e localizacao voltam a sair.
**Depends on**: Phase 1
**Success Criteria**:
  1. O XHR de midia manda `X-CSRF-Token`; o 403 some.
  2. Os cinco tipos passam pelo guard e chegam ao service.
  3. Reenvio apos falha nao cria bolha duplicada.
  4. Falha mostra erro util, e a tela nunca fica travada em "enviando".

Plans:
- [x] 05-01: Cabecalhos de sessao no XHR de midia
- [x] 05-02: Confiabilidade de envio (sem duplicata, sem travar)

### Phase 6: CAPTCHA no cadastro
**Goal**: Criar conta com o Turnstile ligado.
**Depends on**: Phase 1
**Success Criteria**:
  1. O widget aparece no cadastro quando ha chaves configuradas.
  2. O token chega ao servidor e o cadastro conclui.
  3. Token ausente/invalido continua sendo recusado com 403.
  4. Uma tentativa falha reseta o widget (o token vale uma vez).
  5. Sem chaves configuradas, a tela funciona como hoje.

Plans:
- [x] 06-01: Turnstile na `CadastroPage` + repasse do token

### Phase 7: Validacao
**Goal**: Provar que funciona e que nada mais quebrou.
**Depends on**: Phases 2-6
**Success Criteria**:
  1. `npm test` e os `verificar-*.js` existentes passam.
  2. As novas provas passam.
  3. `npm run build` do front conclui.

Plans:
- [x] 07-01: Suite completa + build + revisao final

## Progress

| Phase | Plans | Status | Completed |
|-------|-------|--------|-----------|
| 1. Investigacao | 1/1 | Complete | 2026-08-28 |
| 2. CRUD de fluxos | 3/3 | Complete | 2026-08-28 |
| 3. Salvar bloco | 2/2 | Complete | 2026-08-28 |
| 4. Transferencia | 3/3 | Complete | 2026-08-28 |
| 5. Midia WhatsApp | 2/2 | Complete | 2026-08-28 |
| 6. CAPTCHA | 1/1 | Complete | 2026-08-28 |
| 7. Validacao | 1/1 | Complete | 2026-08-28 |

---

## Marco adicional -- Fase 8

- [x] **Phase 8: Inatividade** - "Atendimento encerrado por inatividade" so com
      pergunta em aberto

### Phase 8: Inatividade
**Goal**: O encerramento por inatividade passa a exigir prova de que o bot
perguntou e o cliente nao respondeu -- em vez de decidir por exclusao (status
Pendente + tempo).
**Success Criteria**:
  1. Automacao concluida ("Chamado aberto com sucesso") nunca recebe o
     encerramento por inatividade, por mais que a conversa siga Pendente.
  2. Pergunta em aberto sem resposta continua sendo encerrada no prazo do fluxo.
  3. Resposta do cliente proxima do timeout impede o encerramento.
  4. Duas varreduras sobrepostas nao geram duas mensagens.
**Artefatos**: `.planning/phases/08-inatividade/{FINDINGS,PLAN,VERIFICATION}.md`
**Prova**: `server/verificar-inatividade.js`
