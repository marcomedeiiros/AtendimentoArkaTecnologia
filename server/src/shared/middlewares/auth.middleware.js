const jwt = require("jsonwebtoken");
const env = require("../../config/env");
const AppError = require("../errors/AppError");
const usuarioRepository = require("../../infrastructure/repositories/usuario.repository");
const sessaoRefreshRepository = require("../../infrastructure/repositories/sessaoRefresh.repository");
const { tokenDoCookie } = require("../helpers/sessaoCookie.helper");

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

/**
 * De onde vem o token: COOKIE primeiro, header `Authorization` depois.
 *
 * Aceitar os dois nao e indecisao -- e o que permite a sessao mudar de lugar
 * sem uma janela de queda. No deploy, o painel antigo (que guarda o token em
 * localStorage e manda `Bearer`) continua funcionando contra a API nova; o
 * painel novo passa a usar cookie. Sem isso, seria preciso trocar os dois no
 * mesmo segundo -- e foi tentando isso que este projeto ja derrubou o login em
 * producao duas vezes.
 *
 * O cookie vem primeiro porque, quando existe, e a forma mais segura: ele e
 * HttpOnly e nenhum script da pagina consegue le-lo.
 */
function tokenDaRequisicao(req) {
  const doCookie = tokenDoCookie(req);
  if (doCookie) return doCookie;
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

async function authMiddleware(req, res, next) {
  const token = tokenDaRequisicao(req);

  if (!token) {
    return next(new AppError("Token de autenticacao nao informado", 401, "UNAUTHORIZED"));
  }

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
    // Sessao revogada (logout, ou familia queimada por reuso de refresh token)
    // invalida o token de acesso NA HORA. Sem esta checagem, sair do painel nao
    // derrubaria um JWT copiado: ele valeria pelo prazo inteiro, porque token
    // sem estado nao se revoga. `sid` so existe nos tokens emitidos a partir da
    // versao com sessao renovavel -- token antigo segue valido ate vencer, para
    // o deploy nao derrubar quem estava logado.
    if (payload.sid && !(await sessaoRefreshRepository.familiaAtiva(payload.sid))) {
      return next(new AppError("Sessao encerrada", 401, "SESSAO_REVOGADA"));
    }

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
      // Sessao desta requisicao. Serve para poupar a propria sessao quando a
      // acao derruba as outras (troca de senha).
      sid: payload.sid || null,
    };
    registrarPresenca(usuario.id);
    return next();
  } catch (err) {
    return next(err);
  }
}

// Mesma origem de token do `authMiddleware` -- se este lesse so o header, uma
// rota de autenticacao opcional deixaria de reconhecer quem esta logado por
// cookie, e passaria a trata-lo como visitante sem nenhum erro aparente.
function optionalAuth(req, res, next) {
  const token = tokenDaRequisicao(req);
  if (!token) return next();

  try {
    req.user = jwt.verify(token, env.jwt.secret);
  } catch {
    // ignora token invalido em rotas opcionais
  }
  return next();
}

module.exports = { authMiddleware, optionalAuth };
