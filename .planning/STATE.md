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
