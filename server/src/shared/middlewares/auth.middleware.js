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
      // Setores extras, tambem do banco e pelo mesmo motivo: tirar um setor de
      // alguem passa a valer na requisicao seguinte, e nao quando o token
      // vencer. Vai junto do cargo porque `podeAcessarSetor` decide com os
      // dois -- separa-los criaria o caminho em que um chega e o outro nao.
      setoresExtras: usuario.setoresExtras || null,
      // Equipe de ranking, tambem do BANCO e pela mesma razao dos setores: ela
      // decide quem enxerga a tela de Relatorios, e tirar alguem de "Fora da
      // Sede" tem de valer na requisicao seguinte -- nao quando o token vencer.
      equipeRanking: usuario.equipeRanking || null,
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

/**
 * AUTENTICACAO OPCIONAL -- quem esta logado e reconhecido, visitante passa.
 *
 * ── POR QUE ELA DELEGA, EM VEZ DE SO VERIFICAR A ASSINATURA ────────────────
 *
 * Esta funcao montava `req.user` com o PAYLOAD do token: `jwt.verify` devolve
 * o que foi assinado, e aquilo virava a identidade da requisicao -- cargo
 * inclusive. Era o oposto exato da regra que o `authMiddleware` ao lado
 * cumpre: cargo, `ativo` e sessao vem do BANCO, a cada chamada.
 *
 * Hoje nenhuma rota a usa, entao nao havia buraco aberto -- havia uma ARMADILHA
 * pronta: a primeira rota "publica com extras" que a montasse na cadeia herdaria
 * um `req.user.cargo` escolhido por quem tem o token na mao, e um `exigirModulo`
 * logo abaixo decidiria com base nisso. Conta desativada e rebaixamento
 * tambem seriam ignorados ate o JWT vencer.
 *
 * Agora ela CHAMA o caminho autoritativo e so troca o desfecho do erro: falhou
 * (sem token, token velho, sessao revogada, conta inativa), segue como
 * visitante, sem `req.user`. Uma porta a menos para manter em dia -- a regra
 * mora num lugar so.
 *
 * Mesma origem de token do `authMiddleware` -- se este lesse so o header, uma
 * rota de autenticacao opcional deixaria de reconhecer quem esta logado por
 * cookie, e passaria a trata-lo como visitante sem nenhum erro aparente.
 */
function optionalAuth(req, res, next) {
  const token = tokenDaRequisicao(req);
  if (!token) return next();

  return authMiddleware(req, res, (err) => {
    if (err) delete req.user;
    return next();
  });
}

module.exports = { authMiddleware, optionalAuth };
