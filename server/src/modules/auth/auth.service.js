const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../../config/env");
const AppError = require("../../shared/errors/AppError");
const usuarioRepository = require("../../infrastructure/repositories/usuario.repository");
const permissaoService = require("../permissoes/permissao.service");

class AuthService {
  _assinar(usuario) {
    const token = jwt.sign(
      { sub: usuario.id, email: usuario.email, nome: usuario.nome, cargo: usuario.cargo },
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

    const assinado = this._assinar(usuario);
    // Modulos que este perfil pode ver -- o cliente usa so para montar o menu.
    // O servidor continua sendo a autoridade a cada requisicao.
    assinado.usuario.permissoes = await permissaoService.modulosDe(usuario.cargo);
    return assinado;
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
