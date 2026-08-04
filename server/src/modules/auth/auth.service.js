const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../../config/env");
const AppError = require("../../shared/errors/AppError");
const usuarioRepository = require("../../infrastructure/repositories/usuario.repository");

class AuthService {
  _assinar(usuario) {
    const token = jwt.sign(
      { sub: usuario.id, email: usuario.email, nome: usuario.nome },
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

    const senhaHash = await bcrypt.hash(senha, 10);
    const usuario = await usuarioRepository.criar({ nome, email, senhaHash, cargo });

    // Ja devolve token: quem acabou de criar a conta entra direto, sem repetir
    // as credenciais numa segunda tela.
    return this._assinar(usuario);
  }

  async login({ email, senha }) {
    const usuario = await usuarioRepository.findByEmail(email);
    if (!usuario || !usuario.ativo) {
      throw new AppError("Credenciais invalidas", 401, "INVALID_CREDENTIALS");
    }

    const senhaOk = await bcrypt.compare(senha, usuario.senhaHash);
    if (!senhaOk) {
      throw new AppError("Credenciais invalidas", 401, "INVALID_CREDENTIALS");
    }

    return this._assinar(usuario);
  }

  async me(userId) {
    const usuario = await usuarioRepository.findById(userId);
    if (!usuario) throw new AppError("Usuario nao encontrado", 404, "NOT_FOUND");
    return usuario;
  }
}

module.exports = new AuthService();
