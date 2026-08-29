---
gsd_state_version: '1.0'
status: complete
progress:
  total_phases: 8
  completed_phases: 8
  total_plans: 14
  completed_plans: 14
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-28)

**Core value:** Central de atendimento WhatsApp multi-operador com triagem por bot.
**Current focus:** Concluido -- as cinco correcoes estao no branch main.

## Current Position

Phase: 8 of 8 (Inatividade)
Status: Complete
Last activity: 2026-08-28 -- inatividade so com pergunta em aberto;
`verificar-inatividade.js` 24/24 e `verificar-tudo.js` sem regressao.

Progress: [██████████] 100%

## Accumulated Context

### Decisions
- D1: corrigir o contrato do servidor (DTO aceita `null`), nao mascarar no front.
- D2: preservar id de passo no update; a gravacao virou diferenca, nao delete+recreate.
- D3: transferencia com UPDATE condicional; duplo-clique e idempotente, corrida real da 409.
- D9 (28/08, REVERTE parte de D3): qualquer pessoa com acesso ao setor transfere,
  inclusive puxando para si. A trava de "so o dono transfere" travava assumir a
  conversa de um colega ausente. Setor, atomicidade e 409 seguem; entra registro
  de autoria no historico.
- D4: CSRF no XHR de midia via `cabecalhosDeSessao()` -- conserta e previne a proxima deriva.
- D5: Turnstile desenhado no cadastro; o guard da rota nao foi tocado.
- D6: inatividade decidida por EVIDENCIA (allowlist de estados + `aguardandoDesde`
  + `concluidoEm` + resposta do cliente posterior a pergunta), nao por exclusao.
  Status da conversa e estado da automacao passam a ser coisas separadas.
- D7: conversa na FILA do atendente nao expira com o TTL da sessao -- o bot nao
  reinicia o fluxo de quem esta esperando um tecnico.
- D8: a varredura entra na mesma fila `comLock(instancia:telefone)` do webhook, e
  a mensagem unica e garantida por UPDATE condicional no banco (`inatividadeEm`),
  nao por flag em memoria.
- D10 (29/08): botao nativo do WhatsApp exige Evolution >= 2.4.0. Medido na
  2.3.7: `sendButtons` e `sendList` respondem 400 com
  `TypeError: this.isZero is not a function`. Nao existe 2.4.0 estavel -- so
  `2.4.0-rc2` (pre-release, maio/2026) -- entao subir e colocar um release
  candidate em producao, com o consentimento do dono.
- D11 (29/08): a 2.4.0 recusa TODA requisicao com 503 `LICENSE_REQUIRED` ate
  ser ativada, e o proprio /manager depende dessas requisicoes -- por isso ele
  so mostra "No instances found" e nunca oferece a tela de ativacao. O fluxo
  pelo navegador tambem nao fecha nesta topologia (porta so em 127.0.0.1,
  `SERVER_URL` inalcancavel de fora). Decisao: ativar HEADLESS -- registrar o
  e-mail uma vez chamando `/v1/register/init` por curl (com o WhatsApp no ar,
  zero indisponibilidade) e depois `EVOLUTION_OPERATOR_EMAIL` no `.env`, que
  faz o container chamar `/v1/register/auto` e nascer ativado.
  O `instance_id` fica em `~/.evolution-license-id` na VM, fixo, porque a
  idempotencia da ativacao e por `(email, instance_id)`.
- D12 (29/08, medido 4x nos dois sentidos): trocar a TAG da imagem da Evolution
  e reversivel -- banco, contatos, 13.515 mensagens e o pareamento do WhatsApp
  sobrevivem. Restaurar o dump por cima do banco povoado e INOCUO (so imprime
  `already exists` e `COPY 0`): o rollback e a troca de tag, nada mais.

### Provas criadas
| Script | Cobre |
|---|---|
| `verificar-fluxos-crud.js` | round-trip GET->PUT, id estavel, CRUD de bloco, reordenar, import |
| `verificar-transferencia.js` | dono x nao-dono x admin, duplo-clique, corrida, setor |
| `verificar-midia.js` | CSRF fechado/aberto, os 5 tipos, gravacao em disco, validacao |
| `verificar-cadastro-turnstile.js` | sem/ com/ forjado/ repetido, e a tela produzindo o token |
| `verificar-inatividade.js` | os 7 cenarios do relato + a varredura real contra o banco |

### Blockers/Concerns
- A entrega no WhatsApp em si (Evolution API) nao roda no ambiente de teste: a
  cobertura de midia vai ate a criacao da mensagem.
- `AtendimentoView` ainda tem `catch {}` nos botoes de status da conversa
  (fechar/pendente/reabrir/marcarLido) -- mesma classe de defeito do editor de
  fluxos, mas fora do escopo relatado. Nao tocado de proposito.

## Session Continuity

Last session: 2026-08-28
Stopped at: Fase 7 concluida; working tree limpo.
