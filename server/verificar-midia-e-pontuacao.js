// Verificacao do ROTEAMENTO DE MIDIA E DA RESPOSTA SEM CONTEUDO --
// `node verificar-midia-e-pontuacao.js`.
//
// ── OS QUATRO DEFEITOS QUE ESTE SCRIPT TRAVA ────────────────────────────────
//
// A. MIDIA NAO DISPARAVA A AUTOMACAO. `_processarMensagemEntrada` tinha um
//    `if (ehMidia) return "midia_recebida"` SEM condicao: PDF, imagem, video e
//    audio eram gravados e a automacao PARAVA. A classificacao nunca foi o
//    problema -- `extrairMidia` reconhece todos --, era o roteamento. Quem
//    abria a conversa com uma foto nao recebia menu nenhum, e quem respondia
//    "descreva sua solicitacao" com uma foto deixava o bot esperando ate a
//    inatividade encerrar com "Nao entendemos a sua demanda".
//
// B. "." VALIA COMO RESPOSTA LIVRE. O ramo de `AGUARDANDO.TEXTO` aceitava
//    qualquer texto nao vazio, entao um unico "." percorria o resto do fluxo e
//    caia no handoff -- com o chamado chegando na fila com "." no lugar do nome.
//
// C. LEGENDA DE VIDEO E DE DOCUMENTO ERA DESCARTADA. `extrairTexto` lia so
//    `imageMessage.caption`.
//
// D. MIDIA NAO MAPEADA DESAPARECIA. `extrairMidia` devolvia null para nó fora da
//    lista, e o webhook respondia `dados_incompletos` -- a mensagem nunca
//    entrava no sistema.
//
// ── POR QUE ELE ENTRA PELO PAYLOAD, E NAO PELO SIMULADOR ────────────────────
//
// O simulador (`chatbot.simulador`) recebe TEXTO ja pronto, entao ele nao
// exercita `extrairMidia`/`extrairTexto` -- e metade destes defeitos vive
// justamente ali. Aqui cada cenario comeca no payload da Evolution e percorre a
// mesma sequencia da producao: extrair -> guarda de `dados_incompletos` ->
// motor. O fluxo tambem e o REAL (docs/fluxo-arka.json), pelo mesmo motivo.
const path = require("path");
const { readFileSync } = require("fs");

const raiz = path.join(__dirname, "src");
const { ChatbotEngine } = require(path.join(raiz, "modules/chatbot/chatbot.engine"));
const svc = require(path.join(raiz, "modules/whatsapp/whatsapp.service"));

// ── o fluxo da ARKA, convertido pelo import do front (igual verificar-fluxo-arka) ──
const fonte = readFileSync(
  path.join(__dirname, "..", "client", "src", "components", "flow", "fluxoJson.js"),
  "utf8"
);
const mod = {};
new Function(
  "exports",
  "const hojeISO = () => '1970-01-01';\n" +
    fonte
      .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
      .replace(/export /g, "") +
    "\n;exports.extrair = extrairFluxosImportados;"
)(mod);
const [convertido] = mod.extrair(
  JSON.parse(readFileSync(path.join(__dirname, "..", "docs", "fluxo-arka.json"), "utf8"))
);
const FLUXO = {
  id: "f-arka",
  nome: convertido.nome,
  gatilho: convertido.gatilho,
  ativo: true,
  passos: convertido.passos.map((p) => ({
    id: p.id,
    tipo: p.tipo,
    titulo: p.titulo,
    descricao: p.desc,
    texto: p.texto || null,
    config: p.config || null,
    targetId: p.targetId,
    ordem: p.ordem,
  })),
};

const erros = [];
// O que saiu para o cliente, em uma linha. Menu com botao/lista nao manda
// string: `sendButtons` recebe {title, description, ...} e `sendList` idem --
// sem isto o relatorio imprimia "[object Object]" no lugar da mensagem.
const linha1 = (s) => {
  const texto = typeof s === "string" ? s : s?.description || s?.title || s?.text || JSON.stringify(s);
  return String(texto).split("\n")[0].slice(0, 34);
};

/** Um atendimento novo, com dependencias em memoria. Motor real. */
function ambiente() {
  const enviadas = [];
  const conversa = {
    id: "c1", instanciaId: "i1", cliente: "Fulano", telefone: "5527999999999",
    statusAtendimento: "pendente", setor: "Geral", atendenteId: null, avaliacao: null,
    atendimentoAtualId: "os1", cnpj: null, cnpjVerificado: false,
    mensagens: [], atendimentos: [{ id: "os1" }],
  };
  let sessao = null;

  const deps = {
    fluxoRepository: {
      findAtivos: async () => [FLUXO],
      findById: async (i) => (i === FLUXO.id ? FLUXO : null),
      findByGatilho: async () => null,
      createLog: async () => {},
    },
    conversaRepository: {
      findById: async () => conversa,
      findByIdParaEvento: async () => conversa,
      findByTelefone: async () => conversa,
      findByTelefoneParaMotor: async () => conversa,
      create: async () => conversa,
      existeMensagemWa: async () => false,
      findMensagemPorWaId: async () => null,
      addMensagem: async (_i, origem, texto, meta) => {
        const m = { id: `m${conversa.mensagens.length + 1}`, origem, texto, metadata: meta, criadoEm: new Date() };
        conversa.mensagens.push(m);
        return m;
      },
      respondeuDepoisDe: async () => false,
      vincularWaMessageId: async () => {},
      update: async (_i, d) => Object.assign(conversa, d),
      garantirAtendimento: async () => null,
      garantirAtendimentoAberto: async () => ({ atendimento: null }),
      atualizarAtendimentoAtual: async () => null,
      atualizarAtendimento: async () => null,
      definirMotivoAtualSeVazio: async () => null,
      definirMotivoSeVazio: async () => null,
      ultimoCnpjDoTelefone: async () => null,
      ultimaMensagemBotComErro: async () => null,
    },
    sessaoRepository: {
      findByTelefone: async () => sessao,
      findByConversa: async () => sessao,
      upsert: async (a, b, c, d) => {
        sessao = { id: "s1", instanciaId: a, conversaId: b, telefone: c, criadoEm: new Date(), ...(sessao || {}), ...d, atualizadoEm: new Date() };
        return sessao;
      },
      update: async (_i, d) => {
        sessao = { ...sessao, ...d, atualizadoEm: new Date() };
        return sessao;
      },
      reivindicarInatividade: async () => ({ count: 0 }),
    },
    parceiroRepository: { findAtivoByCnpj: async () => null, findAtivoByTelefone: async () => null },
    evolutionApi: {
      sendText: async (_t, x) => { enviadas.push(x); return { key: { id: "x" } }; },
      sendButtons: async (_t, x) => { enviadas.push(x); return { key: { id: "x" } }; },
      sendList: async (_t, x) => { enviadas.push(x); return { key: { id: "x" } }; },
      fetchProfilePictureUrl: async () => null,
      getBase64FromMediaMessage: async () => null,
    },
    n8nClient: { encaminharMensagem: async () => ({ encaminhado: false }) },
    // Horario desligado: o expediente tem script proprio e barrar aqui
    // atrapalharia. Modo local forcado, senao o bot nao responde nada.
    configuracaoService: {
      modoAtendimento: async () => "local",
      horarioAtendimento: async () => ({ ativo: false }),
      filasParaSetor: async () => ({}),
      pesquisaSatisfacao: async () => ({ ativo: false }),
    },
    bus: { emitConversa: () => {} },
  };

  const engine = new ChatbotEngine(deps);
  let n = 0;

  /** A MESMA sequencia do webhook de producao, comecando no payload. */
  const receber = async (message) => {
    enviadas.length = 0;
    const body = {
      data: {
        key: { remoteJid: "5527999999999@s.whatsapp.net", fromMe: false, id: `w${++n}` },
        pushName: "Fulano",
        message,
      },
    };
    const midia = svc.extrairMidia(body);
    const texto = svc.extrairTexto(body);
    const botaoId = svc.extrairBotaoId(body);
    // A guarda do webhook: sem texto, midia nem botao a mensagem e descartada.
    if (!texto && !midia && !botaoId) {
      return { descartada: true, tipo: "descartada", enviadas: [] };
    }
    const r = await engine.processarMensagemEntrada({
      instanciaId: "i1", instanceName: "verificacao", telefone: conversa.telefone,
      texto, botaoId, nomeCliente: "Fulano", waMessageId: `w${n}`, midia,
    });
    return { ...r, tipo: midia?.tipo || "texto", legenda: texto, enviadas: [...enviadas] };
  };

  return { receber, get sessao() { return sessao; }, conversa };
}

async function cenario(n, nome, mensagens, esperado) {
  const amb = ambiente();
  let r;
  for (const m of mensagens) r = await amb.receber(m);
  const real = {
    tipo: r.tipo,
    transferido: !!r.transferido,
    aguardando: amb.sessao?.ativo ? amb.sessao.aguardando || null : null,
    respondeu: (r.enviadas || []).length > 0,
  };
  if (esperado.legenda !== undefined) real.legenda = r.legenda;
  const ok = Object.entries(esperado).every(([k, v]) => String(real[k]) === String(v));
  if (!ok) erros.push(`${n}. ${nome}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`);
  console.log(
    `  ${ok ? "OK   " : "FALHA"} ${String(n).padStart(3)}. ${nome.padEnd(33)}` +
      ` tipo=${String(real.tipo).padEnd(10)} transf=${real.transferido ? "SIM" : "nao"}` +
      ` aguard=${String(real.aguardando).padEnd(7)} | ${(r.enviadas || []).map(linha1).join(" | ") || "(nada)"}`
  );
}

const txt = (s) => ({ conversation: s });
// O caminho ate a pergunta de resposta livre no fluxo da ARKA:
// menu -> Tecnico -> avulso -> "Seus dados".
const ATE_RESPOSTA_LIVRE = [txt("oi"), txt("1"), txt("2"), txt("1")];

(async () => {
  console.log("\n══ TEXTO ═══════════════════════════════════════════════════════");
  await cenario(1, '"hello"', [txt("hello")], { tipo: "texto", transferido: false, aguardando: "opcao", respondeu: true });
  await cenario(2, '"oi"', [txt("oi")], { tipo: "texto", transferido: false, aguardando: "opcao", respondeu: true });
  await cenario(3, '"." no primeiro contato', [txt(".")], { transferido: false, aguardando: "opcao", respondeu: true });
  await cenario(4, '"..." no primeiro contato', [txt("...")], { transferido: false, aguardando: "opcao", respondeu: true });
  await cenario(5, '"?" no primeiro contato', [txt("?")], { transferido: false, aguardando: "opcao", respondeu: true });
  // Whitespace nao e mensagem: `extrairTexto` devolve "" e a guarda descarta.
  await cenario(6, "só espaço em branco", [txt("   ")], { tipo: "descartada", transferido: false, respondeu: false });

  console.log("\n══ O RELATO: '.' NUMA RESPOSTA LIVRE ═══════════════════════════");
  // ANTES: um unico "." concluia o fluxo -> transferido=SIM. AGORA: repergunta.
  await cenario("4a", '"." uma vez', [...ATE_RESPOSTA_LIVRE, txt(".")], { transferido: false, aguardando: "texto", respondeu: true });
  await cenario("4b", '"." duas vezes', [...ATE_RESPOSTA_LIVRE, txt("."), txt("..")], { transferido: false, aguardando: "texto", respondeu: true });
  // O teto que ja existia para o menu vale aqui: quem insiste cai na fila.
  await cenario("4c", '"." tres vezes -> fila', [...ATE_RESPOSTA_LIVRE, txt("."), txt(".."), txt("...")], { transferido: true, aguardando: "humano" });
  // ── A RESPOSTA DE VERDADE CONCLUI O FLUXO, e isso E o certo ─────────────
  //
  // "Seus dados" e a ULTIMA etapa livre do fluxo da ARKA: responder ali fecha a
  // triagem e entrega o chamado a equipe (`✅ Solicitação recebida!`), que e o
  // desfecho desenhado no canvas -- o mesmo que verificar-fluxo-arka.js ja
  // exercita. O handoff aqui e legitimo; o que era defeito era chegar nele com
  // um ".".
  await cenario("4d", "resposta de verdade conclui", [...ATE_RESPOSTA_LIVRE, txt("David / TI")], { transferido: true, aguardando: "humano", respondeu: true });
  // Um digito ou uma letra JA e conteudo: nao pode ser recusado.
  await cenario("4e", '"5" é conteúdo', [...ATE_RESPOSTA_LIVRE, txt("5")], { transferido: true, aguardando: "humano", respondeu: true });
  await cenario("4f", "acento/alfabeto não-latino", [...ATE_RESPOSTA_LIVRE, txt("Ção 日本")], { transferido: true, aguardando: "humano", respondeu: true });

  console.log("\n══ MIDIA ABRE O FLUXO ══════════════════════════════════════════");
  await cenario(7, "PDF", [{ documentMessage: { mimetype: "application/pdf", fileName: "nota.pdf" } }], { tipo: "documento", transferido: false, aguardando: "opcao", respondeu: true });
  await cenario(8, "imagem", [{ imageMessage: { mimetype: "image/jpeg" } }], { tipo: "imagem", transferido: false, aguardando: "opcao", respondeu: true });
  await cenario(9, "vídeo", [{ videoMessage: { mimetype: "video/mp4" } }], { tipo: "video", transferido: false, aguardando: "opcao", respondeu: true });
  await cenario(10, "áudio", [{ audioMessage: { mimetype: "audio/ogg", ptt: true } }], { tipo: "audio", transferido: false, aguardando: "opcao", respondeu: true });
  await cenario(11, "figurinha", [{ stickerMessage: { mimetype: "image/webp" } }], { tipo: "figurinha", transferido: false, aguardando: "opcao", respondeu: true });

  console.log("\n══ MIDIA COMO RESPOSTA LIVRE ═══════════════════════════════════");
  // ESTE e o coracao do defeito A. Antes: o bot recebia a foto e PARAVA -- o
  // cliente ficava esperando e, cinco minutos depois, a inatividade encerrava
  // com "Nao entendemos a sua demanda". Agora a midia E a resposta: o fluxo
  // segue e o chamado chega a fila com a foto anexada.
  await cenario("12a", "imagem responde a pergunta", [...ATE_RESPOSTA_LIVRE, { imageMessage: { mimetype: "image/jpeg" } }], { tipo: "imagem", transferido: true, aguardando: "humano", respondeu: true });
  await cenario("12b", "PDF responde a pergunta", [...ATE_RESPOSTA_LIVRE, { documentMessage: { mimetype: "application/pdf", fileName: "n.pdf" } }], { tipo: "documento", transferido: true, aguardando: "humano", respondeu: true });
  // Com legenda, o que fica gravado como resposta e o que o cliente ESCREVEU --
  // e nao o rotulo "[Imagem]". Ver `textoParaFluxo` no motor.
  await cenario("12c", "imagem com legenda responde", [...ATE_RESPOSTA_LIVRE, { imageMessage: { mimetype: "image/jpeg", caption: "David / TI" } }], { tipo: "imagem", legenda: "David / TI", transferido: true, aguardando: "humano" });

  console.log("\n══ MIDIA NAO ATROPELA ETAPA QUE ESPERA OUTRA COISA ═════════════");
  // No MENU o bot espera uma escolha. Uma foto ali nao e "resposta errada" --
  // tratar como erro gastaria as tentativas do cliente. Fica registrada, e o
  // atendente ve; o bot nao repergunta nem transfere.
  await cenario("13a", "imagem no menu", [txt("oi"), { imageMessage: { mimetype: "image/jpeg" } }], { tipo: "imagem", transferido: false, aguardando: "opcao", respondeu: false });
  await cenario("13b", "PDF no menu", [txt("oi"), { documentMessage: { mimetype: "application/pdf" } }], { tipo: "documento", transferido: false, aguardando: "opcao", respondeu: false });

  console.log("\n══ BORDA ═══════════════════════════════════════════════════════");
  await cenario(14, "PDF sem nome de arquivo", [{ documentMessage: { mimetype: "application/pdf" } }], { tipo: "documento", transferido: false, aguardando: "opcao" });
  // O mimetype manda, nao a extensao: ".PDF" maiusculo nao muda nada.
  await cenario(15, "PDF .PDF maiúsculo", [{ documentMessage: { mimetype: "application/pdf", fileName: "NOTA.PDF" } }], { tipo: "documento", transferido: false, aguardando: "opcao" });
  await cenario(16, "imagem com legenda", [{ imageMessage: { mimetype: "image/jpeg", caption: "olha o erro" } }], { tipo: "imagem", legenda: "olha o erro", aguardando: "opcao" });
  // Defeito C: a legenda do VIDEO era descartada (`extrairTexto` lia so imagem).
  await cenario(17, "vídeo com legenda", [{ videoMessage: { mimetype: "video/mp4", caption: "veja isso" } }], { tipo: "video", legenda: "veja isso", aguardando: "opcao" });
  await cenario(18, "documento com legenda", [{ documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf", fileName: "n.pdf", caption: "segue a nota" } } } }], { tipo: "documento", legenda: "segue a nota", aguardando: "opcao" });
  await cenario(19, "mídia sem metadado opcional", [{ imageMessage: {} }], { tipo: "imagem", transferido: false, aguardando: "opcao" });
  // Defeito D: tipo fora da lista era descartado. O mimetype o classifica.
  await cenario(20, "tipo não mapeado (zip)", [{ arquivoQualquerMessage: { mimetype: "application/zip", fileName: "x.zip" } }], { tipo: "documento", transferido: false, aguardando: "opcao", respondeu: true });
  await cenario(21, "tipo não mapeado (image/*)", [{ fotoNovaMessage: { mimetype: "image/heic" } }], { tipo: "imagem", transferido: false, aguardando: "opcao", respondeu: true });
  // Sem mimetype nao ha prova de arquivo: continua descartado, e isso e correto
  // -- adivinhar faria qualquer no de controle virar midia.
  await cenario(22, "nó desconhecido sem mimetype", [{ coisaEstranhaMessage: { foo: 1 } }], { tipo: "descartada", respondeu: false });

  console.log("\n══ PAYLOAD MALFORMADO (a entrada vem de fora) ══════════════════");
  const tortos = [
    null, undefined, {}, { data: null }, { data: {} }, { data: { message: null } },
    { data: { message: "texto" } }, { data: { key: {} } },
    { data: { message: { documentMessage: null } } },
    { data: { message: { imageMessage: { mimetype: 123 } } } },
    { data: { message: [] } },
  ];
  const problemas = [];
  for (const p of tortos) {
    for (const fn of ["extrairMidia", "extrairTexto", "extrairBotaoId", "extrairCitacao", "extrairEncaminhada"]) {
      try {
        svc[fn](p);
      } catch (e) {
        problemas.push(`${fn}(${JSON.stringify(p)}) estourou: ${e.message}`);
      }
    }
  }
  if (problemas.length) erros.push(`23. payload malformado: ${problemas[0]}`);
  console.log(`  ${problemas.length ? "FALHA" : "OK   "}  23. ${tortos.length} payloads malformados sem exceção`);

  console.log(
    "\n" +
      (erros.length
        ? `FALHAS (${erros.length}):\n  - ` + erros.join("\n  - ")
        : "MIDIA E PONTUACAO: TODAS AS VERIFICACOES PASSARAM")
  );
  process.exit(erros.length ? 1 : 0);
})().catch((e) => {
  console.error("ERRO inesperado na verificacao:", e);
  process.exit(1);
});
