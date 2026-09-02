// Correcao de texto (ortografia, acentuacao, pontuacao e concordancia).
//
// Mesma porta da transcricao: API no formato OpenAI (/chat/completions) e a
// MESMA chave (Groq). Quem configurou a transcricao ja tem o corretor
// funcionando -- uma chave, dois recursos, nenhum campo novo para preencher.
//
// ── POR QUE UM MODELO, E NAO UM DICIONARIO ─────────────────────────────────
//
// Corretor de dicionario acerta "concerteza" e erra tudo que importa numa
// conversa de atendimento: acentuacao que muda sentido, concordancia, virgula
// que separa oracao. E, pior, sublinha em vermelho nome de cliente, sigla e
// termo tecnico. O corretor nativo do navegador continua ligado no campo (e de
// graca); ISTO aqui e o passo seguinte, sob demanda, quando a pessoa clica.
//
// ── O QUE ELE NAO PODE FAZER ───────────────────────────────────────────────
//
// Nao reescreve, nao resume, nao "melhora o tom", nao completa frase. O texto
// que sai daqui vai para o campo de mensagem e QUEM ENVIA E O ATENDENTE: ele
// le antes de mandar. Um corretor que muda o sentido do que a pessoa escreveu
// e pior do que erro de digitacao, porque o erro se ve e a troca de sentido
// nao. Por isso `temperature: 0` e as regras explicitas no prompt.
//
// Node 18+ ja traz fetch global, entao nao ha dependencia nova.
const configuracaoService = require("../../modules/configuracoes/configuracao.service");
const AppError = require("../../shared/errors/AppError");

const URL =
  process.env.CORRECAO_URL || "https://api.groq.com/openai/v1/chat/completions";

// MODELO PADRAO: `openai/gpt-oss-20b`.
//
// Os modelos Llama que este projeto usaria por reflexo (llama-3.3-70b-versatile,
// llama-3.1-8b-instant) sairam do plano Developer da Groq e hoje sao Enterprise
// ("Contact Sales") -- apontar para eles daria 404/403 numa conta comum. Os de
// producao acessiveis sao os gpt-oss; o 20b e o mais rapido e o mais barato, e
// corrigir ortografia nao pede o 120b.
//
// Trocavel por env: quando a Groq mexer no catalogo de novo, isto e uma variavel
// e nao um deploy de codigo.
const MODELO = process.env.CORRECAO_MODELO || "openai/gpt-oss-20b";

const MAX_CARACTERES = 4000;

const INSTRUCAO = [
  "Você é um corretor ortográfico e gramatical de português do Brasil.",
  "Corrija APENAS: ortografia, acentuação, pontuação, concordância e uso de maiúsculas.",
  "",
  "NUNCA faça o seguinte:",
  "- mudar o sentido, o tom ou a ordem das ideias;",
  "- reescrever, resumir, expandir ou completar o texto;",
  "- adicionar ou remover informação, saudação ou despedida;",
  "- traduzir, nem responder ao conteúdo da mensagem.",
  "",
  "PRESERVE exatamente como estão:",
  "- quebras de linha e parágrafos;",
  "- emojis;",
  "- a formatação do WhatsApp (*negrito*, _itálico_, ~riscado~, ```mono```);",
  "- links, e-mails, telefones, CNPJ, CPF, números, valores e códigos;",
  "- nomes de pessoas, empresas, produtos e siglas;",
  "- marcadores no formato {{algo}}.",
  "",
  "Se o texto já estiver correto, devolva-o sem nenhuma alteração.",
  "Responda somente com o texto corrigido: sem aspas, sem comentários, sem explicação.",
].join("\n");

// O gpt-oss e um modelo de raciocinio. A Groq devolve o raciocinio em campo
// separado, mas ha versoes que o embutem no conteudo entre <think></think>.
// Tirar isso aqui evita que o rascunho do modelo vaze para a caixa de mensagem
// do atendente -- e, de la, para o cliente.
function limpar(saida) {
  let t = String(saida || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
  // Modelo que "obedece demais" as vezes devolve o texto inteiro entre aspas.
  // So desembrulha quando as aspas cercam TUDO: aspas legitimas no meio da
  // frase (uma citacao do cliente, por exemplo) nao podem ser perdidas.
  if (t.length > 1 && /^["'“](.|\n)*["'”]$/.test(t)) {
    const semAspas = t.slice(1, -1).trim();
    if (semAspas && !/["'“”]/.test(semAspas)) t = semAspas;
  }
  return t;
}

async function corrigir(texto) {
  const original = String(texto || "");
  if (!original.trim()) {
    throw new AppError("Nada para corrigir.", 400, "TEXTO_VAZIO");
  }
  if (original.length > MAX_CARACTERES) {
    throw new AppError(
      `Texto longo demais para corrigir (máximo ${MAX_CARACTERES} caracteres).`,
      400,
      "TEXTO_LONGO"
    );
  }

  const apiKey = await configuracaoService.iaApiKey();
  if (!apiKey) {
    throw new AppError(
      "Corretor não configurado. Adicione a chave (Groq) em Configurações.",
      400,
      "SEM_CHAVE_IA"
    );
  }

  let resp;
  try {
    resp = await fetch(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELO,
        // Zero: a mesma frase tem de sair corrigida igual nas duas vezes que a
        // pessoa clicar. Criatividade aqui e defeito.
        temperature: 0,
        // Teto generoso sobre a entrada: texto corrigido tem tamanho parecido
        // com o original, e um corte no meio devolveria mensagem truncada.
        max_completion_tokens: 2048,
        // Modelo de raciocinio: corrigir virgula nao precisa de deliberacao, e
        // "low" e o que mantem a resposta rapida.
        reasoning_effort: "low",
        messages: [
          { role: "system", content: INSTRUCAO },
          { role: "user", content: original },
        ],
      }),
    });
  } catch (e) {
    throw new AppError(`Falha de rede no corretor: ${e.message}`, 502, "CORRECAO_REDE");
  }

  if (!resp.ok) {
    const corpo = await resp.text().catch(() => "");
    // O corpo da Groq vem junto de proposito: e ele que diz "modelo
    // desativado", "chave invalida" ou "limite excedido". Sem isso, todo
    // problema de configuracao viraria o mesmo "falhou" na tela.
    throw new AppError(
      `Correção falhou (${resp.status}). ${corpo.slice(0, 200)}`,
      502,
      "CORRECAO_ERRO"
    );
  }

  const data = await resp.json().catch(() => ({}));
  const corrigido = limpar(data?.choices?.[0]?.message?.content);
  if (!corrigido) {
    throw new AppError("O corretor não devolveu texto.", 502, "CORRECAO_VAZIA");
  }

  return { texto: corrigido, alterado: corrigido !== original.trim() };
}

module.exports = { corrigir, MAX_CARACTERES };
