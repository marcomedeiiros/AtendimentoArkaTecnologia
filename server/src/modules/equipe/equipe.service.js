const bcrypt = require("bcryptjs");
const AppError = require("../../shared/errors/AppError");
const usuarioRepository = require("../../infrastructure/repositories/usuario.repository");
const sessaoRefreshRepository = require("../../infrastructure/repositories/sessaoRefresh.repository");
const { CARGOS_VALIDOS } = require("./equipe.dto");
const { listaDeSetores, setoresVisiveis } = require("../../shared/helpers/setor.helper");
const bus = require("../../shared/events/event-bus");

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
        // Os extras GRAVADOS e a conta PRONTA. A tela precisa dos dois: os
        // extras sao o que ela edita, e `setoresVisiveis` e o que a pessoa
        // realmente enxerga -- somando o que o cargo ja dava. Sem o segundo, o
        // administrador teria de refazer a regra de cabeca para saber o efeito
        // do que acabou de marcar.
        setoresExtras: listaDeSetores(u.setoresExtras),
        setoresVisiveis: setoresVisiveis(u),
        // Mantem o vocabulario que o resto do painel ja usa (o Dashboard conta
        // `status === "online"`), agora alimentado por presenca real.
        status: u.ativo && agora - visto < JANELA_ONLINE_MS ? "online" : "offline",
        ultimoAcessoEm: u.ultimoAcessoEm,
        criadoEm: u.criadoEm,
      };
    });
  }
  // Confere no BANCO (nao no JWT) que quem pede e Administrador. Fonte unica
  // usada por todas as acoes de gestao -- assim um rebaixamento vale na hora,
  // sem esperar o token da pessoa expirar.
  async _exigirAdmin(solicitanteId) {
    const solicitante = await usuarioRepository.findById(solicitanteId);
    if (!solicitante || solicitante.cargo !== "Administrador") {
      throw new AppError(
        "Apenas Administradores podem gerenciar a equipe.",
        403,
        "SEM_PERMISSAO"
      );
    }
    return solicitante;
  }

  async alterarStatus(id, ativo, solicitanteId) {
    await this._exigirAdmin(solicitanteId);

    // Autoridade: os guards abaixo usam `!ativo`, entao `ativo` tem de ser
    // booleano de verdade. Se este metodo for chamado fora da rota (sem o Zod da
    // borda), um valor ambiguo (ex.: "false", truthy) nao passa daqui.
    if (typeof ativo !== "boolean") {
      throw new AppError("Status inválido (ativo deve ser booleano).", 400, "STATUS_INVALIDO");
    }

    // Nao pode desativar a propria conta (auto-lockout) nem o ultimo Admin ativo.
    if (id === solicitanteId && !ativo) {
      throw new AppError("Você não pode desativar a sua própria conta.", 400, "AUTO_DESATIVACAO");
    }
    if (!ativo) {
      const alvo = await usuarioRepository.findById(id);
      if (alvo?.cargo === "Administrador" && alvo.ativo) {
        const admins = await usuarioRepository.contarAdminsAtivos();
        if (admins <= 1) {
          throw new AppError("Não é possível desativar o último Administrador ativo.", 400, "ULTIMO_ADMIN");
        }
      }
    }

    const atualizado = await usuarioRepository.atualizarStatus(id, ativo);
    // Bloquear alguem precisa TIRAR a pessoa de dentro, nao so impedir o proximo
    // login: sem revogar, o refresh token dela continuaria existindo e voltaria
    // a valer no instante em que a conta fosse reativada.
    if (!ativo) await sessaoRefreshRepository.revogarDoUsuario(id);
    // A equipe mudou para TODO mundo: quem tem o painel aberto rele a lista
    // pelo mesmo stream que ja usa, em vez de descobrir no proximo F5.
    bus.emitRecurso("equipe");
    return atualizado;
  }

  async alterarCargo(id, cargo, solicitanteId) {
    await this._exigirAdmin(solicitanteId);

    // Um Administrador nao altera o proprio cargo -- so o de outros. Evita que
    // ele se rebaixe por engano (e perca o acesso) ou burle o travamento do
    // ultimo admin trocando o proprio cargo.
    if (id === solicitanteId) {
      throw new AppError("Você não pode alterar o seu próprio cargo.", 400, "AUTO_CARGO");
    }

    if (!CARGOS_VALIDOS.includes(cargo)) {
      throw new AppError("Cargo inválido", 400, "CARGO_INVALIDO");
    }

    // Rebaixar o ultimo Administrador ativo travaria a gestao: ninguem mais
    // aprovaria contas, trocaria cargos ou redefiniria senhas.
    if (cargo !== "Administrador") {
      const alvo = await usuarioRepository.findById(id);
      if (alvo?.cargo === "Administrador" && alvo.ativo) {
        const admins = await usuarioRepository.contarAdminsAtivos();
        if (admins <= 1) {
          throw new AppError("Não é possível rebaixar o último Administrador ativo.", 400, "ULTIMO_ADMIN");
        }
      }
    }

    const atualizado = await usuarioRepository.atualizarCargo(id, cargo);
    bus.emitRecurso("equipe");
    return atualizado;
  }

  // Nao ha recuperacao por e-mail: quem esqueceu a senha pede a um Administrador,
  // que define uma nova aqui. A permissao e checada no servidor, nao so na tela --
  // o cargo vem do banco (nao do JWT) para uma troca de cargo valer na hora, sem
  // esperar a pessoa sair e entrar de novo.
  /**
   * OS SETORES EXTRAS DE UMA PESSOA.
   *
   * Diferente de `alterarCargo`, aqui NAO ha trava de auto-edicao: um
   * Administrador ja ve todos os setores, entao mexer nos proprios extras nao
   * muda nada para ele e nao ha como se trancar para fora. A trava do cargo
   * existe porque la da para se rebaixar por engano.
   *
   * Extras que o cargo JA DA sao descartados na gravacao. Guardar "Financeiro"
   * como extra de quem e do Financeiro nao muda o acesso, mas suja a tela: no
   * dia em que o cargo dessa pessoa mudar, o extra silencioso continuaria
   * valendo e ninguem saberia de onde veio.
   */
  async alterarSetores(id, setores, solicitanteId) {
    await this._exigirAdmin(solicitanteId);

    const alvo = await usuarioRepository.findById(id);
    if (!alvo) throw new AppError("Conta nao encontrada", 404, "CONTA_INEXISTENTE");

    const pedidos = listaDeSetores(setores);
    const jaTinhaPeloCargo = setoresVisiveis({ cargo: alvo.cargo, setoresExtras: null });
    const extras = pedidos.filter((s) => !jaTinhaPeloCargo.includes(s));

    const atualizado = await usuarioRepository.atualizarSetoresExtras(
      id,
      extras.length ? extras.join(",") : null
    );

    bus.emit("equipe:update", { id });

    return {
      id: atualizado.id,
      nome: atualizado.nome,
      cargo: atualizado.cargo,
      setoresExtras: extras,
      setoresVisiveis: setoresVisiveis(atualizado),
    };
  }

  async redefinirSenha(idAlvo, novaSenha, solicitanteId) {
    const solicitante = await usuarioRepository.findById(solicitanteId);
    if (!solicitante || solicitante.cargo !== "Administrador") {
      throw new AppError(
        "Apenas Administradores podem redefinir senhas.",
        403,
        "SEM_PERMISSAO"
      );
    }

    if (typeof novaSenha !== "string" || novaSenha.length < 6) {
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
    // Redefinir senha por um admin acontece quando a conta esta perdida ou
    // suspeita. Sem revogar, quem estivesse dentro continuaria dentro: um
    // refresh token nao precisa da senha para se renovar. Aqui caem TODAS as
    // sessoes do alvo (nenhuma delas e a do admin que esta agindo).
    await sessaoRefreshRepository.revogarDoUsuario(idAlvo);
    return { id: alvo.id, nome: alvo.nome };
  }

  // Exclusao definitiva de uma conta. Só Administrador; nao pode excluir a
  // propria conta nem o ultimo Administrador ativo (senao a gestao trava).
  async remover(idAlvo, solicitanteId) {
    const solicitante = await usuarioRepository.findById(solicitanteId);
    if (!solicitante || solicitante.cargo !== "Administrador") {
      throw new AppError("Apenas Administradores podem excluir contas.", 403, "SEM_PERMISSAO");
    }
    if (idAlvo === solicitanteId) {
      throw new AppError("Você não pode excluir a sua própria conta.", 400, "AUTO_EXCLUSAO");
    }

    const alvo = await usuarioRepository.findById(idAlvo);
    if (!alvo) throw new AppError("Conta não encontrada.", 404, "NOT_FOUND");

    if (alvo.cargo === "Administrador" && alvo.ativo) {
      const admins = await usuarioRepository.contarAdminsAtivos();
      if (admins <= 1) {
        throw new AppError(
          "Não é possível excluir o último Administrador ativo.",
          400,
          "ULTIMO_ADMIN"
        );
      }
    }

    // Revoga ANTES de apagar: se a exclusao falhar no meio, o pior cenario e
    // uma conta que existe com as sessoes derrubadas (recuperavel), e nao uma
    // conta apagada com refresh tokens orfaos ainda de pe.
    await sessaoRefreshRepository.revogarDoUsuario(idAlvo);
    await usuarioRepository.remover(idAlvo);
    bus.emitRecurso("equipe");
    return { removido: true, id: idAlvo, nome: alvo.nome };
  }
}

const equipeService = new EquipeService();

// `JANELA_ONLINE_MS` sai junto porque a Central tambem precisa dizer quem esta
// online (no seletor de transferencia). Duas janelas diferentes fariam as duas
// telas discordarem sobre a mesma pessoa.
module.exports = equipeService;
module.exports.JANELA_ONLINE_MS = JANELA_ONLINE_MS;
