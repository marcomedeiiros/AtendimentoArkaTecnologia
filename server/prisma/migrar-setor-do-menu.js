/**
 * GRAVA O SETOR NAS OPCOES DO MENU do fluxo vivo.
 *
 * A regra "setor so por escolha do cliente" depende de cada opcao do menu
 * principal declarar QUAL setor ela representa (`opcao.setor`), porque e isso
 * que `chatbot.engine.aplicarOpcao` persiste no instante da escolha. Sem o
 * campo, o cliente escolhe "1 - Setor Tecnico" e a conversa continua sem setor:
 * o motor nao tem o que gravar.
 *
 * O `docs/fluxo-arka.json` e apenas um EXPORT -- o fluxo que atende de verdade
 * mora em `fluxo_passos.config` no banco de cada instalacao. Por isso isto e um
 * script, e nao uma alteracao de codigo: cada banco precisa receber a sua.
 *
 * Tambem marca "INFORMAR OUTRO CNPJ" com `limparCnpj: true`, para essa opcao
 * desassociar o CNPJ antes de pedir o proximo (senao a etapa de CNPJ ofereceria
 * de volta exatamente o numero que o cliente acabou de recusar).
 *
 * IDEMPOTENTE: rodar de novo nao muda nada. Casa a opcao pelas PALAVRAS-CHAVE, e
 * nao pelo id, porque o editor regenera os ids a cada importacao do fluxo.
 *
 * NAO RODA NO DEPLOY -- passo de dados no entrypoint ja derrubou a API uma vez.
 * Rode a mao:
 *
 *   node prisma/migrar-setor-do-menu.js            # simulacao (nao grava)
 *   node prisma/migrar-setor-do-menu.js --aplicar  # grava
 *
 * Na VM:
 *   docker exec arka-api node prisma/migrar-setor-do-menu.js
 *   docker exec arka-api node prisma/migrar-setor-do-menu.js --aplicar
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const aplicar = process.argv.includes("--aplicar");

// Nomes canonicos do servidor (shared/helpers/setor.helper.js). "Adm/Financeiro"
// no menu do cliente e "Financeiro" no banco -- e o mesmo setor.
const REGRAS = [
  { setor: "Técnico", chaves: ["tecnico", "técnico", "setor tecnico", "suporte tecnico"] },
  { setor: "Comercial", chaves: ["comercial", "vendas"] },
  { setor: "Financeiro", chaves: ["financeiro", "adm", "administrativo", "faturamento"] },
];

function setorDaOpcao(op) {
  const chaves = (op.palavrasChave || []).map((k) => String(k).toLowerCase().trim());
  const achado = REGRAS.find((r) => r.chaves.some((c) => chaves.includes(c)));
  return achado ? achado.setor : null;
}

function ehInformarOutroCnpj(op) {
  const alvo = [op.rotulo, ...(op.palavrasChave || [])].join(" ").toLowerCase();
  return /outro cnpj|informar outro/.test(alvo);
}

async function main() {
  const passos = await prisma.passoFluxo.findMany();
  const mudancas = [];

  for (const passo of passos) {
    const cfg =
      typeof passo.config === "string" ? JSON.parse(passo.config || "{}") : passo.config || {};
    if (!Array.isArray(cfg.opcoes) || !cfg.opcoes.length) continue;

    // SO O MENU PRINCIPAL define setor. Submenus ("tenho contrato", "produtos")
    // sao detalhes DENTRO de um setor ja escolhido -- se eles tambem gravassem,
    // uma opcao qualquer de submenu poderia trocar o setor pelas costas.
    const ehMenuPrincipal = /boas\s*vindas|menu/i.test(passo.titulo || "");
    let tocou = false;

    for (const op of cfg.opcoes) {
      if (ehMenuPrincipal) {
        const setor = setorDaOpcao(op);
        if (setor && op.setor !== setor) {
          op.setor = setor;
          tocou = true;
          mudancas.push(`${passo.titulo} / "${op.rotulo || op.id}" -> setor ${setor}`);
        }
      }
      if (ehInformarOutroCnpj(op) && op.limparCnpj !== true) {
        op.limparCnpj = true;
        tocou = true;
        mudancas.push(`${passo.titulo} / "${op.rotulo || op.id}" -> desassocia CNPJ`);
      }
    }

    if (tocou && aplicar) {
      await prisma.passoFluxo.update({ where: { id: passo.id }, data: { config: cfg } });
    }
  }

  if (!mudancas.length) {
    console.log("[arka] nada a fazer: o fluxo ja declara o setor das opcoes do menu.");
    return;
  }

  console.log(`[arka] ${mudancas.length} opcao(oes) a ajustar:`);
  for (const m of mudancas) console.log(`   ${m}`);
  console.log(
    aplicar
      ? "\n[arka] gravado. O setor passa a ser definido quando o cliente escolher no menu."
      : "\n[arka] SIMULACAO -- nada foi gravado. Rode com --aplicar para efetivar."
  );
}

main()
  .catch((e) => {
    console.error("[arka] migracao do setor do menu FALHOU:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
