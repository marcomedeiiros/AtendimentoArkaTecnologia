/**
 * RECOMEÇAR A CONTAGEM DE UMA COMPETÊNCIA -- e desfazer.
 *
 * ── POR QUE UM SCRIPT, E NÃO UM BOTÃO ──────────────────────────────────────
 *
 * Existiram dois botões de "Limpar dados" (sede e fora da sede) e eles foram
 * removidos a pedido em 11/09/2026 -- ver o §11 de
 * `docs/auditoria-ranking-zerado-10-09.md`. O motivo não foi só serem
 * redundantes: um clique cortava a contagem das duas telas para a equipe
 * inteira, inclusive de quem clicou, e o efeito era indistinguível de perda de
 * dados. Foi assim que o relato chegou -- "perdi a pontuação antiga, não
 * consegui recuperar".
 *
 * A ação continua fazendo sentido de vez em quando; o que não faz sentido é ela
 * estar a um clique de distância numa tela de gestão. Aqui ela exige o terminal
 * do servidor, o nome do ranking escrito à mão, e deixa autoria no log.
 *
 * ── E O QUE ELE FAZ É MENOS DO QUE O ANTIGO FAZIA ──────────────────────────
 *
 * O corte pertence a UMA competência: a próxima nasce limpa, sem herdar nada.
 * O antigo valia "de agora em diante, para sempre".
 *
 * Nada é apagado -- é piso de janela. Desfazer devolve a pontuação inteira,
 * porque ela nunca saiu do banco.
 *
 * ── USO ────────────────────────────────────────────────────────────────────
 *
 *   node recomecar-contagem.js                        mostra o estado, e não muda nada
 *   node recomecar-contagem.js --ranking=sede         recomeça a contagem AGORA
 *   node recomecar-contagem.js --ranking=sede --desfazer
 *
 * `--ranking` é obrigatório para agir: sem ele, nada acontece. Não há "ambos"
 * de propósito -- os dois rankings medem trabalhos diferentes, e recomeçar os
 * dois é uma decisão tomada duas vezes.
 */
const path = require("path");

const ciclo = require(path.join(__dirname, "src/modules/rankings/ciclo"));
const piso = require(path.join(__dirname, "src/modules/rankings/piso.competencia"));

const args = process.argv.slice(2);
const valorDe = (nome) => {
  const achado = args.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : null;
};
const ranking = valorDe("ranking");
const desfazer = args.includes("--desfazer");
const autor = valorDe("por") || process.env.SUDO_USER || process.env.USER || "terminal";

const emBR = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "-");

async function estado() {
  console.log("");
  for (const qual of piso.RANKINGS) {
    const atual = await piso.bruto(qual);
    if (!atual) {
      console.log(`  ${qual.padEnd(8)} contando o ciclo inteiro`);
    } else if (atual.invalido) {
      console.log(`  ${qual.padEnd(8)} valor ilegivel no banco (ignorado pelo servidor): ${atual.invalido}`);
    } else {
      console.log(
        `  ${qual.padEnd(8)} competencia ${atual.competencia} conta a partir de ${emBR(atual.desde)}`
      );
    }
  }
  console.log("");
}

async function main() {
  const cfg = await ciclo.obter();
  const competencia = ciclo.competenciaDe(new Date(), cfg);
  const [ano, mes] = competencia.split("-").map(Number);
  const janela = ciclo.janela(ano, mes, cfg);

  console.log(`[arka] competencia corrente: ${competencia}`);
  console.log(`[arka] o ciclo dela vai de ${emBR(janela.inicio)} a ${emBR(janela.fim)} (fim exclusivo)`);
  await estado();

  if (!ranking) {
    console.log("Nada foi alterado. Para agir:");
    console.log("  node recomecar-contagem.js --ranking=sede");
    console.log("  node recomecar-contagem.js --ranking=externo --desfazer");
    return;
  }
  if (!piso.RANKINGS.includes(ranking)) {
    console.error(`[arka] ranking desconhecido: ${ranking} (use ${piso.RANKINGS.join(" ou ")})`);
    process.exitCode = 1;
    return;
  }

  if (desfazer) {
    const { removido } = await piso.remover(ranking, autor);
    console.log(
      removido
        ? `[arka] desfeito: "${ranking}" volta a contar o ciclo inteiro. A pontuacao anterior reaparece -- ela nunca saiu.`
        : `[arka] nao havia recomeco gravado para "${ranking}". Nada mudou.`
    );
    await estado();
    return;
  }

  const { desde } = await piso.definir(ranking, competencia, autor);
  console.log(`[arka] "${ranking}": a competencia ${competencia} passa a contar de ${emBR(desde)}.`);
  console.log("[arka]");
  console.log("[arka] Nenhum atendimento foi apagado -- e piso de janela.");
  console.log(`[arka] A proxima competencia nasce limpa: este recomeco NAO a alcanca.`);
  console.log(`[arka] Para desfazer:  node recomecar-contagem.js --ranking=${ranking} --desfazer`);
  await estado();
}

// SEM `$disconnect()` no fim, e isso e de proposito.
//
// O cliente compartilhado roda as PRAGMAs de otimizacao do SQLite ao conectar,
// de forma assincrona. Desconectar logo depois de um script curto as pega no
// meio e enche a saida de "Engine is not yet connected" -- erro que nao
// aconteceu, sobre uma conexao que estava fechando de todo jeito. Numa
// ferramenta que alguem roda no servidor as pressas, isso e pior que ruido:
// parece que a operacao falhou.
//
// Sair pelo `exit` do processo fecha tudo igual, e em silencio.
main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((e) => {
    console.error("[arka] nao foi possivel concluir:", e.message);
    process.exit(1);
  });
