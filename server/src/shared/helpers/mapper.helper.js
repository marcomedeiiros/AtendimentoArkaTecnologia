const { formatarHora } = require("../helpers/cnpj.helper");

function mapMensagem(m) {
  const meta = m.metadata || {};
  const tipo = meta.tipo || "texto";
  return {
    de: m.origem === "bot" ? "equipe" : m.origem,
    texto: m.texto,
    hora: formatarHora(m.criadoEm),
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
    atendidoEm: c.atendidoEm ? c.atendidoEm.toISOString?.() || c.atendidoEm : null,
    fechadoEm: c.fechadoEm ? c.fechadoEm.toISOString?.() || c.fechadoEm : null,
    ultimaMensagemEm: ultima?.criadoEm
      ? ultima.criadoEm.toISOString?.() || ultima.criadoEm
      : null,
    mensagens: mensagens.map(mapMensagem),
  };
}

function mapEquipe(e) {
  return {
    id: e.id,
    nome: e.nome,
    cargo: e.cargo,
    status: e.status,
  };
}

function mapParceiro(p) {
  return {
    cnpj: p.cnpj,
    razaoSocial: p.razaoSocial,
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

module.exports = {
  mapMensagem,
  mapConversa,
  mapEquipe,
  mapParceiro,
  mapContato,
  mapFluxo,
};
