/**
 * DECIFRA A EDIÇÃO QUE O CLIENTE FEZ NO APARELHO.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 *
 * Em parte das conversas o WhatsApp não manda a edição como texto: manda um
 * `secretEncryptedMessage`, com o alvo em claro e o conteúdo novo CIFRADO. A
 * Evolution 2.4.0 não decifra -- ela repassa o envelope como veio.
 *
 * O efeito na Central era o pior possível: a bolha seguia mostrando a versão
 * ANTERIOR, e quem atende lia o texto errado acreditando estar lendo o certo --
 * o e-mail que o cliente corrigiu, o número de série, o "não" que virou "sim".
 *
 * ── O ESQUEMA, E DE ONDE ELE VEIO ──────────────────────────────────────────
 *
 * Não é engenharia reversa: está implementado às claras no whatsmeow
 * (`msgsecret.go`), que é cliente WhatsApp de código aberto. O tipo de uso tem
 * nome próprio -- "Message Edit" -- ao lado de "Poll Vote", "Enc Reaction" e
 * outros.
 *
 *   chave = HKDF-SHA256(messageSecret, salt vazio, info, 32 bytes)
 *           info = idDaMensagemOriginal ‖ remetente ‖ editor ‖ "Message Edit"
 *   texto = AES-256-GCM(chave, encIv, encPayload)      -- sem dados adicionais
 *
 * O `messageSecret` é da mensagem ORIGINAL e vem no `messageContextInfo` dela,
 * no momento em que ela chega. Por isso ele passou a ser guardado no metadata:
 * sem ele não há chave, e a edição de uma mensagem anterior a esta mudança
 * continua ilegível (cai no rótulo "editada (versão anterior)").
 *
 * Confirmado com dado real de produção em 11/09/2026: o cliente editou uma
 * mensagem para "123" e esta derivação devolveu exatamente "123".
 *
 * ── POR QUE OS JIDs SÃO TENTADOS, E NÃO ESCOLHIDOS ─────────────────────────
 *
 * `remetente` e `editor` são JIDs, e é justamente aí que esta instalação é
 * traiçoeira: ela endereça por `@lid` (identificador novo do WhatsApp, 26% das
 * mensagens), e o mesmo contato aparece ora como `<lid>@lid`, ora como
 * `<telefone>@s.whatsapp.net`. O Baileys tem defeito aberto exatamente sobre
 * isso na decifração de voto de enquete (issue #2342).
 *
 * Escolher um formato seria apostar. Como a verificação do GCM é infalsificável
 * -- ou a tag bate, ou não bate --, tentar os candidatos é seguro: uma chave
 * errada nunca produz texto plausível, ela produz erro. O custo é de alguns
 * AES sobre dezenas de bytes, e só acontece quando chega uma edição cifrada.
 */
const crypto = require("crypto");
const logger = require("../../config/logger");

// O nome do uso, no vocabulário do WhatsApp. Ver whatsmeow/msgsecret.go.
const USO_EDICAO = "Message Edit";

/** Lê um varint do protobuf. Devolve [valor, próximo índice]. */
function varint(buf, i) {
  let valor = 0;
  let deslocamento = 0;
  while (i < buf.length) {
    const byte = buf[i++];
    valor += (byte & 0x7f) * Math.pow(2, deslocamento);
    if ((byte & 0x80) === 0) break;
    deslocamento += 7;
  }
  return [valor, i];
}

/**
 * Os campos de um protobuf, sem precisar do .proto.
 *
 * Só os campos de COMPRIMENTO DELIMITADO interessam aqui (submensagens e
 * strings); o resto é pulado pelo tamanho que o próprio formato declara. É o
 * suficiente para descer três níveis conhecidos e ler um texto, e evita
 * carregar o protobufjs e as definições inteiras do WhatsApp por causa de uma
 * string.
 */
function campos(buf) {
  const achados = [];
  let i = 0;
  while (i < buf.length) {
    const [tag, depoisDaTag] = varint(buf, i);
    i = depoisDaTag;
    const numero = tag >>> 3;
    const tipo = tag & 7;
    if (tipo === 2) {
      const [tamanho, depoisDoTamanho] = varint(buf, i);
      const fim = depoisDoTamanho + tamanho;
      if (fim > buf.length) break;
      achados.push({ numero, valor: buf.slice(depoisDoTamanho, fim) });
      i = fim;
    } else if (tipo === 0) {
      [, i] = varint(buf, i);
    } else if (tipo === 5) {
      i += 4;
    } else if (tipo === 1) {
      i += 8;
    } else {
      break; // tipo desconhecido: não dá para continuar sem arriscar lixo
    }
  }
  return achados;
}

const acharCampo = (buf, numero) => campos(buf).find((c) => c.numero === numero)?.valor || null;

/**
 * O texto novo dentro do protobuf decifrado.
 *
 * Caminho: Message.protocolMessage (12) → editedMessage (14) → o texto, que é
 * `conversation` (1) numa mensagem simples ou `extendedTextMessage.text` (2→1)
 * quando ela tem formatação, link ou menção.
 */
function textoDaEdicao(bytes) {
  const protocolo = acharCampo(bytes, 12);
  if (!protocolo) return null;
  const editada = acharCampo(protocolo, 14);
  if (!editada) return null;

  const conversa = acharCampo(editada, 1);
  if (conversa) return conversa.toString("utf8");

  const estendida = acharCampo(editada, 2);
  const texto = estendida && acharCampo(estendida, 1);
  return texto ? texto.toString("utf8") : null;
}

/**
 * BYTES, VENHAM COMO VIEREM.
 *
 * `messageSecret`, `encIv` e `encPayload` são campos BINÁRIOS, e o caminho até
 * aqui é JSON -- que não tem binário. Cada camada resolve isso do seu jeito, e
 * a mesma instalação entrega formas diferentes conforme a versão:
 *
 *   "TEnl91AR..."                    base64 (é como o banco da Evolution guarda)
 *   { type: "Buffer", data: [...] }  o `toJSON()` do Buffer do Node
 *   [12, 240, 8, ...]                array cru de bytes
 *   Buffer / Uint8Array              quando nada serializou no meio
 *
 * Tratar só o primeiro caso é o tipo de erro que não estoura: `Buffer.from(obj,
 * "base64")` devolve um buffer vazio em vez de reclamar, a derivação sai errada,
 * o GCM recusa, e o sintoma final é "não foi possível decifrar" -- que se parece
 * exatamente com não ter a chave. Foi o que aconteceu no primeiro teste em
 * produção: `temSegredo: true` e nenhuma combinação funcionando.
 */
function paraBuffer(valor) {
  if (!valor) return null;
  if (Buffer.isBuffer(valor)) return valor.length ? valor : null;
  if (valor instanceof Uint8Array) return valor.length ? Buffer.from(valor) : null;
  if (Array.isArray(valor)) return valor.length ? Buffer.from(valor) : null;
  if (typeof valor === "object" && Array.isArray(valor.data)) {
    return valor.data.length ? Buffer.from(valor.data) : null;
  }
  // `{"0":12,"1":240,...}` -- e o que `JSON.stringify` faz com um Uint8Array, e
  // e a forma que a Evolution 2.4.0 realmente entrega no webhook (medido em
  // producao, 11/09: segredo com 32 chaves, encIv com 12, encPayload com 99).
  // Nao tem `type`, nao tem `data`, nao e array: so as chaves numericas.
  if (typeof valor === "object") {
    const chaves = Object.keys(valor);
    if (chaves.length && chaves.every((k) => /^\d+$/.test(k))) {
      const bytes = chaves
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => Number(valor[k]));
      if (bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
        return Buffer.from(bytes);
      }
    }
  }
  if (typeof valor === "string") {
    // Base64 é o esperado; um buffer vazio significa que a string não era isso.
    const b = Buffer.from(valor, "base64");
    return b.length ? b : null;
  }
  return null;
}

/** Os JIDs plausíveis para a derivação, do mais provável ao menos. */
function candidatos(jids) {
  const limpos = jids.filter((j) => typeof j === "string" && j.length);
  // O número puro entra porque nem toda versão usa o JID completo.
  const numeros = limpos.map((j) => j.split("@")[0]).filter(Boolean);
  return [...new Set([...limpos, ...numeros])];
}

/**
 * Tenta devolver o TEXTO NOVO de uma edição cifrada. `null` quando não dá.
 *
 * `null` não é erro: mensagem anterior à guarda do `messageSecret`, formato
 * novo, ou um tipo de evento que só parece edição. Quem chama cai no rótulo
 * "editada (versão anterior)", que continua sendo melhor do que silêncio.
 *
 * @param {object}   p
 * @param {string}   p.segredo    messageSecret da mensagem ORIGINAL (base64)
 * @param {string}   p.encIv      base64
 * @param {string}   p.encPayload base64 (ciphertext ‖ tag de 16 bytes)
 * @param {string}   p.alvoId     id da mensagem original no WhatsApp
 * @param {string[]} p.jids       JIDs candidatos a remetente/editor
 */
function decifrarEdicao({ segredo, encIv, encPayload, alvoId, jids = [] }) {
  if (!segredo || !encIv || !encPayload || !alvoId) return null;

  const chave = paraBuffer(segredo);
  const iv = paraBuffer(encIv);
  const carga = paraBuffer(encPayload);
  if (!chave || !iv || !carga) return null;
  // GCM: os 16 últimos bytes são a tag de autenticação.
  if (carga.length <= 16 || !chave.length || !iv.length) return null;

  const cifrado = carga.slice(0, carga.length - 16);
  const tag = carga.slice(carga.length - 16);
  const lista = candidatos(jids);

  for (const remetente of lista) {
    for (const editor of lista) {
      try {
        const info = Buffer.concat([
          Buffer.from(alvoId, "utf8"),
          Buffer.from(remetente, "utf8"),
          Buffer.from(editor, "utf8"),
          Buffer.from(USO_EDICAO, "utf8"),
        ]);
        const derivada = Buffer.from(
          crypto.hkdfSync("sha256", chave, Buffer.alloc(0), info, 32)
        );
        const decifrador = crypto.createDecipheriv("aes-256-gcm", derivada, iv);
        decifrador.setAuthTag(tag);
        // Chave errada morre aqui, no `final()`: a tag do GCM não deixa passar.
        const bytes = Buffer.concat([decifrador.update(cifrado), decifrador.final()]);

        const texto = textoDaEdicao(bytes);
        if (texto != null) return texto;

        // Decifrou e não soubemos ler: o formato mudou. Vale registrar, porque
        // e a diferenca entre "nao temos a chave" e "temos e nao entendemos".
        logger.warn("Edicao decifrada mas o texto nao foi encontrado no protobuf", {
          // Só o tamanho e os números dos campos -- nunca o conteúdo, que é
          // conversa de cliente.
          bytes: bytes.length,
          camposNoTopo: campos(bytes).map((c) => c.numero),
        });
        return null;
      } catch {
        // Combinação errada. Segue para a próxima -- é o caminho esperado.
      }
    }
  }
  return null;
}

module.exports = { decifrarEdicao, USO_EDICAO, _textoDaEdicao: textoDaEdicao, _campos: campos };
