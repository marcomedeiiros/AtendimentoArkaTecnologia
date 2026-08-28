/**
 * RESTAURA O QUE FOI RESGATADO do banco de desenvolvimento corrompido.
 *
 * O `dev.db` antigo teve a tabela `conversa` corrompida (páginas ilegíveis).
 * Antes de recriá-lo, cada tabela que AINDA lia foi exportada para JSON pelo
 * próprio Prisma. Este script devolve o que faz sentido devolver.
 *
 * ── O QUE NÃO VOLTA, E POR QUÊ ─────────────────────────────────────────────
 *
 *   conversa          perdida -- é a tabela corrompida, não houve o que exportar
 *   atendimento       cada linha aponta para uma conversa (FK obrigatória)
 *   mensagem          idem -- as 852 mensagens pertencem às conversas perdidas
 *   sessaoChatbot     idem
 *   logExecucaoFluxo  aponta para conversa; são registros de execuções passadas
 *   sessaoRefresh     sessões de login velhas; restaurá-las seria devolver
 *                     acesso a tokens antigos, e é justamente o que não se quer
 *
 * Nada disso é silencioso: o resumo no fim diz o que entrou e o que ficou fora.
 *
 * A ORDEM importa por causa das chaves estrangeiras: quem é apontado entra
 * antes de quem aponta.
 *
 * As senhas voltam INTACTAS -- o `senhaHash` é copiado como está, então cada
 * pessoa entra com a mesma senha de sempre. Nada de redefinir.
 *
 *   cd server && node prisma/restaurar-resgate.js <pasta-do-resgate>
 */
const fs = require("fs");
const path = require("path");
const prisma = require("../src/infrastructure/database/prisma.client");

const ORIGEM = process.argv[2];
if (!ORIGEM || !fs.existsSync(ORIGEM)) {
  console.error("Informe a pasta do resgate: node prisma/restaurar-resgate.js <pasta>");
  process.exit(1);
}

// Contas criadas por teste automatizado não voltam para o ambiente de trabalho.
const DESCARTAR_EMAIL = /@exemplo\.invalido$/;

const NAO_VOLTAM = {
  conversa: "tabela corrompida -- não houve o que exportar",
  atendimento: "depende de conversa (FK obrigatória)",
  mensagem: "depende de conversa (FK obrigatória)",
  sessaoChatbot: "depende de conversa (FK obrigatória)",
  logExecucaoFluxo: "aponta para conversa; são logs de execuções antigas",
  sessaoRefresh: "sessões de login antigas -- devolvê-las seria reviver tokens velhos",
};

// Ordem de dependência: apontado antes de quem aponta.
const ORDEM = [
  "instancia",
  "configuracao",
  "usuario",
  "parceiro",
  "contato",
  "contador",
  "fluxo",
  "passoFluxo",     // precisa de fluxo
  "preferencia",    // precisa de usuario
  "mensagemRapida",
  "compromisso",
  "relatoBug",
  "campanha",
  "campanhaDestinatario",
];

function ler(modelo) {
  const arq = path.join(ORIGEM, `${modelo}.json`);
  if (!fs.existsSync(arq)) return null;
  return JSON.parse(fs.readFileSync(arq, "utf8"));
}

(async () => {
  const entraram = [];
  const vazios = [];
  const problemas = [];

  for (const modelo of ORDEM) {
    let linhas = ler(modelo);
    if (linhas === null) { problemas.push(`${modelo}: sem arquivo no resgate`); continue; }

    if (modelo === "usuario") {
      const antes = linhas.length;
      linhas = linhas.filter((u) => !DESCARTAR_EMAIL.test(u.email || ""));
      const fora = antes - linhas.length;
      if (fora) console.log(`  (descartadas ${fora} contas de teste @exemplo.invalido)`);
    }

    if (!linhas.length) { vazios.push(modelo); continue; }

    // Datas vêm do JSON como texto; o Prisma exige Date.
    const paraGravar = linhas.map((l) => {
      const copia = { ...l };
      for (const [k, v] of Object.entries(copia)) {
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v)) copia[k] = new Date(v);
      }
      return copia;
    });

    try {
      // Uma a uma, e não `createMany`: se uma linha tiver problema, o erro diz
      // QUAL modelo e o resto continua -- em vez de o lote inteiro sumir junto.
      let n = 0;
      for (const linha of paraGravar) {
        await prisma[modelo].create({ data: linha });
        n++;
      }
      entraram.push(`${modelo}=${n}`);
    } catch (e) {
      problemas.push(`${modelo}: ${(e.message.match(/Message: `([^`]+)/) || [, e.message.split("\n").pop()])[1]}`);
    }
  }

  console.log("\n=== RESTAURADO ===");
  console.log("  " + (entraram.join(", ") || "nada"));
  if (vazios.length) console.log("\n=== VAZIOS NA ORIGEM (nada a fazer) ===\n  " + vazios.join(", "));
  console.log("\n=== NAO VOLTAM (por dependencia da conversa perdida) ===");
  for (const [m, motivo] of Object.entries(NAO_VOLTAM)) console.log(`  ${m.padEnd(18)} ${motivo}`);
  if (problemas.length) console.log("\n=== PROBLEMAS ===\n  " + problemas.join("\n  "));

  await prisma.$disconnect();
  process.exit(problemas.length ? 1 : 0);
})();
