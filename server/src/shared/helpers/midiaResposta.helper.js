/**
 * Cabeçalhos SEGUROS para servir bytes de mídia.
 *
 * O risco: os arquivos são servidos pela MESMA origem do painel. Se o navegador
 * abrir um HTML/SVG vindo daí, o script roda com a origem da aplicação (XSS
 * armazenado) e alcança a sessão do operador. O mimetype vem do banco, então
 * também não pode ser jogado cru num header.
 *
 * Defesa em camadas:
 *  1. `Content-Type` só sai de uma ALLOWLIST. Qualquer coisa fora dela vira
 *     application/octet-stream (o navegador não interpreta, só baixa).
 *  2. Só imagem/vídeo/áudio abrem INLINE. Documento e afins vão como
 *     `attachment` -- não renderizam na origem do painel.
 *  3. `nosniff` impede o navegador de "adivinhar" outro tipo.
 *  4. CSP restritiva (sandbox) para o caso de algo ainda ser renderizado.
 *  5. `Referrer-Policy: no-referrer` para o token da URL não vazar em navegação.
 *  6. Nome de arquivo sanitizado antes de ir no `Content-Disposition`.
 */

// Tipos que podem ser exibidos direto na página, sem virar vetor de script.
const INLINE_PERMITIDO = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime", "video/3gpp",
  "audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/webm", "audio/opus",
  /**
   * PDF ENTROU AQUI para o "Ver" da conversa funcionar.
   *
   * Ele saia como `attachment`, entao clicar em ver BAIXAVA o arquivo -- e a
   * nota fiscal que o cliente acabou de mandar so podia ser conferida abrindo a
   * pasta de downloads. Agora abre numa aba, como no WhatsApp.
   *
   * ── POR QUE ISSO NAO AFROUXA A DEFESA ──────────────────────────────────────
   *
   * Os cabecalhos que ja acompanham toda midia continuam valendo, e sao eles
   * que sustentam a decisao:
   *
   *   Content-Security-Policy: default-src 'none'; sandbox
   *       o `sandbox` sem permissao nenhuma poe a resposta numa ORIGEM OPACA e
   *       sem script. Mesmo que o arquivo tente algo, ele nao alcanca o nosso
   *       dominio, nem o cookie de sessao, nem o DOM do painel.
   *   X-Content-Type-Options: nosniff
   *       o navegador nao "adivinha" outro tipo -- um HTML disfarcado de PDF
   *       nao vira pagina.
   *   frame-ancestors 'none'
   *       ninguem embute isto num iframe de outro site.
   *
   * O que continua FORA e o que abriria de verdade: nada de `text/html`,
   * `image/svg+xml` ou script -- esses executam no contexto de quem abre, e
   * nenhum cabecalho desfaz isso por completo.
   */
  "application/pdf",
]);

// Tipos que podem sair no Content-Type mesmo indo como anexo.
const TIPOS_CONHECIDOS = new Set([
  ...INLINE_PERMITIDO,
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
]);

const GENERICO = "application/octet-stream";

// Só o tipo canônico, sem parâmetros, e sem caracteres que quebrariam o header
// (defesa contra header injection com \r\n vindo do banco).
function tipoSeguro(mimetype) {
  const limpo = String(mimetype || "").toLowerCase().split(";")[0].trim();
  if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(limpo)) return GENERICO;
  return TIPOS_CONHECIDOS.has(limpo) ? limpo : GENERICO;
}

// ASCII simples para o filename do Content-Disposition.
function nomeSeguroHeader(nome, tipo) {
  const base = String(nome || "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .slice(0, 100)
    .trim();
  if (base && base !== "." && base !== "_") return base;
  const ext = (tipo.split("/")[1] || "bin").replace(/[^a-z0-9]/g, "") || "bin";
  return `arquivo.${ext}`;
}

/**
 * Aplica os cabeçalhos e devolve o tipo efetivo. `tamanho` em bytes.
 */
function prepararRespostaMidia(res, { mimetype, fileName, tamanho }) {
  const tipo = tipoSeguro(mimetype);
  const inline = INLINE_PERMITIDO.has(tipo);

  res.setHeader("Content-Type", tipo);
  if (Number.isFinite(tamanho)) res.setHeader("Content-Length", tamanho);
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${nomeSeguroHeader(fileName, tipo)}"`
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Avisa que aceitamos faixa: e o que deixa o player descobrir a duracao e
  // procurar dentro do audio/video (ver interpretarRange e o servirMidia).
  res.setHeader("Accept-Ranges", "bytes");
  // Mesmo que algo escape das regras acima, aqui nao roda script nem carrega
  // recurso externo.
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox; frame-ancestors 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  // O conteudo nunca muda; o token na URL e quem limita o acesso.
  res.setHeader("Cache-Control", "private, max-age=604800, immutable");
  return tipo;
}

/**
 * Interpreta o cabecalho `Range` de midia. Aceita so a forma simples de UM
 * intervalo de bytes -- e o que os players usam:
 *
 *   bytes=0-        -> do inicio ao fim
 *   bytes=500-999   -> intervalo fechado
 *   bytes=-500      -> os ultimos 500 bytes
 *
 * Qualquer coisa fora disso (multiplos intervalos, unidade diferente, numero
 * absurdo) devolve null e a resposta sai INTEIRA -- degradar para 200 e sempre
 * seguro; inventar faixa nao e.
 */
function interpretarRange(cabecalho, total = null) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(cabecalho || "").trim());
  if (!m) return null;
  const [, cruInicio, cruFim] = m;
  if (cruInicio === "" && cruFim === "") return null;

  // Sufixo (ultimos N bytes) so da para resolver sabendo o tamanho.
  if (cruInicio === "") {
    const ultimos = Number(cruFim);
    if (!Number.isFinite(ultimos) || ultimos <= 0 || !Number.isFinite(total)) return null;
    return { inicio: Math.max(0, total - ultimos), fim: total - 1 };
  }

  const inicio = Number(cruInicio);
  if (!Number.isFinite(inicio) || inicio < 0) return null;
  if (cruFim === "") return { inicio, fim: undefined };

  const fim = Number(cruFim);
  if (!Number.isFinite(fim) || fim < inicio) return null;
  return { inicio, fim };
}

module.exports = { prepararRespostaMidia, tipoSeguro, interpretarRange };
