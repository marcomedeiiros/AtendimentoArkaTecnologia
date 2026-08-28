const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const env = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../../shared/errors/AppError");
const bus = require("../../shared/events/event-bus");
const usuarioRepository = require("../../infrastructure/repositories/usuario.repository");
const sessaoRefreshRepository = require("../../infrastructure/repositories/sessaoRefresh.repository");
const permissaoService = require("../permissoes/permissao.service");

// O refresh token e opaco (256 bits aleatorios) -- nao carrega informacao e nao
// pode ser forjado; quem manda e a linha no banco. Guardamos so o hash.
const gerarRefresh = () => crypto.randomBytes(32).toString("base64url");
const hashDe = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

class AuthService {
  // `familia` entra no token como `sid`. E o que torna o logout imediato: sem
  // isso, o JWT e valido pelo prazo inteiro (8h) mesmo depois de sair, porque
  // token sem estado nao se revoga. Com o sid, o authMiddleware confere se a
  // sessao ainda existe. Token antigo (sem sid) continua aceito ate vencer --
  // ninguem e derrubado pelo deploy.
  _assinar(usuario, familia = null) {
    const token = jwt.sign(
      { sub: usuario.id, email: usuario.email, nome: usuario.nome, cargo: usuario.cargo, ...(familia ? { sid: familia } : {}) },
      env.jwt.secret,
      { expiresIn: env.jwt.expiresIn }
    );
    return {
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        cargo: usuario.cargo,
      },
    };
  }

  // Emite um refresh token novo. `familia` ausente = sessao nova (login);
  // informada = rotacao da sessao que ja existia.
  async _emitirRefresh(usuarioId, familia = null, familiaCriadaEm = null) {
    const token = gerarRefresh();
    const familiaEfetiva = familia || crypto.randomUUID();
    await sessaoRefreshRepository.criar({
      familia: familiaEfetiva,
      // Rotacao herda o nascimento da sessao; login novo nasce agora.
      familiaCriadaEm: familiaCriadaEm || new Date(),
      tokenHash: hashDe(token),
      usuarioId,
      expiraEm: new Date(Date.now() + env.sessao.refreshMs),
    });
    return { token, familia: familiaEfetiva };
  }

  /**
   * Teto de sessoes simultaneas por conta: login novo alem do limite derruba a
   * mais ANTIGA (nunca a que acabou de nascer).
   *
   * Sem isto, cada login deixa mais um refresh token vivo para tras -- quem
   * entra de varios lugares acumula credenciais de longa duracao sem que nada
   * na tela mostre isso. Com o teto, o estrago de uma senha vazada tambem para
   * de crescer: no maximo N sessoes existem ao mesmo tempo.
   */
  async _limitarSessoes(usuarioId) {
    const familias = await sessaoRefreshRepository.familiasVivasDoUsuario(usuarioId);
    const excedentes = familias.length - env.sessao.maxPorUsuario;
    if (excedentes <= 0) return;
    for (const familia of familias.slice(0, excedentes)) {
      await sessaoRefreshRepository.revogarFamilia(familia);
    }
    logger.info("Sessoes antigas revogadas pelo limite por conta", { usuarioId, revogadas: excedentes });
  }

  // Contrato de sessao devolvido ao cliente no login e na renovacao. O
  // `inatividadeMs` viaja porque a regra de "ninguem na frente da tela" so pode
  // ser observada pelo navegador -- ver o comentario em config/env.js.
  _sessao() {
    return { inatividadeMs: env.sessao.inatividadeMs };
  }

  // Informacao publica que a tela de cadastro precisa ANTES de enviar o
  // formulario: se ha codigo de convite configurado, o campo aparece. Nao
  // devolve o codigo em si, so se ele e exigido.
  registroInfo() {
    return { exigeCodigo: !!env.registroCodigo };
  }

  async cadastrar({ nome, email, senha, cargo, codigo }) {
    if (env.registroCodigo && codigo !== env.registroCodigo) {
      throw new AppError(
        "Codigo de convite invalido. Peca um ao administrador do painel.",
        403,
        "CODIGO_INVALIDO"
      );
    }

    const jaExiste = await usuarioRepository.findByEmail(email);
    if (jaExiste) {
      throw new AppError(
        "Este e-mail ja tem conta. Entre em vez de cadastrar.",
        409,
        "EMAIL_EM_USO"
      );
    }

    // Camada 2 (defesa em profundidade): mesmo que o DTO mude ou seja
    // contornado, o auto-cadastro nunca cria um Administrador. So papeis
    // comuns; qualquer coisa fora disso vira "Técnico".
    const CARGOS_AUTOCADASTRO = ["Financeiro", "Técnico", "Comercial"];
    const cargoSeguro = CARGOS_AUTOCADASTRO.includes(cargo) ? cargo : "Técnico";

    const senhaHash = await bcrypt.hash(senha, 10);
    const usuario = await usuarioRepository.criar({ nome, email, senhaHash, cargo: cargoSeguro });

    // A solicitacao ja esta no banco -- o que faltava era AVISAR quem aprova.
    // Sem este evento, a Gestao da Equipe so descobria a conta nova na proxima
    // releitura periodica (ate 30s) ou num F5, e parecia que o cadastro nao
    // tinha sido salvo. O evento so carrega o NOME do recurso: cada painel rele
    // a lista pela API, com as permissoes de quem esta olhando.
    bus.emitRecurso("equipe");

    // Sem token: criar conta nao e entrar. Quem acabou de se cadastrar passa
    // pelo login como qualquer outra pessoa -- assim a senha e exercitada uma
    // vez antes de virar a unica forma de voltar, e o painel so abre depois de
    // uma autenticacao de verdade.
    return {
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        cargo: usuario.cargo,
      },
    };
  }

  async login({ email, senha }) {
    const usuario = await usuarioRepository.findByEmail(email);
    if (!usuario) {
      throw new AppError("Credenciais inválidas", 401, "INVALID_CREDENTIALS");
    }

    const senhaOk = await bcrypt.compare(senha, usuario.senhaHash);
    if (!senhaOk) {
      throw new AppError("Credenciais inválidas", 401, "INVALID_CREDENTIALS");
    }

    if (!usuario.ativo) {
      throw new AppError(
        "Sua conta está pendente de aprovação por um Administrador.",
        403,
        "CONTA_PENDENTE"
      );
    }

    // O refresh sai primeiro porque o token de acesso precisa carregar o id da
    // sessao (familia) para poder ser revogado no logout.
    const refresh = await this._emitirRefresh(usuario.id);
    await this._limitarSessoes(usuario.id);
    const assinado = this._assinar(usuario, refresh.familia);
    // Modulos que este perfil pode ver -- o cliente usa so para montar o menu.
    // O servidor continua sendo a autoridade a cada requisicao.
    assinado.usuario.permissoes = await permissaoService.modulosDe(usuario.cargo);
    assinado.refreshToken = refresh.token;
    assinado.sessao = this._sessao();
    return assinado;
  }

  /**
   * Renova a sessao: troca um refresh token valido por um par novo
   * (token de acesso + refresh token), sem senha e sem passar pelo login.
   *
   * Cada token vale UMA vez (rotacao). O caminho de reuso e o que interessa
   * aqui: se chega um token que ja foi gasto, ou existem duas copias dele em
   * circulacao (roubo) ou a familia esta comprometida -- nos dois casos a
   * resposta certa e derrubar a sessao inteira e obrigar login, nao emitir mais
   * um par. Falha SEMPRE fechado: qualquer duvida devolve 401.
   */
  async renovar(refreshToken) {
    if (!refreshToken) {
      throw new AppError("Sessao invalida", 401, "SESSAO_INVALIDA");
    }

    const registro = await sessaoRefreshRepository.findByHash(hashDe(refreshToken));
    if (!registro) {
      throw new AppError("Sessao invalida", 401, "SESSAO_INVALIDA");
    }

    if (registro.revogadoEm) {
      throw new AppError("Sessao encerrada", 401, "SESSAO_REVOGADA");
    }

    if (registro.usadoEm) {
      // Token gasto voltando. Duas leituras possiveis:
      //
      //  1. DUPLICADO HONESTO: o operador tem duas abas abertas; as duas viram o
      //     token vencer no mesmo instante e mandaram o mesmo refresh. Dentro de
      //     uma janela curta, e isso -- e derrubar a sessao aqui puniria o uso
      //     normal do painel. Exigimos tambem que ele seja o antecessor direto
      //     da linha mais nova: token de rotacoes atras nao se disfarca de aba.
      //  2. REPLAY: copia roubada sendo usada depois. Ai a familia inteira cai,
      //     e as duas pontas voltam para o login.
      const dentroDaJanela = Date.now() - registro.usadoEm.getTime() <= env.sessao.reusoToleranciaMs;
      // Penultima linha da familia: exatamente UMA sucessora. Com duas ou mais,
      // o token e de rotacoes atras -- copia antiga voltando, nao aba paralela.
      const sucessoras = await sessaoRefreshRepository.contarPosteriores(registro.familia, registro.criadoEm);

      if (!(dentroDaJanela && sucessoras === 1)) {
        await sessaoRefreshRepository.revogarFamilia(registro.familia);
        logger.warn("Reuso de refresh token: familia revogada", {
          familia: registro.familia,
          usuarioId: registro.usuarioId,
          usadoHaMs: Date.now() - registro.usadoEm.getTime(),
          sucessoras,
        });
        throw new AppError("Sessao encerrada por seguranca. Entre novamente.", 401, "SESSAO_REUSO");
      }
      logger.info("Renovacao duplicada tolerada (abas simultaneas)", { familia: registro.familia });
    }

    if (registro.expiraEm.getTime() <= Date.now()) {
      throw new AppError("Sessao expirada", 401, "SESSAO_EXPIRADA");
    }

    // Teto absoluto: contado do login, nao da ultima rotacao. E o que impede
    // que uma sessao (ou um refresh token roubado que va sendo usado) se
    // renove para sempre. Passado o prazo, pede senha de novo.
    if (Date.now() - registro.familiaCriadaEm.getTime() > env.sessao.maxMs) {
      await sessaoRefreshRepository.revogarFamilia(registro.familia);
      throw new AppError("Sessao expirada. Entre novamente.", 401, "SESSAO_MAX");
    }

    // Estado da conta vale AGORA, nao no momento em que a sessao nasceu: conta
    // apagada ou desativada nao renova (mesmo raciocinio do authMiddleware).
    const usuario = await usuarioRepository.findById(registro.usuarioId);
    if (!usuario) {
      await sessaoRefreshRepository.revogarFamilia(registro.familia);
      throw new AppError("Conta nao encontrada", 401, "CONTA_INEXISTENTE");
    }
    if (!usuario.ativo) {
      await sessaoRefreshRepository.revogarFamilia(registro.familia);
      throw new AppError("Conta desativada", 403, "CONTA_INATIVA");
    }

    await sessaoRefreshRepository.marcarUsado(registro.id);

    const refresh = await this._emitirRefresh(usuario.id, registro.familia, registro.familiaCriadaEm);
    const assinado = this._assinar(usuario, refresh.familia);
    assinado.usuario.permissoes = await permissaoService.modulosDe(usuario.cargo);
    assinado.refreshToken = refresh.token;
    assinado.sessao = this._sessao();
    return assinado;
  }

  /**
   * Logout de verdade: revoga a familia inteira no servidor, entao o refresh
   * token que ficou no navegador (ou copiado em outro lugar) para de valer na
   * hora. Antes, "sair" so apagava o token do navegador -- quem tivesse uma
   * copia seguia com a sessao.
   *
   * Idempotente de proposito: token desconhecido tambem responde 200. Logout
   * nao e lugar de dizer se um token existe (isso seria um oraculo), e a tela
   * precisa conseguir sair mesmo com a sessao ja morta.
   */
  async sair(refreshToken) {
    if (!refreshToken) return { encerrada: true };
    const registro = await sessaoRefreshRepository.findByHash(hashDe(refreshToken));
    if (registro) await sessaoRefreshRepository.revogarFamilia(registro.familia);
    return { encerrada: true };
  }

  /**
   * SAIR DE TODOS OS DISPOSITIVOS.
   *
   * Revoga TODAS as familias de refresh da conta, sem excecao -- inclusive a de
   * quem pediu. O "menos a atual" que a troca de senha usa NAO vale aqui, e e
   * de proposito: quem clica nisso desconfia que alguem entrou na conta, e a
   * duvida inclui a propria aba (pode ser justamente o computador emprestado
   * onde a sessao ficou aberta).
   *
   * O efeito e IMEDIATO, e nao no fim do prazo do JWT: o `authMiddleware`
   * confere `familiaAtiva(sid)` a cada requisicao, entao um token de acesso ja
   * emitido -- ou copiado -- para de autenticar no mesmo instante, em qualquer
   * maquina. Sem isso, "encerrar tudo" so valeria quando o token vencesse
   * sozinho, e o botao mentiria justamente para quem mais precisa dele.
   *
   * Reusa `revogarDoUsuario`, o mesmo que a troca de senha chama, sem `exceto`.
   */
  async sairDeTodos(userId) {
    const { count } = await sessaoRefreshRepository.revogarDoUsuario(userId);
    logger.info("Todas as sessoes encerradas pelo usuario", { usuarioId: userId, linhas: count });
    return { encerradas: true, sessoesEncerradas: count };
  }

  async me(userId) {
    const usuario = await usuarioRepository.findById(userId);
    if (!usuario) throw new AppError("Usuario nao encontrado", 404, "NOT_FOUND");
    const permissoes = await permissaoService.modulosDe(usuario.cargo);
    return { ...usuario, permissoes };
  }

  // Edita o proprio perfil. `userId` vem SEMPRE do token (req.user.sub), nunca
  // do corpo -- por isso ninguem edita a conta de outro.
  async atualizarPerfil(userId, { nome }) {
    const usuario = await usuarioRepository.atualizarNome(userId, String(nome).trim());
    const permissoes = await permissaoService.modulosDe(usuario.cargo);
    return { ...usuario, permissoes };
  }

  // Troca a propria senha conferindo a atual. `userId` do token.
  //
  // `sidAtual` e a sessao de quem esta trocando: ela SOBREVIVE e todas as outras
  // caem. Trocar a senha e o que a pessoa faz quando desconfia que alguem
  // entrou na conta -- se as outras sessoes continuassem valendo, a troca nao
  // expulsaria ninguem, porque um refresh token roubado nao precisa da senha
  // para se renovar. Derrubar tambem a sessao atual so obrigaria a fazer login
  // de novo sem ganho de seguranca.
  async trocarSenha(userId, senhaAtual, novaSenha, sidAtual = null) {
    const atual = await usuarioRepository.senhaHashDe(userId);
    if (!atual) throw new AppError("Usuario nao encontrado", 404, "NOT_FOUND");

    const confere = await bcrypt.compare(String(senhaAtual), atual.senhaHash);
    if (!confere) {
      throw new AppError("Senha atual incorreta.", 400, "SENHA_ATUAL_INVALIDA");
    }

    const senhaHash = await bcrypt.hash(String(novaSenha), 10);
    await usuarioRepository.atualizarSenha(userId, senhaHash);
    const { count } = await sessaoRefreshRepository.revogarDoUsuario(userId, sidAtual);
    if (count) logger.info("Sessoes derrubadas por troca de senha", { usuarioId: userId, linhas: count });
    return { trocada: true, outrasSessoesEncerradas: count > 0 };
  }
}

module.exports = new AuthService();
