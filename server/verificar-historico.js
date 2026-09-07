/**
 * A PRÉVIA DA IMPORTAÇÃO NÃO PODE PROMETER O QUE A IMPORTAÇÃO NÃO ENTREGA.
 *
 * ── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * A prévia mostrava o TOTAL do número. A tela convidava com ele: "foram
 * encontradas 2298 mensagens antigas deste número; a Central já tem 2280".
 * Quem lia entendia que 18 entrariam. Confirmava, esperava a importação inteira
 * rodar, e recebia "nenhuma mensagem nova entrou".
 *
 * As 18 eram reação e evento de protocolo -- coisas que nunca viram mensagem.
 * A conta que faltava não era a do total: era a de quantas SOBREVIVERIAM aos
 * mesmos extratores que a importação usa.
 *
 * ── O QUE ESTÁ TRAVADO AQUI ────────────────────────────────────────────────
 *
 * Que `previa.novas` seja igual ao que a importação de fato inseriria, medido
 * pelo MESMO caminho -- e não por uma reimplementação da regra dentro do teste,
 * que passaria a concordar com o defeito no dia em que ele voltasse.
 *
 * As dobras substituem só a Evolution e o banco. `previa`, `_coletar` e
 * `_temConteudo` são o código de verdade.
 */
const path = require("path");

const ALVO = path.join(__dirname, "src/modules/whatsapp");

// Uma página com 3 mensagens de texto e 2 reações.
const REG = (id, texto) => ({
  key: { id, remoteJid: "5511999@s.whatsapp.net", fromMe: false },
  messageTimestamp: 1700000000,
  message: texto ? { conversation: texto } : { reactionMessage: { text: "\u{1F44D}" } },
});
const PAGINA = [REG("a", "oi"), REG("b", "tudo bem"), REG("c", "ok"), REG("r1"), REG("r2")];
const JA_NA_CENTRAL = new Set(["a", "b", "c"]);

function dobra(rel, exports) {
  const p = require.resolve(path.join(ALVO, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

dobra("../../infrastructure/external/evolution-api.client", {
  findMessages: async () => ({ registros: PAGINA, total: PAGINA.length, paginas: 1 }),
  findChats: async () => [],
});
dobra("../../infrastructure/repositories/conversa.repository", {
  dadosParaImportacao: async () => ({ id: "c1", telefone: "5511999", instanciaId: "i1" }),
  contarMensagensComWaId: async () => JA_NA_CENTRAL.size,
  waIdsExistentes: async (ids) => new Set(ids.filter((i) => JA_NA_CENTRAL.has(i))),
});
dobra("../../infrastructure/repositories/instancia.repository", {
  findById: async () => ({ nome: "arka" }),
});
dobra("../../infrastructure/storage/midia.storage", { salvarDataUrl: async () => null });

const historico = require(path.join(ALVO, "historico.service"));

const erros = [];
function check(nome, problemas) {
  if (problemas.length) {
    erros.push(nome);
    console.log("  FALHA " + nome);
    for (const p of problemas) console.log("        " + p);
  } else {
    console.log("  OK   " + nome);
  }
}

(async () => {
  console.log("=== Previa da importacao de historico ===");

  const previa = await historico.previa("c1");

  check("a previa continua contando o total do numero", [
    ...(previa.disponivel === 5 ? [] : ["`disponivel` deveria ser 5, veio " + previa.disponivel]),
    ...(previa.jaNaCentral === 3 ? [] : ["`jaNaCentral` deveria ser 3, veio " + previa.jaNaCentral]),
  ]);

  // O nucleo: sobram 2 registros novos, e os dois sao reacao.
  check("reacao e evento nao sao contados como mensagem a importar", [
    ...(previa.novas === 0 ? [] : ["`novas` deveria ser 0 (as 2 restantes sao reacoes), veio " + previa.novas]),
    ...(previa.motivo === "tudo_ja_importado"
      ? []
      : ["`motivo` deveria ser tudo_ja_importado, veio " + previa.motivo]),
  ]);

  JA_NA_CENTRAL.delete("c");
  const comNovidade = await historico.previa("c1");

  check("quando ha mensagem de verdade, a previa conta", [
    ...(comNovidade.novas === 1 ? [] : ["`novas` deveria ser 1, veio " + comNovidade.novas]),
    ...(comNovidade.motivo === null ? [] : ["`motivo` deveria ser null, veio " + comNovidade.motivo]),
  ]);

  // A promessa e o cumprimento medidos pelo mesmo caminho.
  const { novos } = await historico._coletar("j", "arka", 3000);
  const importaria = [...novos.values()].filter((r) => historico._temConteudo(r)).length;

  check("a previa promete exatamente o que a importacao entrega", [
    ...(importaria === comNovidade.novas
      ? []
      : ["a previa diz " + comNovidade.novas + " e a importacao traria " + importaria]),
  ]);

  console.log(
    "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "HISTORICO: TUDO CONFERE")
  );
  process.exit(erros.length ? 1 : 0);
})();
