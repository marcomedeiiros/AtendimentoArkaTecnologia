const fluxoRepository = require("../../infrastructure/repositories/fluxo.repository");
const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const sessaoRepository = require("../../infrastructure/repositories/sessao.repository");
const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const mockErp = require("../../infrastructure/external/mock-erp.service");
const {
  limparCnpj,
  cnpjValido,
  mascararCnpj,
  sleep,
} = require("../../shared/helpers/cnpj.helper");
const { comLock } = require("../../shared/helpers/lock.helper");
const logger = require("../../config/logger");
const env = require("../../config/env");
const { sessao: cfgSessao, limites, palavrasChave, mensagens } = require("./chatbot.config");

// Estados possiveis de `sessao.aguardando`:
//   cnpj   -> proxima mensagem do cliente e tratada como CNPJ
//   menu   -> proxima mensagem e tratada como escolha numerica do menu
//   humano -> conversa transferida; o bot fica calado ate expirar ou ser atendida
const AGUARDANDO = { CNPJ: "cnpj", MENU: "menu", HUMANO: "humano" };

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class ChatbotEngine {
  normalizarTexto(texto) {
    return String(texto || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  extrairTextoMensagem(texto) {
    return String(texto || "").trim();
  }

  // Texto que efetivamente vai para o cliente. `descricao` e anotacao interna
  // do editor de fluxos e so entra como fallback para fluxos antigos que nao
  // tem `texto` preenchido.
  textoDoPasso(passo) {
    return (
      passo.texto ||
      passo.config?.mensagem ||
      passo.descricao ||
      passo.titulo ||
      ""
    );
  }

  // "Fluxo 2: Reenvio de 2a Via de Boleto" -> "Reenvio de 2a Via de Boleto"
  rotuloDoFluxo(fluxo) {
    return String(fluxo.nome || "").replace(/^fluxo\s*\d+\s*[:\-]\s*/i, "").trim() || fluxo.nome;
  }

  // Um fluxo pode ter varios gatilhos separados por virgula, ponto-e-virgula ou |.
  gatilhosDoFluxo(fluxo) {
    return String(fluxo.gatilho || "")
      .split(/[,;|]/)
      .map((g) => this.normalizarTexto(g))
      .filter(Boolean);
  }

  // Casa por inicio de palavra (aceita plural) em vez de substring solta, e
  // devolve o fluxo do gatilho mais especifico quando mais de um bate.
  detectarGatilho(texto, fluxos) {
    const normalizado = this.normalizarTexto(texto);
    let melhor = null;

    for (const fluxo of fluxos) {
      for (const gatilho of this.gatilhosDoFluxo(fluxo)) {
        const regex = new RegExp(`(^|[^\\p{L}\\p{N}])${escaparRegex(gatilho)}`, "u");
        if (regex.test(normalizado) && (!melhor || gatilho.length > melhor.tamanho)) {
          melhor = { fluxo, tamanho: gatilho.length };
        }
      }
    }

    return melhor?.fluxo || null;
  }

  detectarComando(texto) {
    const normalizado = this.normalizarTexto(texto);
    for (const [comando, termos] of Object.entries(palavrasChave)) {
      const bateu = termos.some((termo) => {
        const t = this.normalizarTexto(termo);
        return normalizado === t || new RegExp(`(^|[^\\p{L}\\p{N}])${escaparRegex(t)}([^\\p{L}\\p{N}]|$)`, "u").test(normalizado);
      });
      if (bateu) return comando;
    }
    return null;
  }

  ordenarPassos(passos) {
    return [...passos].sort((a, b) => a.ordem - b.ordem);
  }

  proximoPasso(passos, passoAtual) {
    if (!passoAtual) return passos[0] || null;
    if (passoAtual.targetId) {
      return passos.find((p) => p.id === passoAtual.targetId) || null;
    }
    const idx = passos.findIndex((p) => p.id === passoAtual.id);
    return idx >= 0 ? passos[idx + 1] || null : null;
  }

  // Um passo de mensagem pode pedir CNPJ explicitamente via config.aguardar.
  // A heuristica pelo texto existe so para os fluxos criados antes disso.
  passoAguardaCnpj(passo) {
    if (passo.config?.aguardar) return passo.config.aguardar === AGUARDANDO.CNPJ;
    const alvo = this.normalizarTexto(
      `${passo.titulo || ""} ${passo.descricao || ""} ${passo.texto || ""}`
    );
    return alvo.includes("cnpj");
  }

  sessaoExpirada(sessao) {
    if (!sessao?.ativo) return false;
    const ttl =
      sessao.aguardando === AGUARDANDO.HUMANO ? cfgSessao.ttlHumanoMs : cfgSessao.ttlMs;
    const ultimaAtividade = new Date(sessao.atualizadoEm || sessao.criadoEm).getTime();
    return Date.now() - ultimaAtividade > ttl;
  }

  async registrarLog(instanciaId, fluxoId, passo, conversaId, mensagem, sucesso, inicio) {
    try {
      await fluxoRepository.createLog({
        instanciaId,
        fluxoId,
        conversaId,
        passoId: passo?.id || null,
        tipo: passo?.tipo || "sistema",
        titulo: passo?.titulo || "Execucao",
        mensagem,
        sucesso,
        duracaoMs: Date.now() - inicio,
      });
    } catch (error) {
      // Log de auditoria nunca deve derrubar o atendimento.
      logger.warn("Falha ao gravar log de execucao", { message: error.message });
    }
  }

  async enviarBot(conversaId, telefone, texto, instanceName) {
    await conversaRepository.addMensagem(conversaId, "bot", texto);
    try {
      await evolutionApi.sendText(telefone, texto, instanceName || env.evolutionApi.instance);
    } catch (error) {
      logger.warn("Falha ao enviar WhatsApp", { telefone, message: error.message });
    }
    return texto;
  }

  async validarCnpjRecebido(conversa, texto) {
    const cnpjLimpo = limparCnpj(texto);
    if (cnpjLimpo.length !== 14 || !cnpjValido(cnpjLimpo)) {
      return { valido: false, cnpj: cnpjLimpo };
    }

    const parceiro = await parceiroRepository.findAtivoByCnpj(cnpjLimpo);
    await conversaRepository.update(conversa.id, {
      cnpj: cnpjLimpo,
      cnpjVerificado: true,
    });

    const msg = parceiro
      ? `CNPJ ${mascararCnpj(cnpjLimpo)} validado! Razao Social: ${parceiro.razaoSocial} - parceiro com contrato ativo.`
      : `CNPJ ${mascararCnpj(cnpjLimpo)} consultado. Nao consta contrato de parceiro ativo.`;

    return { valido: true, cnpj: cnpjLimpo, parceiro, mensagem: msg };
  }

  // ---------------------------------------------------------------- menu ---

  montarMenu(fluxos, cabecalho) {
    const linhas = fluxos.map((f, i) => `${i + 1} - ${this.rotuloDoFluxo(f)}`);
    return [cabecalho, "", linhas.join("\n"), "", mensagens.menuRodape].join("\n");
  }

  async enviarMenu(ctx, fluxos, cabecalho) {
    const { conversa, telefone, instanciaId, instanceName } = ctx;

    if (!fluxos.length) {
      await this.enviarBot(conversa.id, telefone, mensagens.semFluxos, instanceName);
      return this.transferirParaHumano(ctx, { avisar: false });
    }

    await this.enviarBot(conversa.id, telefone, this.montarMenu(fluxos, cabecalho), instanceName);

    await sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: null,
      passoAtualId: null,
      aguardando: AGUARDANDO.MENU,
      ativo: true,
      contexto: {
        ...(ctx.contexto || {}),
        menuOpcoes: fluxos.map((f) => f.id),
        tentativasMenu: (ctx.contexto?.tentativasMenu || 0) + 1,
      },
    });

    return { processado: true, conversaId: conversa.id, aguardando: AGUARDANDO.MENU };
  }

  // Aceita "2", "2)" ou "opcao 2".
  interpretarEscolhaMenu(texto, opcoes) {
    const match = this.normalizarTexto(texto).match(/\d+/);
    if (!match) return null;
    const indice = Number(match[0]) - 1;
    return opcoes[indice] || null;
  }

  // ------------------------------------------------------------ handoff ---

  async transferirParaHumano(ctx, { avisar = true, motivo = "solicitado" } = {}) {
    const { conversa, telefone, instanciaId, instanceName } = ctx;

    if (avisar) {
      await this.enviarBot(conversa.id, telefone, mensagens.transferindo, instanceName);
    }

    await conversaRepository.update(conversa.id, {
      statusAtendimento: "aguardando",
      lido: false,
    });

    await sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: null,
      passoAtualId: null,
      aguardando: AGUARDANDO.HUMANO,
      ativo: true,
      contexto: {},
    });

    logger.info("Conversa transferida para atendimento humano", {
      conversaId: conversa.id,
      motivo,
    });

    return {
      processado: true,
      conversaId: conversa.id,
      aguardando: AGUARDANDO.HUMANO,
      transferido: true,
      motivo,
    };
  }

  async encerrarSessao(ctx) {
    const { conversa, telefone, instanciaId, instanceName } = ctx;

    await this.enviarBot(conversa.id, telefone, mensagens.encerrado, instanceName);
    await sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: null,
      passoAtualId: null,
      aguardando: null,
      ativo: false,
      contexto: {},
    });

    return { processado: true, conversaId: conversa.id, encerrado: true };
  }

  // ------------------------------------------------------------- passos ---

  async executarPasso(passo, contexto) {
    const inicio = Date.now();
    const { conversa, telefone, instanciaId, fluxo, instanceName } = contexto;
    let resposta = null;
    let aguardando = null;
    let proximo = null;

    switch (passo.tipo) {
      case "gatilho":
      case "comentario":
        proximo = this.proximoPasso(fluxo.passos, passo);
        break;

      case "mensagem": {
        resposta = this.textoDoPasso(passo);
        if (this.passoAguardaCnpj(passo) && !contexto.cnpjValidacao?.valido) {
          aguardando = AGUARDANDO.CNPJ;
        } else {
          proximo = this.proximoPasso(fluxo.passos, passo);
        }
        break;
      }

      case "condicao": {
        const cnpjCtx = contexto.cnpjValidacao;
        if (cnpjCtx?.valido) {
          // Passo de roteamento: a confirmacao ja foi enviada no momento da
          // validacao. Repetir aqui mandava a mesma mensagem duas vezes.
          proximo = this.proximoPasso(fluxo.passos, passo);
        } else {
          aguardando = AGUARDANDO.CNPJ;
          resposta = this.textoDoPasso(passo) || mensagens.cnpjSolicitar;
        }
        break;
      }

      case "delay": {
        const ms = Math.min(Number(passo.config?.ms) || 1000, limites.maxDelayMs);
        await sleep(ms);
        proximo = this.proximoPasso(fluxo.passos, passo);
        break;
      }

      case "acao": {
        const acao = passo.config?.acao;
        const cnpj = conversa.cnpj || contexto.cnpjValidacao?.cnpj;
        const parceiro = cnpj ? await parceiroRepository.findAtivoByCnpj(cnpj) : null;

        if (acao === "desconto_parceiro") {
          const percentual = passo.config?.percentual || 15;
          if (parceiro) {
            const result = await mockErp.aplicarDescontoParceiro({
              cnpj,
              razaoSocial: parceiro.razaoSocial,
              percentual,
            });
            resposta = result.mensagem;
          } else {
            resposta =
              "Desconto de parceiro nao aplicavel: o CNPJ informado nao possui contrato ativo.";
          }
        } else if (acao === "gerar_boleto") {
          const result = await mockErp.gerarBoleto({
            cnpj,
            razaoSocial: parceiro?.razaoSocial,
          });
          resposta = `${result.mensagem}\nLinha digitavel: ${result.linhaDigitavel}\nPIX: ${result.pixCopiaCola}\nVencimento: ${result.vencimento}`;
        } else {
          resposta = this.textoDoPasso(passo);
        }
        proximo = this.proximoPasso(fluxo.passos, passo);
        break;
      }

      default:
        proximo = this.proximoPasso(fluxo.passos, passo);
    }

    if (resposta) {
      await this.enviarBot(conversa.id, telefone, resposta, instanceName);
    }

    await this.registrarLog(instanciaId, fluxo.id, passo, conversa.id, resposta, true, inicio);

    return { proximo, aguardando };
  }

  // Percorre os passos com dois freios: um teto de passos e um conjunto de
  // visitados. Sem eles, um fluxo com targetId ciclico (facil de montar no
  // editor visual) prendia o event loop do servidor para sempre.
  async percorrer(passoInicial, contexto) {
    let passoAtual = passoInicial;
    let aguardando = null;
    const visitados = new Set();
    let executados = 0;

    while (passoAtual) {
      if (visitados.has(passoAtual.id) || executados >= limites.maxPassosPorExecucao) {
        logger.warn("Execucao de fluxo interrompida: ciclo ou limite de passos", {
          fluxoId: contexto.fluxo.id,
          conversaId: contexto.conversa.id,
          passoId: passoAtual.id,
          executados,
        });
        await this.registrarLog(
          contexto.instanciaId,
          contexto.fluxo.id,
          passoAtual,
          contexto.conversa.id,
          "Fluxo interrompido: ciclo detectado ou limite de passos atingido.",
          false,
          Date.now()
        );
        passoAtual = null;
        break;
      }

      visitados.add(passoAtual.id);
      executados += 1;

      const resultado = await this.executarPasso(passoAtual, contexto);
      aguardando = resultado.aguardando;

      if (aguardando) {
        // Fica parado no passo que pediu a informacao; a resposta do cliente
        // e que faz avancar.
        return { passoAtual, aguardando };
      }

      passoAtual = resultado.proximo;
    }

    return { passoAtual: null, aguardando: null };
  }

  async executarFluxo(fluxo, conversa, telefone, instanciaId, instanceName, contextoExtra = {}) {
    const passos = this.ordenarPassos(fluxo.passos);
    const contexto = {
      conversa,
      telefone,
      instanciaId,
      instanceName,
      fluxo: { ...fluxo, passos },
      ...contextoExtra,
    };

    const { passoAtual, aguardando } = await this.percorrer(passos[0] || null, contexto);

    await sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: fluxo.id,
      passoAtualId: passoAtual?.id || null,
      aguardando,
      ativo: !!aguardando,
      contexto: { tentativasCnpj: 0 },
    });

    return { fluxoId: fluxo.id, aguardando, concluido: !aguardando };
  }

  // ------------------------------------------------------ continuar sessao --

  async continuarSessao(sessao, ctx, textoEntrada) {
    const { conversa, telefone, instanciaId, instanceName } = ctx;
    const fluxo = await fluxoRepository.findById(sessao.fluxoAtualId);

    if (!fluxo || !fluxo.ativo) {
      // Fluxo apagado ou desativado no meio do atendimento.
      const fluxos = await fluxoRepository.findAtivos();
      return this.enviarMenu(ctx, fluxos, mensagens.menuCabecalho);
    }

    const passos = this.ordenarPassos(fluxo.passos);
    const contexto = {
      ...ctx,
      fluxo: { ...fluxo, passos },
    };

    let passoAtual = sessao.passoAtualId
      ? passos.find((p) => p.id === sessao.passoAtualId)
      : passos[0];

    if (sessao.aguardando === AGUARDANDO.CNPJ) {
      const cnpjValidacao = await this.validarCnpjRecebido(conversa, textoEntrada);

      if (!cnpjValidacao.valido) {
        const tentativas = (sessao.contexto?.tentativasCnpj || 0) + 1;

        if (tentativas >= limites.maxTentativasCnpj) {
          await this.enviarBot(
            conversa.id,
            telefone,
            "Nao consegui validar o CNPJ informado.",
            instanceName
          );
          return this.transferirParaHumano(ctx, { motivo: "cnpj_invalido" });
        }

        const restantes = limites.maxTentativasCnpj - tentativas;
        await this.enviarBot(
          conversa.id,
          telefone,
          `${mensagens.cnpjInvalido}\n(Voce ainda tem ${restantes} tentativa${restantes > 1 ? "s" : ""}, ou digite *atendente*.)`,
          instanceName
        );

        await sessaoRepository.update(sessao.id, {
          contexto: { ...(sessao.contexto || {}), tentativasCnpj: tentativas },
        });

        return { conversaId: conversa.id, aguardando: AGUARDANDO.CNPJ };
      }

      await this.enviarBot(conversa.id, telefone, cnpjValidacao.mensagem, instanceName);

      contexto.cnpjValidacao = cnpjValidacao;
      contexto.conversa = await conversaRepository.findById(conversa.id);

      // O passo que pediu o CNPJ ja cumpriu seu papel; segue para o proximo.
      if (passoAtual) {
        passoAtual = this.proximoPasso(passos, passoAtual);
      }
    }

    const resultado = await this.percorrer(passoAtual, contexto);

    await sessaoRepository.update(sessao.id, {
      passoAtualId: resultado.passoAtual?.id || null,
      aguardando: resultado.aguardando,
      ativo: !!resultado.aguardando,
      contexto: { ...(sessao.contexto || {}), tentativasCnpj: 0 },
    });

    return {
      fluxoId: fluxo.id,
      aguardando: resultado.aguardando,
      concluido: !resultado.aguardando,
    };
  }

  // ------------------------------------------------------------- entrada ---

  async processarMensagemEntrada(params) {
    const chave = `${params.instanciaId}:${params.telefone}`;
    // Serializa mensagens do mesmo cliente: webhooks chegam em paralelo.
    return comLock(chave, () => this._processarMensagemEntrada(params));
  }

  async _processarMensagemEntrada({
    instanciaId,
    instanceName,
    telefone,
    texto,
    nomeCliente = "Cliente",
    waMessageId = null,
  }) {
    const textoLimpo = this.extrairTextoMensagem(texto);
    if (!textoLimpo) return { processado: false, motivo: "mensagem_vazia" };

    // A Evolution API reentrega webhooks; sem isso a mesma mensagem rodava o
    // fluxo duas vezes e o cliente recebia tudo duplicado.
    if (waMessageId && (await conversaRepository.existeMensagemWa(waMessageId))) {
      return { processado: false, motivo: "mensagem_duplicada" };
    }

    let conversa = await conversaRepository.findByTelefone(instanciaId, telefone);
    if (!conversa) {
      conversa = await conversaRepository.create({
        instanciaId,
        cliente: nomeCliente,
        telefone,
        statusAtendimento: "aguardando",
        lido: false,
        mensagens: {
          create: { origem: "cliente", texto: textoLimpo, waMessageId },
        },
      });
      conversa = await conversaRepository.findById(conversa.id);
    } else {
      await conversaRepository.addMensagem(
        conversa.id,
        "cliente",
        textoLimpo,
        null,
        waMessageId
      );
      conversa = await conversaRepository.findById(conversa.id);
    }

    // Atendente humano assumiu: o bot nao interfere.
    if (conversa.statusAtendimento === "em_atendimento") {
      return { processado: false, motivo: "atendimento_humano", conversaId: conversa.id };
    }

    let sessao = await sessaoRepository.findByTelefone(instanciaId, telefone);
    if (sessao && this.sessaoExpirada(sessao)) {
      await sessaoRepository.update(sessao.id, {
        ativo: false,
        aguardando: null,
        passoAtualId: null,
        contexto: {},
      });
      logger.info("Sessao do chatbot expirada", { conversaId: conversa.id, telefone });
      sessao = null;
    }

    const ctx = {
      conversa,
      telefone,
      instanciaId,
      instanceName,
      contexto: sessao?.contexto || {},
    };

    try {
      const comando = this.detectarComando(textoLimpo);

      if (comando === "atendente") {
        return await this.transferirParaHumano(ctx, { motivo: "pedido_do_cliente" });
      }

      if (comando === "sair") {
        return await this.encerrarSessao(ctx);
      }

      if (comando === "menu") {
        const fluxos = await fluxoRepository.findAtivos();
        ctx.contexto = { ...ctx.contexto, tentativasMenu: 0 };
        return await this.enviarMenu(ctx, fluxos, mensagens.menuCabecalho);
      }

      // Transferida para humano e ainda ninguem assumiu: o bot so registra.
      if (sessao?.ativo && sessao.aguardando === AGUARDANDO.HUMANO) {
        return {
          processado: false,
          motivo: "aguardando_atendente",
          conversaId: conversa.id,
        };
      }

      // Sessao esperando escolha do menu.
      if (sessao?.ativo && sessao.aguardando === AGUARDANDO.MENU) {
        const opcoes = sessao.contexto?.menuOpcoes || [];
        const fluxoId = this.interpretarEscolhaMenu(textoLimpo, opcoes);

        if (fluxoId) {
          const fluxo = await fluxoRepository.findById(fluxoId);
          if (fluxo?.ativo) {
            const result = await this.executarFluxo(
              fluxo,
              conversa,
              telefone,
              instanciaId,
              instanceName
            );
            return { processado: true, conversaId: conversa.id, fluxoId: fluxo.id, ...result };
          }
        }
        // Nao escolheu numero: cai no fluxo normal de gatilho/fallback abaixo.
      }

      // Sessao em andamento dentro de um fluxo.
      if (sessao?.ativo && sessao.fluxoAtualId) {
        const result = await this.continuarSessao(sessao, ctx, textoLimpo);
        return { processado: true, conversaId: conversa.id, ...result };
      }

      const fluxos = await fluxoRepository.findAtivos();
      const fluxo = this.detectarGatilho(textoLimpo, fluxos);

      if (!fluxo) {
        // Antes o bot simplesmente nao respondia nada aqui.
        const tentativas = ctx.contexto?.tentativasMenu || 0;
        if (tentativas >= limites.maxTentativasMenu) {
          return await this.transferirParaHumano(ctx, { motivo: "sem_gatilho" });
        }

        const cabecalho = tentativas > 0 ? mensagens.naoEntendi : mensagens.menuCabecalho;
        const result = await this.enviarMenu(ctx, fluxos, cabecalho);
        return { ...result, motivo: "sem_gatilho" };
      }

      // Cliente ja mandou o CNPJ junto com a primeira mensagem.
      const cnpjNumeros = limparCnpj(textoLimpo);
      let cnpjValidacao = null;
      if (cnpjNumeros.length === 14 && cnpjValido(cnpjNumeros) && !conversa.cnpjVerificado) {
        cnpjValidacao = await this.validarCnpjRecebido(conversa, textoLimpo);
        await this.enviarBot(conversa.id, telefone, cnpjValidacao.mensagem, instanceName);
        conversa = await conversaRepository.findById(conversa.id);
      }

      const result = await this.executarFluxo(
        fluxo,
        conversa,
        telefone,
        instanciaId,
        instanceName,
        { cnpjValidacao }
      );

      return { processado: true, conversaId: conversa.id, fluxoId: fluxo.id, ...result };
    } catch (error) {
      // Qualquer falha inesperada vira handoff em vez de deixar o cliente sem resposta.
      logger.error("Erro ao processar mensagem do chatbot", {
        conversaId: conversa.id,
        telefone,
        message: error.message,
        stack: error.stack,
      });

      await this.enviarBot(conversa.id, telefone, mensagens.erroInterno, instanceName).catch(
        () => {}
      );
      await this.transferirParaHumano(ctx, { avisar: false, motivo: "erro_interno" }).catch(
        () => {}
      );

      return { processado: false, motivo: "erro_interno", conversaId: conversa.id };
    }
  }
}

module.exports = new ChatbotEngine();
