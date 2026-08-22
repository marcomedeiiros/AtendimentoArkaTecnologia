const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const env = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../../shared/errors/AppError");
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
  async _emitirRefresh(usuarioId, familia = null) {
    const token = gerarRefresh();
    const familiaEfetiva = familia || crypto.randomUUID();
    await sessaoRefreshRepository.criar({
      familia: familiaEfetiva,
      tokenHash: hashDe(token),
      usuarioId,
      expiraEm: new Date(Date.now() + env.sessao.refreshMs),
    });
    return { token, familia: familiaEfetiva };
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
      // Token gasto voltando: trata como copia roubada e queima a familia.
      await sessaoRefreshRepository.revogarFamilia(registro.familia);
      logger.warn("Reuso de refresh token: familia revogada", {
        familia: registro.familia,
        usuarioId: registro.usuarioId,
      });
      throw new AppError("Sessao encerrada por seguranca. Entre novamente.", 401, "SESSAO_REUSO");
    }

    if (registro.expiraEm.getTime() <= Date.now()) {
      throw new AppError("Sessao expirada", 401, "SESSAO_EXPIRADA");
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

    const refresh = await this._emitirRefresh(usuario.id, registro.familia);
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
  async trocarSenha(userId, senhaAtual, novaSenha) {
    const atual = await usuarioRepository.senhaHashDe(userId);
    if (!atual) throw new AppError("Usuario nao encontrado", 404, "NOT_FOUND");

    const confere = await bcrypt.compare(String(senhaAtual), atual.senhaHash);
    if (!confere) {
      throw new AppError("Senha atual incorreta.", 400, "SENHA_ATUAL_INVALIDA");
    }

    const senhaHash = await bcrypt.hash(String(novaSenha), 10);
    await usuarioRepository.atualizarSenha(userId, senhaHash);
    return { trocada: true };
  }
}

module.exports = new AuthService();
