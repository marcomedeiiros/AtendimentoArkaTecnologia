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
//   verificar-contrato-api.js      as duas pontas de cada chamada da tela (só leitura)
//   verificar-horario.js           a regra de expediente, caso a caso (módulo puro)
//   verificar-fluxo-arka.js        a matriz do fluxo, conversando com o motor real
//   verificar-visual-whatsapp.js   o payload que chega ao WhatsApp (botão x texto)
//   verificar-inatividade.js       os dois relógios do bot (Parte B exige o dev.db)
//
// Uso: npm test        (ou node verificar-tudo.js)
//      node verificar-tudo.js --lista     só lista o que seria rodado
//
// NÃO confunda com `diagnosticar-instalacao.js`: este arquivo prova o CÓDIGO e o
// fluxo do repositório; aquele confere uma INSTALAÇÃO (o motor que subiu contra o
// fluxo que está no banco dela) e é o que responde "por que o bot não está
// esperando nesta VM".
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
    // Não fala com o motor nem com o banco: lê os dois lados do código. Vem
    // primeiro porque é o mais barato, e porque o defeito que ele pega -- a tela
    // manda um campo, o schema Zod o descarta calado -- não produz erro nenhum
    // para os outros scripts verem. Foi assim que o "responder" da Central ficou
    // quebrado com as duas pontas escritas e funcionando.
    arquivo: "verificar-contrato-api.js",
    titulo: "Contrato entre a tela e o servidor",
    resumo: "método existe, rota existe, e o corpo que a tela manda sobrevive ao schema",
  },
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
    // Modulo puro com dubles: nao fala com a Evolution nem com o Postgres, e
    // por isso da para exercitar aqui os cenarios que so aconteceriam
    // derrubando a internet -- timeout 408, logout 401, credencial apagada,
    // dois reconnects ao mesmo tempo. Vem cedo porque e barato.
    arquivo: "verificar-reconexao-whatsapp.js",
    titulo: "Reconexao do WhatsApp",
    resumo: "queda temporaria nunca vira QR; logout real sempre vira; um socket por instancia",
  },
  {
    arquivo: "verificar-inatividade.js",
    titulo: "Inatividade",
    resumo: "os dois relógios do bot; a Parte B roda contra o banco quando há DATABASE_URL",
  },
  // ── OS QUE ESTAVAM DE FORA, E APODRECERAM POR ISSO ────────────────────────
  //
  // Ate 01/09/2026 este runner chamava cinco scripts, e outros trinta e cinco
  // existiam sem que ninguem os executasse. Uma auditoria rodou os trinta e
  // cinco: SEIS estavam quebrados. Dois deles nem carregavam (o recorte do
  // VisualFlowEditor estourava `SyntaxError` desde 29/08, e um id de fluxo
  // congelado no codigo estourava `TypeError`), e dois reprovavam edicoes
  // legitimas de fluxo como se fossem regressao.
  //
  // Nenhum defeito era novo. Todos estavam ali havia dias, calados -- que e
  // exatamente o diagnostico escrito no topo deste arquivo sobre a versao
  // anterior dele ("ele ficou tempo demais sem ser executado e apodreceu em
  // silencio"). Um teste fora do runner nao e uma protecao a menos: e uma
  // protecao que MENTE, porque quem le o nome do arquivo acredita que ela roda.
  //
  // Estao aqui agora, em ordem crescente de custo.
  {
    arquivo: "verificar-cabecalhos.js",
    titulo: "Cabeçalhos de segurança e CSP",
    resumo: "CSP, HSTS, nosniff -- e a CSP do nginx igual a do Express",
  },
  {
    arquivo: "verificar-responsivo.js",
    titulo: "Responsividade do painel",
    resumo: "tabela rolavel, grade que quebra, largura que encolhe, safe-area",
  },
  {
    arquivo: "verificar-interface.js",
    titulo: "Interface",
    resumo: "os 64 arquivos de tela: imports, chaves e props usadas",
  },
  {
    arquivo: "verificar-exposicao.js",
    titulo: "Exposição de dados",
    resumo: "o que a API devolve nao pode vazar campo interno",
  },
  {
    arquivo: "verificar-escopo-dados.js",
    titulo: "Escopo de dados entre setores",
    resumo: "um setor nao enxerga a conversa de outro",
  },
  {
    arquivo: "verificar-sessao-cookie.js",
    titulo: "Sessão em cookie e CSRF",
    resumo: "cookie de sessao, CSRF de duplo envio e a checagem de origem",
  },
  {
    arquivo: "verificar-bloqueio.js",
    titulo: "Bloqueio progressivo",
    resumo: "bloqueio progressivo depois de tentativas de login erradas",
  },
  {
    arquivo: "verificar-cadastro-turnstile.js",
    titulo: "Cadastro com Turnstile",
    resumo: "o cadastro exige o desafio antes de tocar no banco",
  },
  {
    arquivo: "verificar-botoes.js",
    titulo: "Botões, listas e rótulos do WhatsApp",
    resumo: "botao x lista x enquete, rotulos dentro do limite do WhatsApp",
  },
  {
    arquivo: "verificar-blocos-conteudo.js",
    titulo: "Conteúdo dos blocos no editor",
    resumo: "o card do editor mostra o conteudo real do bloco",
  },
  {
    arquivo: "verificar-fluxos-crud.js",
    titulo: "CRUD de fluxos e blocos",
    resumo: "criar, editar e apagar fluxo e bloco sem perder passo",
  },
  {
    arquivo: "verificar-midia.js",
    titulo: "Envio de mídia",
    resumo: "upload, token da URL, streaming e o Range do player",
  },
  {
    arquivo: "verificar-transferencia.js",
    titulo: "Transferência entre atendentes",
    resumo: "passar a conversa para outro atendente",
  },
  {
    arquivo: "verificar-destinos-transferencia.js",
    titulo: "Destinos de transferência",
    resumo: "quem aparece na lista de destinos, por cargo",
  },
  {
    arquivo: "verificar-dois-atendentes.js",
    titulo: "Dois atendentes na mesma conversa",
    resumo: "duas abas na mesma conversa nao se sobrescrevem",
  },
  {
    arquivo: "verificar-sair-de-todos.js",
    titulo: "Sair de todos os atendimentos",
    resumo: "sair de todos os atendimentos de uma vez",
  },
  {
    arquivo: "verificar-cliente-avulso.js",
    titulo: "Cliente cadastrado x avulso",
    resumo: "cadastrado x avulso, e a badge que a Central mostra",
  },
  {
    arquivo: "verificar-assinatura.js",
    titulo: "Assinatura do atendente",
    resumo: "a assinatura do atendente no texto que sai",
  },
  {
    arquivo: "verificar-backup.js",
    titulo: "Backup e restauração",
    resumo: "o backup fecha o WAL e a restauracao volta o banco inteiro",
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
