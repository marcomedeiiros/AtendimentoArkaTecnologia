// O QUE O CLIENTE VÊ NO WHATSAPP -- `node verificar-visual-whatsapp.js`.
//
// ── POR QUE ESTE ARQUIVO EXISTE, SE JÁ HÁ A MATRIZ DO FLUXO ──────────────────
//
// `verificar-fluxo-arka.js` prova o COMPORTAMENTO: o bot para e espera, o setor
// certo, a fila certa. Ele não prova a APARÊNCIA, e a regra que mais doeu era de
// aparência: um botão "resposta livre" debaixo de "descreva sua solicitação", e
// um bloco com 4 botões que a Evolution recusa na porta.
//
// A diferença é onde se olha. O simulador registra o TEXTO da bolha; quem decide
// se aquilo vira botão, lista ou texto puro é `enviarBotComOpcoes`, e o resultado
// dessa decisão só aparece no PAYLOAD enviado à Evolution -- `sendButtons` com N
// botões, `sendList` com N linhas, ou `sendText` sem nada.
//
// Então aqui a dependência interceptada é a `evolutionApi`: cada chamada é
// gravada com o payload inteiro. É o mais perto da tela do cliente que se chega
// sem um celular na mão -- e, ao contrário de um print, isto reprova sozinho
// quando alguém reintroduzir o botão.
//
// Sai também um arquivo HTML com a conversa desenhada em bolhas de WhatsApp
// (`docs/verificacao-visual-arka.html`), para conferência de olho.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";
// OS BOTÕES LIGADOS. Sem esta variável, `enviarBotComOpcoes` cai direto no texto
// puro (é o padrão conservador do motor) e o teste não exercitaria nada do que
// pretende medir.
process.env.WHATSAPP_BOTOES_INTERATIVOS = "true";

const path = require("path");
const { readFileSync, writeFileSync } = require("fs");

const raiz = path.join(__dirname, "src");
const { ChatbotEngine, MAX_BOTOES_POR_MENSAGEM, AGUARDANDO, DESCRICAO_LINHA_INVISIVEL } = require(
  path.join(raiz, "modules/chatbot/chatbot.engine")
);

// "Sobrou alguma coisa LEGÍVEL aqui?" -- ignorando o zero-width space, que só
// existe para a Evolution não recusar a linha (ver DESCRICAO_LINHA_INVISIVEL).
const temTextoVisivel = (v) => String(v ?? "").replace(/[\u200B\s]/g, "") !== "";

// ── o fluxo, convertido pelo import do front ─────────────────────────────────
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
const fluxo = {
  id: "f-arka",
  nome: convertido.nome,
  gatilho: convertido.gatilho,
  ativo: true,
  passos: convertido.passos.map((p) => ({
    id: p.id, tipo: p.tipo, titulo: p.titulo, descricao: p.desc,
    texto: p.texto || null, config: p.config || null,
    targetId: p.targetId, ordem: p.ordem,
  })),
};

const erros = [];
const check = (cond, msg) => { if (!cond) erros.push(msg); return !!cond; };

/**
 * Um ambiente onde TODA chamada à Evolution é gravada com o payload.
 *
 * `parceiro` permite percorrer o caminho de quem tem contrato (sem ele todo CNPJ
 * cai no avulso e a confirmação de cadastro nunca é enviada).
 */
function ambiente({ parceiro = null } = {}) {
  const enviados = [];
  const conversa = {
    id: "c-visual", instanciaId: "i", cliente: "David", telefone: "5527999990000",
    statusAtendimento: "pendente", setor: "Geral", cnpj: null, empresa: null,
    cnpjVerificado: false, mensagens: [],
  };
  let sessao = null;

  const engine = new ChatbotEngine({
    fluxoRepository: {
      findAtivos: async () => [fluxo],
      findById: async () => fluxo,
      findByGatilho: async () => null,
      createLog: async () => {},
    },
    conversaRepository: {
      findById: async () => conversa,
      findByIdParaEvento: async () => conversa,
      findByTelefone: async () => conversa,
      findByTelefoneParaMotor: async () => conversa,
      existeMensagemWa: async () => false,
      create: async () => conversa,
      addMensagem: async (_i, origem, texto) => {
        conversa.mensagens.push({ origem, texto, criadoEm: new Date() });
        return { id: `m${conversa.mensagens.length}` };
      },
      vincularWaMessageId: async () => {},
      update: async (_i, d) => Object.assign(conversa, d),
      atualizarAtendimentoAtual: async () => null,
      garantirAtendimentoAberto: async () => ({ atendimento: null, nova: false }),
      ultimoCnpjDoTelefone: async () => null,
      respondeuDepoisDe: async () => false,
    },
    sessaoRepository: {
      findByTelefone: async () => sessao,
      findByConversa: async () => sessao,
      upsert: async (instanciaId, conversaId, telefone, dados) => {
        sessao = { id: "s", instanciaId, conversaId, telefone, ...(sessao || {}), ...dados, atualizadoEm: new Date() };
        return sessao;
      },
      update: async (_i, d) => { sessao = { ...sessao, ...d }; return sessao; },
    },
    parceiroRepository: {
      findAtivoByCnpj: async (cnpj) => {
        if (!parceiro) return null;
        const so = (v) => String(v || "").replace(/[^0-9]/g, "");
        return so(cnpj) === so(parceiro.cnpj) ? parceiro : null;
      },
    },
    // ── A INTERCEPTAÇÃO ────────────────────────────────────────────────────
    evolutionApi: {
      sendText: async (_tel, texto) => {
        enviados.push({ tipo: "texto", texto, botoes: [] });
        return { key: { id: "x" } };
      },
      sendButtons: async (_tel, payload) => {
        enviados.push({
          tipo: "botoes",
          texto: payload.description,
          rodape: payload.footer,
          botoes: (payload.buttons || []).map((b) => b.displayText),
        });
        return { key: { id: "x" } };
      },
      sendList: async (_tel, payload) => {
        enviados.push({
          tipo: "lista",
          texto: payload.description,
          rodape: payload.footerText,
          botao: payload.buttonText,
          botoes: (payload.sections?.[0]?.rows || []).map((r) => r.title),
          // A DESCRIÇÃO DE CADA LINHA IMPORTA, e não é detalhe de payload: o
          // WhatsApp devolve `title` + `description` na resposta do cliente e
          // desenha OS DOIS na bolha dele. Sem guardar isto aqui, o teste não
          // teria como ver o texto que sobra grudado na resposta.
          descricoes: (payload.sections?.[0]?.rows || []).map((r) => r.description),
        });
        return { key: { id: "x" } };
      },
      sendPoll: async (_tel, payload) => {
        enviados.push({ tipo: "enquete", texto: payload.name, botoes: payload.values || [] });
        return { key: { id: "x" } };
      },
      fetchProfilePictureUrl: async () => null,
    },
    configuracaoService: {
      modoAtendimento: async () => "local",
      horarioAtendimento: async () => ({ ativo: false }),
      filasParaSetor: async () => ({ 33: "Técnico", 35: "Comercial" }),
      pesquisaSatisfacao: async () => ({ ativo: false }),
    },
    bus: { emitConversa: () => {} },
  });

  let n = 0;
  const cliente = async (texto) => {
    const antes = enviados.length;
    await engine.processarMensagemEntrada({
      instanciaId: "i", instanceName: "arka", telefone: conversa.telefone,
      texto, nomeCliente: "David", waMessageId: `wa-${++n}`,
    });
    return enviados.slice(antes);
  };

  return { engine, cliente, enviados, get sessao() { return sessao; }, conversa };
}

// ── O ROTEIRO, e o que cada resposta do bot DEVE ser ─────────────────────────
//
// `botoes` é a contagem exigida (0 = nenhum botão pode aparecer). É a tradução
// direta do item 27 do pedido.
const CENARIOS = [
  {
    titulo: "Técnico com contrato",
    parceiro: { cnpj: "11222333000181", razaoSocial: "METALURGICA HORIZONTE LTDA" },
    turnos: [
      { entrada: "oi", bloco: "MENU PRINCIPAL", botoes: 3 },
      { entrada: "1", bloco: "TÉCNICO", botoes: 3 },
      { entrada: "1", bloco: "CNPJ", botoes: 0 },
      { entrada: "11.222.333/0001-81", bloco: "CONFIRMA CNPJ", botoes: 2 },
      { entrada: "1", bloco: "IDENTIFICAÇÃO", botoes: 0 },
      { entrada: "David TI", bloco: "DESCRIÇÃO DA SOLICITAÇÃO", botoes: 0 },
      { entrada: "Meu computador não consegue acessar o sistema.", bloco: "FILA TÉCNICA", botoes: 0 },
    ],
  },
  {
    titulo: "Técnico avulso",
    turnos: [
      { entrada: "oi", bloco: "MENU PRINCIPAL", botoes: 3 },
      { entrada: "1", bloco: "TÉCNICO", botoes: 3 },
      { entrada: "2", bloco: "AVULSO VALORES", botoes: 3 },
      { entrada: "1", bloco: "AVULSO DADOS", botoes: 0 },
      { entrada: "David, preciso de suporte na rede.", bloco: "FILA TÉCNICA", botoes: 0 },
    ],
  },
  {
    titulo: "Comercial",
    turnos: [
      { entrada: "oi", bloco: "MENU PRINCIPAL", botoes: 3 },
      { entrada: "2", bloco: "COMERCIAL DADOS", botoes: 0 },
      { entrada: "David, preciso de um orçamento para 10 notebooks.", bloco: "FILA COMERCIAL", botoes: 0 },
    ],
  },
  {
    titulo: "Financeiro",
    turnos: [
      { entrada: "oi", bloco: "MENU PRINCIPAL", botoes: 3 },
      { entrada: "3", bloco: "FINANCEIRO DADOS", botoes: 0 },
      { entrada: "Ana, segunda via do boleto.", bloco: "FILA FINANCEIRO", botoes: 0 },
    ],
  },
];

(async () => {
  const paraHtml = [];

  for (const cenario of CENARIOS) {
    console.log(`\n╔══ ${cenario.titulo} ${"═".repeat(Math.max(0, 52 - cenario.titulo.length))}`);
    const amb = ambiente({ parceiro: cenario.parceiro || null });
    const turnosHtml = [];

    for (const t of cenario.turnos) {
      const saida = await amb.cliente(t.entrada);

      // A última mensagem do turno é a que fecha o passo (as anteriores são
      // avisos: "não encontramos esse CNPJ", por exemplo).
      const ultima = saida[saida.length - 1] || { tipo: "nenhuma", texto: "", botoes: [] };
      const qtd = ultima.botoes.length;

      const ok = check(
        qtd === t.botoes,
        `${cenario.titulo} / "${t.bloco}": ${qtd} botão(ões) no WhatsApp, esperado ${t.botoes}` +
          (qtd ? ` [${ultima.botoes.join(" | ")}]` : "")
      );
      // Nada pode estourar o teto do protocolo, em nenhuma das mensagens.
      for (const m of saida) {
        if (m.tipo === "botoes") {
          check(
            m.botoes.length <= MAX_BOTOES_POR_MENSAGEM,
            `${cenario.titulo} / "${t.bloco}": ${m.botoes.length} botões numa mensagem (a Evolution recusa acima de ${MAX_BOTOES_POR_MENSAGEM})`
          );
        }
      }
      // ── E O RODAPÉ "SELECIONE UMA OPÇÃO" TAMBÉM NÃO PODE APARECER ───────
      //
      // Ele vem junto do card de botões/lista. Num bloco de texto livre ele
      // seria a mesma instrução equivocada que o botão: manda escolher o que
      // não há o que escolher.
      if (t.botoes === 0) {
        check(
          !saida.some((m) => m.rodape),
          `${cenario.titulo} / "${t.bloco}": saiu com rodapé de menu ("${saida.find((m) => m.rodape)?.rodape}")`
        );
        check(
          saida.every((m) => m.tipo === "texto"),
          `${cenario.titulo} / "${t.bloco}": deveria ser texto puro, veio ${saida.map((m) => m.tipo).join("+")}`
        );
      }

      // ── A ESCOLHA NÃO PODE SER OFERECIDA DUAS VEZES ────────────────────
      //
      // O card de botões traz o TEXTO do bloco como corpo, e o bloco lista as
      // opções numeradas (é a reserva para quando o botão não sai). Se
      // `_corpoInterativo` falhar em removê-las, o cliente recebe os três botões
      // E a lista "1️⃣ ... 2️⃣ ... 3️⃣ ..." logo abaixo -- a mesma escolha duas
      // vezes. Já quebrou duas vezes por suposição sobre como o menu está
      // escrito (com traço/sem traço, negrito antes do número).
      if (t.botoes > 0) {
        const corpo = ultima.texto || "";
        const numeradas = corpo
          .split("\n")
          .filter((l) => /^[ \t]*[*_~]*[ \t]*\d/u.test(l));
        check(
          numeradas.length === 0,
          `${cenario.titulo} / "${t.bloco}": o card de botões repetiu a lista numerada no corpo (${numeradas.map((l) => l.trim()).join(" / ")})`
        );
      }

      const marca = qtd
        ? `${qtd} botão(ões) [${ultima.botoes.join(" | ")}]`
        : ultima.tipo === "texto"
          ? "TEXTO PURO (sem botões, sem rodapé)"
          : `${ultima.tipo}`;
      console.log(`  ${ok ? "OK   " : "FALHA"} "${t.bloco}".padEnd  ->  ${marca}`.replace('".padEnd  ->', '"  ->'));

      turnosHtml.push({ entrada: t.entrada, bloco: t.bloco, mensagens: saida });
    }

    paraHtml.push({ titulo: cenario.titulo, turnos: turnosHtml });
  }

  // ── UM BLOCO COM 4 BOTÕES NÃO PODE SAIR COMO BOTÕES ────────────────────────
  //
  // O motor mentia aqui: pedindo `exibicao: "buttons"` com 4 opções ele
  // registrava "vai em várias bolhas" e mandava as 4 num payload só -- a
  // Evolution devolvia 400 e o cliente recebia texto numerado. Este caso
  // constrói exatamente essa situação e cobra a decisão nova (lista).
  console.log("\n╔══ o teto de 3 botões é respeitado mesmo com o fluxo errado ══");
  {
    const amb = ambiente();
    const opcoes = [1, 2, 3, 4].map((i) => ({
      id: `x${i}`, ordem: i - 1, esperaEscolha: true,
      rotulo: `${i},opcao ${i}`, palavrasChave: [String(i)], acao: "ir",
      targetId: null, botao: `Opção ${i}`,
    }));
    await amb.engine.enviarBotComOpcoes(
      "c-visual", "5527999990000", "Escolha:", opcoes, "arka", { exibicao: "buttons" }
    );
    const m = amb.enviados[amb.enviados.length - 1];
    check(
      m.tipo === "lista",
      `4 opções pedindo "buttons" deveriam sair como LISTA, saiu como ${m.tipo}`
    );
    check(m.botoes.length === 4, `a lista deveria trazer as 4 opções, trouxe ${m.botoes.length}`);
    console.log(`  ${m.tipo === "lista" ? "OK   " : "FALHA"} 4 opções + exibicao:"buttons"  ->  ${m.tipo} com ${m.botoes.length} itens`);

    // E com 3, botões de verdade.
    await amb.engine.enviarBotComOpcoes(
      "c-visual", "5527999990000", "Escolha:", opcoes.slice(0, 3), "arka", { exibicao: "buttons" }
    );
    const m3 = amb.enviados[amb.enviados.length - 1];
    check(m3.tipo === "botoes" && m3.botoes.length === 3, `3 opções deveriam sair como 3 botões, veio ${m3.tipo}/${m3.botoes.length}`);
    console.log(`  ${m3.tipo === "botoes" ? "OK   " : "FALHA"} 3 opções + exibicao:"buttons"  ->  ${m3.tipo} com ${m3.botoes.length} botões`);
  }

  // ── A LISTA NÃO CARIMBA TEXTO DE MENU NA RESPOSTA DO CLIENTE ───────────────
  //
  // Ao tocar numa linha, o WhatsApp monta a resposta com o `title` E a
  // `description` da linha, e desenha os dois na bolha que sai do aparelho do
  // cliente. Com "Toque para selecionar" ali, a pesquisa de satisfação chegava
  // assim no celular de quem tinha acabado de responder:
  //
  //     5 (emoji)
  //     Toque para selecionar
  //
  // Do nosso lado nada aparecia -- `extrairTexto` lê só o `title` --, e é por
  // isso que o defeito sobreviveu: ele existia inteiro na tela do cliente. E a
  // descrição não pode simplesmente sumir: a Evolution valida `minLength: 1` e
  // devolve 400 sem ela, o `catch` derruba o menu para texto puro. Daí o
  // invisível, que satisfaz a API sem escrever nada.
  console.log("\n╔══ a lista não carimba texto de menu na resposta do cliente ══");
  {
    const amb = ambiente();

    // A PESQUISA DE SATISFAÇÃO é o caso do relato: 5 notas não cabem em 3
    // botões, então ela SEMPRE sai como lista.
    await amb.engine._enviarComBotoesFixos(
      "c-visual",
      "5527999990000",
      "Antes de encerrar: de 1 a 5, que nota você dá para este atendimento?",
      AGUARDANDO.AVALIACAO_NOTA,
      "arka",
      { exibicao: "auto" }
    );
    const nota = amb.enviados[amb.enviados.length - 1];
    check(nota.tipo === "lista", `as 5 notas deveriam sair como LISTA, saiu ${nota.tipo}`);
    check(nota.botoes.length === 5, `a lista de notas deveria ter 5 linhas, tem ${nota.botoes.length}`);
    const notaSuja = (nota.descricoes || []).filter(temTextoVisivel);
    const okNota = check(
      notaSuja.length === 0,
      `a resposta do cliente sairia com texto colado embaixo da nota: ${JSON.stringify(notaSuja)}`
    );
    console.log(
      `  ${okNota ? "OK   " : "FALHA"} pesquisa 1..5  ->  lista com ${nota.botoes.length} ` +
        `linhas e nenhuma descrição visível`
    );

    // E o mesmo vale para QUALQUER lista, não só a da pesquisa.
    const opcoes = [1, 2, 3, 4].map((i) => ({
      id: `y${i}`, ordem: i - 1, esperaEscolha: true,
      rotulo: `${i},opcao ${i}`, palavrasChave: [String(i)], acao: "ir",
      targetId: null, botao: `Opção ${i}`,
    }));
    await amb.engine.enviarBotComOpcoes(
      "c-visual", "5527999990000", "Escolha:", opcoes, "arka", { exibicao: "list" }
    );
    const menu = amb.enviados[amb.enviados.length - 1];
    const menuSujo = (menu.descricoes || []).filter(temTextoVisivel);
    const okMenu = check(
      menuSujo.length === 0,
      `menu em lista deixaria texto colado na resposta do cliente: ${JSON.stringify(menuSujo)}`
    );
    console.log(`  ${okMenu ? "OK   " : "FALHA"} menu de 4 opções em lista  ->  nenhuma descrição visível`);

    // A OUTRA METADE, e ela é a razão de o texto de enchimento ter existido: a
    // Evolution recusa a linha com descrição VAZIA. Um invisível que um `trim()`
    // no caminho apagasse reintroduziria o 400 -- e o menu inteiro cairia para
    // texto puro, calado. U+200B sobrevive ao trim; um espaço comum, não.
    const okTrim = check(
      DESCRICAO_LINHA_INVISIVEL.trim().length >= 1,
      `a descrição invisível vira vazia num trim() e a Evolution devolveria 400: ` +
        `${JSON.stringify(DESCRICAO_LINHA_INVISIVEL)}`
    );
    console.log(`  ${okTrim ? "OK   " : "FALHA"} a descrição invisível ainda satisfaz o minLength:1 da Evolution`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEM BOTÃO INTERATIVO, O CLIENTE AINDA TEM COMO ESCOLHER
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Este é o caso que quase passou batido. `enviarBotComOpcoes` manda TEXTO PURO
  // em duas situações reais:
  //
  //   - a instalação roda sem `WHATSAPP_BOTOES_INTERATIVOS` (é o padrão do
  //     motor, conservador de propósito);
  //   - a Evolution recusa o payload interativo e o `catch` cai no texto.
  //
  // Nos dois casos o que sai é o TEXTO DO BLOCO, inteiro. Um menu cujo texto
  // fosse só "Como podemos ajudar?" chegaria sem opção nenhuma -- o cliente não
  // teria o que responder, erraria, e em 5 minutos a inatividade encerraria o
  // chamado. Por isso cada bloco de menu lista as opções numeradas no texto.
  console.log("\n╔══ sem botão interativo, o cliente ainda tem como escolher ══");
  {
    // ── O CASO QUE QUASE PASSOU BATIDO ─────────────────────────────────────
    //
    // `enviarBotComOpcoes` manda TEXTO PURO em duas situações reais: a
    // instalação sem `WHATSAPP_BOTOES_INTERATIVOS` (padrão conservador do motor,
    // furado por `exibicao: "buttons"` no bloco) e a Evolution recusando o
    // payload interativo -- aí o `catch` cai em `sendText(texto)`.
    //
    // O que sai nesses casos é o TEXTO DO BLOCO, inteiro. Um menu cujo texto
    // fosse só "Como podemos ajudar?" chegaria sem opção nenhuma: o cliente não
    // teria o que responder, erraria, e em 5 minutos a inatividade encerraria o
    // chamado. Por isso cada bloco de menu lista as opções numeradas no texto.
    //
    // Duas metades, e as duas são necessárias:
    //
    //   ESTÁTICA -- o texto de cada bloco de menu numera tantas opções quantos
    //   botões ele tem. É a garantia de que a reserva EXISTE.
    //
    //   DINÂMICA -- com a Evolution recusando, a mensagem que chega ao cliente é
    //   esse texto com os números. É a garantia de que a reserva É USADA.
    //
    // E o par com a checagem de cima ("o card não repete a lista") fecha o
    // cerco: a lista está no texto, sai quando o botão falha, e não aparece
    // duplicada quando o botão funciona.
    const engineEstatico = new ChatbotEngine();
    for (const p of fluxo.passos) {
      const botoes = engineEstatico
        .opcoesDoPasso(p)
        .filter((o) => engineEstatico._opcaoEhEscolha(o));
      if (!botoes.length) continue;

      const numeradas = String(p.texto || "")
        .split("\n")
        .filter((l) => /^[ \t]*[*_~]*[ \t]*\d[\uFE0F\u20E3]/u.test(l));
      const ok = check(
        numeradas.length === botoes.length,
        `"${p.titulo}": ${botoes.length} botões mas ${numeradas.length} opções numeradas no texto ` +
          `-- sem botão interativo o cliente ficaria sem saber o que responder`
      );
      console.log(
        `  ${ok ? "OK   " : "FALHA"} "${p.titulo}"  ->  ${botoes.length} botões e ` +
          `${numeradas.length} opções numeradas de reserva no texto`
      );
    }

    // A METADE DINÂMICA: a Evolution recusa, e o cliente recebe o menu numerado.
    const amb = ambiente();
    amb.engine.deps.evolutionApi.sendButtons = async () => {
      throw new Error("400 Maximum of 3 reply buttons allowed (simulado)");
    };
    const saida = await amb.cliente("oi");
    const caiu = saida[saida.length - 1];
    const linhas = String(caiu?.texto || "").split("\n");
    const temNumeros = ["1", "2", "3"].every((n) =>
      linhas.some((l) => new RegExp(`^[ \t]*${n}[\uFE0F\u20E3]`, "u").test(l))
    );
    const okFallback = check(
      caiu?.tipo === "texto" && temNumeros,
      `com a Evolution recusando os botões, o cliente deveria receber o menu numerado; ` +
        `veio ${caiu?.tipo} (números presentes: ${temNumeros})`
    );
    console.log(
      `  ${okFallback ? "OK   " : "FALHA"} Evolution recusa os botões  ->  ` +
        `${caiu?.tipo} com as 3 opções numeradas`
    );
  }

  // ── O HTML DE CONFERÊNCIA ──────────────────────────────────────────────────
  const esc = (s) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // *negrito* do WhatsApp -> <strong>, para a bolha parecer com a de verdade.
  const wa = (s) => esc(s).replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verificação visual fluxo ARKA no WhatsApp</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:#0b141a; color:#e9edef; padding:24px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#8696a0; font-size:13px; margin:0 0 24px; }
  .cenarios { display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start; }
  .cenario { background:#111b21; border:1px solid #222d34; border-radius:14px;
             width:min(100%,360px); overflow:hidden; }
  .cenario h2 { font-size:14px; margin:0; padding:12px 14px; background:#202c33;
                border-bottom:1px solid #222d34; }
  .chat { padding:14px; display:flex; flex-direction:column; gap:8px;
          background:#0b141a; }
  .b { max-width:88%; padding:7px 10px; border-radius:10px; font-size:13.5px;
       white-space:normal; word-break:break-word; }
  .cli { align-self:flex-end; background:#005c4b; border-bottom-right-radius:3px; }
  .bot { align-self:flex-start; background:#202c33; border-bottom-left-radius:3px; }
  .btns { display:flex; flex-direction:column; gap:4px; margin-top:8px;
          border-top:1px solid #2a3942; padding-top:8px; }
  .btn { text-align:center; color:#53bdeb; font-size:13px; font-weight:600;
         padding:6px; border-radius:6px; background:#1d282f; }
  .rodape { color:#8696a0; font-size:11px; margin-top:6px; }
  .marca { align-self:flex-start; font-size:10.5px; color:#8696a0;
           letter-spacing:.02em; text-transform:uppercase; margin-top:4px; }
  .ok { color:#7ee0a0; } .nao { color:#f2a2a2; }
  footer { color:#8696a0; font-size:12px; margin-top:24px; max-width:70ch; }
</style></head><body>
<h1>Fluxo ARKA o que o cliente vê no WhatsApp</h1>
<p class="sub">Bolhas montadas a partir do <strong>payload real</strong> enviado à Evolution API,
capturado do motor (<code>verificar-visual-whatsapp.js</code>). Botão desenhado = botão
que sai de verdade.</p>
<div class="cenarios">
${paraHtml
  .map(
    (c) => `  <section class="cenario">
    <h2>${esc(c.titulo)}</h2>
    <div class="chat">
${c.turnos
  .map((t) => {
    const cli = `      <div class="b cli">${wa(t.entrada)}</div>`;
    const bots = t.mensagens
      .map((m) => {
        const btns = m.botoes.length
          ? `<div class="btns">${m.botoes.map((b) => `<div class="btn">${esc(b)}</div>`).join("")}</div>` +
            (m.rodape ? `<div class="rodape">${esc(m.rodape)}</div>` : "")
          : "";
        return `      <div class="b bot">${wa(m.texto)}${btns}</div>`;
      })
      .join("\n");
    const qtd = t.mensagens[t.mensagens.length - 1]?.botoes.length || 0;
    const marca = `      <div class="marca">${esc(t.bloco)}  <span class="${qtd ? "ok" : "ok"}">${
      qtd ? `${qtd} botão(ões)` : "texto livre, sem botões"
    }</span></div>`;
    return [cli, bots, marca].join("\n");
  })
  .join("\n")}
    </div>
  </section>`
  )
  .join("\n")}
</div>
<footer>
As bolhas do cliente aparecem à direita; as do bot, à esquerda. Onde não há botão
desenhado, o motor enviou <code>sendText</code>  texto puro, sem card interativo
e sem o rodapé “Selecione uma opção”. É o que o item 27 do pedido exige para
Identificação, Descrição, Dados Comercial, Dados Financeiro e Dados Avulso.
</footer>
</body></html>
`;

  const destino = path.join(__dirname, "..", "docs", "verificacao-visual-arka.html");
  writeFileSync(destino, html, "utf8");
  console.log(`\n✓ conferência visual: ${path.relative(path.join(__dirname, ".."), destino)}`);

  console.log(
    "\n" +
      (erros.length
        ? `FALHAS (${erros.length}):\n  - ` + erros.join("\n  - ")
        : "VISUAL WHATSAPP: TODAS AS VERIFICACOES PASSARAM")
  );
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error("ERRO", e); process.exit(1); });
