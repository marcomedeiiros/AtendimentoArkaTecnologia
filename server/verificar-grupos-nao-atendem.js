/**
 * GRUPO NAO ABRE ATENDIMENTO -- a verificacao do buraco que apareceu em producao.
 *
 * ── O QUE ACONTECEU ────────────────────────────────────────────────────────
 *
 * O numero da empresa participa de um grupo. Alguem falou la, o webhook
 * entregou a mensagem como qualquer outra, e a conversa DO GRUPO apareceu na
 * fila de atendimento -- com o pushName de quem falou no lugar do nome do
 * cliente e as nao-lidas subindo a cada mensagem trocada entre a equipe.
 *
 * O recebimento so pulava `fromMe`. Nada olhava o SUFIXO do `remoteJid`, que e
 * a unica coisa que distingue pessoa de grupo, transmissao e canal. E
 * `extrairTelefone` nao tinha como perceber: ele faz `split("@")[0]` e limpa o
 * que nao e digito, entao "5527998189226-1620131695@g.us" virou um "telefone"
 * de 23 digitos, que passa por qualquer checagem de tamanho.
 *
 * ── POR QUE UM TESTE, E NAO SO O CONSERTO ──────────────────────────────────
 *
 * Porque este defeito e SILENCIOSO no unico lugar em que se olharia: o webhook
 * respondeu 200, nenhum log de erro, nenhuma excecao. So aparece como conversa
 * estranha na fila, dias depois, e para quem olha a fila -- nao para quem mexe
 * no codigo. Um teste que envia um payload de grupo e confere que NADA foi
 * gravado e o que impede a proxima refatoracao de reabrir isso sem ninguem ver.
 *
 * O caso "pessoa continua entrando" esta junto de proposito: a correcao obvia
 * (exigir "@s.whatsapp.net") fecharia o grupo e passaria a DERRUBAR clientes de
 * verdade em qualquer identificador novo que o WhatsApp inventasse. Este teste
 * falha nas duas direcoes.
 *
 * TOCA O BANCO DE DESENVOLVIMENTO e limpa tudo no final.
 *
 *   cd server && node verificar-grupos-nao-atendem.js
 */
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const prisma = require("./src/infrastructure/database/prisma.client");
const whatsappService = require("./src/modules/whatsapp/whatsapp.service");

const MARCA = "grupos-" + process.pid;
const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${msg}`);
  if (!ok) erros.push(`[${secao}] ${msg}`);
};

// Payload no formato que a Evolution entrega no messages.upsert.
const payload = (remoteJid, texto) => ({
  event: "messages.upsert",
  instance: MARCA,
  data: {
    key: { remoteJid, fromMe: false, id: `${MARCA}-${Math.random().toString(36).slice(2)}` },
    pushName: "Yesser Munzer",
    message: { conversation: texto },
    messageTimestamp: Math.floor(Date.now() / 1000),
  },
});

// Conta conversas cujo telefone contem os digitos do jid -- e assim que a
// conversa fantasma apareceu: o jid inteiro virou "telefone".
const contarPorDigitos = (jid) =>
  prisma.conversa.count({ where: { telefone: { contains: jid.split("@")[0].replace(/\D/g, "") } } });

(async () => {
  const criados = [];
  try {
    const instancia = await prisma.instancia.create({
      data: { nome: MARCA, conectado: false, webhookSecret: MARCA },
    });

    // ── 1 ────────────────────────────────────────────────────────────────
    titulo("1. Mensagem de GRUPO nao vira conversa");
    // O jid real que abriu a conversa fantasma em producao (grupo antigo:
    // numero de quem criou + hifen + carimbo de criacao).
    const jidGrupo = "5527998189226-1620131695@g.us";
    let r = await whatsappService.processarWebhook(payload(jidGrupo, "mensagem no grupo"), MARCA);
    check(r?.processado === false, `webhook respondeu processado=false (motivo: ${r?.motivo})`);
    check(r?.motivo === "grupo", `motivo registrado como "grupo" (veio: ${r?.motivo})`);
    check((await contarPorDigitos(jidGrupo)) === 0, "nenhuma conversa criada para o grupo");

    // ── 2 ────────────────────────────────────────────────────────────────
    titulo("2. Grupo NOVO (jid so de digitos) tambem nao passa");
    const jidGrupoNovo = "120363123456789012@g.us";
    r = await whatsappService.processarWebhook(payload(jidGrupoNovo, "outro grupo"), MARCA);
    check(r?.motivo === "grupo", `motivo "grupo" (veio: ${r?.motivo})`);
    check((await contarPorDigitos(jidGrupoNovo)) === 0, "nenhuma conversa criada");

    // ── 3 ────────────────────────────────────────────────────────────────
    titulo("3. Status e canal tambem nao sao atendimento");
    r = await whatsappService.processarWebhook(payload("status@broadcast", "status"), MARCA);
    check(r?.motivo === "transmissao", `status@broadcast -> "${r?.motivo}" (esperado transmissao)`);
    r = await whatsappService.processarWebhook(payload("123456@newsletter", "canal"), MARCA);
    check(r?.motivo === "canal", `@newsletter -> "${r?.motivo}" (esperado canal)`);

    // ── 4 ────────────────────────────────────────────────────────────────
    titulo("4. E O CLIENTE DE VERDADE CONTINUA ENTRANDO");
    const telefonePessoa = "5527" + String(Math.floor(1e8 + Math.random() * 8e8));
    r = await whatsappService.processarWebhook(
      payload(`${telefonePessoa}@s.whatsapp.net`, "oi, preciso de suporte"),
      MARCA
    );
    check(r?.processado !== false, `webhook processou a mensagem da pessoa (motivo: ${r?.motivo || "-"})`);
    const daPessoa = await prisma.conversa.findMany({ where: { telefone: telefonePessoa } });
    check(daPessoa.length === 1, `conversa da pessoa criada (${daPessoa.length})`);
    criados.push(...daPessoa.map((c) => c.id));

    criados.push(instancia.id);
  } catch (e) {
    erros.push(`[fatal] ${e.message}`);
    console.error("\nERRO FATAL:", e.message);
  } finally {
    titulo("limpeza");
    for (const id of criados) {
      await prisma.conversa.delete({ where: { id } }).catch(() => {});
      await prisma.instancia.delete({ where: { id } }).catch(() => {});
    }
    await prisma.instancia.deleteMany({ where: { nome: MARCA } }).catch(() => {});
    const sobra = await prisma.instancia.count({ where: { nome: MARCA } });
    check(sobra === 0, `limpeza completa (sobraram ${sobra} registros de teste)`);

    await prisma.$disconnect();
    console.log(
      erros.length
        ? `\n${erros.length} FALHA(S):\n` + erros.map((e) => "  - " + e).join("\n")
        : "\nGRUPO/TRANSMISSAO/CANAL NAO ABREM ATENDIMENTO -- E O CLIENTE CONTINUA ENTRANDO"
    );
    process.exit(erros.length ? 1 : 0);
  }
})();
