/**
 * A BUSCA DE EMPRESA no perfil do contato (Central de Atendimentos).
 *
 * ── O DEFEITO QUE ISTO TRAVA ───────────────────────────────────────────────
 *
 * A condição era:
 *
 *     limparDocumento(p.cnpj).includes(limparDocumento(busca))
 *
 * Digitando LETRAS -- que é o caso normal de quem procura pelo nome --
 * `limparDocumento('zunik')` tira tudo que não é dígito e devolve STRING
 * VAZIA. Toda string contém a string vazia, então a condição passava para
 * TODOS os cadastros: a lista inteira aparecia, cortada em 8.
 *
 * E o sintoma enganava: como o corte pega sempre o começo do alfabeto (A
 * COLLI, ACADEMIA, AFAGO), parecia CADASTRO INCOMPLETO, e não filtro
 * quebrado. Foi assim que o usuário descreveu.
 *
 * ── POR QUE O TESTE LÊ O FONTE EM VEZ DE REESCREVER A REGRA ────────────────
 *
 * O filtro mora dentro de um componente e não é exportado. Copiar a expressão
 * para cá conferiria a CÓPIA, não o que roda na tela -- e é exatamente assim
 * que um teste passa enquanto o defeito continua vivo. Então o bloco é
 * extraído do arquivo e executado como está.
 *
 *   cd server && node verificar-busca-empresa.js
 */
const fs = require("fs");
const path = require("path");

const ARQUIVO = path.join(__dirname, "..", "client", "src", "components", "pages", "AtendimentoView.jsx");

const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (nome, ok, detalhe = "") => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${nome}${detalhe ? "  " + detalhe : ""}`);
  if (!ok) erros.push(`[${secao}] ${nome}`);
};

// ---------------------------------------------------------------------------
titulo("1. Consegui extrair o filtro real do componente");

const fonte = fs.readFileSync(ARQUIVO, "utf8");
const mSemAcento = /function semAcento\(s\) \{[\s\S]*?\n\}/.exec(fonte);
const mLimite = /const LIMITE_ACHADOS = (\d+);/.exec(fonte);
const mFiltro = /const casaram = \(\(\) => \{([\s\S]*?)\n  \}\)\(\);/.exec(fonte);

// Sem isto, uma renomeação faria os testes abaixo sumirem sem ninguém notar.
check("achei `semAcento`", !!mSemAcento);
check("achei `LIMITE_ACHADOS`", !!mLimite);
check("achei o bloco `casaram`", !!mFiltro);
if (erros.length) {
  console.log("\nFALHAS: nao da para seguir sem o filtro.");
  process.exit(1);
}

const LIMITE = Number(mLimite[1]);
const limparDocumento = (v) => String(v || "").replace(/\D/g, "");
const montar = new Function(
  "busca", "parceiros", "limparDocumento",
  `${mSemAcento[0]}\n const casaram = (() => {${mFiltro[1]}\n })(); return casaram;`
);

// Massa com as formas que aparecem na base real: acento na razão social, uma
// palavra que se repete em dezenas de cadastros, um nome raro, e um inativo.
const PARCEIROS = [
  { cnpj: "21533349000169", razaoSocial: "A COLLI / AUTO UNION", status: "ativo" },
  { cnpj: "36324580000110", razaoSocial: "ACADEMIA DE GINÁSTICA HANGAR LTDA", status: "ativo" },
  { cnpj: "32394603000101", razaoSocial: "AFAGO COMERCIO LTDA", status: "ativo" },
  { cnpj: "36325157000134", razaoSocial: "COSTA CAMARGO COM. DE PRODUTOS HOSPITALARES LTDA", status: "ativo" },
  { cnpj: "11444777000161", razaoSocial: "AR VIX COMERCIO E SERVICO LTDA", status: "ativo" },
  { cnpj: "11222333000181", razaoSocial: "ZUNIK COMERCIO INTERNACIONAL LTDA", status: "ativo" },
  { cnpj: "99999999000199", razaoSocial: "ZUNIK ANTIGA LTDA", status: "inativo" },
];
const ATIVOS = PARCEIROS.filter((p) => p.status !== "inativo").length;
const buscar = (q) => montar(q, PARCEIROS, limparDocumento);

// ---------------------------------------------------------------------------
titulo("2. Buscar por NOME filtra de verdade");

const zunik = buscar("zunik");
check("nome raro devolve so ele", zunik.length === 1 && /ZUNIK COMERCIO/.test(zunik[0].razaoSocial),
  `-> ${zunik.length}`);

// A checagem central: e a que reprova a condicao antiga.
check("letra nenhuma vira 'casa com todo mundo'", zunik.length < ATIVOS,
  `-> ${zunik.length} de ${ATIVOS} ativos`);

check("nome que nao existe devolve vazio", buscar("xyzabcinexistente").length === 0);
check("menos de 2 caracteres nao busca", buscar("a").length === 0);

// ---------------------------------------------------------------------------
titulo("3. Acento nao pode atrapalhar");

// A razao social vem do cadastro oficial e TEM acento; ninguem digita acento
// numa caixa de busca.
const semAc = buscar("GINASTICA");
const comAc = buscar("ginástica");
check("acha com e sem acento, e o mesmo resultado",
  semAc.length === 1 && comAc.length === 1 && semAc[0].cnpj === comAc[0].cnpj,
  `-> ${semAc.length} e ${comAc.length}`);

// ---------------------------------------------------------------------------
titulo("4. Buscar por DOCUMENTO continua funcionando");

check("CNPJ em digitos crus acha", buscar("36325157").length === 1);
check("CNPJ com mascara acha o mesmo", buscar("36.325.157/0001-34").length === 1);
// Um digito so casaria com meio cadastro: dois e o minimo que ainda e busca.
check("um digito so nao dispara a busca por documento",
  !buscar("1x").some((p) => !/1x/i.test(p.razaoSocial)), "(so nome, nunca documento)");

// ---------------------------------------------------------------------------
titulo("5. Inativo nao aparece, e a lista cortada avisa");

check("inativo fica de fora mesmo casando com o nome",
  buscar("ZUNIK").every((p) => p.status !== "inativo"),
  `('ZUNIK' devolveu ${buscar("ZUNIK").length} de 2 cadastros com esse nome)`);

const comum = buscar("comercio");
check("termo comum devolve mais de um", comum.length > 1, `-> ${comum.length}`);
// A tela mostra LIMITE e diz quantos ficaram de fora. Uma lista cortada em
// silencio parece cadastro faltando -- que foi o defeito relatado.
check("a tela avisa quando corta a lista",
  /achadosOcultos/.test(fonte) && /e mais \{achadosOcultos\}/.test(fonte),
  `(limite ${LIMITE})`);

console.log(
  "\n" + (erros.length
    ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
    : "BUSCA DE EMPRESA: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
