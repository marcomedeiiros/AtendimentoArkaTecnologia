const repo = require("../../infrastructure/repositories/mensagemRapida.repository");
const prisma = require("../../infrastructure/database/prisma.client");
const { mapMensagemRapida } = require("../../shared/helpers/mapper.helper");
const { validarImagemDataUrl } = require("../../shared/helpers/imagemSegura.helper");
const AppError = require("../../shared/errors/AppError");
const logger = require("../../config/logger");

// Anexo de mensagem rapida ate 5 MB (imagem raster). O envio ao WhatsApp
// revalida de novo pelo pipeline de midia (conversa.dto).
const MAX_ANEXO_BYTES = 5 * 1024 * 1024;

// Flag que marca que os padroes ja foram semeados UMA vez. Apagar as mensagens
// nao faz elas "voltarem" -- so semeamos enquanto esta flag nao existir.
const FLAG_SEED = "mensagens_rapidas.seeded";

// Conteudo inicial (migrado do antigo default do front). Sem anexo.
const PADROES = [
  {
    titulo: "PIX",
    categoria: "pagamento",
    icon: "pix",
    texto:
      "Olá! Para realizar o pagamento via PIX, utilize a chave abaixo:\n\n🔑 Chave PIX: pagamentos@arkatecnologia.com.br\n\nApós o pagamento, envie o comprovante neste chat para confirmarmos. 😊",
  },
  {
    titulo: "Limite de Pesquisa",
    categoria: "consulta",
    icon: "search",
    texto:
      "Olá! Informamos que você atingiu o limite de pesquisas disponíveis para este período.\n\nPara continuar utilizando o serviço, entre em contato com nossa equipe comercial para verificar as opções disponíveis.",
  },
  {
    titulo: "Pesquisa Finalizada por Tempo",
    categoria: "consulta",
    icon: "clock",
    texto:
      "Olá! Sua pesquisa foi encerrada automaticamente por exceder o tempo limite configurado.\n\nCaso precise de mais informações, fique à vontade para iniciar uma nova consulta ou entrar em contato com nosso suporte.",
  },
  {
    titulo: "Até a Próxima!",
    categoria: "encerramento",
    icon: "bye",
    texto:
      "Foi um prazer atendê-lo(a)! 😊\n\nSe precisar de mais alguma coisa, é só entrar em contato. Estamos sempre aqui para ajudar.\n\n*Equipe Arka Tecnologia* Até a próxima! 👋",
  },
  {
    titulo: "Sem Retorno",
    categoria: "encerramento",
    icon: "noreturn",
    texto:
      "Olá! Percebemos que não obtivemos retorno após nossos contatos.\n\nEste atendimento será encerrado por falta de resposta. Caso precise de auxílio, basta enviar uma nova mensagem será um prazer atendê-lo(a) novamente!",
  },
  {
    titulo: "AnyDesk",
    categoria: "suporte",
    icon: "monitor",
    texto:
      "Olá! Para darmos continuidade ao suporte remoto, precisamos acessar seu computador via AnyDesk.\n\n📥 *Download AnyDesk:* https://anydesk.com/pt\n\n1. Baixe e instale o AnyDesk\n2. Abra o programa\n3. Envie o número de 9 dígitos que aparecer na tela\n\nAguardamos! 🛠️",
  },
];

// Nome de arquivo seguro: sem separadores de caminho nem caracteres de
// controle (filtra por codigo do caractere -- evita quebrar cabecalhos).
function nomeSeguro(nome) {
  if (!nome) return null;
  const limpo = String(nome)
    .split("")
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 32 && c !== 127;
    })
    .join("")
    .replace(/[/\\]/g, "_")
    .trim()
    .slice(0, 200);
  return limpo || null;
}

// Traduz o `anexo` cru do cliente em colunas do banco, validando a imagem.
// Devolve sempre os tres campos (media/mimetype/nome), com null quando nao ha.
function processarAnexo(anexo) {
  if (!anexo || !anexo.media) {
    return { anexoMedia: null, anexoMimetype: null, anexoNome: null };
  }
  const { media, mimetype } = validarImagemDataUrl(anexo.media, { maxBytes: MAX_ANEXO_BYTES });
  return {
    anexoMedia: media,
    anexoMimetype: mimetype, // usa o mime conferido pelos magic bytes, nao o declarado
    anexoNome: nomeSeguro(anexo.fileName),
  };
}

class MensagemRapidaService {
  // Semeia os padroes UMA vez (guardado por flag em Configuracao). Concorrencia:
  // o SQLite serializa a transacao; a checagem da flag evita re-semear.
  async garantirSeed() {
    const flag = await prisma.configuracao.findUnique({ where: { chave: FLAG_SEED } });
    if (flag) return;
    try {
      const total = await repo.count();
      if (total === 0) {
        await repo.createMany(PADROES.map((p, i) => ({ ...p, ordem: i })));
        logger.info("Mensagens rapidas: padroes semeados");
      }
      await prisma.configuracao.upsert({
        where: { chave: FLAG_SEED },
        update: { valor: "1" },
        create: { chave: FLAG_SEED, valor: "1" },
      });
    } catch (e) {
      logger.warn("Falha ao semear mensagens rapidas", { message: e.message });
    }
  }

  async listar() {
    await this.garantirSeed();
    const itens = await repo.findAll();
    return itens.map(mapMensagemRapida);
  }

  async criar({ titulo, texto, categoria, icon, anexo }) {
    const dados = {
      titulo: titulo.trim(),
      texto: (texto || "").trim(),
      categoria,
      icon,
      ...processarAnexo(anexo),
    };
    const criada = await repo.create(dados);
    return mapMensagemRapida(criada);
  }

  async atualizar(id, { titulo, texto, categoria, icon, anexo }) {
    const existente = await repo.findById(id);
    if (!existente) throw new AppError("Mensagem nao encontrada", 404, "NOT_FOUND");
    const dados = {
      titulo: titulo.trim(),
      texto: (texto || "").trim(),
      categoria,
      icon,
      ...processarAnexo(anexo),
    };
    const atualizada = await repo.update(id, dados);
    return mapMensagemRapida(atualizada);
  }

  async remover(id) {
    const existente = await repo.findById(id);
    if (!existente) throw new AppError("Mensagem nao encontrada", 404, "NOT_FOUND");
    await repo.delete(id);
    return { removido: true };
  }
}

module.exports = new MensagemRapidaService();
