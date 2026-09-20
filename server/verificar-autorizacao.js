/**
 * AUTORIZAÇÃO: quem é você, e o que é seu.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * `verificar-escopo-dados.js` já pergunta se um SETOR enxerga o outro. Este
 * pergunta as outras três, que ninguém estava fazendo:
 *
 *   1. A IDENTIDADE VEM DO BANCO?  O `authMiddleware` relê cargo, `ativo` e a
 *      sessão a cada requisição, de propósito -- desativar uma conta vale já,
 *      e não quando o JWT vencer (até 8h depois). Isso é uma escolha de
 *      desenho, e escolha sem teste é comentário: basta alguém "otimizar" o
 *      middleware para ler `payload.cargo` e o sistema volta a confiar num
 *      papel assinado há horas. Aqui o token é forjado COM O SEGREDO CERTO
 *      dizendo `cargo: "Administrador"` -- se o servidor acreditar, passa.
 *
 *   2. O QUE É DE UM É DE UM?  Relatório de visita é o recurso mais pessoal do
 *      sistema (ele vira pontuação e prêmio). Dois técnicos do MESMO cargo e
 *      da MESMA equipe passam pelas mesmas portas -- a única coisa entre o
 *      relatório de um e as mãos do outro é o recorte por dono no service.
 *      É o clássico IDOR: trocar o id na URL.
 *
 *   3. O CORPO PODE PROMOVER ALGUÉM?  Campo que o cliente manda e o servidor
 *      grava sem perguntar (`tecnicoId`, `status`, `cargo`, `ativo`) é a forma
 *      mais silenciosa de escalar privilégio: não há erro, não há log, só uma
 *      linha diferente no banco.
 *
 * E mais duas varreduras que não dependem de ninguém lembrar de uma lista: as
 * rotas de administrador são LIDAS DO CÓDIGO e chamadas por um não-admin, e
 * toda leitura é vasculhada atrás de hash de senha.
 *
 * ── O QUE ELE NÃO PROMETE ──────────────────────────────────────────────────
 *
 * Não fala de injeção (`verificar-injecao`), de cabeçalho (`verificar-cabecalhos`),
 * de vazamento entre setores (`verificar-escopo-dados`) nem de cookie/CSRF
 * (`verificar-sessao-cookie`). Aqui é identidade, posse e escalada.
 *
 * TOCA O BANCO DE DESENVOLVIMENTO e limpa tudo no final.
 *
 *   cd server && node verificar-autorizacao.js
 */
// Turnstile desligado ANTES de qualquer require -- mesma razão das outras
// suítes: com chave no .env, todo login daqui levaria 403 e o arquivo inteiro
// falharia por um motivo que nada tem a ver com o que ele testa.
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const prisma = require("./src/infrastructure/database/prisma.client");
const createApp = require("./src/app");
const mapeamentoService = require("./src/modules/rankings/mapeamento.service");
const env = require("./src/config/env");

// O log de depuração imprime TODA consulta do Prisma -- centenas de linhas que
// escondem as verificações. Aqui interessa o veredito, e não o SQL.
require("./src/config/logger").level = "warn";

const MARCA = "autz-" + process.pid;
const criados = { usuarios: [], mapeamentos: [] };
const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${msg}`);
  if (!ok) erros.push(`[${secao}] ${msg}`);
};

let base = "";
let servidor = null;

async function pedir(caminho, { metodo = "GET", corpo, token, ip = "203.0.113.9" } = {}) {
  const h = { "Content-Type": "application/json", "X-Forwarded-For": `${ip}, 10.0.0.1` };
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: h,
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* nao-JSON (midia, pdf) */ }
  return { status: r.status, texto, json };
}

// A sessão inteira: o token de acesso e o de renovação. O de renovação só
// interessa ao bloco do logout -- é ele que identifica QUAL sessão encerrar.
async function logarSessao(email, senha) {
  const r = await pedir("/api/auth/login", { metodo: "POST", corpo: { email, senha } });
  const dados = r.json?.data || r.json || {};
  if (r.status !== 200 || !dados.token) {
    throw new Error(`login falhou para ${email}: HTTP ${r.status} ${r.texto.slice(0, 160)}`);
  }
  return dados;
}

async function logar(email, senha) {
  return (await logarSessao(email, senha)).token;
}

async function criarUsuario(cargo, extras = {}) {
  const senha = "Senha!" + Math.random().toString(36).slice(2, 10);
  const sufixo = Math.random().toString(36).slice(2, 8);
  const u = await prisma.usuario.create({
    data: {
      nome: `${MARCA}-${cargo}-${sufixo}`.normalize("NFD").replace(/[̀-ͯ]/g, ""),
      email: `${MARCA}-${sufixo}@teste.local`.toLowerCase(),
      senhaHash: await bcrypt.hash(senha, 10),
      cargo,
      ativo: true,
      ...extras,
    },
  });
  criados.usuarios.push(u.id);
  return { ...u, senha };
}

const hoje = () => new Date().toISOString().slice(0, 10);

// Um PNG de 1x1 -- evidência de verdade, para o teste de arquivo ter o que
// pedir. Menor imagem válida possível: o que importa aqui é o controle de
// acesso, não o conteúdo.
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * AS ROTAS DE ADMINISTRADOR, LIDAS DO CÓDIGO.
 *
 * Uma lista escrita à mão só cobre o que alguém lembrou de escrever -- e rota
 * nova é justamente a que ninguém lembra. Aqui o mapa de montagem do `app.js`
 * é cruzado com as linhas `router.<metodo>(... adminMiddleware ...)` de cada
 * módulo, então um endpoint de admin criado amanhã entra na varredura sozinho.
 */
function lerModulosDoApp() {
  const raiz = path.join(__dirname, "src");
  const appSrc = fs.readFileSync(path.join(raiz, "app.js"), "utf8");

  // Duas formas de importar um roteador, e as DUAS contam. A segunda é a que
  // quase escapou desta varredura: `const { webhookRouter, adminRouter } =
  // require(".../whatsapp.routes")` -- o WhatsApp inteiro (conectar, QR code,
  // token da instância) ficaria de fora de um teste que só entende a primeira.
  const requires = Object.fromEntries([
    ...[...appSrc.matchAll(/const (\w+) = require\("\.\/modules\/([\w-]+)\/[^"]+"\)/g)].map(
      ([, variavel, pasta]) => [variavel, pasta]
    ),
    ...[...appSrc.matchAll(/const \{([^}]+)\} = require\("\.\/modules\/([\w-]+)\/[^"]+"\)/g)].flatMap(
      ([, lista, pasta]) => lista.split(",").map((n) => [n.trim(), pasta]).filter(([n]) => n)
    ),
  ]);

  return [...appSrc.matchAll(/app\.use\(\s*"(\/api\/[^"]+)"\s*,\s*(\w+)/g)]
    .map(([, prefixo, variavel]) => ({ prefixo, pasta: requires[variavel] }))
    .filter((m) => m.pasta);
}

// `:id` vira um id inexistente DE PROPÓSITO: a resposta certa continua sendo
// 403, porque a barreira vem ANTES de procurar no banco. Um 404 já seria o
// servidor tendo ido ao banco por ordem de quem não podia mandar.
const semParametros = (caminho) => caminho.replace(/:[A-Za-z]+/g, "inexistente-" + MARCA);

function paraCadaRota(visitar) {
  const raiz = path.join(__dirname, "src");
  for (const { prefixo, pasta } of lerModulosDoApp()) {
    const dir = path.join(raiz, "modules", pasta);
    if (!fs.existsSync(dir)) continue;
    for (const arq of fs.readdirSync(dir).filter((f) => f.endsWith(".routes.js"))) {
      visitar(fs.readFileSync(path.join(dir, arq), "utf8"), prefixo);
    }
  }
}

/**
 * TODA ROTA PROTEGIDA, E POR QUAL BARREIRA -- lida do código.
 *
 * Três sutilezas, e as três já quase deixaram algo de fora:
 *
 *   NOME DO ROTEADOR   não é sempre `router`: o WhatsApp usa `adminRouter`.
 *   APELIDO DA GUARDA  `const somenteAdmin = exigirModulo("whatsapp")`, usado
 *                      nove vezes -- procurar só pela chamada literal deixaria
 *                      conectar, desconectar e o QR code sem teste.
 *   A ORDEM IMPORTA    `router.use(gate)` vale só para o que vem DEPOIS dele.
 *                      A rota de anexo das mensagens rápidas é declarada ANTES
 *                      do `authMiddleware` de propósito (ela se autentica pelo
 *                      token assinado na URL); atribuir a ela a barreira do
 *                      arquivo seria inventar uma falha que não existe.
 */
function descobrirRotasProtegidas() {
  const rotas = [];
  paraCadaRota((src, prefixo) => {
    const apelidoAdmin = new Set(["adminMiddleware"]);
    for (const [, nome] of src.matchAll(/const (\w+)\s*=\s*adminMiddleware\s*;/g)) apelidoAdmin.add(nome);
    const apelidoModulo = {};
    for (const [, nome, modulo] of src.matchAll(/const (\w+)\s*=\s*exigirModulo\("([^"]+)"\)/g)) {
      apelidoModulo[nome] = modulo;
    }

    // As barreiras do arquivo inteiro, com a posição em que passam a valer.
    const doArquivo = [];
    for (const m of src.matchAll(/\w+\.use\(([^)]*(?:\)[^)]*)?)\)/g)) {
      const dentro = m[1];
      const modulo = dentro.match(/exigirModulo\("([^"]+)"\)/)?.[1]
        || Object.keys(apelidoModulo).find((n) => new RegExp(`\\b${n}\\b`).test(dentro));
      doArquivo.push({
        pos: m.index,
        admin: [...apelidoAdmin].some((n) => new RegExp(`\\b${n}\\b`).test(dentro)),
        modulo: apelidoModulo[modulo] || modulo || null,
      });
    }

    for (const m of src.matchAll(/\w+\.(get|post|put|patch|delete)\(\s*"([^"]*)"\s*,\s*([^\n]*)/g)) {
      const [, metodo, caminho, resto] = m;
      const herdadas = doArquivo.filter((g) => g.pos < m.index);
      const admin =
        [...apelidoAdmin].some((n) => new RegExp(`\\b${n}\\b`).test(resto)) ||
        herdadas.some((g) => g.admin);
      const proprio = resto.match(/exigirModulo\("([^"]+)"\)/)?.[1]
        || Object.entries(apelidoModulo).find(([n]) => new RegExp(`\\b${n}\\b`).test(resto))?.[1];
      const modulo = proprio || herdadas.map((g) => g.modulo).filter(Boolean).pop() || null;
      if (!admin && !modulo) continue;
      rotas.push({ metodo: metodo.toUpperCase(), url: prefixo + semParametros(caminho), admin, modulo });
    }
  });
  return rotas;
}

(async () => {
  try {
    const app = createApp();
    await new Promise((r) => { servidor = app.listen(0, r); });
    base = `http://127.0.0.1:${servidor.address().port}`;
    console.log(`app de teste em ${base}`);

    // Dois técnicos IGUAIS: mesmo cargo, mesma equipe de ranking. Não há
    // nenhuma diferença de permissão entre eles -- só a de posse.
    const tecA = await criarUsuario("Técnico", { equipeRanking: "externo" });
    const tecB = await criarUsuario("Técnico", { equipeRanking: "externo" });
    const admin = await criarUsuario("Administrador");

    const tokenA = await logar(tecA.email, tecA.senha);
    const tokenB = await logar(tecB.email, tecB.senha);
    const tokenAdmin = await logar(admin.email, admin.senha);

    // ───────────────────────────────────────────────────────────────────────
    titulo("1. A identidade vem do BANCO, e não do token");

    // 1a. Token LEGÍTIMO (assinado com o segredo do servidor) mentindo o cargo.
    // É o teste que mais importa: prova que o cargo é relido do banco. Se o
    // middleware um dia passar a confiar em `payload.cargo`, este é o único
    // lugar que grita.
    // Com o `sid` da sessão REAL do técnico A: o token é perfeito em tudo
    // menos no cargo. Assim o 403 que vem a seguir só pode ser o cargo relido
    // do banco -- e não a sessão faltando.
    const sessaoDoA = await prisma.sessaoRefresh.findFirst({
      where: { usuarioId: tecA.id, revogadoEm: null },
      orderBy: { familiaCriadaEm: "desc" },
    });
    const tokenMentiroso = jwt.sign(
      { sub: tecA.id, email: tecA.email, nome: tecA.nome, cargo: "Administrador", sid: sessaoDoA?.familia },
      env.jwt.secret,
      { expiresIn: "1h" }
    );
    const comMentira = await pedir("/api/rankings/configuracao", { token: tokenMentiroso });
    check(
      comMentira.status === 403,
      `token assinado dizendo cargo=Administrador NÃO promove o Técnico -> ${comMentira.status} (esperado 403)`
    );

    /**
     * 1a-bis. TOKEN SEM SESSÃO NÃO ENTRA.
     *
     * Um token de acesso que não aponta para nenhuma sessão é irrevogável por
     * construção: não há família para queimar no logout, então ele
     * sobreviveria a sair do painel, ao "sair de todos" e à desativação da
     * conta. Tem de ser recusado na porta.
     *
     * Era aceito até hoje, por uma compatibilidade de deploy que já venceu
     * sozinha (token de acesso dura no máximo 8h, e as duas emissões do
     * sistema sempre criam família).
     */
    const tokenSemSessao = jwt.sign(
      { sub: tecA.id, email: tecA.email, nome: tecA.nome, cargo: "Técnico" },
      env.jwt.secret,
      { expiresIn: "1h" }
    );
    const semSessao = await pedir("/api/auth/me", { token: tokenSemSessao });
    check(
      semSessao.status === 401 && semSessao.json?.error?.code === "SESSAO_REVOGADA",
      `token sem sid (sessão nenhuma) é recusado -> ${semSessao.status} ${semSessao.json?.error?.code || ""}`
    );

    // 1b. Token assinado com OUTRO segredo não entra de jeito nenhum.
    const tokenForjado = jwt.sign({ sub: admin.id, cargo: "Administrador" }, "segredo-errado", { expiresIn: "1h" });
    const comForjado = await pedir("/api/auth/me", { token: tokenForjado });
    check(comForjado.status === 401, `token assinado com outro segredo -> ${comForjado.status} (esperado 401)`);

    // 1c. Rebaixar o cargo no banco vale na REQUISIÇÃO SEGUINTE, com o mesmo
    // token na mão.
    const antesRebaixe = await pedir("/api/rankings/configuracao", { token: tokenAdmin });
    check(antesRebaixe.status === 200, `o Administrador lê a configuração -> ${antesRebaixe.status}`);
    await prisma.usuario.update({ where: { id: admin.id }, data: { cargo: "Comercial" } });
    const depoisRebaixe = await pedir("/api/rankings/configuracao", { token: tokenAdmin });
    check(
      depoisRebaixe.status === 403,
      `rebaixado no banco, o MESMO token perde a rota de admin -> ${depoisRebaixe.status} (esperado 403)`
    );
    await prisma.usuario.update({ where: { id: admin.id }, data: { cargo: "Administrador" } });

    // 1d. Conta desativada para de autenticar na hora.
    await prisma.usuario.update({ where: { id: tecB.id }, data: { ativo: false } });
    const desativado = await pedir("/api/auth/me", { token: tokenB });
    check(
      desativado.status === 403 && desativado.json?.error?.code === "CONTA_INATIVA",
      `conta desativada no banco derruba o token vivo -> ${desativado.status} ${desativado.json?.error?.code || ""}`
    );
    await prisma.usuario.update({ where: { id: tecB.id }, data: { ativo: true } });
    const reativado = await pedir("/api/auth/me", { token: tokenB });
    check(reativado.status === 200, `reativada, a mesma sessão volta a valer -> ${reativado.status}`);

    // 1e. "Sair de todos" mata o token de acesso já emitido -- inclusive o de
    // quem pediu. Sem isso o botão mentiria para quem mais precisa dele.
    const tokenDescartavel = await logar(tecB.email, tecB.senha);
    const antesSair = await pedir("/api/auth/me", { token: tokenDescartavel });
    check(antesSair.status === 200, `sessão nova autentica -> ${antesSair.status}`);
    await pedir("/api/auth/sair-todos", { metodo: "POST", token: tokenDescartavel });
    const depoisSair = await pedir("/api/auth/me", { token: tokenDescartavel });
    check(
      depoisSair.status === 401,
      `depois de "sair de todos", o token copiado morre na hora -> ${depoisSair.status} (esperado 401)`
    );

    /**
     * 1e-bis. O LOGOUT COMUM também mata o token de acesso -- e só o dele.
     *
     * É a pergunta que costuma vir como "precisamos de uma lista de `jti`
     * revogados": num JWT puro, sair do painel não derruba nada, porque o token
     * é um papel assinado que vale sozinho até vencer. Aqui não é assim -- o
     * `sid` do token é a FAMÍLIA da sessão, e o `authMiddleware` confere
     * `familiaAtiva(sid)` a cada requisição. Revogar a família é exatamente uma
     * lista de revogação, só que por SESSÃO em vez de por token: a rotação do
     * refresh emite vários tokens na mesma sessão, e todos morrem juntos.
     *
     * O teste cobra as duas metades, porque uma sem a outra seria defeito:
     * o aparelho que saiu perde o acesso NA HORA, e o outro continua logado.
     */
    const aparelho1 = await logarSessao(tecB.email, tecB.senha);
    const aparelho2 = await logarSessao(tecB.email, tecB.senha);
    await pedir("/api/auth/sair", { metodo: "POST", corpo: { refreshToken: aparelho1.refreshToken } });
    const saiu = await pedir("/api/auth/me", { token: aparelho1.token });
    const ficou = await pedir("/api/auth/me", { token: aparelho2.token });
    check(
      saiu.status === 401,
      `o logout comum derruba o token de acesso daquela sessão -> ${saiu.status} (esperado 401)`
    );
    check(
      ficou.status === 200,
      `e NÃO derruba o outro aparelho, que não saiu -> ${ficou.status} (esperado 200)`
    );

    // O tokenB foi revogado junto (sair-todos não poupa ninguém): renova.
    const tokenBVivo = await logar(tecB.email, tecB.senha);

    /**
     * 1f. A PORTA LATERAL: `optionalAuth`.
     *
     * Nenhuma rota a usa hoje, então não dá para exercitá-la por HTTP -- e é
     * justamente por isso que ela merece teste: era a única função do projeto
     * que montava `req.user` a partir do PAYLOAD do token, cargo inclusive. Um
     * dia alguém a coloca numa rota "pública com extras", põe um `exigirModulo`
     * abaixo, e a decisão passa a sair de um papel assinado em vez do banco.
     *
     * Chamada direta, com o mesmo token mentiroso do 1a.
     */
    const { optionalAuth } = require("./src/shared/middlewares/auth.middleware");
    const comoVisita = async (tokenUsado) => {
      const req = { headers: { authorization: `Bearer ${tokenUsado}` }, cookies: {} };
      await new Promise((pronto) => optionalAuth(req, {}, pronto));
      return req.user;
    };
    const visitaMentirosa = await comoVisita(tokenMentiroso);
    check(
      visitaMentirosa?.cargo === "Técnico",
      `optionalAuth lê o cargo do banco, não do token (${visitaMentirosa?.cargo || "sem usuário"})`
    );
    await prisma.usuario.update({ where: { id: tecA.id }, data: { ativo: false } });
    const visitaDesativada = await comoVisita(tokenA);
    check(!visitaDesativada, "optionalAuth trata conta desativada como visitante, e não como dono do token");
    await prisma.usuario.update({ where: { id: tecA.id }, data: { ativo: true } });

    // ───────────────────────────────────────────────────────────────────────
    titulo("2. IDOR: o relatório de um técnico na mão do outro");

    const criado = await pedir("/api/rankings/mapeamentos", {
      metodo: "POST",
      token: tokenA,
      corpo: {
        empresa: `${MARCA} Empresa A`,
        dataVisita: hoje(),
        descricao: "Relatorio do tecnico A, com evidencia, para o teste de posse.",
        itens: {},
        evidencias: [PNG_1PX],
      },
    });
    check(criado.status === 201 || criado.status === 200, `o técnico A cria o relatório dele -> ${criado.status}`);
    const idA = criado.json?.data?.id;
    if (!idA) throw new Error(`não consegui criar o mapeamento base: ${criado.texto.slice(0, 200)}`);
    criados.mapeamentos.push(idA);

    // Cada porta de entrada do MESMO recurso, uma a uma. Basta uma esquecida.
    const portas = [
      { metodo: "GET", url: `/api/rankings/mapeamentos/${idA}`, o: "ler" },
      { metodo: "GET", url: `/api/rankings/mapeamentos/${idA}/arquivo`, o: "baixar o PDF" },
      { metodo: "GET", url: `/api/rankings/mapeamentos/${idA}/evidencia/0`, o: "ver a evidência" },
      { metodo: "PATCH", url: `/api/rankings/mapeamentos/${idA}`, o: "editar", corpo: { descricao: "invadido" } },
      { metodo: "POST", url: `/api/rankings/mapeamentos/${idA}/devolver`, o: "devolver", corpo: { observacao: "invadido pelo B" } },
      { metodo: "DELETE", url: `/api/rankings/mapeamentos/${idA}`, o: "apagar" },
    ];
    for (const p of portas) {
      const r = await pedir(p.url, { metodo: p.metodo, token: tokenBVivo, corpo: p.corpo });
      check(r.status === 403, `o técnico B tenta ${p.o} o relatório do A -> ${r.status} (esperado 403)`);
    }

    // A prova final não é o código HTTP: é o banco. Uma recusa que mesmo assim
    // gravou seria pior do que uma permissão honesta.
    const aindaLa = await prisma.mapeamentoTecnico.findUnique({ where: { id: idA } });
    check(!!aindaLa, "o relatório do A continua existindo depois das seis tentativas");
    check(
      aindaLa?.tecnicoId === tecA.id && !String(aindaLa?.descricao || "").includes("invadido"),
      `e continua sendo do A, com o texto dele (dono ${aindaLa?.tecnicoId === tecA.id ? "intacto" : "TROCADO"})`
    );

    // A listagem é o outro caminho: não adianta barrar por id se o índice
    // entrega tudo.
    const listaB = await pedir("/api/rankings/mapeamentos", { token: tokenBVivo });
    check(
      !listaB.texto.includes(idA),
      `a lista do técnico B não traz o relatório do A -> ${listaB.texto.includes(idA) ? "VAZOU" : "não aparece"}`
    );

    // ───────────────────────────────────────────────────────────────────────
    titulo("3. O corpo da requisição não promove ninguém");

    // 3a. Criar um relatório TENTANDO nascer aprovado, no nome de outro, com
    // pontuação e validação já dadas.
    const comEnfeites = await pedir("/api/rankings/mapeamentos", {
      metodo: "POST",
      token: tokenBVivo,
      corpo: {
        empresa: `${MARCA} Empresa B`,
        dataVisita: hoje(),
        descricao: "Tentativa de nascer aprovado e no nome do outro tecnico.",
        itens: {},
        // Tudo daqui para baixo é contrabando:
        tecnicoId: tecA.id,
        tecnicoNome: tecA.nome,
        status: "aprovado",
        entregueEm: new Date(2020, 0, 1).toISOString(),
        validadoPorId: admin.id,
        pontos: 9999,
      },
    });
    const idB = comEnfeites.json?.data?.id;
    if (idB) criados.mapeamentos.push(idB);
    check(!!idB, `o relatório com campos extras é aceito (os extras é que não valem) -> ${comEnfeites.status}`);
    if (idB) {
      const linha = await prisma.mapeamentoTecnico.findUnique({ where: { id: idB } });
      check(linha?.tecnicoId === tecB.id, `o dono é quem MANDOU, não quem o corpo disse (${linha?.tecnicoId === tecB.id ? "B" : "A"})`);
      check(linha?.status === "rascunho", `nasceu como rascunho, e não "aprovado" (${linha?.status})`);
      check(!linha?.validadoPorId, `ninguém validou por conta própria (${linha?.validadoPorId || "nulo"})`);
    }

    // 3b. Editar o próprio relatório tentando trocar de dono e se aprovar.
    if (idB) {
      await pedir(`/api/rankings/mapeamentos/${idB}`, {
        metodo: "PATCH",
        token: tokenBVivo,
        corpo: { descricao: "Edicao legitima do proprio dono.", tecnicoId: tecA.id, status: "aprovado" },
      });
      const depois = await prisma.mapeamentoTecnico.findUnique({ where: { id: idB } });
      check(
        depois?.tecnicoId === tecB.id && depois?.status !== "aprovado",
        `editar não muda dono nem aprova (dono ${depois?.tecnicoId === tecB.id ? "B" : "A"}, status ${depois?.status})`
      );
    }

    // 3c. O próprio perfil: nome pode, cargo e `ativo` não.
    await pedir("/api/auth/perfil", {
      metodo: "PATCH",
      token: tokenBVivo,
      corpo: { nome: `${MARCA}-renomeado`, cargo: "Administrador", ativo: false, equipeRanking: "sede,externo" },
    });
    const perfil = await prisma.usuario.findUnique({ where: { id: tecB.id } });
    check(perfil?.cargo === "Técnico", `PATCH /perfil não promove a Administrador (cargo ${perfil?.cargo})`);
    check(perfil?.ativo === true, "PATCH /perfil não mexe em `ativo`");
    check(perfil?.equipeRanking === "externo", `PATCH /perfil não muda a equipe de ranking (${perfil?.equipeRanking})`);

    // 3d. Reportar um bug em nome de outra pessoa.
    const bug = await pedir("/api/bugs", {
      metodo: "POST",
      token: tokenBVivo,
      corpo: { titulo: `${MARCA} bug`, descricao: "Relato de teste de autoria.", usuarioId: tecA.id, usuarioNome: tecA.nome },
    });
    const idBug = bug.json?.data?.id;
    if (idBug) {
      const linha = await prisma.relatoBug.findUnique({ where: { id: idBug } }).catch(() => null);
      if (linha) {
        const autor = linha.usuarioId ?? linha.autorId ?? null;
        check(autor !== tecA.id, `o bug é registrado em nome de quem o mandou (autor ${autor === tecB.id ? "B" : String(autor)})`);
        await prisma.relatoBug.delete({ where: { id: idBug } }).catch(() => {});
      }
    }

    /**
     * 3e. A SEGUNDA CAMADA, TESTADA SOZINHA.
     *
     * Tudo acima passou pela borda -- e o Zod DESCARTA chave que o schema não
     * conhece, então o contrabando morre antes de chegar ao serviço. Isso é
     * ótimo e é insuficiente como prova: se o serviço um dia passar a gravar
     * `dados.tecnicoId`, nada aqui reclamaria, porque a borda esconderia o
     * defeito. No dia em que alguém acrescentar o campo ao schema por outro
     * motivo, o buraco nasce pronto.
     *
     * Então este bloco pula o HTTP e chama o serviço na mão, com o corpo sujo.
     * É exatamente o que "cada camada segura sozinha" quer dizer: a de dentro
     * tem de recusar mesmo quando a de fora não filtrou nada.
     */
    const semBorda = await mapeamentoService.criar(
      {
        empresa: `${MARCA} sem borda`,
        dataVisita: hoje(),
        descricao: "Chamada direta ao service, sem passar pelo Zod da borda.",
        itens: {},
        evidencias: [],
        tecnicoId: tecA.id,
        tecnicoNome: tecA.nome,
        status: "aprovado",
        validadoPorId: admin.id,
        entregueEm: new Date(2020, 0, 1).toISOString(),
      },
      { sub: tecB.id, nome: tecB.nome }
    );
    criados.mapeamentos.push(semBorda.id);
    const linhaSemBorda = await prisma.mapeamentoTecnico.findUnique({ where: { id: semBorda.id } });
    check(
      linhaSemBorda?.tecnicoId === tecB.id,
      `sem a borda, o service AINDA grava o dono a partir de quem chamou (${linhaSemBorda?.tecnicoId === tecB.id ? "B" : "A"})`
    );
    check(
      linhaSemBorda?.status === "rascunho" && !linhaSemBorda?.validadoPorId,
      `sem a borda, o service AINDA recusa nascer aprovado (status ${linhaSemBorda?.status})`
    );

    // ───────────────────────────────────────────────────────────────────────
    titulo("4. Varredura: toda rota de administrador recusa quem não é");

    const protegidas = descobrirRotasProtegidas();
    const rotasAdmin = protegidas.filter((r) => r.admin);
    check(rotasAdmin.length > 0, `achei ${rotasAdmin.length} rota(s) de administrador no código`);
    for (const r of rotasAdmin) {
      const resp = await pedir(r.url, { metodo: r.metodo, token: tokenBVivo, corpo: r.metodo === "GET" ? undefined : {} });
      check(resp.status === 403, `${r.metodo} ${r.url} como Técnico -> ${resp.status} (esperado 403)`);
    }

    // ───────────────────────────────────────────────────────────────────────
    titulo("4b. Varredura: a matriz de permissões é obedecida na URL");

    /**
     * O TESTE PERGUNTA À PRÓPRIA MATRIZ o que esperar, em vez de trazer uma
     * lista de módulos escrita aqui dentro. Assim ele não quebra quando o
     * administrador liga um módulo novo para o Técnico -- e continua exigindo
     * 403 em tudo que a matriz nega HOJE.
     *
     * Só as rotas NEGADAS são chamadas. Uma permitida executaria o controlador
     * de verdade (conectar instância, apagar registro), e um teste de
     * autorização não tem por que mexer no mundo para descobrir isso.
     */
    const editor = await pedir("/api/permissoes", { token: tokenAdmin });
    const matriz = editor.json?.data?.matriz || {};
    const doTecnico = matriz["Técnico"] || {};
    check(Object.keys(matriz).length > 0, `a matriz de permissões foi lida (${Object.keys(matriz).length} perfis)`);

    const rotasModulo = protegidas.filter((r) => !r.admin && r.modulo);
    const negadas = rotasModulo.filter((r) => doTecnico[r.modulo] !== true);
    check(rotasModulo.length > 0, `achei ${rotasModulo.length} rota(s) atrás da matriz; ${negadas.length} negada(s) ao Técnico`);
    // As rotas de Relatórios são a exceção declarada: `exigirRelatorioDeVisita`
    // abre a porta para quem está na equipe de visita, mesmo sem o módulo
    // "rankings" no cargo. É regra do sistema, não buraco -- ver ranking.routes.
    const semGate = [];
    for (const r of negadas) {
      const resp = await pedir(r.url, { metodo: r.metodo, token: tokenBVivo, corpo: r.metodo === "GET" ? undefined : {} });
      if (resp.status !== 403) semGate.push(`${r.metodo} ${r.url} (módulo "${r.modulo}") -> ${resp.status}`);
    }
    check(
      semGate.length === 0,
      `toda rota de módulo negado ao Técnico responde 403${semGate.length ? `: ${semGate.join(" | ")}` : ""}`
    );

    // ───────────────────────────────────────────────────────────────────────
    titulo("5. Nenhuma resposta carrega hash de senha");

    // O hash não é senha, mas é material para quebrar offline no tempo de quem
    // atacou -- e não há uma única tela que precise dele.
    const leituras = [
      "/api/auth/me",
      "/api/equipe",
      "/api/agenda/pessoas",
      "/api/dashboard",
      "/api/dashboard/painel",
      "/api/conversas/atendentes",
      "/api/permissoes",
    ];
    let vazou = 0;
    for (const url of leituras) {
      const r = await pedir(url, { token: tokenAdmin });
      const sujo = /\$2[aby]\$\d\d\$/.test(r.texto) || /"senhaHash"/.test(r.texto) || /"senha"\s*:/.test(r.texto);
      if (sujo) { vazou += 1; console.log(`        ${url} traz hash de senha na resposta`); }
    }
    check(vazou === 0, `nenhuma das ${leituras.length} leituras devolve hash de senha`);

    // ───────────────────────────────────────────────────────────────────────
  } catch (e) {
    console.error("\nERRO NA SUITE:", e.message);
    erros.push(`[suite] ${e.message}`);
  } finally {
    titulo("Limpeza");
    for (const id of criados.mapeamentos) {
      await prisma.mapeamentoTecnico.delete({ where: { id } }).catch(() => {});
    }
    for (const id of criados.usuarios) {
      await prisma.sessaoRefresh.deleteMany({ where: { usuarioId: id } }).catch(() => {});
      await prisma.preferencia.deleteMany({ where: { usuarioId: id } }).catch(() => {});
      await prisma.mapeamentoTecnico.deleteMany({ where: { tecnicoId: id } }).catch(() => {});
      await prisma.usuario.delete({ where: { id } }).catch(() => {});
    }
    const sobrou = await prisma.usuario.count({ where: { nome: { contains: MARCA } } });
    check(sobrou === 0, `limpeza completa (sobraram ${sobrou} usuários de teste)`);

    if (servidor) servidor.close();
    await prisma.$disconnect();

    console.log("");
    if (erros.length) {
      console.log(`FALHAS (${erros.length}):`);
      for (const e of erros) console.log(`  ${e}`);
      process.exitCode = 1;
    } else {
      console.log("AUTORIZAÇÃO: TUDO CONFERE");
    }
  }
})();
