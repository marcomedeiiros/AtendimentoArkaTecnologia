/**
 * HORARIO DE ATENDIMENTO -- a regra de expediente, e so ela.
 *
 * Modulo PURO de proposito (nenhum acesso a banco, nenhum envio de mensagem):
 * ele recebe a configuracao e um instante, e responde tres perguntas.
 *
 *   1. estamos fora do expediente?           -> foraDoHorario
 *   2. como o expediente e escrito por extenso? -> resumoHorario
 *   3. qual e o texto de "fora do horario"?  -> mensagemFora
 *
 * ── POR QUE UM MODULO, E NAO MAIS TRES METODOS NO MOTOR ──────────────────────
 *
 * O que existia era `ChatbotEngine.foraDoHorario` + `_minutosDoDia`, com UMA
 * janela por semana (`{ inicio, fim, dias: [1..5] }`). Isso nao expressa o que a
 * operacao pede: dia ligado/desligado individualmente, mais de um periodo no
 * mesmo dia (o almoco), fuso proprio e feriado numa data especifica.
 *
 * Enfiar isso no motor faria a checagem de expediente crescer dentro de um
 * arquivo que ja tem 3.400 linhas, e ela e a unica parte do bot que da para
 * testar sem conversa, sem sessao e sem banco. Fica aqui, do lado do
 * `chatbot.inatividade.js` -- que e o outro relogio do bot, e tambem mora fora
 * do motor pela mesma razao.
 *
 * ── COMPATIBILIDADE ──────────────────────────────────────────────────────────
 *
 * `normalizarHorario` aceita as DUAS formas. A antiga
 * (`{ativo, inicio, fim, dias:[1..5], mensagem}`) e o que esta gravado hoje na
 * chave `chatbot.horario` de quem ja usa o sistema, e ela continua valendo
 * exatamente como valia -- inclusive a janela que atravessa a meia-noite
 * (22:00 as 06:00), que era o unico caso de canto ja coberto por teste.
 *
 * ── O QUE UM TYPO NA CONFIGURACAO NAO PODE FAZER ─────────────────────────────
 *
 * Bloquear o atendimento. Um horario ilegivel ("8h" em vez de "08:00"), um fuso
 * que nao existe ou um JSON quebrado devolvem "estamos DENTRO do expediente":
 * na duvida, atender. O contrario -- calar o bot por causa de uma virgula --
 * seria uma pane silenciosa, e o motor de fluxos e a unica coisa que responde o
 * cliente no modo "local".
 */

const { partesEmFuso, dataISOEmFuso, FUSO_PADRAO } = require("../../shared/helpers/cnpj.helper");

// `Date#getDay`: 0 = domingo. A configuracao usa a MESMA numeracao para nao
// precisar de traducao em lugar nenhum (a tela, o JSON e o motor concordam).
const DIAS_DA_SEMANA = [0, 1, 2, 3, 4, 5, 6];

// Nomes por extenso, usados na mensagem que o cliente recebe.
const NOME_DO_DIA = {
  0: "Domingo",
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
  6: "Sábado",
};
// Forma curta para o agrupamento ("Segunda a sexta").
const NOME_CURTO = {
  0: "domingo",
  1: "segunda",
  2: "terça",
  3: "quarta",
  4: "quinta",
  5: "sexta",
  6: "sábado",
};

// A semana comeca na SEGUNDA na leitura humana ("segunda a sexta"), mesmo que a
// numeracao siga o domingo=0 do Date.
const ORDEM_DE_LEITURA = [1, 2, 3, 4, 5, 6, 0];

// Expediente comercial: e o que a ARKA pratica e o que a tela oferece como
// ponto de partida. NAO e regra escondida -- `ativo: false` significa "atende a
// qualquer hora", que continua sendo o padrao de quem nunca configurou nada.
const PADRAO_COMERCIAL = { inicio: "08:00", fim: "18:00" };

/**
 * O texto de "fora do horario", com `{{horarios}}` no lugar da tabela.
 *
 * Ele mora AQUI e nao no fluxo: os horarios sao configuracao, e repeti-los
 * dentro de um passo do fluxo era exatamente o que criaria as duas fontes que
 * discordam (mudar o expediente na tela e o cliente continuar ouvindo "08:00 as
 * 18:00" porque o texto do bloco nao foi editado).
 */
/**
 * O AVISO DE FORA DO HORARIO.
 *
 * A versao anterior terminava com "sua mensagem sera recebida e poderemos dar
 * continuidade no proximo periodo de atendimento" -- uma PROMESSA de retorno. E
 * ela nao era verdade: a conversa caia em Pendentes e ficava a noite inteira,
 * ate alguem de manha achar, no meio de uma fila cheia, um cliente que escreveu
 * as 22h. Quem leu aquilo ficou esperando um retorno que ninguem tinha se
 * comprometido a dar.
 *
 * Agora o texto pede a acao que resolve de fato ("escreva de novo no horario") e
 * conta o que vai acontecer com a conversa. Dizer que sera encerrada parece
 * duro, e e melhor do que a alternativa: o cliente que acha que ja esta na fila
 * simplesmente nao volta a escrever, e o chamado dele nunca existe.
 *
 * `{{minutos}}` recebe o prazo REAL configurado (`encerrarAposMin`). Numero
 * escrito a mao aqui viraria mentira no dia em que alguem mudasse o prazo na
 * configuracao -- e ninguem lembraria de vir corrigir o texto.
 */
const MENSAGEM_PADRAO =
  "🌙 *Atendimento fora do horário*\n\n" +
  "Olá! Recebemos sua mensagem.\n\n" +
  "No momento, nossa equipe está fora do horário de atendimento.\n\n" +
  "Nosso horário de atendimento é:\n\n" +
  "{{horarios}}\n\n" +
  "*Para ser atendido, entre em contato novamente dentro do horário acima.*\n\n" +
  "Este atendimento será encerrado em {{minutos}} minutos. Seu histórico fica salvo — " +
  "é só nos escrever no horário de atendimento que abrimos um novo chamado para você.";

// Minutos entre o aviso de fora do horario e o encerramento automatico da
// conversa. Cinco e curto de proposito: a conversa nao deve amanhecer numa fila
// que ninguem podia atender, e o cliente acabou de ser avisado de que precisa
// voltar no expediente.
const ENCERRAR_APOS_MIN = 5;

// Quanto tempo antes de repetir o aviso de fora de horario para o MESMO cliente.
// Ver `deveAvisar`: 2 horas cobre a noite inteira sem repetir, e ainda avisa de
// novo quem volta no dia seguinte (tambem fora do expediente).
const REAVISAR_APOS_MIN = 120;

// "18:30" -> 1110 minutos. Fora do formato devolve null, e quem chama trata o
// periodo como ilegivel em vez de assumir zero (meia-noite).
function minutosDoDia(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// "08:00" a partir de minutos. Usado so na leitura por extenso.
function hhmm(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function textoOuVazio(valor) {
  return typeof valor === "string" ? valor : "";
}

function inteiro(valor, padrao, min, max) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : padrao;
}

/**
 * Uma lista de periodos, separando o que da para ler do que nao da.
 *
 * A distincao importa: um dia com periodo ILEGIVEL nao e um dia FECHADO. Ver o
 * cabecalho -- typo na configuracao nao bloqueia atendimento.
 *
 * @returns {{validos: Array<{inicio:number,fim:number}>, invalidos: number}}
 */
function lerPeriodos(bruto) {
  const lista = Array.isArray(bruto) ? bruto : [];
  const validos = [];
  let invalidos = 0;
  for (const p of lista) {
    const inicio = minutosDoDia(p?.inicio);
    const fim = minutosDoDia(p?.fim);
    if (inicio === null || fim === null || inicio === fim) {
      invalidos += 1;
      continue;
    }
    validos.push({ inicio, fim });
  }
  // Ordenado pela abertura: e o que a leitura por extenso mostra ao cliente.
  validos.sort((a, b) => a.inicio - b.inicio);
  return { validos, invalidos };
}

/**
 * A CONFIGURACAO EFETIVA, nas duas formas de entrada.
 *
 * Devolve sempre a forma nova, para o resto do modulo (e o motor) nao precisar
 * saber qual delas estava gravada:
 *
 *   {
 *     ativo, timezone, mensagem, reavisarAposMin,
 *     dias: { 0..6: { ativo, periodos: [{inicio:"08:00", fim:"18:00"}] } },
 *     excecoes: [{ data:"2026-12-25", fechado, periodos, descricao }],
 *   }
 */
function normalizarHorario(bruto) {
  const h = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {};

  const timezone = String(h.timezone || h.fuso || "").trim() || FUSO_PADRAO;
  const mensagem = textoOuVazio(h.mensagem);
  const reavisarAposMin = inteiro(h.reavisarAposMin, REAVISAR_APOS_MIN, 0, 24 * 60);
  // Minutos entre o aviso de fora do horario e o encerramento automatico.
  // `0` desliga o encerramento: a conversa fica em Pendentes como antes.
  const encerrarAposMin = inteiro(h.encerrarAposMin, ENCERRAR_APOS_MIN, 0, 24 * 60);

  // ── FORMA NOVA: um objeto por dia ───────────────────────────────────────
  const porDia = {};
  const temFormaNova = h.dias && typeof h.dias === "object" && !Array.isArray(h.dias);

  // ── FORMA ANTIGA: uma janela e a lista de dias que a usam ────────────────
  //
  // `dias: [1,2,3,4,5]` (array) + `inicio`/`fim` no topo. E o que esta gravado
  // em producao hoje. Convertido aqui, uma vez, em vez de espalhar dois
  // caminhos pelo resto do modulo.
  const diasLegado = Array.isArray(h.dias)
    ? h.dias.map(Number).filter((d) => DIAS_DA_SEMANA.includes(d))
    : null;
  const janelaLegado = {
    inicio: typeof h.inicio === "string" ? h.inicio : PADRAO_COMERCIAL.inicio,
    fim: typeof h.fim === "string" ? h.fim : PADRAO_COMERCIAL.fim,
  };

  for (const d of DIAS_DA_SEMANA) {
    if (temFormaNova) {
      const cfg = h.dias[String(d)] ?? h.dias[d] ?? null;
      const periodos = Array.isArray(cfg?.periodos)
        ? cfg.periodos
            .filter((p) => p && typeof p === "object")
            .map((p) => ({ inicio: textoOuVazio(p.inicio), fim: textoOuVazio(p.fim) }))
        : [];
      porDia[d] = { ativo: cfg?.ativo === true && periodos.length > 0, periodos };
      continue;
    }
    // Sem a forma nova: a janela unica vale nos dias listados. Lista ausente =
    // segunda a sexta, o mesmo padrao que a configuracao antiga aplicava.
    const dias = diasLegado && diasLegado.length ? diasLegado : [1, 2, 3, 4, 5];
    porDia[d] = dias.includes(d)
      ? { ativo: true, periodos: [{ ...janelaLegado }] }
      : { ativo: false, periodos: [] };
  }

  // ── EXCECOES (feriado / horario especial numa data) ──────────────────────
  //
  // Uma data, e o que vale nela. Sem `periodos`, e fechado -- que e o caso
  // comum (feriado). Com `periodos`, e um expediente diferente naquele dia
  // (vespera de Natal ate meio-dia).
  const excecoes = (Array.isArray(h.excecoes) ? h.excecoes : [])
    .filter((e) => e && typeof e === "object")
    .map((e) => {
      const data = String(e.data || "").trim();
      const periodos = Array.isArray(e.periodos)
        ? e.periodos
            .filter((p) => p && typeof p === "object")
            .map((p) => ({ inicio: textoOuVazio(p.inicio), fim: textoOuVazio(p.fim) }))
        : [];
      return {
        data,
        // `fechado` explicito vence; sem periodo nenhum, fechado tambem.
        fechado: e.fechado === true || periodos.length === 0,
        periodos,
        descricao: textoOuVazio(e.descricao),
      };
    })
    // Data fora de YYYY-MM-DD nunca casaria com nada: sai daqui para nao virar
    // uma excecao "invisivel" que o operador jura ter cadastrado.
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.data));

  return {
    ativo: h.ativo === true,
    timezone,
    dias: porDia,
    excecoes,
    mensagem,
    reavisarAposMin,
    encerrarAposMin,
  };
}

/**
 * O QUE VALE NESTA DATA -- excecao primeiro, depois o dia da semana.
 *
 * @returns {{fechado:boolean, periodos:Array, invalidos:number, excecao:object|null}}
 */
function regraDoDia(cfg, dataISO, diaSemana) {
  const excecao = cfg.excecoes.find((e) => e.data === dataISO) || null;
  if (excecao) {
    if (excecao.fechado) return { fechado: true, periodos: [], invalidos: 0, excecao };
    const { validos, invalidos } = lerPeriodos(excecao.periodos);
    return { fechado: false, periodos: validos, invalidos, excecao };
  }

  const dia = cfg.dias[diaSemana] || { ativo: false, periodos: [] };
  if (!dia.ativo) return { fechado: true, periodos: [], invalidos: 0, excecao: null };
  const { validos, invalidos } = lerPeriodos(dia.periodos);
  return { fechado: false, periodos: validos, invalidos, excecao: null };
}

// O dia anterior a `dataISO`, no calendario. Precisa existir por causa do
// periodo que atravessa a meia-noite: as 03:00 de terca ainda pertencem ao
// plantao que abriu as 22:00 de segunda -- e a excecao a consultar e a de
// SEGUNDA, nao a de terca.
function diaAnterior(dataISO) {
  const [a, m, d] = dataISO.split("-").map(Number);
  // UTC de proposito: e aritmetica de calendario sobre uma data ja resolvida no
  // fuso certo, e usar o fuso local aqui reintroduziria o deslocamento.
  const t = Date.UTC(a, m - 1, d) - 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * ESTAMOS FORA DO EXPEDIENTE?
 *
 * `false` quando a regra esta desligada, quando a configuracao e ilegivel, ou
 * quando o instante cai dentro de um periodo. Ver o cabecalho do modulo para o
 * porque de o ilegivel nao bloquear.
 *
 * @param {object} horario  configuracao (forma nova OU antiga)
 * @param {Date}   [agora]
 */
function foraDoHorario(horario, agora = new Date()) {
  const cfg = normalizarHorario(horario);
  if (!cfg.ativo) return false;

  const quando = agora instanceof Date ? agora : new Date(agora);
  const { minutosDoDia: minutos, diaSemana } = partesEmFuso(quando, cfg.timezone);
  const dataISO = dataISOEmFuso(quando, cfg.timezone);

  const hoje = regraDoDia(cfg, dataISO, diaSemana);

  // PERIODO DE HOJE. `fim <= inicio` atravessa a meia-noite: dali em diante o
  // dia esta aberto.
  for (const p of hoje.periodos) {
    const atravessa = p.fim < p.inicio;
    if (atravessa ? minutos >= p.inicio : minutos >= p.inicio && minutos < p.fim) return false;
  }

  // PERIODO DE ONTEM QUE AINDA NAO FECHOU. O plantao 22:00-06:00 de segunda
  // cobre as 03:00 de terca; sem isto, a madrugada seria "fora do horario"
  // exatamente durante o plantao.
  const ontemISO = diaAnterior(dataISO);
  const ontem = regraDoDia(cfg, ontemISO, (diaSemana + 6) % 7);
  for (const p of ontem.periodos) {
    if (p.fim < p.inicio && minutos < p.fim) return false;
  }

  // Nao caiu em periodo nenhum. Antes de dizer "fechado", separa o dia que esta
  // fechado DE PROPOSITO do dia cuja configuracao nao deu para ler.
  if (!hoje.fechado && hoje.periodos.length === 0 && hoje.invalidos > 0) return false;

  return true;
}

/**
 * QUANTOS PERIODOS ESTA CONFIGURACAO TEM DE FATO.
 *
 * Uma regra ATIVA sem nenhum periodo legivel em nenhum dia significaria "fechado
 * para sempre" -- o que quase certamente e configuracao pela metade, e nao a
 * intencao de nunca atender. Quem chama usa isto para nao bloquear.
 */
function temAlgumPeriodo(horario) {
  const cfg = normalizarHorario(horario);
  return DIAS_DA_SEMANA.some((d) => {
    const dia = cfg.dias[d];
    return dia?.ativo && lerPeriodos(dia.periodos).validos.length > 0;
  });
}

/**
 * O EXPEDIENTE POR EXTENSO -- e o `{{horarios}}` da mensagem.
 *
 * Agrupa dias CONSECUTIVOS com o mesmo expediente, porque e assim que se le:
 * "Segunda a sexta: 08:00 às 18:00" em vez de cinco linhas iguais. Dia fechado
 * so aparece quando `incluirFechados` -- na mensagem para o cliente o que
 * interessa e quando ATENDEMOS.
 *
 * @param {object} horario
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.incluirFechados=false]
 * @returns {string} linhas separadas por "\n"
 */
function resumoHorario(horario, { incluirFechados = false } = {}) {
  const cfg = normalizarHorario(horario);

  // A assinatura de um dia: os periodos legiveis, em texto. Dias com a mesma
  // assinatura entram no mesmo grupo.
  const assinatura = (d) => {
    const dia = cfg.dias[d];
    if (!dia?.ativo) return "";
    const { validos } = lerPeriodos(dia.periodos);
    if (!validos.length) return "";
    return validos.map((p) => `${hhmm(p.inicio)} às ${hhmm(p.fim)}`).join(" e ");
  };

  const grupos = [];
  for (const d of ORDEM_DE_LEITURA) {
    const chave = assinatura(d);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.chave === chave) ultimo.dias.push(d);
    else grupos.push({ chave, dias: [d] });
  }

  const linhas = [];
  for (const g of grupos) {
    if (!g.chave && !incluirFechados) continue;
    const rotulo =
      g.dias.length === 1
        ? NOME_DO_DIA[g.dias[0]]
        : g.dias.length === 2
          ? `${NOME_DO_DIA[g.dias[0]]} e ${NOME_CURTO[g.dias[1]]}`
          : `${NOME_DO_DIA[g.dias[0]]} a ${NOME_CURTO[g.dias[g.dias.length - 1]]}`;
    linhas.push(`${rotulo}: ${g.chave || "fechado"}`);
  }

  return linhas.join("\n");
}

/**
 * A MENSAGEM DE FORA DO HORARIO, com os horarios da configuracao dentro.
 *
 * `{{horarios}}` e substituido pelo `resumoHorario`. O template pode vir da
 * configuracao (campo `mensagem`) ou ser o padrao -- em nenhum dos dois casos os
 * horarios estao escritos a mao: e sempre a mesma fonte.
 *
 * Devolve "" quando nao ha o que dizer (configuracao sem periodo nenhum), para o
 * chamador nao mandar uma bolha vazia.
 */
function mensagemFora(horario, agora = new Date()) {
  const cfg = normalizarHorario(horario);
  const template = cfg.mensagem.trim() || MENSAGEM_PADRAO;
  const horarios = resumoHorario(cfg);

  // Uma excecao COM descricao explica melhor que a tabela ("Feriado: Natal").
  const quando = agora instanceof Date ? agora : new Date(agora);
  const dataISO = dataISOEmFuso(quando, cfg.timezone);
  const excecao = cfg.excecoes.find((e) => e.data === dataISO && e.descricao);

  let texto = template.replace(/\{\{\s*horarios\s*\}\}/g, horarios || "");

  // ── O PRAZO REAL, OU PARAGRAFO NENHUM ───────────────────────────────────
  //
  // `encerrarAposMin: 0` desliga o encerramento automatico. Interpolar o zero
  // faria o aviso prometer "encerrado em 0 minutos" -- pior que nao dizer nada,
  // porque descreve um comportamento que nao vai acontecer.
  //
  // Entao com o recurso desligado o PARAGRAFO inteiro sai. O corte e por
  // paragrafo (blocos separados por linha em branco) e nao por frase: e a
  // unidade que a mensagem ja usa, e qualquer texto que alguem escreva na
  // configuracao respeita a mesma regra sem precisar saber dela.
  const MINUTOS = /\{\{\s*minutos\s*\}\}/;
  if (cfg.encerrarAposMin > 0) {
    texto = texto.replace(new RegExp(MINUTOS.source, "g"), String(cfg.encerrarAposMin));
  } else {
    texto = texto
      .split(/\n{2,}/)
      .filter((bloco) => !MINUTOS.test(bloco))
      .join("\n\n");
  }
  if (excecao) {
    texto = texto.replace(
      /\{\{\s*excecao\s*\}\}/g,
      excecao.fechado ? `Hoje: ${excecao.descricao} (fechado)` : `Hoje: ${excecao.descricao}`
    );
  }
  // Placeholder que sobrou (a configuracao nao tem excecao hoje) nao vaza.
  texto = texto.replace(/\{\{\s*excecao\s*\}\}/g, "");
  return texto.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * O CLIENTE JA FOI AVISADO HA POUCO?
 *
 * A regra de "nao repetir" mora aqui porque ela e sobre HORARIO, e o dado que
 * ela le (`quando`) e a marca gravada na sessao pelo motor. Sem isto, o cliente
 * que escreve "oi", "alguem aí?", "preciso de ajuda" as 22h recebe o mesmo aviso
 * tres vezes -- foi o comportamento relatado.
 *
 * `reavisarAposMin: 0` na configuracao volta a avisar sempre, para quem preferir.
 *
 * @param {object} horario
 * @param {Date|string|null} quando  ultimo aviso enviado a este cliente
 */
function deveAvisar(horario, quando, agora = new Date()) {
  const cfg = normalizarHorario(horario);
  if (!quando) return true;
  if (cfg.reavisarAposMin <= 0) return true;
  const ultimo = quando instanceof Date ? quando : new Date(quando);
  if (Number.isNaN(ultimo.getTime())) return true;
  const passou = (agora instanceof Date ? agora : new Date(agora)).getTime() - ultimo.getTime();
  return passou >= cfg.reavisarAposMin * 60 * 1000;
}

module.exports = {
  DIAS_DA_SEMANA,
  NOME_DO_DIA,
  PADRAO_COMERCIAL,
  MENSAGEM_PADRAO,
  REAVISAR_APOS_MIN,
  ENCERRAR_APOS_MIN,
  minutosDoDia,
  normalizarHorario,
  regraDoDia,
  foraDoHorario,
  temAlgumPeriodo,
  resumoHorario,
  mensagemFora,
  deveAvisar,
};
