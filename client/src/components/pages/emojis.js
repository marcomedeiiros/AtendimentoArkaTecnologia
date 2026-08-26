/**
 * Catálogo de emojis do seletor, por categoria.
 *
 * Todos são Unicode padrão (nada de imagem nem de fonte proprietária): é assim
 * que o mesmo caractere aparece com o desenho do iPhone no iPhone, do Android no
 * Android e do Windows no Windows. Trocar isso por sprites do iOS quebraria o
 * que mais importa aqui -- o que sai daqui é TEXTO, e é o WhatsApp do cliente
 * que desenha. O que dá para melhorar do nosso lado é a FONTE usada na tela do
 * atendente (ver `.emoji-fonte` no index.css) e a quantidade/organização.
 *
 * COMPATIBILIDADE (o ponto sensível): nada aqui muda como a mensagem é
 * armazenada. O texto continua indo para o banco como string UTF-8, exatamente
 * como já ia -- os emojis que já estavam nas conversas antigas continuam sendo
 * os mesmos bytes. Este arquivo só decide QUAIS caracteres o seletor oferece.
 *
 * Evitados de propósito: emojis muito recentes (Unicode 14+) e sequências ZWJ
 * exóticas (famílias, profissões com tom de pele), que aparecem como caixinha
 * ou como dois bonecos separados em aparelhos e sistemas mais antigos.
 */

export const CATEGORIAS_EMOJI = [
  {
    id: 'frequentes',
    rotulo: 'Frequentes',
    icone: '🕘',
    emojis: [
      '👍', '🙏', '✅', '❌', '😊', '😀', '😂', '🥰', '👏', '🎉',
      '🔥', '💰', '📄', '📎', '⚠️', '🤝', '🚀', '📌', '💬', '⏰',
    ],
  },
  {
    id: 'rostos',
    rotulo: 'Rostos e pessoas',
    icone: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
      '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
      '😋', '😛', '😜', '🤪', '😝', '🤗', '🤭', '🤫', '🤔', '🤐',
      '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮', '😯', '😲',
      '😴', '🤤', '😪', '😵', '🤯', '🥳', '😎', '🤓', '🧐', '😕',
      '😟', '🙁', '😢', '😭', '😤', '😠', '😡', '🤬', '😳', '🥺',
      '😨', '😰', '😱', '😖', '😣', '😞', '😓', '🤒', '🤕', '🤧',
      '😷', '🥴', '🤠', '🤡', '👻', '💀', '👽', '🤖', '😺', '😻',
    ],
  },
  {
    id: 'gestos',
    rotulo: 'Gestos',
    icone: '👍',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤙', '👋', '🤚', '🖐️', '✋',
      '👊', '✊', '🤛', '🤜', '👏', '🙌', '🤝', '🙏', '💪', '👀',
      '👆', '👇', '👈', '👉', '☝️', '✍️', '🫰', '🤲', '🖖', '💅',
    ],
  },
  {
    id: 'trabalho',
    rotulo: 'Trabalho e suporte',
    icone: '💼',
    emojis: [
      '💼', '📁', '📂', '📄', '📃', '📑', '📋', '📌', '📎', '🖇️',
      '✏️', '🖊️', '📝', '🗓️', '📅', '⏰', '⏳', '🔔', '🔕', '📞',
      '☎️', '📱', '💻', '🖥️', '⌨️', '🖱️', '🖨️', '💾', '💿', '🔌',
      '🔋', '🛠️', '🔧', '🔩', '⚙️', '🧰', '🔍', '🔎', '🔒', '🔓',
      '🔑', '📡', '🌐', '📶', '🖧', '🗄️', '📊', '📈', '📉', '🗂️',
    ],
  },
  {
    id: 'financeiro',
    rotulo: 'Financeiro',
    icone: '💰',
    emojis: [
      '💰', '💵', '💴', '💶', '💷', '💳', '🧾', '🏦', '🏧', '💱',
      '💲', '📊', '📈', '📉', '🪙', '💸', '🤑', '🧮', '📆', '✔️',
    ],
  },
  {
    id: 'simbolos',
    rotulo: 'Símbolos',
    icone: '✅',
    emojis: [
      '✅', '☑️', '✔️', '❌', '❎', '⭕', '❗', '❓', '⚠️', '🚫',
      '💯', '🔥', '⭐', '🌟', '✨', '💡', '❤️', '🧡', '💛', '💚',
      '💙', '💜', '🖤', '🤍', '💔', '➕', '➖', '➗', '♻️', '🔄',
      '🔝', '🔜', '▶️', '⏸️', '⏹️', '🆗', '🆕', '🆙', '🔴', '🟢',
      '🟡', '🔵', '⚫', '⚪', '🟠', '🟣', '🟤', '1️⃣', '2️⃣', '3️⃣',
    ],
  },
  {
    id: 'comemoracao',
    rotulo: 'Comemoração',
    icone: '🎉',
    emojis: [
      '🎉', '🎊', '🥳', '🎈', '🎁', '🏆', '🥇', '🎯', '🚀', '🌈',
      '☀️', '⛅', '🌧️', '❄️', '⚡', '🍀', '🌻', '🌹', '☕', '🍕',
    ],
  },
];

// Lista achatada, usada pela busca do seletor.
export const TODOS_EMOJIS = CATEGORIAS_EMOJI.flatMap((c) =>
  c.emojis.map((e) => ({ emoji: e, categoria: c.rotulo }))
);
