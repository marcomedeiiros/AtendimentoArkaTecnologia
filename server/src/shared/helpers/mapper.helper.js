const { formatarHora } = require("../helpers/cnpj.helper");

function mapMensagem(m) {
  const meta = m.metadata || {};
  const tipo = meta.tipo || "texto";
  return {
    id: m.id,
    de: m.origem === "bot" ? "equipe" : m.origem,
    texto: m.texto,
    hora: formatarHora(m.criadoEm),
    // Risquinhos: so faz sentido no que sai daqui.
    status: m.origem === "cliente" ? null : m.status || null,
    respondendoAId: m.respondendoAId || null,
    editada: !!m.editadaEm,
    tipo,
    // Dados da midia (url/base64, mimetype, nome, legenda, coords, contato)
    // quando a mensagem nao for de texto puro.
    midia: tipo !== "texto" ? meta : null,
  };
}

function mapConversa(c) {
  const mensagens = c.mensagens || [];
  const ultima = mensagens[mensagens.length - 1];
  return {
    id: c.id,
    cliente: c.cliente,
    telefone: c.telefone,
    statusAtendimento: c.statusAtendimento,
    setor: c.setor || "Geral",
    avaliacao: c.avaliacao || null,
    feedback: c.feedback || null,
    cnpj: c.cnpj,
    cnpjVerificado: c.cnpjVerificado,
    lido: c.lido,
    naoLidas: c.naoLidas ?? 0,
    fotoUrl: c.fotoUrl || null,
    favorita: !!c.favorita,
    fixada: !!c.fixada,
    arquivada: !!c.arquivada,
    oculta: !!c.oculta,
    atendenteId: c.atendenteId || null,
    criadoEm: c.criadoEm ? c.criadoEm.toISOString?.() || c.criadoEm : null,
    atendidoEm: c.atendidoEm ? c.atendidoEm.toISOString?.() || c.atendidoEm : null,
    fechadoEm: c.fechadoEm ? c.fechadoEm.toISOString?.() || c.fechadoEm : null,
    ultimaMensagemEm: ultima?.criadoEm
      ? ultima.criadoEm.toISOString?.() || ultima.criadoEm
      : null,
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

function mapRelatoBug(r) {
  return {
    id: r.id,
    descricao: r.descricao,
    pagina: r.pagina || null,
    status: r.status,
    usuarioId: r.usuarioId || null,
    usuarioNome: r.usuarioNome || null,
    usuarioEmail: r.usuarioEmail || null,
    criadoEm: r.criadoEm ? r.criadoEm.toISOString?.() || r.criadoEm : null,
  };
}

module.exports = {
  mapMensagem,
  mapConversa,
  mapParceiro,
  mapContato,
  mapFluxo,
  mapRelatoBug,
};
