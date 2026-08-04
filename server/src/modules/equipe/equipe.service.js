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
}

module.exports = new EquipeService();
