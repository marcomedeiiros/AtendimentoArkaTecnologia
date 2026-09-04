// Verificacao das FOTOS NA AGENDA -- `node verificar-fotos-contatos.js`.
//
// A lista de Contatos passou a mostrar a foto de perfil do WhatsApp, e o boneco
// cinza quando nao ha nenhuma. A parte que pode dar errado em silencio nao e
// desenhar a foto -- e ACHAR a foto certa, porque ela mora em dois lugares com
// prazos de validade diferentes:
//
//   conversas  o link e renovado pelo varredor (conversa.fotos.js). Sempre o
//              mais fresco que temos.
//   contatos   gravado na sincronizacao da agenda e parado desde entao. Serve
//              para quem nunca escreveu para o numero.
//
// Se a prioridade se inverter, a tela passa a mostrar links vencidos (403) para
// gente que TEM foto boa guardada na conversa -- e o sintoma e um boneco cinza
// que ninguem entende, porque a foto existe.
//
// O segundo risco e o casamento dos numeros: a agenda importada grava
// 5527999990000 e a conversa pode ter 27999990000. Comparados crus, o mesmo
// numero nao casa consigo mesmo e NINGUEM ganha foto.
//
// Usa o banco de verdade e limpa o que criou.
const prisma = require("./src/infrastructure/database/prisma.client");
const contatoService = require("./src/modules/contatos/contato.service");

const erros = [];
const check = (cond, msg) => {
  if (!cond) erros.push(msg);
  console.log(`  ${cond ? "OK   " : "FALHA"} ${msg}`);
};
const titulo = (t) => console.log(`\n=== ${t} ===\n`);

const MARCA = "teste-fotos";
const FOTO_CONVERSA = "https://exemplo.invalido/foto-da-conversa.jpg";
const FOTO_AGENDA = "https://exemplo.invalido/foto-da-agenda.jpg";

async function limpar() {
  await prisma.conversa.deleteMany({ where: { cliente: { startsWith: MARCA } } });
  await prisma.contato.deleteMany({ where: { nome: { startsWith: MARCA } } });
}

async function main() {
  await limpar();
  const instancia = await prisma.instancia.findFirst();
  if (!instancia) throw new Error("sem instancia no banco -- rode o seed (npm run db:seed)");

  const base = String(Date.now()).slice(-7);
  const numeros = {
    // Guardado COM DDI na agenda e SEM DDI na conversa: e o caso que falha
    // quando alguem compara os telefones crus.
    comConversa: { agenda: `5527${base}1`, conversa: `27${base}1` },
    soAgenda: { agenda: `5527${base}2` },
    semFoto: { agenda: `5527${base}3` },
  };

  await prisma.contato.createMany({
    data: [
      { nome: `${MARCA} tem conversa`, telefone: numeros.comConversa.agenda, fotoUrl: FOTO_AGENDA },
      { nome: `${MARCA} so agenda`, telefone: numeros.soAgenda.agenda, fotoUrl: FOTO_AGENDA },
      { nome: `${MARCA} sem foto`, telefone: numeros.semFoto.agenda },
    ],
  });
  await prisma.conversa.create({
    data: {
      cliente: `${MARCA} cliente`,
      telefone: numeros.comConversa.conversa,
      setor: "Geral",
      statusAtendimento: "aberta",
      instanciaId: instancia.id,
      fotoUrl: FOTO_CONVERSA,
    },
  });

  const lista = await contatoService.listar({ q: MARCA });
  const por = (sufixo) => lista.find((c) => c.nome === `${MARCA} ${sufixo}`);

  titulo("1. A FOTO CHEGA NA TELA");
  check(lista.length === 3, `os tres contatos de teste voltaram (${lista.length})`);
  check("fotoUrl" in (lista[0] || {}), "o campo fotoUrl existe no payload da agenda");

  titulo("2. A CONVERSA GANHA DA AGENDA (link fresco vence link parado)");
  const comConversa = por("tem conversa");
  check(
    comConversa?.fotoUrl === FOTO_CONVERSA,
    `contato com conversa usa a foto DA CONVERSA (veio "${comConversa?.fotoUrl}")`
  );
  // Este e o check que pega a comparacao crua de telefone: os dois numeros so
  // casam depois de tirar o DDI dos dois lados.
  check(
    comConversa?.fotoUrl !== FOTO_AGENDA,
    "e nao a da agenda, que pode estar vencida (DDI diferente nao impediu o casamento)"
  );

  titulo("3. SEM CONVERSA, VALE A FOTO DA AGENDA");
  check(
    por("so agenda")?.fotoUrl === FOTO_AGENDA,
    "quem nunca escreveu para o numero ainda tem foto"
  );

  titulo("4. SEM FOTO NENHUMA -> null (a tela desenha o boneco cinza)");
  check(
    por("sem foto")?.fotoUrl === null,
    `contato sem foto devolve null, e nao string vazia (veio ${JSON.stringify(por("sem foto")?.fotoUrl)})`
  );

  titulo("5. A TELA USA O AVATAR COMPARTILHADO");
  const fs = require("fs");
  const path = require("path");
  const view = fs.readFileSync(
    path.join(__dirname, "..", "client", "src", "components", "pages", "Contatos.jsx"),
    "utf8"
  );
  check(/<Avatar contato nome=\{contato\.nome\} fotoUrl=\{contato\.fotoUrl\}/.test(view),
    "a lista renderiza <Avatar contato ... fotoUrl>, com foto e boneco");
  // O circulo proprio que existia aqui tinha a copia quebrada das iniciais
  // (`p[0]` num emoji = meio par surrogate = o losango que apareceu na lista).
  check(!/\.split\(' '\)\.slice\(0,2\)\.map\(p => p\[0\]\)/.test(view),
    "a copia local das iniciais (que quebrava com emoji) nao existe mais");

  const avatar = fs.readFileSync(
    path.join(__dirname, "..", "client", "src", "components", "Avatar.jsx"),
    "utf8"
  );
  check(/onError=\{\(\) => setErroFoto\(true\)\}/.test(avatar),
    "o Avatar cai para o boneco quando o link da foto vence (403)");

  titulo("limpeza");
  await limpar();
  const sobrou =
    (await prisma.contato.count({ where: { nome: { startsWith: MARCA } } })) +
    (await prisma.conversa.count({ where: { cliente: { startsWith: MARCA } } }));
  check(sobrou === 0, `limpeza completa (sobraram ${sobrou})`);
}

main()
  .catch((e) => { erros.push(`excecao: ${e.message}`); console.error(e); })
  .finally(async () => {
    await limpar().catch(() => {});
    await prisma.$disconnect();
    if (erros.length) {
      console.log(`\nFALHAS (${erros.length}):`);
      for (const e of erros) console.log(`  ${e}`);
      process.exit(1);
    }
    console.log("\nFOTOS NA AGENDA: TUDO CONFERE");
  });
