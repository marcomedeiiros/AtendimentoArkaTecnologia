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
 * ── E O QUE ESSA CONFERÊNCIA ERRAVA (corrigido em 11/09/2026) ──────────────
 *
 * A primeira versão perguntava `/webhook/find` e, sem resposta, gritava
 * `error: WEBHOOK AUSENTE`. Só que nesta topologia quem entrega é o webhook
 * **global** da Evolution, e o global **não aparece** nessa consulta. Resultado:
 * o alarme saía a cada boot, com as mensagens entrando normalmente.
 *
 * Um alarme que grita todo dia é um alarme que ninguém lê no dia em que for
 * verdade -- e este cobre a única via de entrada de mensagem do produto. Gastar
 * a credibilidade dele era o defeito; o ruído era só o sintoma.
 *
 * A regra que ficou: **afirmar só o que dá para afirmar.** Ausência de webhook
 * por instância vira `warn` (é o normal aqui); webhook que existe e está
 * desligado continua `error` (isso é afirmável). E a pergunta que de fato
 * importa -- "está entrando alguma coisa?" -- passou a ser respondida por
 * EVIDÊNCIA, o tráfego real, e não por suposição. Ver `confirmarPeloTransito`.
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

// Quanto se espera por QUALQUER evento antes de dizer que a entrada está muda.
//
// Dez minutos é folgado de propósito: a pergunta que este relógio responde é "a
// Evolution está chamando?", e ela chama por muito mais do que mensagem --
// `connection.update`, `contacts.update`, `chats.update`. Uma instalação viva
// dificilmente passa dez minutos em silêncio absoluto; uma instalação com o
// webhook quebrado nunca sai dele.
const ESPERA_TRANSITO_MS = 10 * 60 * 1000;

/** Só o suficiente para comparar sem despejar o segredo no log. */
function resumirUrl(url) {
  if (!url) return null;
  return String(url).replace(/token=[^&]*/i, "token=***");
}

/**
 * A PROVA QUE FALTAVA: alguém chegou a bater na porta?
 *
 * Nenhuma pergunta feita à Evolution responde "as mensagens estão entrando?" --
 * o webhook global não aparece em `/webhook/find`, e ela não tem como dizer se
 * consegue nos alcançar. O tráfego responde, e é a única coisa que responde.
 *
 * Por isso o veredito fica em `warn`, e não em `error`: dez minutos de silêncio
 * é FORTE indício, não prova. Se ninguém falou com o número e a conexão estava
 * quieta, silêncio é normal -- e transformar isso num `error` recriaria, por
 * outro caminho, exatamente o alarme falso que este módulo acabou de perder.
 *
 * Quando há tráfego, sai uma linha positiva. Ela vale mais do que parece: hoje,
 * para saber que a entrada funciona, é preciso ir no log procurar por mensagem
 * recebida. Uma linha dizendo "confirmado" é o que transforma uma investigação
 * em uma leitura.
 */
function confirmarPeloTransito(instancia) {
  // Import tardio: `whatsapp.service` carrega o mundo (repositórios, storage,
  // motor do bot), e este módulo é chamado no boot -- exigi-lo no topo mudaria
  // a ordem de carga por causa de uma conferência que é um confortável.
  const whatsappService = require("./whatsapp.service");
  const t0 = Date.now();

  const t = setTimeout(() => {
    const ultimo = whatsappService.ultimoEventoEm();
    if (ultimo && ultimo >= t0) {
      logger.info("Webhook confirmado pelo transito -- eventos estao entrando", {
        instancia,
        ultimoEventoHaSegundos: Math.round((Date.now() - ultimo) / 1000),
      });
      return;
    }
    logger.warn("Nenhum evento do WhatsApp chegou desde que a API subiu", {
      instancia,
      minutos: Math.round(ESPERA_TRANSITO_MS / 60000),
      // As duas causas produzem o MESMO silencio e pedem consertos opostos. A
      // segunda tem sintoma proprio, e dizer isso aqui poupa a investigacao.
      seForQuebra:
        "Confira WEBHOOK_GLOBAL_URL no compose da Evolution. Se o log tiver " +
        "'Webhook RECUSADO', o problema e o WEBHOOK_SECRET divergente, nao a URL.",
      seForCalmaria: "Se ninguem falou com o numero neste periodo, isto e normal.",
    });
  }, ESPERA_TRANSITO_MS);

  // Nao segura o processo aberto: um `docker stop` durante a espera nao deve
  // ficar aguardando este temporizador.
  if (typeof t.unref === "function") t.unref();
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

  // ── "SEM WEBHOOK POR INSTANCIA" NAO E "SEM WEBHOOK" ───────────────────────
  //
  // Aqui saia `error: WEBHOOK AUSENTE -- nenhuma mensagem do WhatsApp vai
  // entrar`, e em producao ele saia A CADA BOOT -- com as mensagens entrando
  // normalmente. O motivo: nesta topologia quem entrega e o webhook GLOBAL da
  // Evolution (`WEBHOOK_GLOBAL_URL`, no compose dela), e o global NAO aparece em
  // `/webhook/find`. Perguntar por instancia sempre devolveu vazio.
  //
  // Isso e pior do que um log errado. Esta e exatamente a frase que, em
  // 07/09/2026, significou bot mudo por horas -- e uma frase que grita todo dia
  // sem motivo e uma frase que ninguem le no dia em que for verdade. Gastar o
  // unico alarme da unica via de entrada de mensagem e o defeito, nao o ruido.
  //
  // O que se pode afirmar daqui e so isto: nao ha webhook POR INSTANCIA. Quem
  // decide se ha entrada e o TRANSITO -- e ele e verificado logo abaixo, com
  // evidencia em vez de suposicao.
  if (!url) {
    logger.warn("Sem webhook POR INSTANCIA -- presumindo o global da Evolution", {
      instancia,
      naoEErro: "Nesta topologia o global entrega, e ele nao aparece em /webhook/find.",
      conferindo: `Aguardando ${Math.round(ESPERA_TRANSITO_MS / 60000)} min por qualquer evento para confirmar.`,
    });
    return confirmarPeloTransito(instancia);
  }

  // Webhook por instancia EXISTE e esta desligado: isto sim e afirmavel, e e
  // uma configuracao quebrada -- alguem criou e desativou.
  if (!ligado) {
    logger.error("WEBHOOK DESLIGADO -- nenhuma mensagem do WhatsApp vai entrar", {
      instancia,
      configurado: resumirUrl(url),
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
