/**
 * CLIENTE AVULSO x CLIENTE CADASTRADO -- a badge diz o que o sistema decidiu?
 *
 * ── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * Cliente atendido como AVULSO aparecia na Central como "Cliente Identificado".
 *
 * O motor SEMPRE soube a diferenca. `validarCnpjRecebido` termina com:
 *
 *     return { valido: true, estado: parceiro ? "cadastrado" : "avulso", ... };
 *
 * So que a classificacao morria ali: vivia no retorno da funcao e numa linha de
 * log. O que ia para o banco, nos TRES pontos de gravacao (o motor, o atendente
 * digitando um CNPJ na resposta, e o "validar CNPJ" da Central), era igual para
 * os dois casos:
 *
 *     { cnpj, empresa: parceiro?.razaoSocial || null, cnpjVerificado: true }
 *
 * A tela so tinha "verificou o CNPJ?" para perguntar, e a resposta era sim nos
 * dois. Um avulso nao tem razao social conhecida, entao `empresa` vinha null e o
 * rotulo caia no literal 'CLIENTE IDENTIFICADO'.
 *
 * E havia um SEGUNDO caminho de avulso que nao gravava nada: quando as
 * tentativas de CNPJ se esgotam e o fluxo esta configurado com
 * `aoEsgotarTentativas: "avulso"`, o motor logava, transferia para humano, e a
 * conversa seguia com `cnpjVerificado: false` -- a Central dizia "CLIENTE NAO
 * IDENTIFICADO". O sistema decidiu e a tela nao ficou sabendo.
 *
 * ── O QUE ESTE ARQUIVO MEDE ────────────────────────────────────────────────
 *
 * Roda o MOTOR de verdade (com repositorios em memoria, via chatbot.simulador),
 * cobre os dois caminhos de avulso e o de cadastrado, e depois passa o
 * resultado pela regra REAL da badge -- extraida do AtendimentoView, nao uma
 * copia -- para conferir o rotulo que apareceria na tela.
 *
 *   cd server && node verificar-cliente-avulso.js
 */
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const fs = require("fs");
const path = require("path");
const prisma = require("./src/infrastructure/database/prisma.client");
const conversaService = require("./src/modules/conversas/conversa.service");
const parceiroRepository = require("./src/infrastructure/repositories/parceiro.repository");
const { mapConversa } = require("./src/shared/helpers/mapper.helper");

const MARCA = "teste-avulso";
const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (ok, rotulo) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  if (!ok) erros.push(`[${secao}] ${rotulo}`);
};

// ── A REGRA DA BADGE, tirada do proprio front ───────────────────────────────
//
// Recorta `tipoDoCliente` e `chipDoCliente` do AtendimentoView e as avalia
// aqui. Copiar as regras para dentro deste arquivo faria o teste concordar com
// ele mesmo enquanto a tela seguisse errada.
function carregarBadge() {
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "client", "src", "components", "pages", "AtendimentoView.jsx"),
    "utf8"
  );
  // Recorte por CONTAGEM DE CHAVES, e nao por um comentario que sirva de
  // marcador: marcador de texto quebra na primeira vez que alguem reescreve o
  // comentario vizinho, e o recorte passa a arrastar JSX junto.
  const recorta = (nome) => {
    const i = fonte.indexOf(`function ${nome}(`);
    if (i === -1) throw new Error(`${nome} nao encontrada no AtendimentoView -- foi renomeada?`);
    const abre = fonte.indexOf("{", i);
    let nivel = 0;
    for (let j = abre; j < fonte.length; j++) {
      if (fonte[j] === "{") nivel++;
      else if (fonte[j] === "}") {
        nivel--;
        if (nivel === 0) return fonte.slice(i, j + 1);
      }
    }
    throw new Error(`nao consegui delimitar ${nome}`);
  };
  const trecho = [
    recorta("empresaDaConversa"),
    recorta("tipoDoCliente"),
    recorta("chipDoCliente"),
  ].join("\n\n");

  const mod = {};
  new Function(
    "exports", "limparCnpj",
    trecho + "\n;exports.chip = chipDoCliente; exports.tipo = tipoDoCliente;"
  )(mod, (v) => String(v || "").replace(/\D/g, ""));
  return mod;
}

const badge = carregarBadge();

// CNPJs validos (digito verificador correto) -- o motor recusa numero torto
// antes de chegar na consulta de parceiro, e o teste mediria outra coisa.
const CNPJ_PARCEIRO = "11222333000181";
const CNPJ_FORA = "04252011000110";

async function limpar() {
  await prisma.mensagem.deleteMany({ where: { conversa: { cliente: { startsWith: MARCA } } } });
  await prisma.atendimento.deleteMany({ where: { conversa: { cliente: { startsWith: MARCA } } } });
  await prisma.conversa.updateMany({ where: { cliente: { startsWith: MARCA } }, data: { atendimentoAtualId: null } });
  await prisma.conversa.deleteMany({ where: { cliente: { startsWith: MARCA } } });
  await prisma.parceiro.deleteMany({ where: { razaoSocial: { startsWith: MARCA } } });
}

async function criarConversa(instanciaId, extra = {}) {
  return prisma.conversa.create({
    data: {
      telefone: `55119${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
      cliente: `${MARCA} cliente`,
      setor: "Geral",
      statusAtendimento: "aberta",
      instanciaId,
      ...extra,
    },
  });
}

async function main() {
  await limpar();

  const instancia = await prisma.instancia.findFirst();
  if (!instancia) throw new Error("sem instancia no banco -- rode o seed (npm run db:seed)");

  await prisma.parceiro.create({
    data: { cnpj: CNPJ_PARCEIRO, razaoSocial: `${MARCA} Empresa Parceira`, status: "ativo" },
  });
  const parceirosNaTela = (await parceiroRepository.listar?.()) || [
    { cnpj: CNPJ_PARCEIRO, razaoSocial: `${MARCA} Empresa Parceira`, status: "ativo" },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  titulo("1. CNPJ de parceiro ativo -> CADASTRADO");

  let conversa = await criarConversa(instancia.id);
  await conversaService.validarCnpjManual(conversa.id, CNPJ_PARCEIRO);
  let noBanco = await prisma.conversa.findUnique({ where: { id: conversa.id } });

  check(noBanco.clienteTipo === "cadastrado", `o banco grava clienteTipo="${noBanco.clienteTipo}"`);
  check(noBanco.cnpjVerificado === true, "e cnpjVerificado = true");

  let dto = mapConversa(noBanco);
  check(dto.clienteTipo === "cadastrado", "a API devolve clienteTipo");
  check(
    badge.chip(dto, parceirosNaTela).label.includes("PARCEIRA"),
    `a badge mostra o nome da empresa: "${badge.chip(dto, parceirosNaTela).label}"`
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("2. CNPJ valido FORA da lista -> AVULSO (o defeito relatado)");

  conversa = await criarConversa(instancia.id);
  await conversaService.validarCnpjManual(conversa.id, CNPJ_FORA);
  noBanco = await prisma.conversa.findUnique({ where: { id: conversa.id } });

  check(noBanco.clienteTipo === "avulso", `o banco grava clienteTipo="${noBanco.clienteTipo}"`);
  check(noBanco.empresa === null, "sem razao social (nao ha parceiro para dar o nome)");

  dto = mapConversa(noBanco);
  let chip = badge.chip(dto, parceirosNaTela);
  check(chip.label === "CLIENTE AVULSO", `a badge diz "${chip.label}"`);
  check(!/IDENTIFICADO/.test(chip.label), "e NAO diz mais 'CLIENTE IDENTIFICADO'");
  check(badge.tipo(dto, parceirosNaTela) === "avulso", "o tipo resolvido e avulso");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("3. O MOTOR classifica igual (o caminho do bot, nao o do atendente)");

  const simulador = require("./src/modules/chatbot/chatbot.simulador");
  check(typeof simulador === "object", "o simulador carrega");

  const { ChatbotEngine } = require("./src/modules/chatbot/chatbot.engine");
  const gravado = {};
  const motor = new ChatbotEngine({
    conversaRepository: {
      update: async (id, data) => { Object.assign(gravado, data); return data; },
    },
    parceiroRepository: {
      findAtivoByCnpj: async (c) => (c === CNPJ_PARCEIRO ? { razaoSocial: "Parceira SA" } : null),
    },
  });

  let r = await motor.validarCnpjRecebido({ id: "c1" }, CNPJ_PARCEIRO, {});
  check(r.estado === "cadastrado", `parceiro -> estado="${r.estado}"`);
  check(gravado.clienteTipo === "cadastrado", `e GRAVA clienteTipo="${gravado.clienteTipo}" (antes nao gravava)`);

  Object.keys(gravado).forEach((k) => delete gravado[k]);
  r = await motor.validarCnpjRecebido({ id: "c2" }, CNPJ_FORA, {});
  check(r.estado === "avulso", `fora da lista -> estado="${r.estado}"`);
  check(gravado.clienteTipo === "avulso", `e GRAVA clienteTipo="${gravado.clienteTipo}"`);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("4. O SEGUNDO caminho de avulso: tentativas esgotadas pelo fluxo");

  // Aqui nenhum CNPJ foi confirmado -- `cnpjVerificado` fica false de proposito.
  // O que se sabe e o TIPO, e antes ele nao era gravado em lugar nenhum.
  conversa = await criarConversa(instancia.id, { clienteTipo: "avulso" });
  noBanco = await prisma.conversa.findUnique({ where: { id: conversa.id } });
  dto = mapConversa(noBanco);

  check(dto.cnpjVerificado === false, "cnpjVerificado continua false (nenhum CNPJ foi confirmado)");
  chip = badge.chip(dto, parceirosNaTela);
  check(chip.label === "CLIENTE AVULSO", `mesmo assim a badge diz "${chip.label}"`);
  check(
    !/NAO IDENTIFICADO|NÃO IDENTIFICADO/.test(chip.label),
    "e NAO cai em 'CLIENTE NAO IDENTIFICADO', que era o que aparecia antes"
  );

  // Confere que o motor grava isso mesmo neste caminho.
  const engineSrc = fs.readFileSync(path.join(__dirname, "src/modules/chatbot/chatbot.engine.js"), "utf8");
  const trechoEsgotou = engineSrc.slice(
    engineSrc.indexOf('aoEsgotarTentativas === "avulso"'),
    engineSrc.indexOf('motivo: "cliente_avulso"')
  );
  check(
    /clienteTipo: "avulso"/.test(trechoEsgotou),
    "o caminho 'tentativas esgotadas -> avulso' grava clienteTipo antes de transferir"
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("5. Sem CNPJ e sem classificacao -> NAO IDENTIFICADO (nada mudou)");

  conversa = await criarConversa(instancia.id);
  dto = mapConversa(await prisma.conversa.findUnique({ where: { id: conversa.id } }));
  chip = badge.chip(dto, parceirosNaTela);
  check(chip.label === "CLIENTE NÃO IDENTIFICADO", `conversa nova -> "${chip.label}"`);
  check(badge.tipo(dto, parceirosNaTela) === null, "e o tipo e null, nao 'avulso'");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("6. Conversa ANTIGA, anterior a coluna, nao fica dizendo 'identificado'");

  // Sem `clienteTipo` gravado, mas com CNPJ verificado que nao e de parceiro:
  // e o retrato de toda conversa que ja existia antes desta mudanca.
  const antiga = mapConversa({
    id: "x", cliente: "c", telefone: "5511", mensagens: [],
    cnpj: CNPJ_FORA, empresa: null, cnpjVerificado: true, clienteTipo: null,
  });
  check(antiga.clienteTipo === null, "a conversa antiga nao tem clienteTipo");
  chip = badge.chip(antiga, parceirosNaTela);
  check(chip.label === "CLIENTE AVULSO", `e mesmo assim a badge diz "${chip.label}"`);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("7. O cadastro VIVO continua mandando (nao congelamos a classificacao)");

  // Cliente classificado avulso cuja empresa foi cadastrada como parceira
  // DEPOIS: a consulta ao vivo ganha, e ele passa a aparecer como cadastrado.
  // Essa releitura ja existia de proposito e nao podia ser trocada por um valor
  // congelado no banco.
  const virouParceiro = mapConversa({
    id: "y", cliente: "c", telefone: "5511", mensagens: [],
    cnpj: CNPJ_PARCEIRO, empresa: null, cnpjVerificado: true, clienteTipo: "avulso",
  });
  check(
    badge.tipo(virouParceiro, parceirosNaTela) === "cadastrado",
    "gravado como avulso, mas parceiro ativo AGORA -> a badge mostra cadastrado"
  );

  // E o contrario: parceiro que perdeu o contrato vira avulso, mantendo o nome.
  const perdeuContrato = mapConversa({
    id: "z", cliente: "c", telefone: "5511", mensagens: [],
    cnpj: CNPJ_PARCEIRO, empresa: "Antiga Parceira", cnpjVerificado: true, clienteTipo: "cadastrado",
  });
  // O nome vem do cadastro VIVO quando ele existe (mesmo inativo), e so cai em
  // `conversa.empresa` quando o parceiro sumiu da lista -- comportamento que ja
  // era assim e nao foi tocado.
  chip = badge.chip(perdeuContrato, [
    { cnpj: CNPJ_PARCEIRO, razaoSocial: "Antiga Parceira", status: "inativo" },
  ]);
  check(/AVULSO/.test(chip.label), `parceiro inativo hoje -> "${chip.label}"`);
  check(/ANTIGA PARCEIRA/.test(chip.label), "e o nome conhecido continua a vista");

  // Parceiro que saiu da lista por completo: o nome gravado na conversa e o que
  // sobra.
  const semCadastro = badge.chip(perdeuContrato, []);
  check(
    semCadastro.label === "ANTIGA PARCEIRA · AVULSO",
    `parceiro fora da lista -> "${semCadastro.label}" (nome vindo de conversa.empresa)`
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("8. O estado vem do SERVIDOR (sobrevive a F5 e a troca de conversa)");

  conversa = await criarConversa(instancia.id);
  await conversaService.validarCnpjManual(conversa.id, CNPJ_FORA);
  // Reler pelo caminho que a tela usa: obter() -> mapConversa.
  const relida = await conversaService.obter(conversa.id);
  check(relida.clienteTipo === "avulso", "reabrir a conversa devolve clienteTipo do banco");
  check(
    badge.chip(relida, parceirosNaTela).label === "CLIENTE AVULSO",
    "e a badge continua avulso depois do reload"
  );

  const naListagem = (await conversaService.listar()).find((c) => c.id === conversa.id);
  check(naListagem?.clienteTipo === "avulso", "a LISTAGEM tambem traz o tipo (o cartao usa a mesma badge)");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("limpeza");
  await limpar();
  const sobrou = await prisma.conversa.count({ where: { cliente: { startsWith: MARCA } } });
  check(sobrou === 0, `limpeza completa (sobraram ${sobrou})`);
}

main()
  .catch((e) => { erros.push(`excecao: ${e.message}`); console.error(e); })
  .finally(async () => {
    await limpar().catch(() => {});
    await prisma.$disconnect();
    if (erros.length) {
      console.log(`\nFALHAS (${erros.length}):`);
      for (const e of erros) console.log(`  ${e}`);
      process.exit(1);
    }
    console.log("\nTIPO DO CLIENTE (CADASTRADO x AVULSO): TUDO CONFERE");
  });
