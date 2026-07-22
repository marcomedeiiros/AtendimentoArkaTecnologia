const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../../config/env");
const AppError = require("../../shared/errors/AppError");
const usuarioRepository = require("../../infrastructure/repositories/usuario.repository");

class AuthService {
  async login({ email, senha }) {
    const usuario = await usuarioRepository.findByEmail(email);
    if (!usuario || !usuario.ativo) {
      throw new AppError("Credenciais invalidas", 401, "INVALID_CREDENTIALS");
    }

    const senhaOk = await bcrypt.compare(senha, usuario.senhaHash);
    if (!senhaOk) {
      throw new AppError("Credenciais invalidas", 401, "INVALID_CREDENTIALS");
    }

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

  async me(userId) {
    const usuario = await usuarioRepository.findById(userId);
    if (!usuario) throw new AppError("Usuario nao encontrado", 404, "NOT_FOUND");
    return usuario;
  }
}

module.exports = new AuthService();
