/**
 * FLUXOS: O QUE FOI SALVO E O QUE VOLTA DEPOIS DO F5.
 *
 * ── A PERGUNTA QUE ESTE ARQUIVO RESPONDE ───────────────────────────────────
 *
 * "Editei um bloco, cliquei em salvar, a tela aceitou. Recarreguei. Cade a
 * minha alteracao?"
 *
 * A resposta era: nunca saiu do navegador. E o motivo nao estava no editor --
 * estava no CONTRATO, e era circular:
 *
 *   mapPasso emite `texto: null` para bloco sem texto (coluna vazia no banco);
 *   passoSchema aceitava `z.string().optional()`, que e `string | undefined`.
 *
 * `null` nao passa em `.optional()`. Entao o PUT que devolvia EXATAMENTE o que
 * o GET tinha entregue morria em 400 na borda, sem tocar o banco. E como o
 * `syncFlowToParent` terminava em `catch {}`, a tela seguia mostrando a
 * alteracao aplicada. So o F5 contava a verdade.
 *
 * Bastava UM bloco sem texto -- uma anotacao, um gatilho, um delay -- para o
 * fluxo INTEIRO parar de salvar, porque `passos` e validado como array unico.
 *
 * ── O SEGUNDO DEFEITO, QUE SO APARECE OLHANDO O ID ─────────────────────────
 *
 * `update` fazia deleteMany + createMany com `randomUUID()` novo para cada
 * passo. Salvar um fluxo trocava a identidade de todos os blocos dele: o editor
 * ficava com ids que nao existiam mais, e qualquer referencia a um bloco que
 * nao fosse targetId/config.opcoes (a de uma sessao do bot em curso, a de um
 * log de execucao) ficava orfa na hora.
 *
 * Cria e apaga os proprios fluxos. Nenhum fluxo real e tocado.
 *
 *   cd server && node verificar-fluxos-crud.js
 */
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const prisma = require("./src/infrastructure/database/prisma.client");
const fluxoService = require("./src/modules/fluxos/fluxo.service");
const { atualizarFluxoSchema, atualizarPassoSchema } = require("./src/modules/fluxos/fluxo.dto");

const MARCA = "teste-crud-fluxo";
const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (ok, rotulo) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  if (!ok) erros.push(`[${secao}] ${rotulo}`);
};

async function limpar() {
  await prisma.fluxo.deleteMany({ where: { nome: { startsWith: MARCA } } });
}

async function main() {
  await limpar();

  // ─────────────────────────────────────────────────────────────────────────
  titulo("1. CREATE -- criar fluxo com blocos");

  const criado = await fluxoService.criar({
    nome: `${MARCA} principal`,
    gatilho: "*",
    ativo: true,
    passos: [
      { id: "tmp-1", tipo: "gatilho", titulo: "Inicio", targetId: "tmp-2" },
      { id: "tmp-2", tipo: "mensagem", titulo: "Saudacao", texto: "Bom dia", targetId: "tmp-3" },
      // Sem texto, sem desc, sem config: e este bloco que derrubava o fluxo todo.
      { id: "tmp-3", tipo: "comentario", titulo: "Anotacao da equipe" },
    ],
  });

  check(!!criado.id, "fluxo criado");
  check(criado.passos.length === 3, `os 3 blocos foram gravados (vieram ${criado.passos.length})`);

  const [inicio, saudacao, anotacao] = criado.passos;
  check(inicio.targetId === saudacao.id, "a ligacao 1->2 aponta para o id REAL do bloco gravado");
  check(saudacao.targetId === anotacao.id, "a ligacao 2->3 aponta para o id REAL do bloco gravado");
  check(anotacao.texto === null, "bloco sem texto e gravado como null (e o que o GET vai emitir)");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("2. O SERVIDOR ACEITA O PROPRIO RETRATO (a regressao do 400 mudo)");

  // Exatamente o ciclo do editor: le o fluxo, nao muda NADA, devolve.
  const retrato = await fluxoService.obter(criado.id);
  const comoVolta = atualizarFluxoSchema.safeParse({ passos: retrato.passos });
  check(comoVolta.success, "PUT /fluxos/:id aceita, sem alterar nada, o que o GET acabou de emitir");
  if (!comoVolta.success) {
    for (const i of comoVolta.error.issues) console.log(`         ${i.path.join(".")}: ${i.message}`);
  }

  // E a prova de que o `null` era mesmo o culpado, campo a campo.
  const soNulos = atualizarFluxoSchema.safeParse({
    passos: [{
      id: "x", tipo: "mensagem", titulo: "t",
      desc: null, descricao: null, texto: null, config: null,
      x: null, y: null, w: null, h: null, targetId: null, ordem: null,
    }],
  });
  check(soNulos.success, "null e aceito em desc/descricao/texto/config/x/y/w/h/targetId/ordem");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("3. UPDATE do fluxo -- e o id do bloco SOBREVIVE");

  const idsAntes = criado.passos.map((p) => p.id);
  const depois = await fluxoService.atualizar(criado.id, {
    passos: retrato.passos.map((p) =>
      p.id === saudacao.id ? { ...p, texto: "Boa tarde" } : p
    ),
  });

  const idsDepois = depois.passos.map((p) => p.id);
  check(
    JSON.stringify(idsAntes) === JSON.stringify(idsDepois),
    "salvar o fluxo NAO troca o id dos blocos (antes cada save gerava uuid novo para todos)"
  );
  check(
    depois.passos.find((p) => p.id === saudacao.id)?.texto === "Boa tarde",
    "a alteracao do texto foi de fato gravada"
  );
  check(
    depois.passos.find((p) => p.id === inicio.id)?.targetId === saudacao.id,
    "as ligacoes continuam de pe depois do save"
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("4. RELOAD -- o que o banco devolve e o que foi salvo");

  const relido = await fluxoService.obter(criado.id);
  check(
    relido.passos.find((p) => p.id === saudacao.id)?.texto === "Boa tarde",
    "reabrir o fluxo mostra o valor salvo, e nao o antigo"
  );
  check(relido.passos.length === 3, "nenhum bloco se perdeu no caminho");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("5. CRUD de BLOCO -- criar");

  const comNovo = await fluxoService.criarPasso(criado.id, {
    tipo: "mensagem",
    titulo: "Despedida",
    texto: "Ate logo",
  });
  check(comNovo.passos.length === 4, "bloco novo entrou no fluxo");
  const novo = comNovo.passos.find((p) => p.titulo === "Despedida");
  check(!!novo && novo.texto === "Ate logo", "o bloco novo guardou o texto");
  check(novo.ordem === 3, "entrou no fim da fila (ordem 3)");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("6. CRUD de BLOCO -- editar (o PATCH nao pode apagar o que nao citou)");

  await fluxoService.atualizarPasso(criado.id, novo.id, {
    config: { modo: "sem_resposta", minutos: 7 },
  });
  // Segundo PATCH mexendo SO no texto: o config gravado acima tem de sobreviver.
  const aposTexto = await fluxoService.atualizarPasso(criado.id, novo.id, { texto: "Ate breve" });
  const novoDepois = aposTexto.passos.find((p) => p.id === novo.id);

  check(novoDepois.texto === "Ate breve", "o texto foi atualizado");
  check(
    novoDepois.config && novoDepois.config.minutos === 7,
    "o config NAO foi apagado por um PATCH que so falava de texto"
  );
  check(novoDepois.titulo === "Despedida", "o titulo nao citado ficou intacto");

  // O mesmo pela borda: o schema parcial aceita um corpo minusculo.
  check(
    atualizarPassoSchema.safeParse({ texto: "so isto" }).success,
    "o schema do PATCH aceita um corpo com um campo so"
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("7. CRUD de BLOCO -- JSON de configuracao");

  const jsonRico = {
    opcoes: [
      { rotulo: "1", valor: "financeiro", targetId: null },
      { rotulo: "2", valor: "tecnico", targetId: null },
    ],
    mensagemInvalida: "Nao entendi",
    maxTentativas: 3,
  };
  const comJson = await fluxoService.atualizarPasso(criado.id, novo.id, { config: jsonRico });
  const lidoJson = comJson.passos.find((p) => p.id === novo.id).config;
  check(
    JSON.stringify(lidoJson) === JSON.stringify(jsonRico),
    "o JSON de configuracao volta identico ao que foi salvo (inclusive as opcoes)"
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("8. CRUD de BLOCO -- ligacao invalida e recusada");

  let recusouAlvoMorto = false;
  try {
    await fluxoService.atualizarPasso(criado.id, novo.id, { targetId: "id-que-nao-existe" });
  } catch (e) {
    recusouAlvoMorto = e.statusCode === 400;
  }
  check(recusouAlvoMorto, "apontar para um bloco inexistente da 400, em vez de gravar um fio morto");

  let recusouAutoAlvo = false;
  try {
    await fluxoService.atualizarPasso(criado.id, novo.id, { targetId: novo.id });
  } catch (e) {
    recusouAutoAlvo = e.statusCode === 400;
  }
  check(recusouAutoAlvo, "um bloco nao pode apontar para ele mesmo");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("9. CRUD de BLOCO -- bloco de OUTRO fluxo nao e alcancavel");

  const outro = await fluxoService.criar({
    nome: `${MARCA} outro`,
    gatilho: "outro",
    passos: [{ id: "o-1", tipo: "mensagem", titulo: "Do outro fluxo", texto: "nao mexa" }],
  });
  const passoAlheio = outro.passos[0].id;

  let barrouAlheio = false;
  try {
    await fluxoService.atualizarPasso(criado.id, passoAlheio, { texto: "invadido" });
  } catch (e) {
    barrouAlheio = e.statusCode === 404;
  }
  check(barrouAlheio, "editar um passo de outro fluxo pelo id da 404 (a PK de passo e global)");
  const intacto = await fluxoService.obter(outro.id);
  check(intacto.passos[0].texto === "nao mexa", "o bloco do outro fluxo ficou intacto");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("10. CRUD de BLOCO -- reordenar");

  const antesOrdem = (await fluxoService.obter(criado.id)).passos.map((p) => p.id);
  const invertido = [...antesOrdem].reverse();
  const reordenado = await fluxoService.reordenarPassos(criado.id, invertido);
  check(
    JSON.stringify(reordenado.passos.map((p) => p.id)) === JSON.stringify(invertido),
    "a nova ordem foi aplicada"
  );
  const releituraOrdem = await fluxoService.obter(criado.id);
  check(
    JSON.stringify(releituraOrdem.passos.map((p) => p.id)) === JSON.stringify(invertido),
    "a ordem sobrevive ao reload"
  );
  check(
    releituraOrdem.passos.find((p) => p.id === novo.id)?.texto === "Ate breve",
    "reordenar NAO mexeu no conteudo dos blocos"
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("11. CRUD de BLOCO -- apagar");

  const semNovo = await fluxoService.removerPasso(criado.id, novo.id);
  check(semNovo.passos.length === 3, "o bloco saiu do fluxo");
  check(!semNovo.passos.some((p) => p.id === novo.id), "e nao volta na releitura");
  check(
    !semNovo.passos.some((p) => p.targetId === novo.id),
    "quem apontava para o bloco removido ficou sem destino, e nao com um fio morto"
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("12. UPDATE parcial -- mexer no fluxo sem tocar nos passos");

  const soNome = await fluxoService.atualizar(criado.id, { nome: `${MARCA} renomeado` });
  check(soNome.nome === `${MARCA} renomeado`, "o nome mudou");
  check(soNome.passos.length === 3, "os blocos continuam la (passos ausente = nao mexa)");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("13. IMPORT -- ids de fora nao roubam passos de outro fluxo");

  // Simula o import: manda passos com o id de um passo que pertence a OUTRO
  // fluxo. Eles tem de virar blocos novos, e o fluxo de origem nao pode perder
  // nada.
  const importado = await fluxoService.criar({
    nome: `${MARCA} importado`,
    gatilho: "importado",
    passos: [{ id: passoAlheio, tipo: "mensagem", titulo: "Veio de fora", texto: "oi" }],
  });
  check(importado.passos[0].id !== passoAlheio, "o id de fora foi trocado por um novo");
  const origemAindaLa = await fluxoService.obter(outro.id);
  check(
    origemAindaLa.passos.length === 1 && origemAindaLa.passos[0].id === passoAlheio,
    "o fluxo de origem nao perdeu o passo dele"
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("14. DELETE do fluxo");

  await fluxoService.remover(importado.id);
  let sumiu = false;
  try { await fluxoService.obter(importado.id); } catch (e) { sumiu = e.statusCode === 404; }
  check(sumiu, "o fluxo apagado da 404");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("limpeza");
  await limpar();
  const sobrou = await prisma.fluxo.count({ where: { nome: { startsWith: MARCA } } });
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
    console.log("\nCRUD DE FLUXOS E BLOCOS: TUDO CONFERE");
  });
