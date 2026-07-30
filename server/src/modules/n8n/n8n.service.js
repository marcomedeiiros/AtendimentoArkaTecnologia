const n8nClient = require("../../infrastructure/external/n8n.client");

// Encontra o caminho do webhook num workflow (para "executar agora").
function caminhoWebhook(workflow) {
  const node = (workflow?.nodes || []).find((n) =>
    String(n.type || "").includes("webhook")
  );
  return node?.parameters?.path || null;
}

function mediaMs(lista) {
  const validos = lista.filter((n) => Number.isFinite(n) && n >= 0);
  if (!validos.length) return null;
  return Math.round(validos.reduce((a, b) => a + b, 0) / validos.length);
}

class N8nService {
  async testarConexao() {
    return n8nClient.testarConexao();
  }

  // Lista os workflows ja cruzados com as metricas de execucao.
  async listarWorkflows() {
    const [workflows, execucoes] = await Promise.all([
      n8nClient.listarWorkflows(),
      n8nClient.listarExecucoes({ limit: 250 }).catch(() => []),
    ]);

    const porWorkflow = new Map();
    for (const ex of execucoes) {
      const id = String(ex.workflowId ?? ex.workflowData?.id ?? "");
      if (!id) continue;
      if (!porWorkflow.has(id)) porWorkflow.set(id, []);
      porWorkflow.get(id).push(ex);
    }

    return workflows.map((w) => {
      const lista = (porWorkflow.get(String(w.id)) || []).sort(
        (a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0)
      );
      const ultima = lista[0] || null;
      const duracoes = lista
        .filter((e) => e.startedAt && e.stoppedAt)
        .map((e) => new Date(e.stoppedAt) - new Date(e.startedAt));

      return {
        id: w.id,
        nome: w.name,
        ativo: !!w.active,
        status: w.active ? "Ativo" : "Inativo",
        criadoEm: w.createdAt || null,
        atualizadoEm: w.updatedAt || null,
        webhookPath: caminhoWebhook(w),
        // A API publica do n8n nao expoe o proximo disparo agendado; quando o
        // workflow tem um trigger de schedule informamos a expressao.
        proximaExecucao:
          (w.nodes || []).find((n) => String(n.type || "").includes("scheduleTrigger"))
            ?.parameters?.rule?.interval?.[0]?.expression || null,
        execucoes: lista.length,
        ultimaExecucao: ultima
          ? {
              em: ultima.startedAt || null,
              status: ultima.status || (ultima.finished ? "success" : "unknown"),
            }
          : null,
        tempoMedioMs: mediaMs(duracoes),
      };
    });
  }

  async criar(nome) {
    return n8nClient.criarWorkflow({ name: nome });
  }

  async renomear(id, nome) {
    const atual = await n8nClient.obterWorkflow(id);
    return n8nClient.atualizarWorkflow(id, {
      name: nome,
      nodes: atual.nodes || [],
      connections: atual.connections || {},
      settings: atual.settings || { executionOrder: "v1" },
    });
  }

  async alternarAtivo(id, ativo) {
    return ativo ? n8nClient.ativarWorkflow(id) : n8nClient.desativarWorkflow(id);
  }

  async excluir(id) {
    await n8nClient.excluirWorkflow(id);
    return { id, excluido: true };
  }

  async executar(id, payload = {}) {
    const workflow = await n8nClient.obterWorkflow(id);
    const caminho = caminhoWebhook(workflow);
    if (!caminho) {
      // Sem trigger de webhook nao ha como disparar pela API publica.
      const erro = new Error(
        "Este workflow nao possui um nó de Webhook. Adicione um Webhook Trigger no n8n para permitir execucao manual."
      );
      erro.statusCode = 400;
      throw erro;
    }
    const resposta = await n8nClient.executarViaWebhook(caminho, payload);
    return { id, executado: true, resposta };
  }
}

module.exports = new N8nService();
