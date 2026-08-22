const { z } = require("zod");

// Criar workflow: nome opcional (o handler cai para "Novo fluxo" se faltar).
const criarWorkflowSchema = z.object({
  nome: z.string().min(1).max(120).optional(),
});

// Renomear: nome obrigatorio.
const renomearWorkflowSchema = z.object({
  nome: z.string().min(1, "Informe o nome").max(120),
});

// Ativar/desativar: booleano de verdade (nao "true"/"false" como string).
const alternarAtivoSchema = z.object({
  ativo: z.boolean(),
});

// Executar: payload livre repassado ao n8n. So garantimos que o corpo e um
// objeto; o conteudo do payload em si e responsabilidade do fluxo de destino.
const executarWorkflowSchema = z.object({
  payload: z.unknown().optional(),
});

module.exports = {
  criarWorkflowSchema,
  renomearWorkflowSchema,
  alternarAtivoSchema,
  executarWorkflowSchema,
};
