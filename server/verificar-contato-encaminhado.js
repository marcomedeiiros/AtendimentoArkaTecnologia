// Verificacao do CONTATO ENCAMINHADO -- `node verificar-contato-encaminhado.js`.
//
// Quando o cliente encaminha um cartao de contato, a bolha passou a oferecer
// "Conversar": um clique abre o fio com aquela pessoa, ja na aba Abertas e sem
// mandar mensagem nenhuma. Tudo isso depende de UMA coisa dar certo -- tirar o
// telefone certo do vCard cru que o WhatsApp mandou.
//
// E ai mora o defeito que este script existe para impedir: o vCard tem DOIS
// numeros na mesma linha. O `waid=` (o identificador da conta no WhatsApp, com
// DDI, sem mascara) e o texto depois dos dois-pontos, que quem salvou o contato
// digitou como quis -- as vezes sem DDD, as vezes com ramal. Ler o texto em vez
// do `waid` abre conversa com o numero errado, e o atendente so descobre depois
// de a mensagem chegar em outra pessoa.
//
// Nao sobe servidor nem toca no banco: le o parser do cliente como texto e
// avalia; o resto e leitura dos arquivos.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const erros = [];
const check = (cond, msg) => {
  if (!cond) erros.push(msg);
  console.log(`  ${cond ? "OK   " : "FALHA"} ${msg}`);
};

const RAIZ = path.join(__dirname, "..");
const lerCliente = (rel) => fs.readFileSync(path.join(RAIZ, "client", rel), "utf8");

// O parser e um modulo ES do front. Aqui ele roda no Node depois de trocar
// `export function` por `function` -- e o CODIGO DE VERDADE, nao uma copia:
// uma copia envelheceria em silencio no dia em que o parser mudasse.
const fonteVcard = lerCliente("src/utils/vcard.js").replace(/^export\s+/gm, "");
const caixa = {};
vm.createContext(caixa);
vm.runInContext(`${fonteVcard}; this.contatoDoVcard = contatoDoVcard;`, caixa);
const { contatoDoVcard } = caixa;

const vcard = (linhas) => ["BEGIN:VCARD", "VERSION:3.0", ...linhas, "END:VCARD"].join("\r\n");

console.log("\n=== 1. O NUMERO SAI DO waid, NAO DO TEXTO DIGITADO ===\n");
{
  // O caso da vida real: quem salvou escreveu so "99999-0000" (sem DDD), mas o
  // waid tem o numero completo. Ler o texto abriria conversa com um numero
  // impossivel -- ou, pior, com o numero de outra pessoa em outro DDD.
  const c = contatoDoVcard(
    vcard(["FN:Arlene Avocado", "TEL;type=CELL;waid=5527999990000:99999-0000"])
  );
  check(!!c, "cartao com waid e reconhecido");
  check(c && c.telefone === "5527999990000", `telefone vem do waid (veio "${c && c.telefone}")`);
  check(c && c.nome === "Arlene Avocado", "nome vem do FN");
  check(c && c.temWhatsApp === true, "marcado como conta de WhatsApp");
}

console.log("\n=== 2. SEM waid, CAI NO NUMERO ESCRITO ===\n");
{
  const c = contatoDoVcard(vcard(["FN:Fornecedor Fixo", "TEL;type=WORK:+55 (27) 3333-4444"]));
  check(!!c, "cartao sem waid ainda abre conversa");
  check(c && c.telefone === "552733334444", `mascara e removida (veio "${c && c.telefone}")`);
  check(
    c && c.temWhatsApp === false,
    "sinalizado como NAO confirmado no WhatsApp (a tela avisa antes do clique)"
  );
}

console.log("\n=== 3. O QUE NAO E TELEFONE NAO VIRA BOTAO ===\n");
{
  check(contatoDoVcard(vcard(["FN:So Email", "EMAIL:alguem@exemplo.com"])) === null,
    "cartao so com e-mail nao oferece conversa");
  check(contatoDoVcard(vcard(["FN:Curto", "TEL:4004"])) === null,
    "numero curto demais (4004) e recusado");
  check(contatoDoVcard("") === null, "vCard vazio nao quebra e nao oferece conversa");
  check(contatoDoVcard(null) === null, "vCard ausente nao quebra");
  check(contatoDoVcard(vcard(["FN:Longo", "TEL:+1 415 555 0100 999999"])) === null,
    "numero fora da faixa brasileira e recusado");
}

console.log("\n=== 4. FORMATOS QUE O WHATSAPP REALMENTE MANDA ===\n");
{
  // Linha dobrada: o padrao vCard permite quebrar uma linha longa e continuar na
  // seguinte iniciada por espaco. Sem desdobrar, o waid vinha partido ao meio e
  // o telefone saia truncado -- um numero errado que PARECE certo.
  const dobrado = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Nome Longo\r\nTEL;type=CELL;wa\r\n id=5527999990000:+55 27 99999-0000\r\nEND:VCARD";
  const c1 = contatoDoVcard(dobrado);
  check(c1 && c1.telefone === "5527999990000", "linha dobrada e remontada antes de ler o waid");

  // Prefixo "item1." aparece em cartao exportado de iPhone.
  const c2 = contatoDoVcard(vcard(["FN:Do iPhone", "item1.TEL;waid=5511988887777:+55 11 98888-7777"]));
  check(c2 && c2.telefone === "5511988887777", "prefixo item1. nao esconde o TEL");

  // Varios telefones: o que TEM waid ganha, mesmo nao sendo o primeiro.
  const c3 = contatoDoVcard(vcard([
    "FN:Dois Numeros",
    "TEL;type=WORK:+55 27 3333-4444",
    "TEL;type=CELL;waid=5527999990000:+55 27 99999-0000",
  ]));
  check(c3 && c3.telefone === "5527999990000",
    `entre fixo e WhatsApp, ganha o do WhatsApp (veio "${c3 && c3.telefone}")`);

  // Sem FN, o nome cai no displayName que a Evolution mandou junto.
  const c4 = contatoDoVcard(vcard(["TEL;waid=5527999990000:+55 27 99999-0000"]), "Arlene Avocado");
  check(c4 && c4.nome === "Arlene Avocado", "sem FN, usa o displayName da mensagem");
}

console.log("\n=== 5. O SERVIDOR PRESERVA O vCARD ===\n");
{
  const whatsapp = require("./src/modules/whatsapp/whatsapp.service");
  const midia = whatsapp.extrairMidia({
    message: {
      contactMessage: {
        displayName: "Arlene Avocado",
        vcard: vcard(["FN:Arlene Avocado", "TEL;waid=5527999990000:+55 27 99999-0000"]),
      },
    },
  });
  check(midia && midia.tipo === "contato", "contactMessage vira midia do tipo contato");
  check(!!(midia && midia.vcard), "o vCard cru e guardado (sem ele nao ha telefone para ler)");

  const emArray = whatsapp.extrairMidia({
    message: { contactsArrayMessage: { contacts: [{ displayName: "A", vcard: vcard(["TEL;waid=5527999990000:x"]) }] } },
  });
  check(!!(emArray && emArray.vcard), "contactsArrayMessage tambem preserva o vCard");

  const mapper = fs.readFileSync(path.join(__dirname, "src/shared/helpers/mapper.helper.js"), "utf8");
  check(/midia:\s*tipo !== "texto" \? \{ \.\.\.meta/.test(mapper),
    "o mapper repassa o metadata inteiro (o vCard chega na tela)");
}

console.log("\n=== 6. A TELA ESTA LIGADA NO CAMINHO CERTO ===\n");
{
  const view = lerCliente("src/components/pages/AtendimentoView.jsx");
  check(/import \{ contatoDoVcard \} from '\.\.\/\.\.\/utils\/vcard'/.test(view),
    "AtendimentoView usa o parser compartilhado, nao uma leitura propria");
  check(/function CartaoContato\(/.test(view), "o cartao de contato e um componente proprio");
  check(/onAbrirContato=\{conversarComContatoRecebido\}/.test(view),
    "o clique chega ate o handler da tela");

  const handler = view.slice(view.indexOf("const conversarComContatoRecebido"));
  check(/telefoneComparavel\(c\.telefone\) === tel/.test(handler.slice(0, 900)),
    "conversa que ja existe e reaproveitada (nao duplica o fio do cliente)");
  check(/texto: '',/.test(handler.slice(0, 1200)),
    "abre SEM enviar mensagem: o contato nao e notificado");
  check(/setor: 'Geral'/.test(handler.slice(0, 1200)),
    "nasce sem triagem (Geral), como toda conversa nova");

  // A conversa precisa aparecer na aba Abertas -- que e o pedido literal. Quem
  // faz isso e `iniciarConversaNova`, e por isso o handler passa por ela em vez
  // de chamar a API direto.
  check(/iniciarConversaNova\(\{/.test(handler.slice(0, 1200)),
    "reaproveita iniciarConversaNova (e ela quem troca para a aba Abertas)");
  const inicia = view.slice(view.indexOf("const iniciarConversaNova"));
  check(/setAbaAtual\('abertas'\)/.test(inicia.slice(0, 1600)), "a aba vai para Abertas");
  check(/return nova;/.test(inicia.slice(0, 1800)),
    "devolve a conversa criada (o cartao precisa saber se deu certo)");
  check(/setNovaInicial\(\{ telefone: contato\.telefone/.test(handler.slice(0, 1400)),
    "falha cai no modal preenchido, onde o erro tem onde aparecer");
}

console.log(`\n${erros.length === 0 ? "TUDO OK" : `${erros.length} FALHA(S)`}\n`);
if (erros.length) {
  erros.forEach((e) => console.log(`  - ${e}`));
  process.exit(1);
}
