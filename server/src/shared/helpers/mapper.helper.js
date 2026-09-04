const { formatarHora } = require("../helpers/cnpj.helper");
const { gerarTokenMidia } = require("./midiaToken.helper");

// A midia fica no banco como data URL base64. Mandar isso dentro do JSON da
// conversa era o gargalo: um anexo de 20MB vira ~27MB de string, recarregado e
// retransmitido (SSE) a CADA acao -- o que travava a API (502) e deixava tudo
// lento. Aqui trocamos o base64 por uma URL curta e assinada; o navegador busca
// os bytes uma vez e cacheia. URLs http(s) ja salvas passam direto.
function urlDaMidia(mensagemId, meta) {
  const rota = mensagemId
    ? `/api/conversas/mensagens/${mensagemId}/midia?t=${gerarTokenMidia(mensagemId)}`
    : null;
  // Novo: bytes no disco (metadata.arquivo) -- sempre pela rota.
  if (meta?.arquivo) return rota;
  // Legado: data URL base64 no banco. Tambem vai pela rota (nao trafega o
  // base64); so fica inline se nao houver id para montar a rota.
  const url = meta?.url;
  if (typeof url !== "string" || !url.startsWith("data:")) return url || null;
  return rota || url;
}

function mapMensagem(m) {
  const meta = m.metadata || {};
  const tipo = meta.tipo || "texto";
  return {
    id: m.id,
    // `de` continua colapsando bot->equipe: e o que posiciona a bolha do lado
    // direito, e mudar isso mexeria em toda a renderizacao.
    de: m.origem === "bot" ? "equipe" : m.origem,
    // ORIGEM REAL, sem colapsar: cliente | equipe | bot | sistema | nota.
    //
    // Sem este campo a Central nao tinha como distinguir o que o BOT mandou do
    // que um atendente digitou -- as duas coisas chegavam como "equipe". E e
    // essa distincao que decide se a mensagem conta como atividade nova na
    // conversa (som, badge) ou se e apenas o fluxo falando sozinho.
    origem: m.origem,
    // Mensagem gerada por uma automacao do fluxo (pesquisa de satisfacao, aviso
    // de espera, timeout). Marcada na gravacao, nao deduzida na tela.
    automacao: m.origem === "bot" || !!meta.automacao,
    // NOTA INTERNA: quem escreveu. Nome vem do metadata (a nota nunca embute a
    // autoria no texto) e existe so nas notas -- null em todo o resto.
    //
    // Existe um segundo campo, e nao so o `origem === "nota"`, porque a bolha
    // precisa dizer QUEM anotou: numa conversa que passou por tres turnos, uma
    // nota sem autor nao ajuda ninguem a decidir se ainda vale.
    notaAutor: m.origem === "nota" ? meta.autorNome || null : null,
    // Resposta do cliente a PESQUISA DE SATISFACAO (a nota, ou o comentario).
    //
    // Continua sendo mensagem do cliente para todo o resto -- aparece no chat,
    // entra no historico, e exportada. O que esta marca diz e uma coisa so: ela
    // NAO e um pedido de atendimento, entao a Central nao toca o som nem
    // notifica por ela. Gravada pelo motor, que e quem sabe em que estado a
    // sessao estava; a tela nao teria como adivinhar olhando um "5".
    respostaPesquisa: !!meta.respostaPesquisa,
    // A qual OS esta mensagem pertence: e o que permite ao painel recortar o
    // historico por atendimento sem quebrar o fio unico da conversa.
    atendimentoId: m.atendimentoId || null,
    texto: m.texto,
    hora: formatarHora(m.criadoEm),
    // Risquinhos: so faz sentido no que sai daqui.
    status: m.origem === "cliente" ? null : m.status || null,
    respondendoAId: m.respondendoAId || null,
    // RETRATO do trecho citado, quando o WhatsApp mandou junto (citacao vinda do
    // cliente). E o plano B do `respondendoAId`: com ele a bolha mostra o que
    // foi citado mesmo quando a mensagem original nao esta no banco (citou algo
    // anterior a integracao) ou nao esta na janela carregada na tela.
    citacao: meta.citacao?.texto ? { texto: meta.citacao.texto } : null,
    editada: !!m.editadaEm,
    // Marcada por "Apagar para todos": some do WhatsApp do cliente e vira aviso
    // no chat ao vivo, mas segue no Registro (o texto original continua aqui).
    deletada: !!meta.deletada,
    // Selo "Encaminhada": vem do WhatsApp (contextInfo.isForwarded /
    // forwardingScore) ou de um encaminhamento feito na propria Central. Nunca
    // e deduzido pela aparencia da mensagem.
    encaminhada: !!meta.encaminhada,
    encaminhadaVezes: Number(meta.encaminhadaVezes) || 0,
    tipo,
    // Dados da midia (url, mimetype, nome, legenda, coords, contato) quando a
    // mensagem nao for de texto puro. `url` vai como link curto (ver urlDaMidia),
    // nunca mais como base64 gigante dentro do payload.
    midia: tipo !== "texto" ? { ...meta, url: urlDaMidia(m.id, meta) } : null,
  };
}

// Resumo de uma OS para o seletor de historico da Central. Sem mensagens: quem
// abre um atendimento antigo filtra as mensagens que ja vieram na conversa.
function mapAtendimento(a) {
  return {
    id: a.id,
    numeroOS: a.numeroOS ?? null,
    os: a.numeroOS != null ? "OS" + String(a.numeroOS).padStart(5, "0") : null,
    setor: a.setor || null,
    status: a.status,
    atendenteNome: a.atendenteNome || null,
    avaliacao: a.avaliacao ?? null,
    // COMO a avaliacao terminou (respondida | sem_nota | sem_resposta |
    // aguardando). Sem isto, "sem nota" e "nao respondeu" ficavam iguais.
    avaliacaoStatus: a.avaliacaoStatus || null,
    // POR QUE o cliente procurou, escolhido no fechamento. `null` em OS fechada
    // antes deste campo existir -- e isso e diferente de qualquer motivo real,
    // entao a tela mostra "nao informado" em vez de inventar uma categoria.
    motivo: a.motivo || null,
    feedback: a.feedback || null,
    abertoEm: a.abertoEm ? a.abertoEm.toISOString?.() || a.abertoEm : null,
    atendidoEm: a.atendidoEm ? a.atendidoEm.toISOString?.() || a.atendidoEm : null,
    fechadoEm: a.fechadoEm ? a.fechadoEm.toISOString?.() || a.fechadoEm : null,
  };
}

function mapConversa(c) {
  const mensagens = c.mensagens || [];
  const ultima = mensagens[mensagens.length - 1];
  // Historico de OS (mais recente primeiro) e a OS em curso.
  const atendimentos = (c.atendimentos || []).map(mapAtendimento);
  const atual =
    atendimentos.find((a) => a.id === c.atendimentoAtualId) || atendimentos[0] || null;
  return {
    id: c.id,
    cliente: c.cliente,
    telefone: c.telefone,
    statusAtendimento: c.statusAtendimento,
    setor: c.setor || "Geral",
    avaliacao: c.avaliacao || null,
    avaliacaoStatus: c.avaliacaoStatus || null,
    feedback: c.feedback || null,
    // O NUMERO do CNPJ continua saindo daqui porque a busca da Central, o
    // relacionamento com o parceiro e o Registro dependem dele -- o que mudou e
    // que a tela da conversa nao o EXIBE mais. Quem aparece e `empresa`.
    cnpj: c.cnpj,
    empresa: c.empresa || null,
    cnpjVerificado: c.cnpjVerificado,
    // "cadastrado" | "avulso" | null (ainda nao classificado). Sai daqui para a
    // badge da Central poder dizer O QUE o cliente e, em vez de deduzir de
    // `cnpjVerificado` -- que valia true para os dois tipos e por isso chamava
    // todo avulso de "CLIENTE IDENTIFICADO".
    clienteTipo: c.clienteTipo || null,
    // Escolha do cliente ("Atendimento avulso" no menu), nao retrato do
    // cadastro -- ver o campo no schema. A Central usa este para a badge.
    atendimentoAvulso: !!c.atendimentoAvulso,
    lido: c.lido,
    naoLidas: c.naoLidas ?? 0,
    fotoUrl: c.fotoUrl || null,
    favorita: !!c.favorita,
    fixada: !!c.fixada,
    arquivada: !!c.arquivada,
    oculta: !!c.oculta,
    atendenteId: c.atendenteId || null,
    // Responsavel pelo atendimento (do banco, via relacao) -- compartilhado por
    // toda a equipe. Antes esse "quem atende" vivia so no localStorage.
    atendenteNome: c.atendente?.nome || null,
    atendenteCargo: c.atendente?.cargo || null,
    // Historico: quem atendeu, mesmo que a conversa nao tenha mais responsavel
    // (voltou para a fila / foi fechada). Alimenta a coluna das Avaliacoes.
    ultimoAtendenteNome: c.ultimoAtendenteNome || c.atendente?.nome || null,
    // REVISAO: o front descarta qualquer snapshot com versao <= a que ja tem.
    versao: c.versao ?? 0,
    // Numero do fio do cliente (interno; nao e mais o que a tela mostra).
    numeroTicket: c.numeroTicket ?? null,
    // A OS EM CURSO. `ticket` mantem o nome que todas as telas ja usam (Registro,
    // PDF, cabecalho do chat), mas agora aponta para o atendimento atual em vez
    // do numero fixo da conversa -- e o numero que muda a cada novo ciclo.
    // Conversa de base antiga, ainda sem OS, cai no numero do fio.
    atendimentoAtualId: atual?.id || c.atendimentoAtualId || null,
    numeroOS: atual?.numeroOS ?? c.numeroTicket ?? null,
    ticket:
      atual?.os ||
      (c.numeroTicket != null ? "OS" + String(c.numeroTicket).padStart(5, "0") : null),
    // Historico de atendimentos do cliente (inclui a OS atual).
    atendimentos,
    criadoEm: c.criadoEm ? c.criadoEm.toISOString?.() || c.criadoEm : null,
    atendidoEm: c.atendidoEm ? c.atendidoEm.toISOString?.() || c.atendidoEm : null,
    fechadoEm: c.fechadoEm ? c.fechadoEm.toISOString?.() || c.fechadoEm : null,
    ultimaMensagemEm: ultima?.criadoEm
      ? ultima.criadoEm.toISOString?.() || ultima.criadoEm
      : null,
    // ESTA LISTA PODE SER SO A CAUDA DO HISTORICO.
    //
    // Eventos de tempo real carregam apenas as ultimas mensagens (ver
    // conversa.repository.findByIdParaEvento). `parcial` avisa o front de que
    // ausencia NAO significa exclusao -- ele mantem o que ja tem e apenas
    // incorpora o que chegou. Sem a marca, a regra ficaria implicita e a
    // primeira pessoa a "simplificar" o merge apagaria o historico da tela.
    parcial: !!c.__parcial,
    mensagens: mensagens.map(mapMensagem),
  };
}

function mapParceiro(p) {
  return {
    cnpj: p.cnpj,
    razaoSocial: p.razaoSocial,
    email: p.email || "",
    telefones: p.telefones || "",
    cidades: p.cidades || "",
    // Contratos guardados como "ti,backups" no banco; devolvidos como array.
    contratos: p.contratos ? p.contratos.split(",").filter(Boolean) : [],
    status: p.status,
  };
}

function mapContato(c) {
  return {
    id: c.id,
    nome: c.nome,
    telefone: c.telefone,
    email: c.email || "",
    empresa: c.empresa || "",
    tag: c.tag,
    favorito: c.favorito,
    observacoes: c.observacoes || "",
    // Foto do WhatsApp. Pode ser a da CONVERSA (mais fresca, ver
    // contato.service.listar) ou a guardada na sincronizacao da agenda. Vem
    // `null` quando nao ha nenhuma -- e ai a tela desenha o boneco cinza.
    fotoUrl: c.fotoUrl || null,
  };
}

function mapPasso(p) {
  return {
    id: p.id,
    tipo: p.tipo,
    titulo: p.titulo,
    desc: p.descricao,
    descricao: p.descricao,
    texto: p.texto,
    config: p.config,
    x: p.posX,
    y: p.posY,
    w: p.largura,
    h: p.altura,
    targetId: p.targetId,
    ordem: p.ordem,
  };
}

function mapFluxo(f) {
  return {
    id: f.id,
    nome: f.nome,
    gatilho: f.gatilho,
    ativo: f.ativo,
    passos: (f.passos || []).map(mapPasso),
  };
}

function normalizarImagens(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor;
  if (typeof valor === "string") {
    try {
      const arr = JSON.parse(valor);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapRelatoBug(r) {
  return {
    id: r.id,
    descricao: r.descricao,
    pagina: r.pagina || null,
    // Prisma (SQLite) pode devolver Json ja como array ou ainda como string.
    imagens: normalizarImagens(r.imagens),
    status: r.status,
    prioridade: r.prioridade || "media",
    usuarioId: r.usuarioId || null,
    usuarioNome: r.usuarioNome || null,
    usuarioEmail: r.usuarioEmail || null,
    criadoEm: r.criadoEm ? r.criadoEm.toISOString?.() || r.criadoEm : null,
  };
}

function mapMensagemRapida(r) {
  return {
    id: r.id,
    titulo: r.titulo,
    texto: r.texto || "",
    categoria: r.categoria || "geral",
    icon: r.icon || "default",
    // Reconstroi o `anexo` no formato que o front usa. Mesma otimizacao da midia
    // das conversas: o base64 (ate 20MB) NAO vai na listagem -- vai uma URL curta
    // e assinada, que o navegador busca uma vez e cacheia.
    anexo: r.anexoMedia
      ? {
          // "arquivo:" (novo, bytes em disco) ou "data:" (legado): os dois vao
          // pela rota. URL externa (http) passa direto.
          media: /^(arquivo:|data:)/.test(String(r.anexoMedia))
            ? `/api/mensagens-rapidas/${r.id}/anexo?t=${gerarTokenMidia(r.id)}`
            : r.anexoMedia,
          mimetype: r.anexoMimetype || null,
          fileName: r.anexoNome || null,
        }
      : null,
    criadoEm: r.criadoEm ? r.criadoEm.toISOString?.() || r.criadoEm : null,
  };
}

function mapCompromisso(c) {
  return {
    id: c.id,
    titulo: c.titulo,
    data: c.data,
    hora: c.hora || "09:00",
    tipo: c.tipo || "reuniao",
    prioridade: c.prioridade || "media",
    descricao: c.descricao || "",
    contato: c.contato || "",
    concluido: !!c.concluido,
    usuarioNome: c.usuarioNome || null,
    criadoEm: c.criadoEm ? c.criadoEm.toISOString?.() || c.criadoEm : null,
  };
}

module.exports = {
  mapMensagem,
  mapAtendimento,
  mapConversa,
  mapParceiro,
  mapContato,
  mapFluxo,
  // Exportado desde que existe a leitura de UM bloco (GET /fluxos/:id/passos/:passoId).
  mapPasso,
  mapRelatoBug,
  mapMensagemRapida,
  mapCompromisso,
};
