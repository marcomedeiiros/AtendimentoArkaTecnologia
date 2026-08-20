const { z } = require("zod");

// O e-mail e normalizado ja no schema, nao no service: ele e chave unica, entao
// "Maria@Arka.com" e "maria@arka.com" precisam colidir no cadastro e casar no
// login. Sem isso da para cadastrar o mesmo endereco duas vezes e depois nao
// conseguir entrar com ele.
const email = z.string().trim().toLowerCase().email("E-mail invalido");

const loginSchema = z.object({
  email,
  senha: z.string().min(6),
});

const cadastroSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome completo"),
  email,
  senha: z.string().min(6, "A senha precisa de pelo menos 6 caracteres"),
  // Auto-cadastro NAO escolhe cargo privilegiado. "Administrador" nunca e um
  // valor aceito aqui: promocao so acontece pela tela de Equipe, por um admin.
  // Camada 1 (aqui): o enum recusa qualquer valor fora destes. Camada 2: o
  // service reforca o padrao mesmo que isto mude.
  cargo: z.enum(["Financeiro", "Técnico", "Comercial"]).optional(),
  // Precisa estar declarado mesmo sendo opcional: o middleware troca req.body
  // pelo resultado do zod, e o zod descarta chave que o schema nao conhece.
  // Fora daqui, o codigo de convite nunca chegaria ao service.
  codigo: z.string().optional(),
});

// Edicao do proprio perfil. So o nome -- nunca cargo/ativo/email (email e chave
// de login; cargo/ativo sao gestao). O id do dono vem do token, nunca do body.
const atualizarPerfilSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome completo").max(120),
});

// Troca da propria senha: exige a senha atual (defesa em profundidade -- um
// token roubado nao troca a senha sem conhecer a atual).
const trocarSenhaSchema = z.object({
  senhaAtual: z.string().min(1, "Informe a senha atual"),
  novaSenha: z.string().min(6, "A nova senha precisa de pelo menos 6 caracteres"),
});

module.exports = { loginSchema, cadastroSchema, atualizarPerfilSchema, trocarSenhaSchema };
