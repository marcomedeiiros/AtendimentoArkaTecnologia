const crypto = require("crypto");
const prisma = require("../database/prisma.client");

// ── TODA LIGACAO ENTRE BLOCOS PRECISA SER REMAPEADA. TODA. ──────────────────
//
// Fluxos importados guardam as ramificacoes em `config.opcoes`, e cada opcao tem
// seu proprio `targetId`. Toda vez que um id de passo muda -- e no IMPORT muda
// sempre, porque ids de fora nao sao nossos --, esses destinos precisam do mesmo
// remapeamento do targetId principal; senao as ramificacoes apontam para passos
// inexistentes no primeiro reload.
//
// A lista de campos de ligacao esta declarada em `LIGACOES_NO_CONFIG` de
// proposito. Antes, o unico campo tratado era `config.opcoes[].targetId`, e a
// funcao inclusive DESISTIA cedo (`if (!Array.isArray(config.opcoes)) return
// config`) -- entao qualquer ligacao nova guardada fora de `opcoes` era
// silenciosamente esquecida, e o defeito so aparecia na conversa do cliente. O
// campo `targetIdNaoCadastrado` (a saida do CNPJ que nao esta na base) e o
// primeiro caso; o proximo entra nesta lista e passa a funcionar de graca.
const LIGACOES_NO_CONFIG = ["targetIdNaoCadastrado"];

function remapearConfig(config, alvo) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return config;

  const saida = { ...config };

  if (Array.isArray(config.opcoes)) {
    saida.opcoes = config.opcoes.map((op) =>
      op && typeof op === "object" ? { ...op, targetId: alvo(op.targetId) } : op
    );
  }

  for (const campo of LIGACOES_NO_CONFIG) {
    // So mexe no que EXISTE: gravar `targetIdNaoCadastrado: null` em todo bloco
    // sujaria o config de fluxos que nao usam a saida alternativa.
    if (config[campo] !== undefined) saida[campo] = alvo(config[campo]);
  }

  return saida;
}

// Traduz um passo do formato do editor para o das colunas. `alvo` resolve as
// ligacoes (targetId e config.opcoes[].targetId) pelo mapa montado em
// `resolverIds`.
function paraColunas(p, index, alvo) {
  return {
    tipo: p.tipo,
    titulo: p.titulo,
    descricao: p.descricao || p.desc || null,
    texto: p.texto || null,
    config: p.config ? remapearConfig(p.config, alvo) : null,
    posX: p.x ?? p.posX ?? null,
    posY: p.y ?? p.posY ?? null,
    largura: p.w ?? p.largura ?? null,
    altura: p.h ?? p.altura ?? null,
    targetId: alvo(p.targetId),
    ordem: p.ordem ?? index,
  };
}

/**
 * DECIDE O ID DE CADA PASSO -- e essa decisao e a diferenca entre o editor
 * funcionar e o editor mentir.
 *
 * ── O QUE ACONTECIA ANTES ─────────────────────────────────────────────────
 *
 * `update` fazia `deleteMany` + `createMany`, e o antigo `montarPassos` gerava
 * um `randomUUID()` NOVO para cada passo a cada gravacao. Ou seja: salvar um
 * fluxo trocava a identidade de todos os blocos dele.
 *
 * O estrago e maior do que parece:
 *
 *   - o editor segue com ids que nao existem mais no banco. A gravacao seguinte
 *     manda ids fantasma, e o servidor os trata como blocos novos;
 *   - o remapeamento so cobre `targetId` e `config.opcoes[].targetId`. Qualquer
 *     outra referencia a um bloco (o `passoId` de uma SessaoChatbot em curso, o
 *     de um LogExecucaoFluxo) fica orfa na hora;
 *   - salvar UM bloco exigia reescrever todos, entao duas telas abertas no
 *     mesmo fluxo se sobrescreviam;
 *   - e o historico de execucao perdia o vinculo com o bloco que executou.
 *
 * ── O QUE PASSA A ACONTECER ───────────────────────────────────────────────
 *
 * Id de passo e IDENTIDADE, e identidade nao se troca ao salvar. Id novo so
 * quando o passo e novo de verdade:
 *
 *   - ja existe NESTE fluxo  -> mantem o id (vira UPDATE);
 *   - nao existe             -> ganha um uuid novo (vira CREATE).
 *
 * A segunda condicao e o que cobre o import: um JSON de fora traz ids que nao
 * sao nossos -- ou que sao de OUTRO fluxo, ja que a PK e global -- e esses
 * precisam ser novos, senao o import roubaria passos de outro fluxo. Como o
 * mapa e montado antes de gravar, as ligacoes acompanham a troca.
 *
 * Id repetido dentro do mesmo payload tambem e tratado: o primeiro fica com
 * ele, o segundo vira passo novo. Antes isso corrompia em silencio -- o Map
 * colapsava as chaves iguais, a lista de ids ficava mais curta que a de passos,
 * e os ultimos gravavam com `id: undefined`.
 */
function resolverIds(passos, idsExistentes) {
  const existentes = new Set(idsExistentes);
  const usados = new Set();
  const idMap = new Map();

  const finais = passos.map((p) => {
    const original = p.id || null;
    const manter = original && existentes.has(original) && !usados.has(original);
    const id = manter ? original : crypto.randomUUID();
    usados.add(id);
    // O mapa vai do id QUE O EDITOR USA para o id gravado. Quando sao o mesmo, a
    // entrada e inofensiva; quando nao sao, e ela que salva as ligacoes.
    if (original && !idMap.has(original)) idMap.set(original, id);
    return id;
  });

  // Ligacao para um passo que nao veio no payload vira null, em vez de apontar
  // para o vazio: o motor le `targetId` como "proximo", e um id morto ali
  // pararia a conversa no meio sem registrar por que.
  const alvo = (antigo) => (antigo && idMap.get(antigo)) || null;
  return { finais, alvo };
}

const INCLUI_PASSOS = { passos: { orderBy: { ordem: "asc" } } };

class FluxoRepository {
  findAll() {
    return prisma.fluxo.findMany({ include: INCLUI_PASSOS, orderBy: { nome: "asc" } });
  }

  findById(id) {
    return prisma.fluxo.findUnique({ where: { id }, include: INCLUI_PASSOS });
  }

  findAtivos() {
    return prisma.fluxo.findMany({ where: { ativo: true }, include: INCLUI_PASSOS });
  }

  findByGatilho(gatilho) {
    return prisma.fluxo.findFirst({
      where: { ativo: true, gatilho: { equals: gatilho } },
      include: INCLUI_PASSOS,
    });
  }

  // `fluxoId` no where nao e enfeite: sem ele, um passoId de OUTRO fluxo seria
  // encontrado e editado por quem pediu este. A PK de PassoFluxo e global.
  findPasso(fluxoId, passoId) {
    return prisma.passoFluxo.findFirst({ where: { id: passoId, fluxoId } });
  }

  create(data, passos = []) {
    return prisma.$transaction(async (tx) => {
      const fluxo = await tx.fluxo.create({ data });
      if (passos.length) {
        // Fluxo recem-criado nao tem passo nenhum: todo id aqui e novo.
        const { finais, alvo } = resolverIds(passos, []);
        await tx.passoFluxo.createMany({
          data: passos.map((p, i) => ({ id: finais[i], fluxoId: fluxo.id, ...paraColunas(p, i, alvo) })),
        });
      }
      return tx.fluxo.findUnique({ where: { id: fluxo.id }, include: INCLUI_PASSOS });
    });
  }

  /**
   * Grava o fluxo. `passos` ausente (undefined) quer dizer "nao mexa nos
   * passos" -- e o que permite renomear ou pausar um fluxo sem reescrever o
   * desenho. Um array VAZIO continua querendo dizer "apague todos", que e o
   * unico jeito de esvaziar um fluxo pela tela.
   *
   * A gravacao virou DIFERENCA em vez de "apaga tudo e recria": atualiza o que
   * ja existe, cria o que e novo, apaga o que saiu do desenho. Ver `resolverIds`.
   */
  update(id, data, passos) {
    return prisma.$transaction(async (tx) => {
      // `fluxo.update` com data vazio dispararia um UPDATE a toa e mexeria em
      // `atualizadoEm` (@updatedAt) sem nada ter mudado.
      if (data && Object.keys(data).length) {
        await tx.fluxo.update({ where: { id }, data });
      }

      if (passos) {
        const atuais = await tx.passoFluxo.findMany({ where: { fluxoId: id }, select: { id: true } });
        const { finais, alvo } = resolverIds(passos, atuais.map((p) => p.id));
        const manter = new Set(finais);

        // 1. Fora do desenho, fora do banco.
        const remover = atuais.filter((p) => !manter.has(p.id)).map((p) => p.id);
        if (remover.length) {
          await tx.passoFluxo.deleteMany({ where: { fluxoId: id, id: { in: remover } } });
        }

        // 2. Os que ficam: UPDATE no lugar (id preservado) ou CREATE se e novo.
        //    Sequencial de proposito -- e uma transacao do SQLite, que escreve
        //    uma coisa de cada vez; `Promise.all` aqui trocaria clareza por
        //    contencao de lock.
        const sobreviventes = new Set(atuais.map((p) => p.id));
        for (let i = 0; i < passos.length; i++) {
          const colunas = paraColunas(passos[i], i, alvo);
          const passoId = finais[i];
          if (sobreviventes.has(passoId)) {
            await tx.passoFluxo.update({ where: { id: passoId }, data: colunas });
          } else {
            await tx.passoFluxo.create({ data: { id: passoId, fluxoId: id, ...colunas } });
          }
        }
      }

      return tx.fluxo.findUnique({ where: { id }, include: INCLUI_PASSOS });
    });
  }

  // ── CRUD de um passo so ──────────────────────────────────────────────────
  //
  // Existe para o botao "Salvar" do painel de propriedades nao precisar
  // reenviar o fluxo inteiro. Alem de mais barato, e mais SEGURO: duas pessoas
  // editando blocos diferentes do mesmo fluxo deixam de se sobrescrever, porque
  // cada uma toca so a sua linha.

  criarPasso(fluxoId, passo) {
    return prisma.$transaction(async (tx) => {
      // Entra no fim da fila por padrao; `ordem` explicita continua valendo.
      const total = await tx.passoFluxo.count({ where: { fluxoId } });
      // Bloco novo so pode apontar para ids que ja existem -- nao ha mapa de
      // renomeacao a aplicar aqui.
      const alvo = (antigo) => antigo || null;
      await tx.passoFluxo.create({
        data: { id: crypto.randomUUID(), fluxoId, ...paraColunas(passo, total, alvo) },
      });
      return tx.fluxo.findUnique({ where: { id: fluxoId }, include: INCLUI_PASSOS });
    });
  }

  /**
   * Atualiza UM passo. `campos` ja vem peneirado pelo service: so entra aqui o
   * que o cliente mandou de fato, para um PATCH parcial nao apagar com `null` o
   * que ele nem citou.
   */
  atualizarPasso(fluxoId, passoId, campos) {
    return prisma.$transaction(async (tx) => {
      await tx.passoFluxo.update({ where: { id: passoId }, data: campos });
      return tx.fluxo.findUnique({ where: { id: fluxoId }, include: INCLUI_PASSOS });
    });
  }

  removerPasso(fluxoId, passoId) {
    return prisma.$transaction(async (tx) => {
      await tx.passoFluxo.deleteMany({ where: { id: passoId, fluxoId } });
      // Quem apontava para o bloco removido fica SEM destino, e nao apontando
      // para um id morto -- mesma razao do `alvo` em resolverIds.
      await tx.passoFluxo.updateMany({
        where: { fluxoId, targetId: passoId },
        data: { targetId: null },
      });
      return tx.fluxo.findUnique({ where: { id: fluxoId }, include: INCLUI_PASSOS });
    });
  }

  /**
   * Reordena pela lista de ids. So mexe em `ordem` -- nao carrega dado de bloco
   * nenhum, entao uma reordenacao nunca sobrescreve uma edicao em curso. Id que
   * nao e deste fluxo e ignorado; passo nao citado vai para o fim, preservando
   * a ordem relativa que ja tinha.
   */
  reordenarPassos(fluxoId, ids) {
    return prisma.$transaction(async (tx) => {
      const atuais = await tx.passoFluxo.findMany({
        where: { fluxoId },
        select: { id: true },
        orderBy: { ordem: "asc" },
      });
      const validos = new Set(atuais.map((p) => p.id));
      const ordenados = ids.filter((id) => validos.has(id));
      const vistos = new Set(ordenados);
      const restantes = atuais.map((p) => p.id).filter((id) => !vistos.has(id));

      const ordemFinal = [...ordenados, ...restantes];
      for (let i = 0; i < ordemFinal.length; i++) {
        await tx.passoFluxo.update({ where: { id: ordemFinal[i] }, data: { ordem: i } });
      }
      return tx.fluxo.findUnique({ where: { id: fluxoId }, include: INCLUI_PASSOS });
    });
  }

  delete(id) {
    return prisma.$transaction(async (tx) => {
      // 1. Apaga todos os blocos/passos vinculados ao fluxo
      await tx.passoFluxo.deleteMany({ where: { fluxoId: id } });
      // 2. Apaga histórico de logs de execução deste fluxo
      await tx.logExecucaoFluxo.deleteMany({ where: { fluxoId: id } });
      // 3. Desassocia sessões ativas que apontavam para este fluxo
      await tx.sessaoChatbot.updateMany({
        where: { fluxoAtualId: id },
        data: { fluxoAtualId: null, passoAtualId: null, ativo: false },
      });
      // 4. Exclui o fluxo
      return tx.fluxo.delete({ where: { id } });
    });
  }

  // SEM ROTA HTTP. O `DELETE /api/fluxos` e o botao "Apagar todos os fluxos" do
  // editor foram removidos: apagar toda a automacao do bot nao pode ser um
  // clique numa tela. Fica aqui para script de reset/seed rodado no console,
  // onde existe alguem confirmando -- nao reexponha por uma rota.
  deleteAll() {
    return prisma.fluxo.deleteMany({});
  }

  createLog(data) {
    return prisma.logExecucaoFluxo.create({ data });
  }
}

module.exports = new FluxoRepository();
