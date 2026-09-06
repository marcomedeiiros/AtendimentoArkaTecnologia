/**
 * É IMAGEM DE VERDADE? -- confere os BYTES, e não o que o cliente disse.
 *
 * Mesma regra do `ehPdf` dos relatórios, e pelo mesmo motivo: o mimetype vem da
 * data URL, que vem do navegador, que vem do arquivo que a pessoa escolheu.
 * Renomear "coisa.html" para "logo.png" já bastaria para o servidor guardar --
 * e o arquivo depois é servido de volta para o painel inteiro.
 *
 * ── POR QUE SVG FICA DE FORA ───────────────────────────────────────────────
 *
 * SVG é o formato que mais se pediria aqui: é vetorial, é o que a agência
 * entrega, escala sem borrar. E é justamente por isso que ele não entra.
 *
 * SVG não é imagem, é DOCUMENTO XML -- ele aceita `<script>`, `<foreignObject>`
 * com HTML dentro e handlers `onload`. Servido da mesma origem do painel, um
 * SVG hostil roda com a origem da aplicação e alcança a sessão de quem abriu.
 * Os cabeçalhos de mídia (`sandbox`, `nosniff`) seguram isso quando o arquivo é
 * aberto numa aba, mas uma logo existe para ficar dentro de um `<img>` na
 * lista, e ninguém revisa o XML de um arquivo que "é só a logo do cliente".
 *
 * Os quatro formatos abaixo são bitmap: os bytes descrevem pixels, não código.
 * PNG e WebP têm transparência, que é o que uma logo costuma precisar.
 */
const midiaStorage = require("../../infrastructure/storage/midia.storage");

// Bytes iniciais de cada formato aceito. `offset` é onde a marca começa.
const ASSINATURAS = [
  { tipo: "image/png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { tipo: "image/jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { tipo: "image/gif", offset: 0, texto: "GIF87a" },
  { tipo: "image/gif", offset: 0, texto: "GIF89a" },
  // WebP é um contêiner RIFF: "RIFF" nos bytes 0-3, o tamanho em 4-7, e só em
  // 8-11 vem "WEBP". Conferir só o "RIFF" aceitaria um WAV, que também é RIFF.
  { tipo: "image/webp", offset: 8, texto: "WEBP", exigeTambem: { offset: 0, texto: "RIFF" } },
];

// Quantos bytes do começo do arquivo precisam ser lidos para decidir.
const BYTES_NECESSARIOS = 12;

/**
 * Descobre o tipo pela assinatura. Devolve o mimetype ou `null` quando os bytes
 * não são de nenhum formato aceito.
 */
function tipoDeImagem(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return null;

  const casa = (m) => {
    if (m.texto) {
      const fim = m.offset + m.texto.length;
      if (buffer.length < fim) return false;
      return buffer.toString("latin1", m.offset, fim) === m.texto;
    }
    if (buffer.length < m.offset + m.bytes.length) return false;
    return m.bytes.every((b, i) => buffer[m.offset + i] === b);
  };

  for (const a of ASSINATURAS) {
    if (!casa(a)) continue;
    if (a.exigeTambem && !casa(a.exigeTambem)) continue;
    return a.tipo;
  }
  return null;
}

/**
 * O mesmo, para um arquivo já gravado. Lê só o cabeçalho -- não carrega a
 * imagem inteira na memória para responder uma pergunta de 12 bytes.
 */
async function tipoDeImagemNoDisco(caminhoRelativo) {
  const aberto = await midiaStorage.abrirParaLeitura(caminhoRelativo, {
    inicio: 0,
    fim: BYTES_NECESSARIOS - 1,
  });
  if (!aberto) return null;
  const pedacos = [];
  for await (const p of aberto.stream) pedacos.push(p);
  return tipoDeImagem(Buffer.concat(pedacos));
}

module.exports = { tipoDeImagem, tipoDeImagemNoDisco };
