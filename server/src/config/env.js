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
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  evolutionApi: {
    url: process.env.EVOLUTION_API_URL || "http://localhost:8080",
    key: process.env.EVOLUTION_API_KEY || "",
    instance: process.env.WHATSAPP_INSTANCE || "arka-wapi-oficial",
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
};

module.exports = env;
