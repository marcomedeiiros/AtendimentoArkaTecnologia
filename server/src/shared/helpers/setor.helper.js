/**
 * Setores de atendimento lista canonica.
 *
 * Estes nomes nao sao decorativos: `podeAcessarSetor` (conversa.service.js) usa
 * exatamente estas strings para decidir quem ve qual conversa, e elas casam com
 * os cargos aceitos em equipe.service.js. Uma conversa gravada com "tecnico"
 * minusculo ou "Suporte" simplesmente nunca casaria com o cargo de ninguem e
 * ficaria visivel so para Administrador -- por isso tudo que grava setor passa
 * por aqui.
 *
 * "Geral" e o setor de quem ainda nao foi triado, e todo mundo o ve.
 */
const SETORES = ["Geral", "Financeiro", "Técnico", "Comercial"];

const SETOR_PADRAO = "Geral";

function setorValido(valor) {
  return SETORES.includes(String(valor || "").trim());
}

// Regra unica de "quem enxerga qual setor". Fonte da verdade compartilhada
// entre a listagem/leitura (conversa.service) e o stream em tempo real
// (conversa.stream) -- os dois PRECISAM decidir igual, senao o SSE vaza ao
// vivo o que a leitura esconde. `userCargo` vem do token ja validado.
//
//   - sem cargo / Administrador: ve tudo
//   - Tecnico: o proprio setor MAIS as conversas sem setor (triagem, abaixo)
//   - Financeiro/Comercial: so o proprio setor, e mais nada
//
// ── POR QUE "GERAL" NAO E PASSE LIVRE ──────────────────────────────────────
//
// Havia aqui um `if (setorNorm === SETOR_PADRAO) return true;`. A intencao era
// boa: conversa ainda nao triada nao pertence a ninguem, entao que todos vejam.
// O efeito real era outro.
//
// `normalizarSetor` devolve "Geral" para QUALQUER coisa que nao seja um dos tres
// setores -- inclusive `null`. E conversa nova nasce SEM setor, de proposito:
// quem escolhe o setor e o cliente, no menu do bot. Somando as duas coisas, toda
// conversa nova de cliente ficava legivel por toda a equipe ate alguem escolher
// o setor -- e continuava assim depois de FECHADA, se ninguem escolheu.
//
// Nao era um caso de canto: era o caminho normal de toda conversa. O Comercial
// lia cobranca do Financeiro so por ela chegar antes da triagem. A varredura em
// verificar-escopo-dados.js acusava 15 vazamentos por tres caminhos
// independentes: a listagem, o acesso direto por ID e o histórico de chamados
// fechados.
//
// ── MAS ALGUEM PRECISA VER A TRIAGEM ───────────────────────────────────────
//
// Fechar "Geral" para todos resolvia o vazamento e criava outro problema: o bot
// entrega a conversa para atendimento humano SEM setor em caminhos que nao sao
// escolha do cliente (timeout de "cliente nao respondeu", menu sem gatilho,
// ramificacao sem destino), e o chamado NOVO de quem ja e cliente volta para
// "Geral" ate o menu ser respondido de novo. Nesses casos ficava gente
// esperando atendimento numa conversa que so o Administrador enxergava.
//
// Decisao do time: a triagem e do TECNICO, junto com o Administrador. Comercial
// e Financeiro continuam vendo so o proprio setor.
//
// O preco, para ficar dito em vez de descoberto depois: conversa sem setor pode
// ser sobre qualquer assunto, cobranca inclusive, e o Tecnico a le ate o cliente
// escolher no menu. E a troca entre esse risco e deixar cliente esperando sem
// ninguem ver.
//
// Fica num Set, e nao num `||` dentro do if, para trocar de ideia depois ser uma
// linha -- e para o teste conseguir citar a regra pelo nome em vez de repetir a
// condicao (teste que repete a implementacao concorda com ela ate quando ela
// esta errada).
//
// A linha "Tecnico nunca ve Financeiro" saiu: nao era protecao extra, era um
// caso particular do `setorNorm === userCargo` abaixo, que ja o cobre. Duas
// regras dizendo a mesma coisa so criam a duvida de qual vale.
const CUIDAM_DA_TRIAGEM = new Set(["Técnico"]);

function podeAcessarSetor(userCargo, setorConversa) {
  if (!userCargo || userCargo === "Administrador") return true;
  const setorNorm = normalizarSetor(setorConversa);
  if (["Financeiro", "Técnico", "Comercial"].includes(userCargo)) {
    if (setorNorm === SETOR_PADRAO) return CUIDAM_DA_TRIAGEM.has(userCargo);
    return setorNorm === userCargo;
  }
  return true;
}

// Aceita o que der para aproveitar (espaco sobrando, caixa diferente, sem
// acento) e cai no padrao em vez de gravar lixo no banco.
function normalizarSetor(valor) {
  const bruto = String(valor || "").trim();
  if (!bruto) return SETOR_PADRAO;

  const semAcento = (s) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const achado = SETORES.find((s) => semAcento(s) === semAcento(bruto));
  return achado || SETOR_PADRAO;
}

/**
 * SETOR SO E DEFINIDO POR ESCOLHA -- nunca deduzido do que o cliente escreveu.
 *
 * Existiu aqui um `setorDetectado.helper` que lia as mensagens e adivinhava o
 * setor por palavra-chave ("nao funciona" -> Tecnico, "boleto" -> Financeiro).
 * A intencao era boa (o mapa fila->setor costuma estar vazio, e sem ele tudo
 * caia em "Geral"), mas o efeito era pior que o problema: uma conversa NOVA,
 * cujo cliente apenas disse "meu computador travou", ja nascia gravada como
 * Tecnico -- antes de o menu ser respondido, e sem ninguem ter escolhido nada.
 *
 * A regra agora e simples: o setor vem de uma DECLARACAO -- a opcao de menu que
 * o cliente escolheu (`opcao.setor`, definido no JSON do fluxo), o mapa de filas
 * de Configuracoes, ou o setor que a conversa JA tem gravado de uma escolha
 * anterior. Sem nenhuma das tres, fica "Geral" = ainda sem triagem.
 *
 * `setorAtual` importa: um handoff no meio do caminho (timeout, "quero um
 * atendente") nao pode APAGAR o setor que o cliente ja escolheu no menu.
 */
function resolverSetorDeclarado({ setorExplicito, setorDaFila, setorAtual } = {}) {
  const declarado = setorExplicito || setorDaFila || setorAtual;
  return declarado ? normalizarSetor(declarado) : SETOR_PADRAO;
}

/**
 * O SETOR QUE A OPCAO ESCOLHIDA REPRESENTA.
 *
 * ISTO NAO E A ADIVINHACAO QUE FOI REMOVIDA. A diferenca e o que se le:
 *
 *   - o que foi removido lia o TEXTO LIVRE DO CLIENTE ("meu computador travou")
 *     e chutava um setor -- por isso conversa nova nascia Tecnico sem ninguem
 *     ter escolhido nada;
 *   - isto le o ROTULO DA OPCAO QUE O CLIENTE SELECIONOU no menu. "1 - Setor
 *     Tecnico" declara o setor no proprio nome. Nao ha palpite: houve escolha.
 *
 * Por que existe: o caminho oficial e `opcao.setor`, gravado no JSON do fluxo.
 * So que o fluxo vive no BANCO de cada instalacao, e um fluxo montado antes
 * desse campo existir (ou importado do editor de origem, que nao o conhece) nao
 * o tem -- e ai o cliente escolhia "1" e o motor nao tinha o que gravar. Sem
 * este encaixe, a regra dependeria de alguem lembrar de rodar uma migracao em
 * cada banco, e "funciona depois que voce rodar um script" nao e uma regra que
 * funciona.
 *
 * CASAMENTO EXATO, e contra a lista canonica de setores. Verificado contra o
 * fluxo real: as palavras de setor aparecem SO nas opcoes do menu principal --
 * os submenus usam "contrato", "avulso", "produtos", "voltar", "sim"/"nao".
 * Substring casaria "adm" dentro de "administrativo" e coisas piores, entao a
 * comparacao e por token inteiro.
 */
const PALAVRAS_DE_SETOR = {
  "Técnico": ["tecnico", "setor tecnico", "suporte tecnico"],
  "Comercial": ["comercial", "vendas"],
  "Financeiro": ["financeiro", "adm", "administrativo", "faturamento", "adm/financeiro"],
};

function setorDaOpcaoEscolhida(opcao) {
  if (!opcao) return null;
  const semAcento = (s) =>
    String(s || "").toLowerCase().trim().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // `palavrasChave` e a forma estruturada; `rotulo` ("1,tecnico,setor tecnico")
  // e o mesmo conteudo em texto, para fluxos que so tenham ele.
  const tokens = [
    ...(Array.isArray(opcao.palavrasChave) ? opcao.palavrasChave : []),
    ...String(opcao.rotulo || "").split(","),
  ].map(semAcento).filter(Boolean);

  if (!tokens.length) return null;
  for (const [setor, palavras] of Object.entries(PALAVRAS_DE_SETOR)) {
    if (palavras.some((p) => tokens.includes(p))) return setor;
  }
  return null;
}

module.exports = {
  SETORES,
  SETOR_PADRAO,
  // Exportado para o teste conseguir CITAR a regra em vez de reescreve-la.
  CUIDAM_DA_TRIAGEM,
  setorValido,
  normalizarSetor,
  podeAcessarSetor,
  resolverSetorDeclarado,
  setorDaOpcaoEscolhida,
};
