// `npm test` -- roda TODAS as verificações do bot, em ordem, e falha na primeira.
//
// ── POR QUE ISTO DEIXOU DE SER UM TESTE E VIROU UM RUNNER ────────────────────
//
// Este arquivo tinha 460 linhas que conversavam com o fluxo da ARKA turno a
// turno: menu, Técnico, CNPJ, Comercial, Financeiro, horário, inatividade. Era o
// único lugar onde o fluxo era exercitado, e por isso ele tinha de cobrir tudo.
//
// Duas coisas mudaram:
//
//   1. cada assunto ganhou o seu script, com cobertura muito maior do que a que
//      cabia aqui -- a matriz do fluxo tem 9 seções, o horário tem 45 casos;
//   2. os roteiros escritos aqui estavam colados na FORMA do fluxo antigo
//      (índices de turno, o submenu "Produtos/Serviços", a opção 4 do menu). Ao
//      trocar o desenho, este arquivo passou a estourar `TypeError` em
//      `turnos[3].setor` -- e as três assertivas que já falhavam antes disso
//      cobravam uma opção 4 que o menu não tem mais.
//
// Manter as duas cópias significaria manter duas verdades sobre o mesmo fluxo, e
// a que ninguém roda envelhece calada -- foi exatamente o diagnóstico escrito no
// topo da versão anterior deste arquivo ("ele ficou tempo demais sem ser
// executado e apodreceu em silêncio").
//
// Então o que sobra aqui é o que o nome sempre prometeu: rodar tudo.
//
//   verificar-horario.js           a regra de expediente, caso a caso (módulo puro)
//   verificar-fluxo-arka.js        a matriz do fluxo, conversando com o motor real
//   verificar-visual-whatsapp.js   o payload que chega ao WhatsApp (botão x texto)
//   verificar-inatividade.js       os dois relógios do bot (Parte B exige o dev.db)
//
// Uso: npm test        (ou node verificar-tudo.js)
//      node verificar-tudo.js --lista     só lista o que seria rodado
// O `.env`, como os scripts filhos fazem. Sem isto o runner não vê
// `DATABASE_URL` e a NOTA no fim do resumo dizia que a Parte B tinha sido pulada
// mesmo quando ela havia rodado contra o banco -- um relatório que mente sobre a
// própria cobertura é pior do que nenhum.
require("dotenv").config();

const { spawnSync } = require("child_process");
const path = require("path");
const { existsSync } = require("fs");

// A ORDEM IMPORTA, e ela é do mais simples para o mais composto: um erro na
// regra de horário aparece no primeiro script, e não escondido dentro de uma
// conversa de sete turnos.
const VERIFICACOES = [
  {
    arquivo: "verificar-horario.js",
    titulo: "Horário de atendimento",
    resumo: "dias, períodos, fuso, feriados, mensagem e a não-repetição do aviso",
  },
  {
    arquivo: "verificar-fluxo-arka.js",
    titulo: "Fluxo da ARKA",
    resumo: "botões x texto livre, Técnico/Comercial/Financeiro, CNPJ, timeout e horário",
  },
  {
    arquivo: "verificar-visual-whatsapp.js",
    titulo: "O que o cliente vê no WhatsApp",
    resumo: "payload real da Evolution: botões só onde deve, texto puro no resto, teto de 3",
  },
  {
    arquivo: "verificar-inatividade.js",
    titulo: "Inatividade",
    resumo: "os dois relógios do bot; a Parte B roda contra o banco quando há DATABASE_URL",
  },
];

const raiz = __dirname;

if (process.argv.includes("--lista")) {
  console.log("Verificações que `npm test` executa:\n");
  for (const v of VERIFICACOES) {
    console.log(`  ${v.arquivo}\n    ${v.titulo} -- ${v.resumo}\n`);
  }
  process.exit(0);
}

const resultados = [];
let falhou = false;

for (const v of VERIFICACOES) {
  const caminho = path.join(raiz, v.arquivo);
  console.log(`\n${"═".repeat(72)}`);
  console.log(`▶  ${v.titulo}  (${v.arquivo})`);
  console.log(`   ${v.resumo}`);
  console.log("═".repeat(72));

  if (!existsSync(caminho)) {
    // Arquivo ausente é FALHA, e não "pulado": a lista acima é a promessa de
    // cobertura, e apagar um script sem tirá-lo daqui esvaziaria o `npm test`
    // sem que nada acusasse.
    console.error(`   FALTANDO: ${v.arquivo} não existe.`);
    resultados.push({ ...v, status: "faltando" });
    falhou = true;
    continue;
  }

  // `stdio: "inherit"`: a saída de cada script vai direto para o terminal. Ela é
  // o relatório -- cada linha é uma verificação com OK/FALHA e o motivo.
  const r = spawnSync(process.execPath, [caminho], { cwd: raiz, stdio: "inherit" });
  const ok = r.status === 0;
  if (!ok) falhou = true;
  resultados.push({ ...v, status: ok ? "ok" : "falhou", codigo: r.status });
}

console.log(`\n${"═".repeat(72)}`);
console.log("RESUMO");
console.log("═".repeat(72));
for (const r of resultados) {
  const marca = r.status === "ok" ? "OK      " : r.status === "faltando" ? "FALTANDO" : "FALHOU  ";
  console.log(`  ${marca} ${r.titulo}  (${r.arquivo}${r.codigo ? `, exit=${r.codigo}` : ""})`);
}

if (!process.env.DATABASE_URL) {
  // Dito no fim, e não no meio da saída: é a única parte da cobertura que este
  // comando NÃO exercitou, e quem lê o resumo precisa saber disso.
  console.log(
    "\n  NOTA: DATABASE_URL não está definida -- a Parte B da inatividade\n" +
      "        (a varredura real contra o dev.db) foi pulada."
  );
}

console.log(
  "\n" + (falhou ? "HÁ FALHAS: veja as linhas FALHA na saída de cada script acima." : "TUDO PASSOU.")
);
process.exit(falhou ? 1 : 0);
