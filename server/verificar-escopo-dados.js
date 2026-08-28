/**
 * ESCOPO DE DADOS POR SETOR -- a varredura que procura vazamento.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE (e por que NAO se chama RLS) ───────────────
 *
 * RLS (Row-Level Security) e uma funcionalidade do BANCO: o proprio motor
 * aplica a policy, entao uma consulta que esqueceu o WHERE volta filtrada
 * assim mesmo. Isso exige roles, usuario de sessao e `CREATE POLICY`.
 *
 * O banco desta aplicacao -- em desenvolvimento E em producao -- e SQLite
 * (`provider = "sqlite"`; em producao `DATABASE_URL=file:/data/arka.db`).
 * SQLite nao tem NADA disso: sem roles, sem GRANT, sem policies, sem
 * `current_user`. Verificado, nao suposto: as seis primitivas de RLS foram
 * tentadas contra o banco real e todas deram erro de sintaxe.
 *
 * Entao aqui NAO ha RLS, e chamar de RLS o que existe seria mentir sobre a
 * garantia. O que existe e autorizacao no servidor -- e o papel deste script e
 * checar, do lado de fora, se ela tem buraco.
 *
 * ── O DESENHO DO ATAQUE ────────────────────────────────────────────────────
 *
 * Em vez de conferir endpoint por endpoint (o que so encontra o que alguem
 * lembrou de listar), o teste e ORIENTADO A DADO: cria uma conversa do Tecnico
 * com marcadores unicos -- id, telefone, nome do cliente, texto da mensagem --
 * e depois, autenticado como COMERCIAL, varre TODOS os endpoints de leitura
 * procurando qualquer um desses marcadores na resposta.
 *
 * A vantagem: um endpoint novo que devolva conversa sem filtrar e pego pela
 * varredura, mesmo que ninguem tenha escrito um teste para ele.
 *
 * Fala HTTP direto com a API. Nao usa o front, nao usa a UI: e exatamente o que
 * um atacante com uma sessao valida de Comercial consegue fazer com curl.
 *
 * TOCA O BANCO DE DESENVOLVIMENTO e limpa tudo no final.
 *
 *   cd server && node verificar-escopo-dados.js
 */
// Turnstile desligado para esta suite, ANTES de qualquer require -- mesma razao
// de verificar-seguranca.js: com chaves no .env todo login daqui levaria 403 e
// as 60 verificacoes de escopo morreriam por um motivo que nada tem a ver com o
// que elas testam. A logica do desafio e exercitada la, sem HTTP.
// String vazia e nao `delete`: o dotenv repovoaria uma chave apagada.
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const bcrypt = require("bcryptjs");
const prisma = require("./src/infrastructure/database/prisma.client");
const createApp = require("./src/app");
const env = require("./src/config/env");

const MARCA = "escopo-" + process.pid;
const criados = { usuarios: [], conversas: [], instancias: [] };
const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${msg}`);
  if (!ok) erros.push(`[${secao}] ${msg}`);
};

let base = "";
let servidor = null;

function comoHeader(mapa) {
  return Object.entries(mapa).map(([k, v]) => `${k}=${v.valor}`).join("; ");
}
function cookiesDe(r) {
  const mapa = {};
  for (const c of r.headers.getSetCookie?.() || []) {
    const [par] = c.split(";");
    const i = par.indexOf("=");
    mapa[par.slice(0, i).trim()] = { valor: par.slice(i + 1) };
  }
  return mapa;
}
// COMO A SESSAO VIAJA nesta branch: `Authorization: Bearer <jwt>`.
//
// A versao original desta suite nasceu na branch de seguranca, onde a sessao vai
// em cookie HttpOnly com token de CSRF junto. Aqui na main ainda e o token no
// header. Só estas duas funcoes sabem disso -- o resto dos testes trata `sessao`
// como caixa-preta, entao o dia em que os cookies chegarem, muda-se aqui e mais
// nada.
async function pedir(caminho, { metodo = "GET", corpo, sessao, ip = "203.0.113.5" } = {}) {
  const h = { "Content-Type": "application/json", "X-Forwarded-For": `${ip}, 10.0.0.1` };
  if (sessao?.token) h.Authorization = `Bearer ${sessao.token}`;
  if (sessao?.cookies) {
    h.Cookie = comoHeader(sessao.cookies);
    if (sessao.csrf) h["X-CSRF-Token"] = sessao.csrf;
  }
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: h,
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* nao-JSON */ }
  return { status: r.status, texto, json };
}
async function logar(email, senha, ip) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `${ip}, 10.0.0.1` },
    body: JSON.stringify({ email, senha }),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* nao-JSON */ }
  const dados = json?.data || json || {};
  // Se o login nao devolveu token, os testes seguintes passariam por "ninguem ve
  // nada" em vez de por acerto. Falha alto aqui, onde da para entender.
  if (r.status !== 200 || !dados.token) {
    throw new Error(`login falhou para ${email}: HTTP ${r.status} ${texto.slice(0, 160)}`);
  }
  return { status: r.status, token: dados.token, cookies: null, csrf: null };
}

/**
 * Descobre as rotas de LEITURA lendo o codigo, em vez de confiar numa lista.
 *
 * Cruza o mapa de montagem do `app.js` (`app.use("/api/x", xRoutes)`) com os
 * `router.get(...)` de cada modulo. Assim um endpoint novo entra na varredura
 * sem ninguem precisar lembrar de adiciona-lo aqui -- que e exatamente o tipo
 * de esquecimento que produz vazamento.
 *
 * Fica de fora: rotas com parametro (exercitadas com ids reais no bloco 2), o
 * SSE (conexao que nao termina) e mídia/anexo (autenticadas por token assinado,
 * cobertas pela suite de seguranca).
 */
function descobrirRotasDeLeitura() {
  const fs = require("fs");
  const path = require("path");
  const raiz = path.join(__dirname, "src");

  const appSrc = fs.readFileSync(path.join(raiz, "app.js"), "utf8");
  const montagens = [...appSrc.matchAll(/app\.use\(\s*"(\/api\/[^"]+)"\s*,\s*(\w+)/g)]
    .map(([, prefixo, variavel]) => ({ prefixo, variavel }));

  // variavel -> pasta do modulo, pelo require correspondente.
  const requires = Object.fromEntries(
    [...appSrc.matchAll(/const (\w+) = require\("\.\/modules\/(\w+)\/[^"]+"\)/g)].map(
      ([, variavel, pasta]) => [variavel, pasta]
    )
  );

  const rotas = [];
  for (const { prefixo, variavel } of montagens) {
    const pasta = requires[variavel];
    if (!pasta) continue;
    const dir = path.join(raiz, "modules", pasta);
    if (!fs.existsSync(dir)) continue;
    for (const arquivo of fs.readdirSync(dir).filter((f) => f.endsWith(".routes.js"))) {
      const src = fs.readFileSync(path.join(dir, arquivo), "utf8");
      for (const [, caminho] of src.matchAll(/router\.get\(\s*"([^"]*)"/g)) {
        if (caminho.includes(":")) continue; // ids reais sao testados no bloco 2
        if (caminho.includes("stream")) continue; // conexao que nao termina
        rotas.push((prefixo + caminho).replace(/\/$/, "") || prefixo);
      }
    }
  }
  // Variacoes de filtro na Central: o filtro nao pode ser a porta de fuga.
  rotas.push("/api/conversas?status=fechada", "/api/conversas?busca=ISCA");
  return [...new Set(rotas)];
}

async function criarUsuario(cargo) {
  const senha = "Senha!" + Math.random().toString(36).slice(2, 10);
  const semAcento = cargo.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const u = await prisma.usuario.create({
    data: {
      nome: `${MARCA}-${cargo}`,
      email: `${MARCA}-${semAcento}@teste.local`.toLowerCase(),
      senhaHash: await bcrypt.hash(senha, 10),
      cargo,
      ativo: true,
    },
  });
  criados.usuarios.push(u.id);
  return { ...u, senha };
}

(async () => {
  try {
    const app = createApp();
    await new Promise((r) => { servidor = app.listen(0, r); });
    base = `http://127.0.0.1:${servidor.address().port}`;

    const bd = String(env.databaseUrl || "");
    console.log(`banco: ${bd.startsWith("file:") ? "SQLite (" + bd + ")" : bd}`);
    console.log(`app de teste em ${base}`);

    const comercial = await criarUsuario("Comercial");
    const financeiro = await criarUsuario("Financeiro");
    const tecnico = await criarUsuario("Técnico");

    const instancia = await prisma.instancia.create({
      data: { nome: MARCA, conectado: false, webhookSecret: MARCA },
    });
    criados.instancias.push(instancia.id);

    // ── ISCAS ──────────────────────────────────────────────────────────────
    // Marcadores unicos e improvaveis. Se QUALQUER um aparecer numa resposta
    // lida pelo Comercial, houve vazamento -- nao importa por qual endpoint.
    const iscas = {};
    async function conversaComIsca(setor, status) {
      const chave = `ISCA-${setor}-${status}-${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
      const telefone = "5598" + Math.floor(Math.random() * 1e8);
      const c = await prisma.conversa.create({
        data: {
          instanciaId: instancia.id,
          cliente: chave,
          telefone,
          statusAtendimento: status,
          setor,
          cnpj: null,
          empresa: `EMPRESA-${chave}`,
        },
      });
      criados.conversas.push(c.id);
      const os = await prisma.atendimento.create({
        data: {
          conversaId: c.id,
          numeroOS: Math.floor(Math.random() * 9e8) + 1e8,
          setor,
          status,
        },
      });
      await prisma.conversa.update({ where: { id: c.id }, data: { atendimentoAtualId: os.id } });
      await prisma.mensagem.create({
        data: { conversaId: c.id, origem: "cliente", texto: `SEGREDO-${chave}` },
      });
      iscas[`${setor}/${status}`] = { id: c.id, telefone, chave, empresa: `EMPRESA-${chave}`, segredo: `SEGREDO-${chave}` };
      return c;
    }

    // Todos os setores, em todos os status -- inclusive FECHADA, que e o caso
    // do requisito "atendimento fechado continua respeitando o setor original".
    for (const setor of ["Técnico", "Financeiro", "Comercial", "Geral"]) {
      for (const status of ["pendente", "aberta", "fechada"]) {
        await conversaComIsca(setor, status);
      }
    }

    const sessaoCom = await logar(comercial.email, comercial.senha, "203.0.113.5");
    check(sessaoCom.status === 200, `login do Comercial (preparo) -> ${sessaoCom.status}`);

    // ── 1. VARREDURA DE VAZAMENTO ──────────────────────────────────────────
    titulo("1. Varredura: alguma leitura entrega dado de outro setor ao Comercial?");

    const alheias = Object.entries(iscas).filter(([k]) => !k.startsWith("Comercial/"));

    // AS ROTAS SAO DESCOBERTAS, NAO LISTADAS A MAO.
    //
    // Uma lista fixa so cobre o que alguem lembrou de escrever -- e o endpoint
    // que vaza costuma ser justamente o que ninguem lembrou. Lendo o mapa de
    // rotas do app.js e os `router.get` de cada modulo, um endpoint de leitura
    // criado amanha entra nesta varredura sozinho.
    //
    // Rotas com parametro (`:id`) ficam de fora daqui: elas sao exercitadas com
    // ids REAIS no bloco 2, que e mais forte do que chutar um id.
    const rotas = descobrirRotasDeLeitura();
    console.log(`  (${rotas.length} rotas de leitura descobertas automaticamente)`);

    for (const rota of rotas) {
      const r = await pedir(rota, { sessao: sessaoCom });
      const vazou = alheias.filter(([, v]) =>
        r.texto.includes(v.chave) || r.texto.includes(v.telefone) ||
        r.texto.includes(v.id) || r.texto.includes(v.segredo) || r.texto.includes(v.empresa)
      );
      check(
        vazou.length === 0,
        `GET ${rota} (${r.status}) -> ${vazou.length ? "VAZOU " + vazou.map(([k]) => k).join(", ") : "sem dado de outro setor"}`
      );
    }

    // ── 2. ACESSO DIRETO POR ID, EM TODOS OS STATUS ────────────────────────
    titulo("2. Acesso direto por ID -- inclusive nos FECHADOS");
    for (const [rotulo, isca] of alheias) {
      const r = await pedir(`/api/conversas/${isca.id}`, { sessao: sessaoCom });
      check(r.status === 403, `GET conversa ${rotulo} -> ${r.status} (esperado 403)`);
      const os = await pedir(`/api/conversas/${isca.id}/atendimentos`, { sessao: sessaoCom });
      check(os.status === 403, `GET OS de ${rotulo} -> ${os.status} (esperado 403)`);
    }

    // ── 3. "GERAL" NAO E ACESSO UNIVERSAL ──────────────────────────────────
    titulo("3. Sem setor / Geral nao vira acesso universal");
    for (const status of ["pendente", "aberta", "fechada"]) {
      const isca = iscas[`Geral/${status}`];
      const r = await pedir(`/api/conversas/${isca.id}`, { sessao: sessaoCom });
      check(r.status === 403, `Comercial lendo conversa "Geral" (${status}) -> ${r.status} (esperado 403)`);
    }

    // ── 4. SESSAO DO BOT POR TELEFONE ──────────────────────────────────────
    //
    // Rota que devolve estado de conversa a partir do TELEFONE, e nao do id.
    // Se ela nao aplicar o mesmo filtro, e um caminho lateral para o mesmo dado.
    titulo("4. Caminho lateral: sessao do chatbot por telefone");
    for (const [rotulo, isca] of alheias.slice(0, 3)) {
      const r = await pedir(`/api/chatbot/sessoes/${isca.telefone}`, { sessao: sessaoCom });
      const vazou = r.texto.includes(isca.chave) || r.texto.includes(isca.id) || r.texto.includes(isca.segredo);
      check(!vazou, `GET /api/chatbot/sessoes/<telefone de ${rotulo}> (${r.status}) -> ${vazou ? "VAZOU" : "nao entrega o fio"}`);
    }

    // ── 5. NAO DA PARA MUDAR O SETOR PARA ESCAPAR/ROUBAR ───────────────────
    titulo("5. Escapar da regra mudando o proprio campo de escopo");

    // 5a. Roubar: puxar conversa de outro setor para o meu.
    const alvoTec = iscas["Técnico/pendente"];
    const roubo = await pedir(`/api/conversas/${alvoTec.id}/setor`, {
      metodo: "PATCH", corpo: { setor: "Comercial" }, sessao: sessaoCom,
    });
    const depoisRoubo = await prisma.conversa.findUnique({ where: { id: alvoTec.id } });
    check(roubo.status === 403, `PATCH setor de conversa do Tecnico -> ${roubo.status} (esperado 403)`);
    check(depoisRoubo.setor === "Técnico", `setor no banco intacto (${depoisRoubo.setor})`);

    // 5b. Roubar pelo atendente.
    const rouboAtendente = await pedir(`/api/conversas/${alvoTec.id}/atendente`, {
      metodo: "PATCH", corpo: { atendenteId: comercial.id }, sessao: sessaoCom,
    });
    check(rouboAtendente.status === 403, `PATCH atendente de conversa do Tecnico -> ${rouboAtendente.status}`);

    // 5c. MASS ASSIGNMENT: criar conversa ja carimbada com o setor de outro.
    //
    // `iniciarConversaSchema` ACEITA `setor` no corpo, entao o ataque tem por
    // onde entrar. O corpo abaixo e valido de proposito (com `texto`): um
    // payload que quebra na validacao daria um "passou" falso -- o ataque
    // precisa CHEGAR ao service para o teste significar alguma coisa.
    const criacao = await pedir("/api/conversas/iniciar", {
      metodo: "POST",
      corpo: {
        telefone: "5599" + Math.floor(Math.random() * 1e8),
        nome: `${MARCA}-forjada`,
        texto: "mensagem para a conversa forjada",
        setor: "Financeiro",
      },
      sessao: sessaoCom,
    });
    const idCriada = criacao.json?.data?.id;
    if (idCriada) criados.conversas.push(idCriada);
    const criada = idCriada ? await prisma.conversa.findUnique({ where: { id: idCriada } }) : null;
    check(
      criacao.status !== 400,
      `o ataque de mass assignment CHEGOU ao service (status ${criacao.status}, nao 400 de validacao)`
    );
    check(
      !criada || criada.setor !== "Financeiro",
      `criar conversa com setor="Financeiro" no corpo -> setor gravado: ${criada?.setor ?? "(nao criou)"}`
    );
    // E se conseguiu criar em outro setor, ele consegue LER o que criou?
    if (criada && criada.setor !== "Comercial") {
      const leitura = await pedir(`/api/conversas/${idCriada}`, { sessao: sessaoCom });
      check(leitura.status === 403, `conversa criada fora do proprio setor tambem nao e legivel -> ${leitura.status}`);
    }

    // 5d. Empurrar a PROPRIA conversa para outro setor e continuar lendo.
    //     Nao e escalada (ele perde acesso), mas confirma que a regra e o setor
    //     gravado, e nao um instante congelado no login.
    const minha = iscas["Comercial/pendente"];
    const empurrou = await pedir(`/api/conversas/${minha.id}/setor`, {
      metodo: "PATCH", corpo: { setor: "Financeiro" }, sessao: sessaoCom,
    });
    if (empurrou.status === 200) {
      const depois = await pedir(`/api/conversas/${minha.id}`, { sessao: sessaoCom });
      check(depois.status === 403, `apos mover a propria conversa para Financeiro, perde o acesso -> ${depois.status}`);
      // devolve para nao contaminar os proximos blocos
      await prisma.conversa.update({ where: { id: minha.id }, data: { setor: "Comercial" } });
    } else {
      check(true, `mover a propria conversa de setor -> ${empurrou.status} (recusado, tambem aceitavel)`);
    }

    // ── 6. SIMETRIA ENTRE OS TRES SETORES ──────────────────────────────────
    titulo("6. Simetria: cada setor so o proprio");
    const sessoes = {
      Comercial: sessaoCom,
      Financeiro: await logar(financeiro.email, financeiro.senha, "203.0.113.6"),
      "Técnico": await logar(tecnico.email, tecnico.senha, "203.0.113.7"),
    };
    // A TRIAGEM E DO TECNICO. Conversa sem setor ("Geral") aparece para ele e
    // para o Administrador, e para mais ninguem -- o bot entrega conversa ao
    // humano sem setor em varios caminhos, e sem alguem enxergando isso o
    // cliente fica esperando (ver o comentario em setor.helper.js).
    //
    // DUAS CONFERENCIAS, e elas se cobrem:
    //
    //   a) a lista abaixo e LIDA do helper, entao o teste compara o que o codigo
    //      FAZ com o que ele DECLARA. Mexer na condicao sem mexer na declaracao
    //      (ou o contrario) quebra aqui.
    //
    //   b) a declaracao em si e travada logo abaixo, com o valor escrito a mao.
    //      Sem isso, acrescentar um cargo ao Set faria o teste se ADAPTAR e
    //      passar calado -- que e exatamente o jeito de uma permissao crescer
    //      sem ninguem decidir. Ampliar a triagem agora exige editar o teste, e
    //      editar um teste de vazamento e uma decisao, nao um descuido.
    const { CUIDAM_DA_TRIAGEM } = require("./src/shared/helpers/setor.helper");
    const SEM_SETOR = "Geral";

    check(
      [...CUIDAM_DA_TRIAGEM].sort().join(",") === "Técnico",
      `so o Tecnico (alem do Administrador) faz triagem -- hoje: [${[...CUIDAM_DA_TRIAGEM].join(", ")}]`
    );

    for (const [cargo, sessao] of Object.entries(sessoes)) {
      const lista = await pedir("/api/conversas", { sessao });
      const fazTriagem = CUIDAM_DA_TRIAGEM.has(cargo);

      const proprias = Object.entries(iscas).filter(([k]) => k.startsWith(cargo + "/"));
      // Para quem faz triagem, "Geral" conta como proprio: e trabalho dele.
      const permitidas = fazTriagem
        ? Object.entries(iscas).filter(([k]) => k.startsWith(cargo + "/") || k.startsWith(SEM_SETOR + "/"))
        : proprias;
      const proibidas = Object.entries(iscas).filter(([k]) => !permitidas.some(([p]) => p === k));

      check(proprias.every(([, v]) => lista.texto.includes(v.chave)),
        `${cargo} enxerga as 3 conversas do proprio setor`);

      const vazou = proibidas.filter(([, v]) => lista.texto.includes(v.chave));
      check(vazou.length === 0,
        `${cargo} NAO enxerga nenhuma que nao lhe cabe${vazou.length ? " (VAZOU: " + vazou.map(([k]) => k).join(", ") + ")" : ""}`);

      if (fazTriagem) {
        const semSetor = Object.entries(iscas).filter(([k]) => k.startsWith(SEM_SETOR + "/"));
        check(semSetor.length > 0 && semSetor.every(([, v]) => lista.texto.includes(v.chave)),
          `${cargo} faz triagem: ENXERGA as conversas sem setor`);
      } else {
        const semSetor = Object.entries(iscas).filter(([k]) => k.startsWith(SEM_SETOR + "/"));
        check(semSetor.every(([, v]) => !lista.texto.includes(v.chave)),
          `${cargo} nao faz triagem: NAO enxerga as conversas sem setor`);
      }
    }

    // ── 7. ADMINISTRADOR CONTINUA VENDO TUDO ───────────────────────────────
    titulo("7. Administrador nao foi quebrado pela regra");
    const admin = await criarUsuario("Administrador");
    const sessaoAdmin = await logar(admin.email, admin.senha, "203.0.113.8");
    const listaAdmin = await pedir("/api/conversas", { sessao: sessaoAdmin });
    const todasVisiveis = Object.values(iscas).every((v) => listaAdmin.texto.includes(v.chave));
    check(todasVisiveis, "Administrador enxerga todas as conversas, inclusive as sem setor");
  } catch (e) {
    console.error("\nERRO NO TESTE:", e.stack || e.message);
    erros.push("excecao: " + e.message);
  } finally {
    for (const id of criados.conversas) {
      await prisma.sessaoChatbot.deleteMany({ where: { conversaId: id } }).catch(() => {});
      await prisma.mensagem.deleteMany({ where: { conversaId: id } }).catch(() => {});
      await prisma.atendimento.deleteMany({ where: { conversaId: id } }).catch(() => {});
      await prisma.conversa.delete({ where: { id } }).catch(() => {});
    }
    for (const id of criados.instancias) await prisma.instancia.delete({ where: { id } }).catch(() => {});
    for (const id of criados.usuarios) {
      await prisma.sessaoRefresh.deleteMany({ where: { usuarioId: id } }).catch(() => {});
      await prisma.usuario.delete({ where: { id } }).catch(() => {});
    }
    const sobrou =
      (await prisma.usuario.count({ where: { nome: { contains: MARCA } } })) +
      (await prisma.conversa.count({ where: { cliente: { contains: "ISCA-" } } })) +
      (await prisma.instancia.count({ where: { nome: MARCA } }));
    check(sobrou === 0, `limpeza completa (sobraram ${sobrou} registros de teste)`);

    await prisma.$disconnect();
    if (servidor) servidor.close();
    console.log(
      "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "NENHUM VAZAMENTO ENTRE SETORES")
    );
    process.exit(erros.length ? 1 : 0);
  }
})();
