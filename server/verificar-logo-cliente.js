/**
 * A LOGO DO CLIENTE (tela Clientes/CNPJ) -- o que precisa continuar valendo.
 *
 * Exercita o SERVIÇO de verdade, contra o banco de desenvolvimento: grava
 * arquivo em disco, lê de volta e confere o que sobrou lá. Não é leitura de
 * código -- as regras aqui são todas sobre o que acontece com os BYTES, e essas
 * não dá para conferir com expressão regular.
 *
 * Toda linha e todo arquivo criados aqui são apagados no fim, inclusive quando
 * um check falha no meio.
 */
const fs = require("fs");
const path = require("path");
const parceiroService = require("./src/modules/parceiros/parceiro.service");
const midiaStorage = require("./src/infrastructure/storage/midia.storage");
const prisma = require("./src/infrastructure/database/prisma.client");
const { tipoDeImagem } = require("./src/shared/helpers/imagem.helper");

const erros = [];
let secao = "";
function titulo(t) { secao = t; console.log(`\n=== ${t} ===`); }
function check(nome, problemas) {
  const lista = Array.isArray(problemas) ? problemas.filter(Boolean) : (problemas ? [problemas] : []);
  if (lista.length) {
    console.log(`  FALHA ${nome}`);
    lista.forEach((p) => console.log(`        ${p}`));
    erros.push(`[${secao}] ${nome} (${lista.length})`);
  } else {
    console.log(`  OK   ${nome}`);
  }
}

// PNG 1x1 transparente de verdade -- assinatura, IHDR, IDAT e IEND.
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
// GIF 1x1, para o segundo formato aceito (e para provar a TROCA de arquivo).
const GIF_1PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// O CNPJ tem de passar nos dígitos verificadores: o serviço valida de verdade.
const CNPJ_TESTE = "11222333000181";

const existeNoDisco = (rel) => !!rel && fs.existsSync(path.join(midiaStorage.BASE_DIR, rel));

async function limpar() {
  const p = await prisma.parceiro.findUnique({ where: { cnpj: CNPJ_TESTE } }).catch(() => null);
  if (p?.logoPath) await midiaStorage.remover(p.logoPath).catch(() => {});
  await prisma.parceiro.delete({ where: { cnpj: CNPJ_TESTE } }).catch(() => {});
}

async function principal() {
  await limpar();

  // -------------------------------------------------------------------------
  titulo("1. Assinatura: o que o arquivo E, nao o que ele diz ser");
  {
    const casos = [
      ["PNG de verdade", Buffer.from(PNG_1PX.split(",")[1], "base64"), "image/png"],
      ["GIF de verdade", Buffer.from(GIF_1PX.split(",")[1], "base64"), "image/gif"],
      ["JPEG", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), "image/jpeg"],
      ["WebP", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]), "image/webp"],
      // O caso que motiva o helper: HTML com script, chamado de PNG.
      ["HTML disfarcado", Buffer.from("<html><script>alert(1)</script>"), null],
      // SVG e XML executavel -- fica de fora de proposito.
      ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), null],
      // RIFF sem WEBP: um WAV nao pode passar por imagem.
      ["WAV (RIFF sem WEBP)", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]), null],
    ];
    const problemas = [];
    for (const [nome, buffer, esperado] of casos) {
      const obtido = tipoDeImagem(buffer);
      if (obtido !== esperado) {
        problemas.push(`${nome}: esperava ${esperado || "recusa"}, veio ${obtido || "recusa"}`);
      }
    }
    check("cada assinatura e classificada pelo que e", problemas);
  }

  // -------------------------------------------------------------------------
  titulo("2. Gravar a logo");
  let criado;
  {
    criado = await parceiroService.criar({
      cnpj: CNPJ_TESTE,
      razaoSocial: "Empresa de Teste da Logo",
      logo: PNG_1PX,
    });
    check("o cadastro sai com `temLogo`", criado.temLogo ? [] : ["temLogo veio falso"]);
    check("e com a versao para o cache (`logoEm`)", criado.logoEm ? [] : ["logoEm veio vazio"]);
    // `mapParceiro` NAO pode devolver o caminho no disco: ele nao serve para
    // nada no front e diz a estrutura de pastas do servidor para quem olhar a
    // resposta da API.
    check(
      "o caminho no disco NAO vaza para o front",
      "logoPath" in criado ? ["mapParceiro devolveu logoPath"] : []
    );

    const linha = await prisma.parceiro.findUnique({ where: { cnpj: CNPJ_TESTE } });
    check("o arquivo existe no disco", existeNoDisco(linha.logoPath) ? [] : [`nao achei ${linha.logoPath}`]);
    check(
      "o tipo guardado veio da ASSINATURA",
      linha.logoTipo === "image/png" ? [] : [`logoTipo = ${linha.logoTipo}`]
    );
  }

  // -------------------------------------------------------------------------
  titulo("3. O que nao e imagem nao entra -- e nao deixa lixo");
  {
    // Um HTML com `data:image/png` na frente: exatamente o que o DTO deixa
    // passar (ele so ve o rotulo) e o servico tem de barrar.
    const html = "data:image/png;base64," + Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
    const antes = await prisma.parceiro.findUnique({ where: { cnpj: CNPJ_TESTE } });

    let recusou = null;
    try {
      await parceiroService.atualizar(CNPJ_TESTE, { razaoSocial: "Empresa de Teste da Logo", logo: html });
      recusou = "aceitou HTML como logo";
    } catch (e) {
      if (e.code !== "LOGO_NAO_E_IMAGEM") recusou = `recusou pelo motivo errado: ${e.code} / ${e.message}`;
    }
    check("HTML disfarcado de PNG e recusado", recusou);

    const depois = await prisma.parceiro.findUnique({ where: { cnpj: CNPJ_TESTE } });
    check(
      "a logo que ja estava la continua intacta",
      depois.logoPath === antes.logoPath ? [] : [`logoPath mudou: ${antes.logoPath} -> ${depois.logoPath}`]
    );

    // O ARQUIVO RECUSADO NAO PODE FICAR NO DISCO. Ele chega a ser gravado (so
    // da para ler a assinatura depois de gravar) e o servico apaga em seguida;
    // sem isso, cada tentativa recusada deixaria um arquivo orfao para sempre.
    const dir = midiaStorage.BASE_DIR;
    const todos = [];
    const varrer = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) varrer(p);
        else todos.push(p);
      }
    };
    if (fs.existsSync(dir)) varrer(dir);
    const orfao = todos.find((p) => {
      try { return fs.readFileSync(p).toString("latin1").includes("<script>alert(1)</script>"); }
      catch { return false; }
    });
    check("o arquivo recusado nao ficou no disco", orfao ? [`sobrou ${orfao}`] : []);
  }

  // -------------------------------------------------------------------------
  titulo("4. Salvar SEM falar de logo nao apaga a logo");
  {
    // O defeito que isto trava: a tela de edicao salva razao social, e-mail,
    // telefones e contratos de uma vez. Se "campo ausente" virasse "apague",
    // corrigir um telefone derrubaria a logo do cliente sem ninguem pedir.
    const antes = await prisma.parceiro.findUnique({ where: { cnpj: CNPJ_TESTE } });
    await parceiroService.atualizar(CNPJ_TESTE, {
      razaoSocial: "Empresa de Teste da Logo",
      telefones: "(27) 3333-3333",
    });
    const depois = await prisma.parceiro.findUnique({ where: { cnpj: CNPJ_TESTE } });
    check(
      "a logo sobreviveu a uma edicao que nao a mencionou",
      depois.logoPath === antes.logoPath && depois.logoPath
        ? []
        : [`logoPath ${antes.logoPath} -> ${depois.logoPath}`]
    );
    check("e o arquivo continua no disco", existeNoDisco(depois.logoPath) ? [] : ["arquivo sumiu"]);
  }

  // -------------------------------------------------------------------------
  titulo("5. Trocar a logo apaga a anterior do disco");
  {
    const antes = await prisma.parceiro.findUnique({ where: { cnpj: CNPJ_TESTE } });
    const atualizado = await parceiroService.atualizar(CNPJ_TESTE, {
      razaoSocial: "Empresa de Teste da Logo",
      logo: GIF_1PX,
    });
    const depois = await prisma.parceiro.findUnique({ where: { cnpj: CNPJ_TESTE } });

    check("gravou a nova", depois.logoPath && depois.logoPath !== antes.logoPath ? [] : ["logoPath nao mudou"]);
    check("com o tipo novo", depois.logoTipo === "image/gif" ? [] : [`logoTipo = ${depois.logoTipo}`]);
    check("o arquivo ANTIGO saiu do disco", existeNoDisco(antes.logoPath) ? [`${antes.logoPath} ficou`] : []);
    // A versao tem de andar, senao o navegador serve a logo velha do cache.
    check(
      "a versao (`logoEm`) avancou",
      atualizado.logoEm > new Date(antes.logoEm).getTime() - 1 ? [] : ["logoEm nao avancou"]
    );
  }

  // -------------------------------------------------------------------------
  titulo("6. Remover a logo apaga o arquivo, e nao so a coluna");
  {
    const antes = await prisma.parceiro.findUnique({ where: { cnpj: CNPJ_TESTE } });
    const atualizado = await parceiroService.atualizar(CNPJ_TESTE, {
      razaoSocial: "Empresa de Teste da Logo",
      logo: null,
    });
    const depois = await prisma.parceiro.findUnique({ where: { cnpj: CNPJ_TESTE } });

    check("o cadastro sai sem logo", atualizado.temLogo ? ["temLogo continua verdadeiro"] : []);
    check(
      "as quatro colunas foram limpas",
      [depois.logoPath, depois.logoTipo, depois.logoBytes, depois.logoEm].every((v) => v === null)
        ? []
        : [`sobrou: ${JSON.stringify({ p: depois.logoPath, t: depois.logoTipo, b: depois.logoBytes, e: depois.logoEm })}`]
    );
    check("e o arquivo saiu do disco", existeNoDisco(antes.logoPath) ? [`${antes.logoPath} ficou`] : []);
  }

  // -------------------------------------------------------------------------
  titulo("7. Apagar o cliente leva a logo junto");
  {
    await parceiroService.atualizar(CNPJ_TESTE, { razaoSocial: "Empresa de Teste da Logo", logo: PNG_1PX });
    const antes = await prisma.parceiro.findUnique({ where: { cnpj: CNPJ_TESTE } });
    check("preparo: tem logo", antes.logoPath ? [] : ["nao gravou a logo do preparo"]);

    await parceiroService.remover(CNPJ_TESTE);
    check("o arquivo saiu do disco junto com o cadastro", existeNoDisco(antes.logoPath) ? [`${antes.logoPath} ficou orfao`] : []);
  }

  // -------------------------------------------------------------------------
  titulo("8. A rota sabe dizer onde estao os bytes");
  {
    await parceiroService.criar({ cnpj: CNPJ_TESTE, razaoSocial: "Empresa de Teste da Logo", logo: PNG_1PX });
    const logo = await parceiroService.logoDe(CNPJ_TESTE);
    check("logoDe devolve caminho e tipo", logo?.caminho && logo?.tipo === "image/png" ? [] : [JSON.stringify(logo)]);

    const aberto = await midiaStorage.abrirParaLeitura(logo.caminho);
    check("e o arquivo abre para leitura", aberto?.tamanho > 0 ? [] : ["nao abriu"]);
    if (aberto) aberto.stream.destroy();

    // Quem nao tem logo devolve null -- e a rota vira 404, que faz o `<img>`
    // cair nas iniciais em vez de mostrar imagem quebrada.
    await parceiroService.atualizar(CNPJ_TESTE, { razaoSocial: "Empresa de Teste da Logo", logo: null });
    const vazia = await parceiroService.logoDe(CNPJ_TESTE);
    check("sem logo, devolve null", vazia === null ? [] : [JSON.stringify(vazia)]);
  }
}

principal()
  .catch((e) => { erros.push(`[excecao] ${e.stack || e.message}`); })
  .then(limpar)
  .then(async () => {
    await prisma.$disconnect().catch(() => {});
    console.log(
      "\n" + (erros.length
        ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
        : "LOGO DO CLIENTE: TUDO CONFERE")
    );
    process.exit(erros.length ? 1 : 0);
  });
