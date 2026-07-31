const configuracaoService = require("../../modules/configuracoes/configuracao.service");
const logger = require("../../config/logger");
const AppError = require("../../shared/errors/AppError");

// Cliente da API publica do n8n (v1). Autentica com o header X-N8N-API-KEY,
// gerado em Settings > API dentro do proprio n8n.
class N8nClient {
  async _config() {
    return configuracaoService.n8n();
  }

  async request(method, path, body) {
    const { url, apiKey } = await this._config();
    if (!url) {
      throw new AppError("URL do n8n nao configurada", 400, "N8N_NOT_CONFIGURED");
    }

    try {
      const response = await fetch(`${url}/api/v1${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-N8N-API-KEY": apiKey || "",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const texto = await response.text();
      const dados = texto ? JSON.parse(texto) : null;

      if (!response.ok) {
        logger.warn("n8n erro", { status: response.status, dados });
        throw new AppError(
          dados?.message || `n8n respondeu ${response.status}`,
          response.status === 401 ? 401 : 502,
          response.status === 401 ? "N8N_UNAUTHORIZED" : "N8N_ERROR"
        );
      }

      return dados;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("n8n indisponivel", { message: error.message });
      throw new AppError(
        "n8n indisponivel. Verifique a URL em Configuracoes.",
        503,
        "N8N_UNAVAILABLE"
      );
    }
  }

  // ---------------------------------------------------------- workflows ---

  async listarWorkflows() {
    const dados = await this.request("GET", "/workflows?limit=250");
    return dados?.data || [];
  }

  async obterWorkflow(id) {
    return this.request("GET", `/workflows/${id}`);
  }

  async criarWorkflow({ name, nodes = [], connections = {}, settings = {} }) {
    return this.request("POST", "/workflows", {
      name,
      // O n8n exige nodes/connections mesmo num workflow vazio.
      nodes: nodes.length ? nodes : [],
      connections,
      settings: { executionOrder: "v1", ...settings },
    });
  }

  async atualizarWorkflow(id, dados) {
    return this.request("PUT", `/workflows/${id}`, dados);
  }

  async ativarWorkflow(id) {
    return this.request("POST", `/workflows/${id}/activate`);
  }

  async desativarWorkflow(id) {
    return this.request("POST", `/workflows/${id}/deactivate`);
  }

  async excluirWorkflow(id) {
    return this.request("DELETE", `/workflows/${id}`);
  }

  // --------------------------------------------------------- execucoes ---

  async listarExecucoes({ workflowId, limit = 100 } = {}) {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (workflowId) qs.set("workflowId", String(workflowId));
    const dados = await this.request("GET", `/executions?${qs.toString()}`);
    return dados?.data || [];
  }

  // A API publica do n8n nao expoe "executar agora". O caminho suportado e o
  // webhook do proprio workflow -- por isso disparamos a URL de teste/producao.
  async executarViaWebhook(caminhoWebhook, payload = {}) {
    const { url } = await this._config();
    const alvo = `${url}/webhook/${String(caminhoWebhook).replace(/^\//, "")}`;
    const resp = await fetch(alvo, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const texto = await resp.text();
    if (!resp.ok) {
      throw new AppError(
        `Webhook do n8n respondeu ${resp.status}. Confirme se o workflow esta ativo.`,
        502,
        "N8N_WEBHOOK_ERROR"
      );
    }
    try { return JSON.parse(texto); } catch { return { resposta: texto }; }
  }

  // Encaminha a mensagem recebida do cliente para o webhook do n8n, que decide
  // e responde. Best-effort: uma falha aqui nao pode derrubar o webhook da
  // Evolution -- a conversa ja foi registrada e aparece na Central de qualquer
  // forma, para o atendente humano assumir.
  async encaminharMensagem(payload) {
    const { webhookFluxo } = await this._config();
    if (!webhookFluxo) {
      return { encaminhado: false, motivo: "webhook_do_n8n_nao_configurado" };
    }

    try {
      const resp = await fetch(webhookFluxo, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        logger.warn("n8n recusou a mensagem encaminhada", { status: resp.status });
        return { encaminhado: false, motivo: `n8n_respondeu_${resp.status}` };
      }
      return { encaminhado: true };
    } catch (error) {
      logger.warn("Falha ao encaminhar mensagem ao n8n", { message: error.message });
      return { encaminhado: false, motivo: "n8n_inacessivel" };
    }
  }

  // Ping de conexao: /workflows exige credencial valida, entao serve de teste.
  async testarConexao() {
    const inicio = Date.now();
    const dados = await this.request("GET", "/workflows?limit=1");
    return {
      conectado: true,
      latenciaMs: Date.now() - inicio,
      totalWorkflowsVisiveis: dados?.data?.length ?? 0,
    };
  }
}

module.exports = new N8nClient();
