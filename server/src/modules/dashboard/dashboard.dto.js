/**
 * Validacao na BORDA da configuracao do painel/ranking da sede.
 *
 * ── POR QUE ESTE ARQUIVO PASSOU A EXISTIR ──────────────────────────────────
 *
 * `PUT /api/dashboard/regras` era a UNICA rota de escrita do ranking sem
 * validacao na borda. A irma dela (`PUT /api/rankings/configuracao`) sempre
 * teve o Zod; esta ia com o corpo cru para tres gravadores diferentes --
 * `painelService.salvarRegras`, `ciclo.salvar` e `premiados.salvar` --, cada um
 * validando por conta propria.
 *
 * Os tres validam bem, e por isso nao havia caminho conhecido para gravar valor
 * invalido. O que faltava era a PRIMEIRA camada da defesa em profundidade que o
 * resto do sistema aplica, e ela nao e estilo: `ciclo` e `premiados` eram
 * gravados a partir de `req.body.ciclo` e `req.body.premiados` sem que a borda
 * declarasse a forma desses dois objetos. Um campo novo entraria amanha sem
 * ninguem notar a ausencia. (auditoria-tela-rankings-10-09.md, achado 8)
 *
 * ── O QUE ESTA AQUI, E O QUE FICA NO SERVICO ───────────────────────────────
 *
 * Aqui: a FORMA -- que chaves existem, de que tipo, em que faixa grosseira.
 *
 * No servico: a REGRA. `sede.regras` recusa regua toda zero (\`REGUA_TODA_ZERO\`),
 * `ciclo.salvar` carimba a vigencia com o relogio do servidor e `premiados`
 * apara pelo teto do podio. Nenhum dos dois confia no outro: o servico e
 * chamado de mais de um caminho, e a rota pode ganhar um verbo novo amanha.
 *
 * ── E O QUE O ZOD DESCARTA DE PROPOSITO ────────────────────────────────────
 *
 * O formulario devolve o objeto do ciclo INTEIRO, do jeito que o recebeu --
 * incluindo `vigencias` e `vigenteDesde`. Eles nao estao declarados aqui, e
 * `z.object` DESCARTA chave desconhecida em vez de recusar o pedido: assim a
 * tela continua podendo mandar o que leu, e a lista de vigencias nunca chega ao
 * servico. Quem decide de quando a regra vale e o servidor (ver `ciclo.salvar`),
 * e a borda passou a ser a primeira barreira disso -- e nao a unica.
 */
const { z } = require("zod");
const { MAXIMO: MAXIMO_PREMIADOS } = require("../rankings/premiados");

// Tudo opcional: a tela pode salvar so o campo que mexeu, e o que nao veio
// mantem o valor atual. Isto vale para os tres blocos.
const regrasSedeSchema = z.object({
  // Quanto vale cada unidade. O teto de 1000 e folgado de proposito -- a escala
  // e livre desde que a pontuacao perdeu o teto --, e o minimo e 0 para poder
  // DESLIGAR uma parcela. Tudo zero e recusado no servico, que e onde essa
  // regra pode ser explicada com uma frase.
  unidades: z
    .object({
      atendimento: z.number().int().min(0).max(1000).optional(),
      estrela: z.number().int().min(0).max(1000).optional(),
    })
    .optional(),
  minimoAvaliacoes: z.number().int().min(1).max(20).optional(),
  // O CICLO. `dia` vai a 31: o dia que nao existe no mes cai no ultimo dia dele
  // (ver `shared/helpers/calendario`). `vigenciaDesde`/`vigencias` NAO entram --
  // ver o bloco no topo.
  ciclo: z
    .object({
      dia: z.number().int().min(1).max(31).optional(),
      hora: z.number().int().min(0).max(23).optional(),
      minuto: z.number().int().min(0).max(59).optional(),
    })
    .optional(),
  // Quantos sobem ao podio, por competicao. O teto vem de `premiados.MAXIMO`, e
  // nao repetido aqui. `0` e `null` sao os sinais de "voltar ao padrao" que a
  // tela manda quando o campo fica vazio -- por isso o minimo e 0, e nao 1.
  premiados: z
    .object({
      sede: z.number().int().min(0).max(MAXIMO_PREMIADOS).nullable().optional(),
      externo: z.number().int().min(0).max(MAXIMO_PREMIADOS).nullable().optional(),
    })
    .optional(),
});

module.exports = { regrasSedeSchema };
