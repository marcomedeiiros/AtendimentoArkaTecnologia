// O SIMULADOR TEM DE CUMPRIR O CONTRATO QUE O MOTOR USA.
//
// ── O DEFEITO QUE ESTE SCRIPT EXISTE PARA IMPEDIR ────────────────────────────
//
// `chatbot.simulador.js` roda o motor REAL com repositorios falsos -- e o valor
// disso e justamente nao haver uma segunda implementacao do fluxo para
// envelhecer sozinha. Mas o ambiente falso e escrito A MAO, e o motor cresce:
// quando `fecharConversa` passou a gravar o motivo do ciclo
// (`definirMotivoAtualSeVazio`) e a pesquisa passou a fazer o mesmo
// (`definirMotivoSeVazio`), nenhum dos dois metodos foi acrescentado ao stub.
//
// O motor os chama SEM guarda, porque eles sao o contrato do repositorio e nao
// um recurso opcional. Entao a simulacao estourava
// `TypeError: ... is not a function`, o `catch` geral de
// `_processarMensagemEntrada` engolia o erro e transferia para humano. Na tela
// "Testar", TODO fluxo que encerra -- ou que passa pela pesquisa de satisfacao
// -- terminava com "transferido / erro_interno" em vez da despedida. Quem
// estava testando lia isso como defeito do FLUXO dele.
//
// ── O QUE ELE CONFERE ───────────────────────────────────────────────────────
//
// Le o codigo do motor, extrai toda chamada `this.deps.<dep>.<metodo>()` e exige
// que o ambiente do simulador ofereca cada uma. Chamada GUARDADA no motor
// (`?.()` ou protegida por `if (this.deps.x.y)`) e opcional por construcao e nao
// entra na exigencia -- o motor ja declarou ali que sabe viver sem ela.
//
// Depois roda os cenarios que quebraram de verdade, de ponta a ponta, contra o
// motor: fluxo que encerra, fim de fluxo sem saida e comando global na primeira
// mensagem.
const fs = require("fs");
const path = require("path");

const RAIZ = __dirname;
const ENGINE = path.join(RAIZ, "src/modules/chatbot/chatbot.engine.js");
const SIMULADOR = path.join(RAIZ, "src/modules/chatbot/chatbot.simulador.js");

let falhas = 0;
const checar = (ok, mensagem) => {
  if (ok) return;
  falhas += 1;
  console.log("  FALHA  " + mensagem);
};

const engine = fs.readFileSync(ENGINE, "utf8");
const simulador = fs.readFileSync(SIMULADOR, "utf8");

// ── 1. Toda chamada de dependencia do motor, separando as guardadas ─────────
const obrigatorias = new Map();
const guardadas = new Set();

// Duas formas de guarda que o motor usa: `?.(` na propria chamada e a checagem
// `if (this.deps.x.y)` antes de chamar.
for (const m of engine.matchAll(/this\.deps\.(\w+)\.(\w+)\?\./g)) {
  guardadas.add(m[1] + "." + m[2]);
}
for (const m of engine.matchAll(/if\s*\(\s*this\.deps\.(\w+)\.(\w+)\s*\)/g)) {
  guardadas.add(m[1] + "." + m[2]);
}
// `repo.metodo ? ... : ...` com o repositorio guardado numa variavel local
// (`const repo = this.deps.conversaRepository`) e a terceira forma. Ela e
// reconhecida pelo nome do metodo, porque a variavel apaga o nome da dep.
for (const m of engine.matchAll(/\brepo\.(\w+)\s*\n?\s*\?/g)) {
  guardadas.add("conversaRepository." + m[1]);
}

for (const m of engine.matchAll(/this\.deps\.(\w+)\.(\w+)\s*\(/g)) {
  const dep = m[1];
  const metodo = m[2];
  if (guardadas.has(dep + "." + metodo)) continue;
  if (!obrigatorias.has(dep)) obrigatorias.set(dep, new Set());
  obrigatorias.get(dep).add(metodo);
}

console.log("CONTRATO ENTRE O MOTOR E O SIMULADOR");
console.log("");

let totalObrigatorias = 0;
for (const metodos of obrigatorias.values()) totalObrigatorias += metodos.size;
checar(
  totalObrigatorias > 15,
  "so " + totalObrigatorias + " chamadas obrigatorias extraidas do motor -- a regex parou de casar"
);

// ── 2. Cada uma delas existe no ambiente do simulador ───────────────────────
//
// O ambiente e um literal de objeto dentro de `criarAmbiente`, entao a presenca
// e conferida pelo texto `metodo:` dentro dele. Instanciar o ambiente aqui
// exigiria duplicar o cenario -- e o que importa e a chave existir.
const inicioDeps = simulador.indexOf("const deps = {");
checar(inicioDeps >= 0, "nao achei o objeto `deps` em chatbot.simulador.js");
const ambiente = inicioDeps >= 0 ? simulador.slice(inicioDeps) : "";

for (const [dep, metodos] of obrigatorias) {
  if (ambiente.indexOf(dep + ": {") < 0) {
    checar(false, "o simulador nao declara a dependencia `" + dep + "` (o motor a chama sem guarda)");
    continue;
  }
  for (const metodo of metodos) {
    const temChave = new RegExp("\\b" + metodo + "\\s*:").test(ambiente);
    checar(
      temChave,
      "o motor chama `deps." + dep + "." + metodo + "()` sem guarda e o simulador nao oferece o " +
        'metodo -- testar um fluxo que passe por ai estoura TypeError e a tela "Testar" reporta ' +
        '"erro_interno" como se o defeito fosse do fluxo'
    );
  }
}

// ── 3. E os caminhos que quebraram de verdade continuam andando ─────────────
(async () => {
  const sim = require("./src/modules/chatbot/chatbot.simulador");

  const queEncerra = {
    id: "contrato-1",
    nome: "Fluxo que encerra",
    gatilho: "*",
    ativo: true,
    passos: [
      {
        id: "p1",
        tipo: "mensagem",
        titulo: "Menu",
        texto: "Escolha:\n1 - Encerrar",
        ordem: 0,
        config: {
          opcoes: [
            {
              id: "o1",
              palavrasChave: ["1"],
              esperaEscolha: true,
              acao: "encerrar",
              mensagemEncerramento: "Obrigado pelo contato!",
            },
          ],
        },
      },
    ],
  };

  const r = await sim.simular(queEncerra, ["oi", "1"], { pesquisaSatisfacao: false });
  const ultimo = r.turnos[r.turnos.length - 1];

  checar(
    ultimo.encerrado === true,
    'um fluxo com opcao "encerrar" deveria terminar encerrado; veio encerrado=' +
      ultimo.encerrado + " transferido=" + ultimo.transferido + " motivo=" + ultimo.motivo
  );
  checar(
    ultimo.motivo !== "erro_interno",
    "a simulacao caiu em erro_interno -- o ambiente do simulador nao cumpre o contrato do motor"
  );
  checar(
    ultimo.respostas.includes("Obrigado pelo contato!"),
    "a despedida do fluxo nao foi enviada: " + JSON.stringify(ultimo.respostas)
  );
  if (!falhas) console.log("  OK    fluxo que encerra termina encerrado, com a despedida do fluxo");

  // FIM DE FLUXO SEM OPCAO NENHUMA: o bloco fala e nao tem para onde ir.
  //
  // O motor levantava `fimDoFluxo` so no ramo que tem `config.opcoes`, entao
  // este desenho -- o mais comum para "Chamado aberto com sucesso" -- concluia a
  // sessao SEM entregar a conversa. A prova do defeito era o terceiro turno: o
  // cliente perguntava "alguma novidade?" e recebia a triagem desde o inicio.
  const antesDoFim = falhas;
  const semSaida = {
    id: "contrato-2",
    nome: "Fluxo que termina em confirmacao",
    gatilho: "*",
    ativo: true,
    passos: [
      {
        id: "q1",
        tipo: "mensagem",
        titulo: "Pergunta",
        texto: "Descreva sua solicitacao",
        ordem: 0,
        config: { aguardar: "texto" },
        targetId: "q2",
      },
      {
        id: "q2",
        tipo: "mensagem",
        titulo: "Confirma",
        texto: "Chamado aberto com sucesso!",
        ordem: 1,
        config: {},
      },
    ],
  };
  const r2 = await sim.simular(semSaida, ["oi", "meu pc nao liga", "alguma novidade?"], {
    pesquisaSatisfacao: false,
  });
  const fim = r2.turnos[r2.turnos.length - 1];
  checar(
    fim.transferido === true,
    "o fim do fluxo num bloco sem saida deveria ENTREGAR a conversa; veio transferido=" +
      fim.transferido
  );
  checar(
    r2.turnos.length === 2,
    "o bot nao pode reabrir a triagem depois de entregar o chamado (turnos: " + r2.turnos.length + ")"
  );
  if (falhas === antesDoFim) {
    console.log("  OK    bloco final sem saida entrega a conversa, e o bot nao reabre a triagem");
  }

  // COMANDO GLOBAL NAO SEQUESTRA A PRIMEIRA MENSAGEM.
  //
  // "cancelar", "encerrar", "parar", "tchau", "voltar", "inicio" sao vocabulario
  // do problema do cliente. Casando por substring na PRIMEIRA mensagem, cada uma
  // dessas frases legitimas recebia silencio absoluto (`sair`) ou fila calada
  // (`menu`) -- sem triagem, sem setor e sem CNPJ.
  const antesDasFrases = falhas;
  const frases = [
    "Bom dia, preciso cancelar meu boleto",
    "Preciso encerrar meu contrato de internet",
    "quero voltar a usar o sistema antigo",
    "Tchau, era so isso",
    "meu sistema parou de funcionar",
  ];
  for (const frase of frases) {
    const rf = await sim.simular(queEncerra, [frase], { pesquisaSatisfacao: false });
    const t = rf.turnos[0];
    checar(
      t.respostas.length > 0 && !t.encerrado && !t.transferido,
      '"' + frase + '" deveria abrir o fluxo; veio respostas=' + JSON.stringify(t.respostas) +
        " encerrado=" + t.encerrado + " transferido=" + t.transferido
    );
  }
  if (falhas === antesDasFrases) {
    console.log("  OK    frase com 'cancelar'/'encerrar'/'voltar'/'tchau' abre o fluxo, nao encerra");
  }

  // E o comando DELIBERADO continua valendo: "menu" sozinho mostra o menu.
  const antesDoMenu = falhas;
  for (const comando of ["menu", "inicio", "voltar"]) {
    const rm = await sim.simular(queEncerra, [comando], { pesquisaSatisfacao: false });
    checar(
      rm.turnos[0].respostas.length > 0 && !rm.turnos[0].transferido,
      '"' + comando + '" sozinho deveria mostrar o menu; veio ' +
        JSON.stringify(rm.turnos[0].respostas) + " transferido=" + rm.turnos[0].transferido
    );
  }
  if (falhas === antesDoMenu) console.log("  OK    comando deliberado ('menu' sozinho) reabre o fluxo");

  console.log("");
  if (falhas) {
    console.log("CONTRATO DO SIMULADOR: " + falhas + " FALHA(S)");
    process.exit(1);
  }
  console.log(
    "CONTRATO DO SIMULADOR: TUDO CONFERE (" + totalObrigatorias +
      " chamadas obrigatorias do motor conferidas)"
  );
})();
