/**
 * BACKUP E RESTAURACAO -- as garantias que a gente diz ter.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * Backup que ninguem restaurou e hipotese, nao garantia. E as decisoes que os
 * scripts de deploy tomam parecem detalhe ate o dia em que custam caro:
 *
 *   - por que `.backup` e nao `cp`?
 *   - por que conferir a copia depois de fazer?
 *   - por que contar linhas, se o integrity_check ja passou?
 *   - por que apagar os -wal/-shm ao restaurar?
 *
 * Cada pergunta dessas vira um teste aqui. Nao sao hipoteses: sao os quatro
 * jeitos conhecidos de um backup parecer bom e nao ser.
 *
 * O QUE ESTE ARQUIVO NAO COBRE: os scripts em si (`deploy/backup.sh`,
 * `deploy/restaurar.sh`) chamam `docker compose exec`, e Docker so existe na VM.
 * O que se prova aqui e a LOGICA que eles implementam, com o mesmo SQLite. A
 * primeira execucao na VM continua sendo necessaria -- e o proprio backup.sh
 * falha alto se algo estiver errado.
 *
 * Nao toca no banco do projeto: cria os seus proprios, numa pasta temporaria.
 *
 *   cd server && node verificar-backup.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync, backup } = require("node:sqlite");

const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), "arka-backup-"));
const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (rotulo, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  if (!ok) {
    console.log(`        obtido:   ${JSON.stringify(obtido)}`);
    console.log(`        esperado: ${JSON.stringify(esperado)}`);
    erros.push(`[${secao}] ${rotulo}`);
  }
};

// Um banco parecido com o de producao: WAL ligado (como o do Arka -- ver
// prisma.client.js) e conversas com mensagens dentro.
function bancoDeTeste(arquivo, quantasConversas = 200) {
  const db = new DatabaseSync(arquivo);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("CREATE TABLE conversas (id INTEGER PRIMARY KEY, nome TEXT, setor TEXT);");
  db.exec("CREATE TABLE mensagens (id INTEGER PRIMARY KEY, conversa_id INT, texto TEXT);");
  const c = db.prepare("INSERT INTO conversas (id, nome, setor) VALUES (?, ?, ?)");
  const m = db.prepare("INSERT INTO mensagens (id, conversa_id, texto) VALUES (?, ?, ?)");
  for (let i = 1; i <= quantasConversas; i++) {
    c.run(i, `Cliente ${i}`, ["Comercial", "Técnico", "Financeiro"][i % 3]);
    for (let j = 0; j < 5; j++) m.run(i * 10 + j, i, `mensagem ${j} da conversa ${i} com acentuacao`);
  }
  return db;
}

// A conferencia que `deploy/backup.sh` faz na copia, em JavaScript.
function conferir(arquivo) {
  try {
    const db = new DatabaseSync(arquivo, { readOnly: true });
    const integridade = db.prepare("PRAGMA integrity_check;").get().integrity_check;
    let conversas = 0;
    try { conversas = db.prepare("SELECT COUNT(*) c FROM conversas").get().c; } catch { conversas = -1; }
    db.close();
    return { integridade, conversas };
  } catch (e) {
    return { integridade: "ilegivel: " + e.message.slice(0, 40), conversas: -1 };
  }
}

(async () => {
  // ─────────────────────────────────────────────────────────────────────────
  titulo("1. Copia a QUENTE, com o banco recebendo escrita");

  // E o caso real: o backup roda com clientes conversando. Se a copia so
  // funcionasse com o sistema parado, ela nao serviria para producao.
  const vivo = path.join(PASTA, "vivo.db");
  const db = bancoDeTeste(vivo);

  const escrevendo = setInterval(() => {
    try { db.prepare("INSERT INTO mensagens (conversa_id, texto) VALUES (1, ?)").run("durante o backup"); } catch { /* fim */ }
  }, 1);

  const copia = path.join(PASTA, "copia.db");
  await backup(db, copia);
  clearInterval(escrevendo);

  const r1 = conferir(copia);
  check("a copia abre e esta integra", r1.integridade, "ok");
  check("a copia tem as 200 conversas", r1.conversas, 200);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("2. Por que `.backup` e nao `cp` (a razao do comentario no script)");

  // Copiar o ARQUIVO enquanto a aplicacao escreve pega o banco no meio de uma
  // transacao, e sem o -wal que o completa. E o erro classico, e o resultado
  // costuma abrir normalmente -- so quebra depois.
  const vivo2 = path.join(PASTA, "vivo2.db");
  const db2 = bancoDeTeste(vivo2, 500);
  const escrevendo2 = setInterval(() => {
    try { db2.prepare("INSERT INTO mensagens (conversa_id, texto) VALUES (2, ?)").run("x".repeat(400)); } catch { /* fim */ }
  }, 1);
  await new Promise((r) => setTimeout(r, 60));
  const cru = path.join(PASTA, "copia-crua.db");
  fs.copyFileSync(vivo2, cru);          // <- o `cp` ingenuo, SEM o -wal
  clearInterval(escrevendo2);

  const rCru = conferir(cru);
  const rBom = await (async () => { const d = path.join(PASTA, "copia-boa.db"); await backup(db2, d); return conferir(d); })();

  check("o `.backup` traz o banco COMPLETO", rBom.conversas, 500);

  // O achado que importa, e que e pior do que corromper: o `cp` cru perde o que
  // ainda esta no -wal e mesmo assim passa no integrity_check. Ou seja, a
  // conferencia do backup.sh NAO salvaria um backup feito com `cp` -- ele
  // pareceria perfeito, com dado a menos. Por isso a copia tem que ser
  // `.backup`, e nao "cp + conferir depois".
  console.log(`        (o \`cp\` cru: integridade=${rCru.integridade}, conversas=${rCru.conversas} de 500)`);
  check("o `cp` cru perde dado que o `.backup` preserva", rCru.conversas < rBom.conversas, true);
  check("e o pior: o `cp` incompleto AINDA passa no integrity_check", rCru.integridade, "ok");
  db2.close();

  // ─────────────────────────────────────────────────────────────────────────
  titulo("3. Copia corrompida e RECUSADA (nao vira backup)");

  const podre = path.join(PASTA, "podre.db");
  fs.copyFileSync(copia, podre);
  // Estraga paginas no meio do arquivo, deixando o cabecalho intacto -- e assim
  // que um banco fica "abre, mas quebra na tabela errada", que foi exatamente o
  // que aconteceu com o dev.db deste projeto.
  const buf = fs.readFileSync(podre);
  for (let p = 8192; p < Math.min(buf.length, 65536); p += 7) buf[p] = 0x00;
  fs.writeFileSync(podre, buf);

  const r3 = conferir(podre);
  check("o integrity_check acusa a corrupcao", r3.integridade === "ok", false);
  console.log(`        (integridade relatada: ${String(r3.integridade).slice(0, 60)})`);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("4. Banco VAZIO passa no integrity_check -- por isso contamos linhas");

  // Este e o teste que justifica a segunda checagem do backup.sh. Um banco sem
  // nenhuma linha e um banco perfeitamente integro; sem contar as conversas, um
  // backup vazio passaria por bom e apagaria os antigos na rotacao.
  const vazio = path.join(PASTA, "vazio.db");
  const dbv = new DatabaseSync(vazio);
  dbv.exec("CREATE TABLE conversas (id INTEGER PRIMARY KEY);");
  dbv.close();

  const r4 = conferir(vazio);
  check("banco vazio passa na integridade", r4.integridade, "ok");
  check("mas a contagem de conversas o denuncia", r4.conversas, 0);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("5. Restauracao devolve os dados IGUAIS");

  const impressao = (arquivo) => {
    const d = new DatabaseSync(arquivo, { readOnly: true });
    const r = {
      conversas: d.prepare("SELECT COUNT(*) c FROM conversas").get().c,
      mensagens: d.prepare("SELECT COUNT(*) c FROM mensagens").get().c,
      primeira: d.prepare("SELECT nome, setor FROM conversas ORDER BY id LIMIT 1").get(),
      ultima: d.prepare("SELECT nome, setor FROM conversas ORDER BY id DESC LIMIT 1").get(),
    };
    d.close();
    return r;
  };

  const antes = impressao(copia);
  const restaurado = path.join(PASTA, "restaurado.db");
  // O que o restaurar.sh faz: apaga o destino E os sidecars, depois copia.
  for (const s of ["", "-wal", "-shm"]) { try { fs.unlinkSync(restaurado + s); } catch { /* nao existia */ } }
  fs.copyFileSync(copia, restaurado);
  const depois = impressao(restaurado);

  check("mesmas conversas", depois.conversas, antes.conversas);
  check("mesmas mensagens", depois.mensagens, antes.mensagens);
  check("mesmo primeiro registro", depois.primeira, antes.primeira);
  check("mesmo ultimo registro", depois.ultima, antes.ultima);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("6. Restaurar SEM apagar os -wal/-shm antigos quebra o banco");

  // E a linha `rm -f /data/arka.db-wal` do restaurar.sh. Um -wal sobrando de
  // OUTRO banco nao combina com o arquivo restaurado, e o SQLite recusa --
  // "database disk image is malformed", o mesmo erro que ja nos custou o dev.db.
  const comLixo = path.join(PASTA, "com-lixo.db");
  fs.copyFileSync(copia, comLixo);
  // Um -wal de outro banco, com o cabecalho de WAL valido mas salt diferente.
  const outro = path.join(PASTA, "outro.db");
  const dbo = bancoDeTeste(outro, 3);
  dbo.prepare("INSERT INTO mensagens (conversa_id, texto) VALUES (1, 'x')").run();
  // NAO fechar antes de copiar: fechar consolida o WAL no banco e apaga o
  // arquivo -- e era por isso que este passo vinha sendo pulado.
  if (fs.existsSync(outro + "-wal")) {
    fs.copyFileSync(outro + "-wal", comLixo + "-wal");
    const rLixo = conferir(comLixo);
    const quebrou = rLixo.integridade !== "ok" || rLixo.conversas !== 200;
    check("o -wal alheio arruina o banco restaurado", quebrou, true);
    // O resultado medido e pior do que "quebra": o SQLite APLICA o wal alheio e
    // entrega os dados do OUTRO banco, com integridade "ok". Restaurar sem
    // apagar os sidecars pode devolver, calado, um banco que nao e o que se
    // pediu -- e ninguem confere o que parece estar certo.
    console.log(`        (integridade=${String(rLixo.integridade).slice(0, 40)}, conversas=${rLixo.conversas} -- esperadas 200)`);
    if (rLixo.integridade === "ok" && rLixo.conversas !== 200) {
      console.log("        ou seja: veio o conteudo do OUTRO banco, sem nenhum erro.");
    }
  } else {
    console.log("  OK   (sem -wal para reaproveitar neste sistema; passo pulado)");
    console.log("        O `rm -f` do restaurar.sh continua sendo o certo a fazer.");
  }

  dbo.close();
  db.close();
  fs.rmSync(PASTA, { recursive: true, force: true });

  console.log(
    "\n" + (erros.length
      ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
      : "BACKUP E RESTAURACAO: TUDO CONFERE")
  );
  process.exit(erros.length ? 1 : 0);
})();
