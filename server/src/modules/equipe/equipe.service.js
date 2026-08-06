const bcrypt = require("bcryptjs");
const AppError = require("../../shared/errors/AppError");
const usuarioRepository = require("../../infrastructure/repositories/usuario.repository");

// Alguem conta como online se o servidor viu uma requisicao autenticada dessa
// pessoa nos ultimos minutos. Com o painel aberto o front consulta a API a cada
// poucos segundos, entao a janela abaixo e folgada de proposito: absorve
// oscilacao de rede e o intervalo com que a presenca e gravada, sem manter
// online alguem que ja fechou a aba ha tempo.
const JANELA_ONLINE_MS = 2 * 60 * 1000;

class EquipeService {
  // A equipe nao e mais uma lista digitada a mao: e quem tem conta. Criar
  // membro virou criar conta, em /cadastrar, e o status deixou de ser um botao
  // que a propria pessoa virava -- ele agora e observado, nao declarado.
  async listar() {
    const usuarios = await usuarioRepository.listarTodos();
    const agora = Date.now();

    return usuarios.map((u) => {
      const visto = u.ultimoAcessoEm ? new Date(u.ultimoAcessoEm).getTime() : 0;
      return {
        id: u.id,
        nome: u.nome,
        email: u.email,
        cargo: u.cargo,
        ativo: u.ativo,
        // Mantem o vocabulario que o resto do painel ja usa (o Dashboard conta
        // `status === "online"`), agora alimentado por presenca real.
        status: u.ativo && agora - visto < JANELA_ONLINE_MS ? "online" : "offline",
        ultimoAcessoEm: u.ultimoAcessoEm,
        criadoEm: u.criadoEm,
      };
    });
  }
  async alterarStatus(id, ativo) {
    return usuarioRepository.atualizarStatus(id, ativo);
  }

  async alterarCargo(id, cargo) {
    const cargosValidos = ["Administrador", "Financeiro", "Técnico", "Comercial"];
    if (!cargosValidos.includes(cargo)) {
      throw new Error("Cargo inválido");
    }
    return usuarioRepository.atualizarCargo(id, cargo);
  }

  // Nao ha recuperacao por e-mail: quem esqueceu a senha pede a um Administrador,
  // que define uma nova aqui. A permissao e checada no servidor, nao so na tela --
  // o cargo vem do banco (nao do JWT) para uma troca de cargo valer na hora, sem
  // esperar a pessoa sair e entrar de novo.
  async redefinirSenha(idAlvo, novaSenha, solicitanteId) {
    const solicitante = await usuarioRepository.findById(solicitanteId);
    if (!solicitante || solicitante.cargo !== "Administrador") {
      throw new AppError(
        "Apenas Administradores podem redefinir senhas.",
        403,
        "SEM_PERMISSAO"
      );
    }

    if (!novaSenha || String(novaSenha).length < 6) {
      throw new AppError(
        "A senha precisa de pelo menos 6 caracteres.",
        400,
        "SENHA_CURTA"
      );
    }

    const alvo = await usuarioRepository.findById(idAlvo);
    if (!alvo) {
      throw new AppError("Conta não encontrada.", 404, "NOT_FOUND");
    }

    const senhaHash = await bcrypt.hash(String(novaSenha), 10);
    await usuarioRepository.atualizarSenha(idAlvo, senhaHash);
    return { id: alvo.id, nome: alvo.nome };
  }
}

module.exports = new EquipeService();
