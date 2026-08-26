/**
 * DE QUAL SETOR É ESTE ATENDIMENTO? deduzido do que o cliente disse.
 *
 * Por que existe: o fluxo transfere para uma FILA numérica (`queueId` do editor
 * de origem: 33, 35...), e o mapa fila→setor vive em Configurações. Com o mapa
 * vazio -- que é o estado de qualquer instalação que não o preencheu à mão --
 * `setor` ficava nulo e TODA conversa era gravada como "Geral". Era por isso que
 * a aba de Feedbacks mostrava "Atendimento Geral" em tudo.
 *
 * Em vez de exigir configuração manual, deduzimos do que já está na conversa: o
 * cliente escolheu "1 - Setor Técnico" no menu, ou escreveu "meu boleto". Essa
 * regra já existia -- mas só no NAVEGADOR, duplicada em duas telas (o badge da
 * Central e o Registro), e sem nunca ser gravada. Aqui ela vira uma regra do
 * servidor, aplicada uma vez e PERSISTIDA na conversa e na OS.
 *
 * Com o setor gravado, Conversa, Atendimento e Feedback passam a concordar,
 * porque leem o mesmo campo em vez de cada tela adivinhar por conta própria.
 */
const { SETORES, SETOR_PADRAO, normalizarSetor } = require("./setor.helper");

// Minúsculo e sem acento: "Técnico", "tecnico" e "TÉCNICO" são a mesma coisa.
function semAcento(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * `explicito` = o cliente NOMEOU o setor ("quero falar com o financeiro", ou
 * escolheu a opção "3 - Adm/Financeiro", cujo rótulo traz a palavra).
 * `assunto`   = ele não nomeou, mas o que pediu entrega o setor ("meu boleto").
 *
 * Nomear vale mais do que deduzir, então `explicito` é conferido primeiro.
 */
const GATILHOS = [
  {
    setor: "Técnico",
    explicito: ["tecnico", "tecnica", "suporte tecnico", "setor tecnico"],
    assunto: [
      "nao funciona", "nao esta funcionando", "parou de funcionar", "deu erro",
      "erro no", "travou", "travando", "lento", "sem sinal", "sem internet",
      "sem conexao", "configurar", "configuracao", "instalacao", "instalar",
      "manutencao", "defeito", "suporte", "impressora", "chamado",
    ],
  },
  {
    setor: "Financeiro",
    explicito: ["financeiro", "financeira", "adm", "administrativo", "faturamento"],
    assunto: [
      "boleto", "fatura", "segunda via", "2 via", "pagamento", "pagar",
      "cobranca", "cobrado", "mensalidade", "nota fiscal", "pix", "estorno",
      "reembolso", "vencimento", "em atraso", "debito",
    ],
  },
  {
    setor: "Comercial",
    explicito: ["comercial", "vendas", "vendedor"],
    assunto: [
      "orcamento", "proposta", "contratar", "quanto custa", "preco", "valor",
      "plano", "assinar", "upgrade", "revenda", "parceria", "tabela de preco",
      "computador", "notebook",
    ],
  },
];

function casar(textos, campo) {
  for (const t of textos) {
    const achado = GATILHOS.find((g) => g[campo].some((p) => t.includes(p)));
    if (achado) return achado.setor;
  }
  return null;
}

/**
 * Deduz o setor a partir das falas do cliente e (opcionalmente) do RÓTULO da
 * opção de menu que ele escolheu.
 *
 * O rótulo importa porque no menu o cliente digita só "1" -- o texto dele não
 * diz "técnico", mas a opção escolhida ("1,tecnico,suporte tecnico") diz.
 *
 * @param {object} conversa   conversa com `mensagens` (origem/texto)
 * @param {string} rotuloOpcao rótulo da opção escolhida, quando houver
 * @returns {string|null} setor da lista canônica, ou null quando nada indica um
 */
function detectarSetor(conversa, rotuloOpcao = null) {
  // A opção escolhida é o sinal mais forte: foi uma escolha, não uma dedução.
  if (rotuloOpcao) {
    const doRotulo = casar([semAcento(rotuloOpcao)], "explicito");
    if (doRotulo) return doRotulo;
  }

  const falas = (conversa?.mensagens || [])
    .filter((m) => m.origem === "cliente" && m.texto)
    .map((m) => semAcento(m.texto))
    .reverse(); // da mais recente para a mais antiga

  if (falas.length === 0) return null;
  return casar(falas, "explicito") || casar(falas, "assunto") || null;
}

/**
 * Setor final a gravar: o explícito do fluxo vence; senão o mapa de filas;
 * senão a dedução; senão "Geral".
 */
function resolverSetor({ setorExplicito, setorDaFila, conversa, rotuloOpcao }) {
  const escolhido = setorExplicito || setorDaFila || detectarSetor(conversa, rotuloOpcao);
  return escolhido ? normalizarSetor(escolhido) : SETOR_PADRAO;
}

module.exports = { detectarSetor, resolverSetor, SETORES };
