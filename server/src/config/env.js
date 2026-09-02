require("dotenv").config();

const ehProducao = (process.env.NODE_ENV || "development") === "production";

// Segredos com fallback conhecido sao uma bomba-relogio: se a variavel faltar
// em producao, o app sobe com um JWT_SECRET/WEBHOOK_SECRET que esta no codigo
// publico -- qualquer um forja token de admin ou chama o webhook. Entao os
// fallbacks so valem em desenvolvimento; em producao a ausencia derruba o boot.
function segredo(nome, valor, fallbackDev) {
  if (valor) return valor;
  if (ehProducao) {
    throw new Error(
      `Config ausente: defina ${nome} no ambiente. ` +
        `Gere com: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
    );
  }
  return fallbackDev;
}

// "30d", "12h", "90m", "45s" -> milissegundos. Numero puro e lido como
// milissegundos. Valor invalido cai no padrao recebido, para uma variavel
// digitada errada no .env nao virar sessao de NaN (que expiraria sempre).
function duracaoMs(valor, padraoMs) {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return padraoMs;
  const m = /^(\d+)\s*(s|m|h|d)?$/i.exec(bruto);
  if (!m) return padraoMs;
  const n = Number(m[1]);
  const unidade = (m[2] || "").toLowerCase();
  const fator = unidade === "s" ? 1_000 : unidade === "m" ? 60_000 : unidade === "h" ? 3_600_000 : unidade === "d" ? 86_400_000 : 1;
  return n * fator;
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    secret: segredo("JWT_SECRET", process.env.JWT_SECRET, "dev-secret-change-me"),
    // Padrao curto porque a sessao agora se renova sozinha: token de acesso e
    // credencial em circulacao, e quanto menos tempo ele vale, menor a janela
    // de um vazamento. Aumentar isto nao "melhora" a sessao -- so aumenta o
    // estrago de um token copiado.
    expiresIn: process.env.JWT_EXPIRES_IN || "1h",
  },
  // Sessao renovavel. O token de acesso (JWT acima) continua curto e sem
  // estado; quem sustenta a sessao longa e o refresh token da tabela
  // SessaoRefresh. NAO aumente JWT_EXPIRES_IN para "resolver" queda de sessao:
  // token longo e token que nao da para revogar. A correcao e renovar.
  sessao: {
    // Prazo de cada refresh token, renovado a cada rotacao (deslizante).
    // E o que faz a sessao sobreviver a fechar e reabrir o navegador.
    refreshMs: duracaoMs(process.env.REFRESH_EXPIRES_IN, 30 * 86_400_000), // 30d
    // TETO ABSOLUTO da sessao, contado do login. Sem ele, "deslizante" quer
    // dizer eterna: um refresh token roubado e usado de vez em quando se
    // renovaria para sempre. Passado este prazo, nem quem esta usando escapa --
    // pede senha de novo.
    maxMs: duracaoMs(process.env.SESSAO_MAX, 60 * 86_400_000), // 60d
    // Tolerancia para o DUPLICADO HONESTO: duas abas do mesmo operador podem
    // mandar o mesmo refresh token quase junto. Dentro desta janela, o segundo
    // pedido e tratado como repeticao (rotaciona de novo) em vez de roubo. Fora
    // dela, e reuso e a familia inteira cai. Curta de proposito.
    reusoToleranciaMs: duracaoMs(process.env.SESSAO_REUSO_TOLERANCIA, 15_000), // 15s
    // Teto de sessoes simultaneas por conta. Login novo alem disso derruba a
    // mais antiga: limita quantos refresh tokens vivos existem por pessoa e
    // impede que alguem acumule sessoes silenciosamente.
    maxPorUsuario: Math.max(1, Number(process.env.SESSAO_MAX_POR_USUARIO) || 10),
    // Janela de INATIVIDADE do operador. Quem passa deste tempo sem interagir
    // volta para o login, mesmo com refresh token valido -- e o que impede que
    // uma aba esquecida aberta por dias siga renovando sozinha. Vai para o
    // cliente na resposta do login/renovacao: so o navegador sabe se ha alguem
    // ali. A AUTORIDADE da sessao continua aqui (rotacao, revogacao, reuso).
    inatividadeMs: duracaoMs(process.env.SESSAO_INATIVIDADE, 12 * 3_600_000), // 12h
  },
  /**
   * QUANTOS PROXIES ESTAO NA FRENTE DA API.
   *
   * O compose ja mandava `TRUST_PROXY`, mas nenhum codigo lia -- entao o Express
   * ficava no padrao (`false`) e enxergava o IP do CONTAINER do nginx em toda
   * requisicao. O log de producao mostrava exatamente isso:
   *   ip: "::ffff:172.18.0.5"   (a rede interna do Docker, nao o cliente)
   * mais um aviso do express-rate-limit a cada requisicao.
   *
   * O efeito nao e so log sujo: com um IP unico para todo mundo, o rate limiting
   * vira uma cota GLOBAL em vez de por IP. Um atacante estoura o limite de login
   * e tranca o painel da empresa inteira, enquanto a protecao por IP contra
   * forca bruta simplesmente nao existe.
   *
   * Contagem de hops ate a API, do mais externo para o mais interno:
   *   1 = so o nginx do container `web`
   *   2 = Cloudflare + nginx  (o caso deste projeto)
   *
   * Numero exato, NUNCA `true`: com `true` o Express aceita qualquer
   * `X-Forwarded-For` que chegue, e o proprio cliente escolhe o seu "IP".
   */
  trustProxy: Math.max(0, Number(process.env.TRUST_PROXY ?? 2)),

  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",

  /**
   * As origens aceitas, como LISTA.
   *
   * `corsOrigin` continua existindo (e uma string, e e o que o middleware de
   * CORS recebe). Esta e a mesma coisa em formato de lista, para o guard de
   * CSRF conseguir perguntar "esta origem esta entre as nossas?" -- e para o
   * dia em que o painel e a API ficarem em hosts diferentes.
   */
  get corsOrigins() {
    return String(process.env.CORS_ORIGIN || "http://localhost:5173")
      .split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean);
  },

  /**
   * COOKIES DE SESSAO. Ver shared/helpers/sessaoCookie.helper.js.
   *
   * `secure` acompanha o ambiente: em producao ha HTTPS (a Cloudflare termina
   * na frente), e em desenvolvimento o http://localhost precisa funcionar --
   * um cookie `Secure` simplesmente nao e gravado sobre HTTP, e o login local
   * pararia sem nenhuma mensagem de erro.
   *
   * `sameSite: lax` e a primeira camada anti-CSRF: o navegador ja se recusa a
   * mandar o cookie num POST vindo de outro site.
   */
  cookie: {
    nomeAcesso: "arka_sessao",
    nomeRefresh: "arka_renovacao",
    nomeCsrf: "arka_csrf",
    secure:
      process.env.SESSAO_COOKIE_SECURE != null
        ? process.env.SESSAO_COOKIE_SECURE === "true"
        : ehProducao,
    sameSite: process.env.SESSAO_COOKIE_SAMESITE || "lax",
    // Vazio = o proprio host. So preencha para compartilhar entre subdominios.
    dominio: process.env.SESSAO_COOKIE_DOMINIO || undefined,
  },
  evolutionApi: {
    url: process.env.EVOLUTION_API_URL || "http://localhost:8080",
    key: process.env.EVOLUTION_API_KEY || "",
    instance: process.env.WHATSAPP_INSTANCE || "arka-wapi-oficial",
    // Ligado, o WhatsApp manda a agenda e o historico ao parear -- e sem ele a
    // Evolution fica com 0 contatos. Em troca, toda reconexao refaz essa
    // sincronizacao e demora mais para sair de `connecting`. Veja o comentario
    // em createInstance (evolution-api.client.js) antes de desligar.
    syncFullHistory: process.env.EVOLUTION_SYNC_FULL_HISTORY !== "false",
  },
  webhookSecret: segredo("WEBHOOK_SECRET", process.env.WEBHOOK_SECRET, "arka-webhook-secret"),
  admin: {
    email: process.env.ADMIN_EMAIL || "admin@arkatecnologia.com.br",
    password: process.env.ADMIN_PASSWORD || "Admin@123",
  },
  // Codigo de convite para /api/auth/cadastrar. Vazio (padrao) = cadastro
  // aberto: qualquer pessoa que alcance a URL cria conta e passa a ler as
  // conversas dos clientes. Preencha REGISTRO_CODIGO no .env para exigir o
  // codigo no cadastro -- o formulario mostra o campo sozinho quando isso
  // estiver ativo.
  registroCodigo: process.env.REGISTRO_CODIGO || "",

  /**
   * CLOUDFLARE TURNSTILE.
   *
   * A SECRET vive SO aqui, no servidor. A site key e publica por natureza (vai
   * no HTML), e por isso e servida por uma rota da API em vez de embutida no
   * bundle: assim trocar a chave nao exige rebuild do front, e nao existe
   * NENHUMA variavel do Turnstile do lado do cliente.
   *
   * Sem as duas chaves configuradas o desafio fica DESLIGADO e o login segue
   * normal -- a alternativa (fechar) transformaria "esqueci de preencher o
   * .env" em "ninguem entra no painel". Configuradas, a validacao passa a ser
   * obrigatoria e falha FECHADO.
   */
  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY || "",
    secretKey: process.env.TURNSTILE_SECRET_KEY || "",
    // Hostname esperado no retorno da Cloudflare. Vazio = nao confere.
    hostname: process.env.TURNSTILE_HOSTNAME || "",
    get ativo() {
      return !!(this.siteKey && this.secretKey);
    },
  },

  /**
   * Freios da autenticacao (ver bloqueioProgressivo.middleware.js).
   *
   * O rate limit responde "quantas requisicoes por janela". Isto responde outra
   * pergunta: "quantas FALHAS seguidas" -- que e o sinal de forca bruta. Quem
   * acerta a senha de primeira nao encosta em nada disto.
   *
   * Sao configuraveis porque "muita tentativa" depende do time: cinco pessoas
   * num mesmo escritorio saem todas pelo mesmo IP.
   */
  seguranca: {
    // Falhas toleradas antes de comecar a ATRASAR a resposta.
    falhasAteAtraso: Math.max(1, Number(process.env.SEG_FALHAS_ATE_ATRASO) || 3),
    // Falhas ate o bloqueio temporario (so por IP -- ver o middleware).
    falhasAteBloqueio: Math.max(2, Number(process.env.SEG_FALHAS_ATE_BLOQUEIO) || 8),
    // Primeiro bloqueio; dobra a cada reincidencia ate o teto.
    bloqueioBaseMs: duracaoMs(process.env.SEG_BLOQUEIO_BASE, 60_000), // 1min
    bloqueioMaxMs: duracaoMs(process.env.SEG_BLOQUEIO_MAX, 30 * 60_000), // 30min
    // Janela em que as falhas sao contadas; sem falha nova, o contador zera.
    janelaMs: duracaoMs(process.env.SEG_JANELA, 15 * 60_000), // 15min
    // Teto do atraso. Atraso longo demais vira DoS contra nos mesmos: cada
    // tentativa presa segura um socket aberto.
    atrasoMaxMs: duracaoMs(process.env.SEG_ATRASO_MAX, 2_000),
  },
};

module.exports = env;
