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
const logger = require("../../config/logger");
const env = require("../../config/env");

class ChatbotEngine {
  normalizarTexto(texto) {
    return String(texto || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  extrairTextoMensagem(texto) {
    return String(texto || "").trim();
  }

  detectarGatilho(texto, fluxos) {
    const normalizado = this.normalizarTexto(texto);
    return fluxos.find((f) => normalizado.includes(this.normalizarTexto(f.gatilho)));
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

  async registrarLog(instanciaId, fluxoId, passo, conversaId, mensagem, sucesso, inicio) {
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
      ? `CNPJ ${mascararCnpj(cnpjLimpo)} validado! Razao Social: ${parceiro.razaoSocial} Parceiro com Contrato Ativo.`
      : `CNPJ ${mascararCnpj(cnpjLimpo)} consultado. Nao possui contrato de parceiro ativo.`;

    return { valido: true, cnpj: cnpjLimpo, parceiro, mensagem: msg };
  }

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
        const texto = passo.texto || passo.descricao || passo.titulo;
        resposta = `[${passo.titulo}]: ${texto}`;
        if (passo.descricao?.toLowerCase().includes("cnpj")) {
          aguardando = "cnpj";
        }
        proximo = this.proximoPasso(fluxo.passos, passo);
        break;
      }

      case "condicao": {
        const cnpjCtx = contexto.cnpjValidacao;
        if (cnpjCtx?.valido) {
          resposta = `[${passo.titulo}]: ${cnpjCtx.mensagem}`;
          proximo = this.proximoPasso(fluxo.passos, passo);
        } else {
          aguardando = "cnpj";
          resposta = "[Arka Tecnologia]: Por favor, informe um CNPJ valido para continuarmos.";
        }
        break;
      }

      case "delay": {
        const ms = passo.config?.ms || 1000;
        await sleep(ms);
        proximo = this.proximoPasso(fluxo.passos, passo);
        break;
      }

      case "acao": {
        const acao = passo.config?.acao;
        const cnpj = conversa.cnpj || contexto.cnpjValidacao?.cnpj;
        const parceiro = cnpj
          ? await parceiroRepository.findAtivoByCnpj(cnpj)
          : null;

        if (acao === "desconto_parceiro") {
          const percentual = passo.config?.percentual || 15;
          if (parceiro) {
            const result = await mockErp.aplicarDescontoParceiro({
              cnpj,
              razaoSocial: parceiro.razaoSocial,
              percentual,
            });
            resposta = `[${passo.titulo}]: ${result.mensagem}`;
          } else {
            resposta = `[${passo.titulo}]: Desconto de parceiro nao aplicavel CNPJ sem contrato ativo.`;
          }
        } else if (acao === "gerar_boleto") {
          const result = await mockErp.gerarBoleto({
            cnpj,
            razaoSocial: parceiro?.razaoSocial,
          });
          resposta = `[${passo.titulo}]: ${result.mensagem}\nLinha digitavel: ${result.linhaDigitavel}\nPIX: ${result.pixCopiaCola}\nVencimento: ${result.vencimento}`;
        } else {
          resposta = `[${passo.titulo}]: ${passo.descricao || "Acao executada."}`;
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

    await this.registrarLog(
      instanciaId,
      fluxo.id,
      passo,
      conversa.id,
      resposta,
      true,
      inicio
    );

    return { proximo, aguardando };
  }

  async executarFluxo(fluxo, conversa, telefone, instanciaId, instanceName, contextoExtra = {}) {
    const passos = this.ordenarPassos(fluxo.passos);
    let passoAtual = passos[0] || null;
    let aguardando = null;
    let contexto = { conversa, telefone, instanciaId, fluxo, instanceName, ...contextoExtra };

    while (passoAtual) {
      const resultado = await this.executarPasso(passoAtual, contexto);
      aguardando = resultado.aguardando;
      passoAtual = resultado.proximo;

      if (aguardando) break;
    }

    await sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: fluxo.id,
      passoAtualId: passoAtual?.id || null,
      aguardando,
      ativo: !!passoAtual || !!aguardando,
      contexto: contextoExtra,
    });

    return { fluxoId: fluxo.id, aguardando, concluido: !passoAtual && !aguardando };
  }

  async continuarSessao(sessao, conversa, telefone, instanciaId, instanceName, textoEntrada) {
    const fluxo = await fluxoRepository.findById(sessao.fluxoAtualId);
    if (!fluxo) return null;

    const passos = this.ordenarPassos(fluxo.passos);
    let contexto = {
      conversa,
      telefone,
      instanciaId,
      fluxo,
      instanceName,
    };

    if (sessao.aguardando === "cnpj") {
      const cnpjValidacao = await this.validarCnpjRecebido(conversa, textoEntrada);
      if (!cnpjValidacao.valido) {
        await this.enviarBot(
          conversa.id,
          telefone,
          "[Arka Tecnologia]: CNPJ invalido. Informe os 14 digitos corretamente.",
          instanceName
        );
        return { aguardando: "cnpj" };
      }

      await this.enviarBot(
        conversa.id,
        telefone,
        `[Validacao Automatica Arka]: ${cnpjValidacao.mensagem}`,
        instanceName
      );

      contexto.cnpjValidacao = cnpjValidacao;
      conversa = await conversaRepository.findById(conversa.id);
      contexto.conversa = conversa;
    }

    let passoAtual = sessao.passoAtualId
      ? passos.find((p) => p.id === sessao.passoAtualId)
      : passos[0];

    if (sessao.aguardando === "cnpj" && passoAtual) {
      passoAtual = this.proximoPasso(passos, passoAtual) || passoAtual;
    }

    let aguardando = null;
    while (passoAtual) {
      const resultado = await this.executarPasso(passoAtual, contexto);
      aguardando = resultado.aguardando;
      passoAtual = resultado.proximo;
      if (aguardando) break;
    }

    await sessaoRepository.update(sessao.id, {
      passoAtualId: passoAtual?.id || null,
      aguardando,
      ativo: !!passoAtual || !!aguardando,
    });

    return { fluxoId: fluxo.id, aguardando, concluido: !passoAtual && !aguardando };
  }

  async processarMensagemEntrada({
    instanciaId,
    instanceName,
    telefone,
    texto,
    nomeCliente = "Cliente",
  }) {
    const textoLimpo = this.extrairTextoMensagem(texto);
    if (!textoLimpo) return { processado: false, motivo: "mensagem_vazia" };

    let conversa = await conversaRepository.findByTelefone(instanciaId, telefone);
    if (!conversa) {
      conversa = await conversaRepository.create({
        instanciaId,
        cliente: nomeCliente,
        telefone,
        statusAtendimento: "aguardando",
        lido: false,
        mensagens: {
          create: { origem: "cliente", texto: textoLimpo },
        },
      });
    } else {
      await conversaRepository.addMensagem(conversa.id, "cliente", textoLimpo);
      conversa = await conversaRepository.findById(conversa.id);
    }

    if (conversa.statusAtendimento === "em_atendimento") {
      return { processado: false, motivo: "atendimento_humano", conversaId: conversa.id };
    }

    const sessao = await sessaoRepository.findByTelefone(instanciaId, telefone);
    if (sessao?.ativo && (sessao.aguardando || sessao.fluxoAtualId)) {
      const result = await this.continuarSessao(
        sessao,
        conversa,
        telefone,
        instanciaId,
        instanceName,
        textoLimpo
      );
      return { processado: true, conversaId: conversa.id, ...result };
    }

    const fluxos = await fluxoRepository.findAtivos();
    const fluxo = this.detectarGatilho(textoLimpo, fluxos);
    if (!fluxo) {
      return { processado: false, motivo: "sem_gatilho", conversaId: conversa.id };
    }

    const cnpjNumeros = limparCnpj(textoLimpo);
    let cnpjValidacao = null;
    if (cnpjNumeros.length === 14 && cnpjValido(cnpjNumeros) && !conversa.cnpjVerificado) {
      cnpjValidacao = await this.validarCnpjRecebido(conversa, textoLimpo);
      await this.enviarBot(
        conversa.id,
        telefone,
        `[Validacao Automatica Arka]: ${cnpjValidacao.mensagem}`,
        instanceName
      );
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
  }
}

module.exports = new ChatbotEngine();
