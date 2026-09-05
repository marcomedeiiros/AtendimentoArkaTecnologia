/**
 * TEXTO LEGIVEL DE QUALQUER COISA -- a rede que impede "[object Object]".
 *
 * `new Error(obj)` chama ToString no argumento: um objeto vira literalmente a
 * string "[object Object]", e a partir dai a informacao esta PERDIDA -- nao ha
 * como o middleware, o log ou a tela recuperarem o que era. Foi assim que o
 * painel passou a exibir "Nao foi possivel falar com a Evolution API:
 * [object Object]": a Evolution v2 responde `response.message` como LISTA (as
 * vezes de objetos), a lista foi juntada com `join`, cada objeto virou
 * "[object Object]" e o texto morreu aqui dentro.
 *
 * A correcao de raiz e nesta classe: NENHUM AppError pode carregar uma mensagem
 * que nao seja string util. Quem passar objeto recebe o JSON dele, truncado.
 */
function comoTexto(bruto) {
  if (typeof bruto === "string") return bruto;
  if (bruto == null) return "Erro sem descricao";
  if (typeof bruto === "number" || typeof bruto === "boolean") return String(bruto);
  if (bruto instanceof Error && bruto.message) return bruto.message;
  if (Array.isArray(bruto)) {
    const partes = bruto.map(comoTexto).filter(Boolean);
    if (partes.length) return partes.join("; ");
  }
  try {
    const json = JSON.stringify(bruto);
    if (json && json !== "{}" && json !== "[]") {
      return json.length > 500 ? `${json.slice(0, 500)}...` : json;
    }
  } catch {
    /* referencia circular: cai no texto generico abaixo */
  }
  return "Erro sem descricao";
}

class AppError extends Error {
  /**
   * @param {string} message  texto para o usuario
   * @param {number} statusCode  HTTP a devolver
   * @param {string} code  codigo estavel que a tela pode testar
   * @param {object|null} diagnostico  contexto tecnico (endpoint, HTTP da
   *   origem, corpo da resposta). Vai para o log SEMPRE e para a resposta HTTP
   *   quando presente -- e o que transforma "deu erro" em "deu erro AQUI".
   */
  constructor(message, statusCode = 400, code = "APP_ERROR", diagnostico = null) {
    super(comoTexto(message));
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.diagnostico = diagnostico || null;
  }
}

AppError.comoTexto = comoTexto;

module.exports = AppError;
