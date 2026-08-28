/**
 * DOIS ATENDENTES DO MESMO SETOR, NA MESMA CONVERSA.
 *
 * ── A PERGUNTA QUE ESTE ARQUIVO RESPONDE ───────────────────────────────────
 *
 * "Se eu sou Tecnico e meu colega tambem, ele consegue entrar na mesma conversa
 * que eu? Sem conflito?"
 *
 * Sao tres perguntas diferentes, e as respostas nao sao iguais:
 *
 *   VER      os dois veem, sempre. Setor igual, acesso igual.
 *   ABRIR    os dois abrem e leem o historico inteiro, a qualquer momento.
 *   ATENDER  so UM fica marcado como responsavel. Isso nao e um bloqueio: e um
 *            RÓTULO, para a equipe saber quem esta cuidando e o cliente nao
 *            receber duas respostas diferentes para a mesma pergunta.
 *
 * E a parte que costuma surpreender: quem NAO e o responsavel continua podendo
 * responder. O sistema nao tranca a conversa -- ele so nao deixa a autoria
 * trocar de dono no meio do caminho ("nao rouba conversa de ninguem"). Um
 * colega passar e ajudar e caso normal de atendimento; travar isso atrapalharia
 * mais do que ajuda.
 *
 * Cria e apaga os proprios registros. Nenhuma conta ou conversa real e tocada.
 *
 *   cd server && node verificar-dois-atendentes.js
 */
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const bcrypt = require("bcryptjs");
const prisma = require("./src/infrastructure/database/prisma.client");
const createApp = require("./src/app");
const conversaService = require("./src/modules/conversas/conversa.service");
const conversaRepository = require("./src/infrastructure/repositories/conversa.repository");

const MARCA = "teste-dois";
const SENHA = "SenhaCerta#2026";
const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (ok, rotulo) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  if (!ok) erros.push(`[${secao}] ${rotulo}`);
};

let base = "";
let servidor = null;

async function logar(email) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.5, 10.0.0.1" },
    body: JSON.stringify({ email, senha: SENHA }),
  });
  const j = await r.json();
  return j?.data?.token;
}
async function pedir(caminho, { metodo = "GET", corpo, token } = {}) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.5, 10.0.0.1",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* nao-JSON */ }
  return { status: r.status, json, texto };
}

(async () => {
  const criados = { usuarios: [], conversas: [] };
  try {
    const app = createApp();
    await new Promise((res) => { servidor = app.listen(0, "127.0.0.1", res); });
    base = `http://127.0.0.1:${servidor.address().port}`;

    const senhaHash = await bcrypt.hash(SENHA, 10);
    const criarTecnico = async (apelido) => {
      const u = await prisma.usuario.create({
        data: { nome: `Tecnico ${apelido}`, email: `${MARCA}-${apelido}@exemplo.invalido`,
          senhaHash, cargo: "Técnico", ativo: true },
      });
      criados.usuarios.push(u.id);
      return u;
    };
    // `instanciaId` e obrigatorio no schema: usa a instancia que ja existe.
    const instancia = await prisma.instancia.findFirst();
    if (!instancia) throw new Error("sem instancia no banco -- rode o seed");

    const eu = await criarTecnico("eu");
    const colega = await criarTecnico("colega");

    const conversa = await prisma.conversa.create({
      data: {
        instanciaId: instancia.id, telefone: "5511900000001", cliente: `${MARCA}-cliente`,
        setor: "Técnico", statusAtendimento: "pendente", atendenteId: null,
      },
    });
    criados.conversas.push(conversa.id);

    const tokenEu = await logar(eu.email);
    const tokenColega = await logar(colega.email);

    // ─────────────────────────────────────────────────────────────────────
    titulo("1. Os dois VEEM a conversa na lista");
    const listaEu = await pedir("/api/conversas", { token: tokenEu });
    const listaColega = await pedir("/api/conversas", { token: tokenColega });
    check(listaEu.texto.includes(conversa.id), "eu vejo");
    check(listaColega.texto.includes(conversa.id), "meu colega ve a MESMA conversa");

    // ─────────────────────────────────────────────────────────────────────
    titulo("2. Os dois ABREM e leem o historico");
    const abriEu = await pedir(`/api/conversas/${conversa.id}`, { token: tokenEu });
    const abriuColega = await pedir(`/api/conversas/${conversa.id}`, { token: tokenColega });
    check(abriEu.status === 200, `eu abro -> ${abriEu.status}`);
    check(abriuColega.status === 200, `meu colega abre -> ${abriuColega.status}`);

    // ─────────────────────────────────────────────────────────────────────
    titulo("3. ATENDER: so um fica como responsavel");
    // Os dois clicam JUNTOS. Quem decide e o banco, num UPDATE condicional --
    // sem isso os dois receberiam 200 e cada um veria a conversa como sua.
    const [a, b] = await Promise.all([
      pedir(`/api/conversas/${conversa.id}/atender`, { metodo: "POST", token: tokenEu }),
      pedir(`/api/conversas/${conversa.id}/atender`, { metodo: "POST", token: tokenColega }),
    ]);
    const vencedores = [a, b].filter((r) => r.status === 200).length;
    const perdedores = [a, b].filter((r) => r.status === 409).length;
    check(vencedores === 1, `exatamente UM assumiu (200: ${vencedores})`);
    check(perdedores === 1, `o outro recebeu 409, e nao um 200 mentiroso (409: ${perdedores})`);

    const perdedor = [a, b].find((r) => r.status === 409);
    check(
      /assumiu esta conversa primeiro/i.test(perdedor?.json?.error?.message || ""),
      `e a mensagem diz QUEM assumiu: "${(perdedor?.json?.error?.message || "").slice(0, 60)}"`
    );

    const noBanco = await conversaRepository.findById(conversa.id);
    check(!!noBanco.atendenteId, "o banco gravou um responsavel");

    // ─────────────────────────────────────────────────────────────────────
    titulo("4. Clicar de novo NAO da conflito com voce mesmo");
    // Reconexao, F5, clique duplo: o dono reassumindo tem de passar liso.
    const donoId = noBanco.atendenteId;
    const tokenDono = donoId === eu.id ? tokenEu : tokenColega;
    const denovo = await pedir(`/api/conversas/${conversa.id}/atender`, { metodo: "POST", token: tokenDono });
    check(denovo.status === 200, `o proprio dono reassume -> ${denovo.status}`);

    // ─────────────────────────────────────────────────────────────────────
    titulo("5. Quem NAO e o dono continua podendo trabalhar na conversa");
    // O ponto que costuma surpreender: nao ha tranca. O colega le tudo, e a
    // regra so impede que a AUTORIA troque de dono no meio do caminho.
    const tokenOutro = donoId === eu.id ? tokenColega : tokenEu;
    const outroLe = await pedir(`/api/conversas/${conversa.id}`, { token: tokenOutro });
    check(outroLe.status === 200, `quem nao assumiu continua lendo -> ${outroLe.status}`);

    // A regra de autoria, direto na fonte: com a conversa ja tendo dono,
    // registrar atendente NAO troca o responsavel.
    const outroId = donoId === eu.id ? colega.id : eu.id;
    await conversaService._registrarAtendente(
      await conversaRepository.findById(conversa.id), "equipe", { sub: outroId }
    );
    const depois = await conversaRepository.findById(conversa.id);
    check(depois.atendenteId === donoId, "responder nao ROUBA a conversa de quem ja atende");

    // ─────────────────────────────────────────────────────────────────────
    titulo("5b. RESPONDER: o colega envia numa conversa que NAO e dele");
    //
    // O pedido da equipe: "todos do mesmo cargo conseguem responder". Ler ja
    // estava provado acima; falta a ESCRITA, que e o que importa no dia a dia.
    //
    // O envio nao chega a sair daqui: falar com a Evolution exige WhatsApp
    // conectado, e num teste isso nao existe. Mas o que se quer medir acontece
    // ANTES: se a autorizacao recusasse, a resposta seria 403 (setor) ou 409
    // (conversa nao aberta / ja atendida). Qualquer outro desfecho significa que
    // a requisicao PASSOU pelos guards e morreu no envio externo -- que e
    // exatamente o que se quer saber.
    const envio = await pedir(`/api/conversas/${conversa.id}/mensagens`, {
      metodo: "POST", token: tokenOutro, corpo: { texto: "posso ajudar aqui?" },
    });
    const recusadoPorAutorizacao = envio.status === 403 || envio.status === 409;
    check(!recusadoPorAutorizacao,
      `nao foi barrado por ser de outro (status ${envio.status}${
        recusadoPorAutorizacao ? " -- BARRADO: " + (envio.json?.error?.message || "") : " -- passou os guards"
      })`);

    // E o dono NAO muda por causa disso: ajudar nao e tomar a conversa.
    const aposEnvio = await conversaRepository.findById(conversa.id);
    check(aposEnvio.atendenteId === donoId, "e o responsavel continua sendo quem assumiu");

    // ─────────────────────────────────────────────────────────────────────
    titulo("5c. Conversa PENDENTE: e preciso assumir antes de responder");
    //
    // Isto NAO e sobre quem: qualquer Tecnico pode clicar em Atender. E sobre o
    // ESTADO da conversa -- ninguem responde um chamado que ainda esta na fila
    // sem tira-lo da fila, senao o cliente recebe resposta de uma conversa que
    // continua aparecendo como "nao atendida" para o resto da equipe.
    const naFila = await prisma.conversa.create({
      data: { instanciaId: instancia.id, telefone: "5511900000003", cliente: `${MARCA}-cliente3`,
        setor: "Técnico", statusAtendimento: "pendente", atendenteId: null },
    });
    criados.conversas.push(naFila.id);

    const semAssumir = await pedir(`/api/conversas/${naFila.id}/mensagens`, {
      metodo: "POST", token: tokenOutro, corpo: { texto: "oi" },
    });
    check(semAssumir.status === 409,
      `responder sem assumir -> ${semAssumir.status} ("${(semAssumir.json?.error?.message || "").slice(0, 45)}")`);

    // Mas assumir esta liberado para QUALQUER Tecnico -- inclusive o que nao
    // "descobriu" a conversa primeiro.
    const qualquerUmAssume = await pedir(`/api/conversas/${naFila.id}/atender`, {
      metodo: "POST", token: tokenOutro,
    });
    check(qualquerUmAssume.status === 200,
      `qualquer Tecnico consegue assumir uma da fila -> ${qualquerUmAssume.status}`);

    // ─────────────────────────────────────────────────────────────────────
    titulo("6. Conversa sem dono: quem responde primeiro vira o atendente");
    const solta = await prisma.conversa.create({
      data: { instanciaId: instancia.id, telefone: "5511900000002", cliente: `${MARCA}-cliente2`,
        setor: "Técnico", statusAtendimento: "pendente", atendenteId: null },
    });
    criados.conversas.push(solta.id);
    await conversaService._registrarAtendente(
      await conversaRepository.findById(solta.id), "equipe", { sub: colega.id }
    );
    const soltaDepois = await conversaRepository.findById(solta.id);
    check(soltaDepois.atendenteId === colega.id,
      "sem responsavel, quem age assume (nao precisa clicar em Atender antes)");
  } catch (e) {
    console.error("\nERRO NO TESTE:", e.stack || e.message);
    erros.push("excecao: " + e.message);
  } finally {
    if (servidor) servidor.close();
    for (const id of criados.conversas) {
      await prisma.mensagem.deleteMany({ where: { conversaId: id } }).catch(() => {});
      await prisma.atendimento.deleteMany({ where: { conversaId: id } }).catch(() => {});
      await prisma.sessaoChatbot.deleteMany({ where: { conversaId: id } }).catch(() => {});
      await prisma.conversa.delete({ where: { id } }).catch(() => {});
    }
    if (criados.usuarios.length) {
      await prisma.sessaoRefresh.deleteMany({ where: { usuarioId: { in: criados.usuarios } } }).catch(() => {});
      await prisma.usuario.deleteMany({ where: { id: { in: criados.usuarios } } }).catch(() => {});
    }
    const sobra =
      (await prisma.usuario.count({ where: { email: { startsWith: MARCA } } }).catch(() => -1)) +
      (await prisma.conversa.count({ where: { cliente: { startsWith: MARCA } } }).catch(() => -1));
    check(sobra === 0, `limpeza completa (sobraram ${sobra} registros)`);
    await prisma.$disconnect();
    console.log(
      "\n" + (erros.length
        ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
        : "DOIS ATENDENTES: TUDO CONFERE")
    );
    process.exit(erros.length ? 1 : 0);
  }
})();
