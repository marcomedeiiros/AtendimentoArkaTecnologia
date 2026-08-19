const jwt = require("jsonwebtoken");
const env = require("../../config/env");
const AppError = require("../errors/AppError");
const usuarioRepository = require("../../infrastructure/repositories/usuario.repository");

// Presenca do operador, sem uma tabela de sessao.
//
// Com o painel aberto o front consulta o servidor a cada poucos segundos, entao
// "requisicao autenticada recente" ja e um sinal fiel de aba aberta. Gravar
// isso a cada chamada seria um UPDATE por requisicao; por isso o cache abaixo
// segura a escrita por INTERVALO_ESCRITA. O efeito no "online" e nulo: a janela
// que a tela usa para considerar alguem online e bem maior que esse intervalo.
const INTERVALO_ESCRITA = 30_000;
const ultimaEscrita = new Map();

function registrarPresenca(userId) {
  if (!userId) return;
  const agora = Date.now();
  if (agora - (ultimaEscrita.get(userId) || 0) < INTERVALO_ESCRITA) return;
  ultimaEscrita.set(userId, agora);
  // Sem await: presenca e efeito colateral, nao pode atrasar nem derrubar a
  // resposta. Conta apagada no meio da sessao cai aqui e e ignorada.
  usuarioRepository.marcarAcesso(userId).catch(() => ultimaEscrita.delete(userId));
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError("Token de autenticacao nao informado", 401, "UNAUTHORIZED"));
  }

  const token = header.slice(7);

  let payload;
  try {
    payload = jwt.verify(token, env.jwt.secret);
  } catch {
    return next(new AppError("Token invalido ou expirado", 401, "INVALID_TOKEN"));
  }

  // O token so PROVA quem e a pessoa (sub). Cargo e status vem do BANCO, nao do
  // que o token carrega: assim um rebaixamento ou uma conta desativada valem na
  // hora, sem esperar o token expirar (ate 8h). Toda checagem de permissao
  // adiante (admin, setor) passa a se basear no estado real, nao no congelado.
  try {
    const usuario = await usuarioRepository.findById(payload.sub);
    if (!usuario) {
      return next(new AppError("Conta nao encontrada", 401, "CONTA_INEXISTENTE"));
    }
    if (!usuario.ativo) {
      return next(new AppError("Conta desativada", 403, "CONTA_INATIVA"));
    }
    req.user = {
      sub: usuario.id,
      email: usuario.email,
      nome: usuario.nome,
      cargo: usuario.cargo, // autoritativo (do banco), sobrepoe o do token
    };
    registrarPresenca(usuario.id);
    return next();
  } catch (err) {
    return next(err);
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return next();

  try {
    req.user = jwt.verify(header.slice(7), env.jwt.secret);
  } catch {
    // ignora token invalido em rotas opcionais
  }
  return next();
}

module.exports = { authMiddleware, optionalAuth };
