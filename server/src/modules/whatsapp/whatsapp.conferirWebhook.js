/**
 * O WEBHOOK ESTÁ MESMO DE PÉ? -- conferido ao subir, e dito em voz alta.
 *
 * ── O QUE ACONTECEU EM 07/09/2026 ──────────────────────────────────────────
 *
 * O bot ficou mudo por horas. Todos os sinais de saúde diziam que estava tudo
 * bem: contêineres no ar e `healthy`, WhatsApp `CONNECTED`, painel abrindo
 * normalmente. A Evolution recebia as mensagens e não avisava a API -- ela
 * simplesmente não tinha webhook configurado (`/webhook/find` devolvia `null`).
 *
 * Nada nesta plataforma sabia disso. O webhook é a única via de entrada de
 * mensagem, e era a única peça que ninguém conferia.
 *
 * ── POR QUE CONFERIR, E NÃO CONSERTAR SOZINHO ──────────────────────────────
 *
 * Este módulo AVISA; não reconfigura. Regravar o webhook no boot parece
 * tentador, mas o processo que sobe não sabe por qual endereço a Evolution
 * consegue alcançá-lo -- em outra topologia (proxy na frente, host diferente,
 * n8n no meio) ele sobrescreveria uma configuração correta por uma que só vale
 * aqui, e a pane trocaria de lugar em vez de acabar.
 *
 * Escrever no log o que está configurado e o que se esperava é o suficiente:
 * transforma horas de silêncio numa linha visível em `docker logs arka-api`.
 * O conserto continua sendo de quem sabe a topologia -- pelo painel, em
 * Integração WhatsApp.
 *
 * ── NÃO DERRUBA O BOOT ─────────────────────────────────────────────────────
 *
 * A conferência é um confortável, não um requisito. Se a Evolution estiver
 * fora do ar no instante em que a API sobe, o certo é a API subir mesmo assim
 * -- o vigia de reconexão existe exatamente para esse caso. Por isso tudo aqui
 * é engolido e vira aviso.
 */
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const env = require("../../config/env");
const logger = require("../../config/logger");

// Espera um pouco antes de perguntar. A API e a Evolution sobem juntas num
// `docker compose up`, e perguntar no primeiro segundo mede a corrida entre as
// duas, não a configuração.
const ESPERA_MS = 20_000;

/** Só o suficiente para comparar sem despejar o segredo no log. */
function resumirUrl(url) {
  if (!url) return null;
  return String(url).replace(/token=[^&]*/i, "token=***");
}

async function conferir() {
  const instancia = env.evolutionApi?.instance;
  if (!instancia) return;

  let config = null;
  try {
    config = await evolutionApi.findWebhook(instancia);
  } catch (e) {
    logger.warn("Nao consegui conferir o webhook da Evolution", {
      instancia,
      message: e.message,
      efeito: "Sem confirmacao de que as mensagens vao entrar. Confira em Integracao WhatsApp.",
    });
    return;
  }

  const url = config?.url || null;
  const ligado = config?.enabled === true;

  if (!url || !ligado) {
    logger.error("WEBHOOK AUSENTE -- nenhuma mensagem do WhatsApp vai entrar", {
      instancia,
      configurado: url ? resumirUrl(url) : "(nada)",
      enabled: config?.enabled ?? null,
      // O que fazer, escrito aqui para nao depender de alguem lembrar.
      conserto: "Painel > Integracao WhatsApp > configurar webhook.",
    });
    return;
  }

  // Chamar a Evolution para saber se ELA consegue alcancar a API nao e possivel
  // daqui -- so ela sabe. O que da para conferir e o formato: URL sem token e
  // recusada na porta (401), e essa recusa era invisivel ate hoje.
  if (!/[?&]token=/.test(url) && !/x-webhook-token/i.test(JSON.stringify(config?.headers || {}))) {
    logger.error("WEBHOOK SEM TOKEN -- a API vai recusar tudo com 401", {
      instancia,
      configurado: resumirUrl(url),
      conserto: "Painel > Integracao WhatsApp > configurar webhook.",
    });
    return;
  }

  // OS NOMES, e nao a quantidade.
  //
  // Aqui saia `eventos: 4`, e um mapa com quatro eventos certos e um com quatro
  // eventos errados escrevem a mesma linha. Foi o que deixou passar que
  // `MESSAGES_DELETE` nunca esteve na lista: o "apagar para todos" do cliente
  // nao chega, e o log dizia que estava tudo conferido.
  //
  // Vale um aviso sobre o alcance disto: nesta topologia quem entrega e o
  // webhook GLOBAL da Evolution (WEBHOOK_GLOBAL_URL, no compose dela), e ele NAO
  // aparece em `/webhook/find`. Entao lista vazia aqui e normal, e nao prova
  // ausencia -- o que prova de verdade quais eventos chegam e o log
  // "Webhook recebido e nao roteado", do outro lado da porta.
  const eventos = Array.isArray(config?.events) ? config.events : [];

  // ── E FALTA ALGUM? ────────────────────────────────────────────────────────
  //
  // Imprimir os nomes ja foi um avanco sobre imprimir a quantidade, mas ainda
  // deixava a conferencia para o olho humano -- e foi assim que a assinatura da
  // instancia ficou com tres eventos enquanto o conteiner da Evolution era
  // recriado para autorizar cinco. Sao DOIS filtros em serie, e mexer so num
  // nao muda nada; ver EVENTOS_PADRAO no cliente.
  //
  // Fica em `warn`, e nao em `error`: a mensagem continua entrando (o essencial
  // funciona), o que se perde e o "apagar"/"editar" do cliente. E o conserto e
  // barato -- uma chamada HTTP, sem tocar em conteiner.
  const faltando = evolutionApi.EVENTOS_PADRAO.filter((e) => !eventos.includes(e));
  if (eventos.length && faltando.length) {
    logger.warn("Webhook da Evolution assina MENOS eventos do que deveria", {
      instancia,
      faltando,
      assinados: eventos,
      efeito: "O que o cliente FAZ com a mensagem (apagar, editar) nao chega na Central.",
      conserto: "Painel > Integracao WhatsApp > configurar webhook (nao precisa recriar conteiner).",
    });
    return;
  }

  logger.info("Webhook da Evolution conferido", {
    instancia,
    url: resumirUrl(url),
    eventos: eventos.length ? eventos : "(por instancia vazio -- provavelmente o global)",
  });
}

function iniciar() {
  const t = setTimeout(() => {
    conferir().catch((e) =>
      logger.warn("Falha ao conferir o webhook", { message: e.message })
    );
  }, ESPERA_MS);
  // Nao segura o processo aberto: um `docker stop` durante a espera nao deve
  // ficar aguardando este temporizador.
  if (typeof t.unref === "function") t.unref();
}

module.exports = { iniciar, conferir };
