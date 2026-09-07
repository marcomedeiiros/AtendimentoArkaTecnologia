/**
 * REAÇÕES DE UMA MENSAGEM (o 👍 do WhatsApp).
 *
 * ── ONDE ELAS MORAM, E POR QUE NÃO EM TABELA PRÓPRIA ───────────────────────
 *
 * Em `Mensagem.metadata.reacoes`, um array. Uma tabela separada seria o
 * desenho de livro -- e pagaria por um problema que não existe aqui: reação não
 * é consultada por conta própria ("liste tudo que foi curtido no mês"), ela é
 * lida SEMPRE junto da mensagem que já está sendo carregada. Numa tabela, a
 * listagem da conversa ganharia um JOIN a mais por nada.
 *
 * O preço é conhecido e aceito: mexer numa reação exige ler-modificar-escrever
 * o `metadata` inteiro. Por isso `aplicar` recebe o metadata ATUAL e devolve o
 * novo, em vez de escrever no banco -- quem chama faz a leitura e a escrita
 * numa transação, e o campo de mídia que vive no mesmo `metadata` não é
 * atropelado.
 *
 * ── UMA REAÇÃO POR PESSOA, COMO NO WHATSAPP ────────────────────────────────
 *
 * Trocar o emoji SUBSTITUI o anterior, não acumula. Quem reage é identificado
 * por `autorId`: o telefone do cliente, ou o id do usuário da equipe. Reagir
 * com o mesmo emoji de novo REMOVE -- é o que o aparelho faz, e quem espera
 * isso ficaria com dois 👍 se acumulasse.
 */

// Emojis que a tela oferece. Lista fechada de propósito: o que sai daqui vai
// para o WhatsApp do cliente, e um campo livre deixaria passar texto inteiro
// no lugar de um emoji.
const EMOJIS_PERMITIDOS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// Limite de segurança para o que chega de FORA (o cliente reage pelo celular e
// pode mandar qualquer emoji). Aqui não há allowlist -- recusar o emoji do
// cliente seria esconder da equipe algo que ele de fato enviou --, mas há teto
// de tamanho: um "emoji" de 400 caracteres não é emoji.
const MAX_CHARS_EMOJI = 16;

function limparEmoji(valor) {
  const s = String(valor ?? "").trim();
  if (!s) return "";
  return [...s].slice(0, MAX_CHARS_EMOJI).join("");
}

/**
 * Lista as reações de um `metadata`, sempre como array.
 *
 * DEDUPLICA POR AUTOR, ficando com a última. A regra "uma reação por pessoa" é
 * garantida por `aplicar` na escrita, mas garantir só na escrita deixa a
 * LEITURA à mercê do que estiver gravado -- e há como o banco ter duas do mesmo
 * autor: dois pedidos simultâneos (a equipe pelo painel e o cliente pelo
 * celular caem em caminhos diferentes), ou uma linha adulterada.
 *
 * Sem isto, a mesma pessoa apareceria contada duas vezes num "👍 2" que na
 * verdade é uma pessoa só -- um número errado na tela, que ninguém teria como
 * questionar olhando.
 */
function listar(metadata) {
  const brutas = metadata && typeof metadata === "object" ? metadata.reacoes : null;
  if (!Array.isArray(brutas)) return [];
  const porAutor = new Map();
  for (const r of brutas) {
    if (!r || typeof r !== "object") continue;
    const emoji = limparEmoji(r.emoji);
    if (!emoji) continue;
    // `set` sobrescreve: a última do autor vence, que é a ordem de chegada.
    porAutor.set(String(r.autorId ?? ""), {
      emoji,
      de: r.de === "cliente" ? "cliente" : "equipe",
      autorId: String(r.autorId ?? ""),
      autorNome: String(r.autorNome ?? "").slice(0, 120),
      em: r.em || null,
    });
  }
  return [...porAutor.values()];
}

/**
 * Aplica uma reação e devolve o `metadata` novo.
 *
 * @param {object|null} metadata  o metadata atual da mensagem
 * @param {object} reacao  { emoji, de, autorId, autorNome }
 *   `emoji` vazio remove a reação de quem está reagindo.
 * @returns {{ metadata: object, reacoes: Array, mudou: boolean }}
 */
function aplicar(metadata, { emoji, de, autorId, autorNome = "" }) {
  const base = metadata && typeof metadata === "object" ? metadata : {};
  const atuais = listar(base);
  const quem = String(autorId ?? "");
  const novo = limparEmoji(emoji);

  const anterior = atuais.find((r) => r.autorId === quem) || null;
  // MESMO EMOJI DE NOVO = TIRAR. É o comportamento do aparelho: o dedo no 👍
  // que já está lá desfaz. Sem isto não haveria como remover pela tela.
  const removendo = !novo || (anterior && anterior.emoji === novo);

  const semAsDoAutor = atuais.filter((r) => r.autorId !== quem);
  const reacoes = removendo
    ? semAsDoAutor
    : [
        ...semAsDoAutor,
        {
          emoji: novo,
          de: de === "cliente" ? "cliente" : "equipe",
          autorId: quem,
          autorNome: String(autorNome || "").slice(0, 120),
          em: new Date().toISOString(),
        },
      ];

  const mudou = JSON.stringify(atuais) !== JSON.stringify(reacoes);
  // `reacoes` some do metadata quando fica vazio: sem isso, toda mensagem que
  // ja teve reacao carregaria um array vazio para sempre.
  const metadataNovo = { ...base };
  if (reacoes.length) metadataNovo.reacoes = reacoes;
  else delete metadataNovo.reacoes;

  return { metadata: metadataNovo, reacoes, mudou };
}

/**
 * Agrupa para a tela: um item por emoji, com a contagem e quem reagiu.
 *
 * A tela precisa de "👍 2" e não de duas linhas de 👍 -- e precisa saber se
 * ALGUÉM DA EQUIPE já reagiu, para o botão aparecer marcado.
 */
function agrupar(metadata) {
  const porEmoji = new Map();
  for (const r of listar(metadata)) {
    const atual = porEmoji.get(r.emoji) || { emoji: r.emoji, total: 0, daEquipe: false, autores: [] };
    atual.total += 1;
    if (r.de === "equipe") atual.daEquipe = true;
    if (r.autorNome) atual.autores.push(r.autorNome);
    porEmoji.set(r.emoji, atual);
  }
  return [...porEmoji.values()];
}

module.exports = { EMOJIS_PERMITIDOS, listar, aplicar, agrupar, limparEmoji };
