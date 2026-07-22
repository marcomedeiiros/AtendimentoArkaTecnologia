const { formatarHora } = require("../helpers/cnpj.helper");

function mapMensagem(m) {
  return {
    de: m.origem === "bot" ? "equipe" : m.origem,
    texto: m.texto,
    hora: formatarHora(m.criadoEm),
  };
}

function mapConversa(c) {
  return {
    id: c.id,
    cliente: c.cliente,
    telefone: c.telefone,
    statusAtendimento: c.statusAtendimento,
    cnpj: c.cnpj,
    cnpjVerificado: c.cnpjVerificado,
    lido: c.lido,
    mensagens: (c.mensagens || []).map(mapMensagem),
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
