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

console.log('\n=== 7. "CONVERSAR" DOS CONTATOS NAO FILTRA A CENTRAL ===\n');
{
  // O defeito: o botao navegava com `?busca=<telefone>`, e a Central chegava
  // com a lista filtrada por aquele numero. As conversas abertas, pendentes e
  // fechadas sumiam da tela -- parecia que o painel tinha aberto uma sessao
  // nova e vazia. Nada tinha sumido: era um filtro esquecido no campo de busca.
  const contatos = lerCliente("src/components/pages/Contatos.jsx");
  const inicia = contatos.slice(contatos.indexOf("function iniciarChat"));
  const corpo = inicia.slice(0, inicia.indexOf("\n  }"));
  check(!/busca=/.test(corpo), "o botao NAO manda mais `busca=` (era o que esvaziava a lista)");
  check(/abrir:\s*limparTel\(contato\.telefone\)/.test(corpo),
    "manda `abrir=<telefone>`: uma intencao de abrir, nao um filtro");
  check(/params\.set\('nome'/.test(corpo), "leva o nome junto, para a conversa nova nascer rotulada");

  const view = lerCliente("src/components/pages/AtendimentoView.jsx");
  check(/const \[pedidoAbrir,\s+setPedidoAbrir\]/.test(view), "a Central le o parametro `abrir`");
  const efeito = view.slice(view.indexOf("const abriuPedido"));
  const trecho = efeito.slice(0, 700);
  check(/if \(!pedidoAbrir \|\| carregando \|\|/.test(trecho),
    "espera a lista carregar antes de agir (senao reabriria uma OS fechada)");
  check(/abriuPedido\.current = true;/.test(trecho), "roda uma vez so");
  check(/history\.replaceState/.test(trecho),
    "limpa a URL (um F5 nao pode reabrir a conversa outra vez)");
  check(/conversarComContatoRecebido\(pedidoAbrir\)/.test(trecho),
    "usa o MESMO caminho do cartao encaminhado (uma regra so para abrir conversa)");

  check(/setBusca\(''\);/.test(trecho),
    "limpa qualquer busca que ja estivesse no campo ao abrir a conversa");

  // SAIDA DA LISTA FILTRADA. O campo de busca nao tinha como ser limpo num
  // clique, e a lista vazia nao dizia que estava filtrada -- entao a unica
  // saida que a pessoa encontrava era recarregar a pagina (F5). O estado da
  // busca so nasce no mount (`useState`), e por isso navegar pela barra lateral
  // estando JA na Central nao remonta a tela e nao limpava nada.
  check(/aria-label="Limpar a busca"/.test(view), "o campo de busca tem um X para limpar");
  check(/e\.key === 'Escape' && busca/.test(view), "Esc no campo tambem limpa a busca");
  check(/A lista está filtrada por/.test(view),
    "a lista vazia DIZ que esta filtrada, em vez de parecer vazia de verdade");
  check(/Limpar a busca e ver tudo/.test(view), "a lista vazia oferece a saida num clique");

  // A semente de busca por URL continua existindo -- ela so nao e mais o
  // caminho do botao. Se alguem a remover junto, um link antigo passa a nao
  // fazer nada em silencio.
  check(/get\('busca'\)/.test(view), "o `?busca=` avulso continua funcionando para quem tiver o link");
}

console.log("\n=== 8. CONTATO COM ATENDIMENTO FECHADO ===\n");
{
  // O relato: "quando o contato esta nas fechadas ele nao abre, meio que fecha".
  //
  // Duas causas somadas. (a) O clique caia no "pula para a conversa", que
  // levava para a aba FECHADAS -- nao era o pedido, que e conversar. (b) Uma
  // CORRIDA: a aba atual vem de uma preferencia que chega do servidor depois da
  // primeira renderizacao; o pulo acontecia antes, a resposta sobrescrevia a
  // aba, e o efeito que limpa a selecao fora da aba visivel jogava a conversa
  // fora. Dava certo quando a aba salva por acaso ja era a de destino -- por
  // isso "alguns contatos abrem, outros nao".
  const view = lerCliente("src/components/pages/AtendimentoView.jsx");
  const handler = view.slice(view.indexOf("const conversarComContatoRecebido"));
  const corpo = handler.slice(0, handler.indexOf("}, ["));

  check(/statusAtendimento === 'fechada'\) reabrirConversa\(existente\.id\)/.test(corpo),
    "conversa fechada e REABERTA (nao apenas selecionada na aba Fechadas)");
  check(/else irParaConversa\(existente\.id\)/.test(corpo),
    "conversa viva so recebe o pulo, sem mexer no status");

  // reabrirConversa e quem leva para Abertas -- e preserva o setor. Passar pelo
  // `iniciarConversaNova` aqui mandaria `setor: 'Geral'`, e o servidor
  // sobrescreve o setor do fio existente com ele: uma conversa do Tecnico
  // voltaria como Geral so por causa de um clique em "Conversar".
  const reabrir = view.slice(view.indexOf("const reabrirConversa"));
  check(/setAbaAtual\('abertas'\)/.test(reabrir.slice(0, 300)), "reabrir leva para a aba Abertas");
  check(!/setor/.test(reabrir.slice(0, 400)), "reabrir NAO mexe no setor da conversa");

  // A ordem importa de verdade: `conversarComContatoRecebido` cita
  // `reabrirConversa` na lista de dependencias, que e lida durante a
  // renderizacao. Declarado depois, isso e ReferenceError e a tela nao abre.
  check(view.indexOf("const reabrirConversa") < view.indexOf("const conversarComContatoRecebido"),
    "reabrirConversa e declarado ANTES de quem o usa (senao a tela quebra no render)");

  check(/const \[abaAtual, setAbaAtual, abaCarregada\]/.test(view),
    "a tela sabe quando a aba salva terminou de chegar do servidor");
  const efeito = view.slice(view.indexOf("const abriuPedido"));
  check(/if \(!pedidoAbrir \|\| carregando \|\| !abaCarregada \|\| abriuPedido\.current\) return;/.test(efeito.slice(0, 400)),
    "so abre depois da lista E da preferencia de aba (fecha a corrida)");
}

console.log(`\n${erros.length === 0 ? "TUDO OK" : `${erros.length} FALHA(S)`}\n`);
if (erros.length) {
  erros.forEach((e) => console.log(`  - ${e}`));
  process.exit(1);
}
