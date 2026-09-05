/**
 * LEITURA DO PDF DO RELATORIO -- para o tecnico nao redigitar o que ja escreveu.
 *
 * ── O PROBLEMA QUE ISTO RESOLVE ────────────────────────────────────────────
 *
 * O formulario de "Novo mapeamento" pedia empresa, data, resumo e oito campos
 * de checklist. Tudo isso ja esta DENTRO do PDF que o tecnico acabou de montar
 * e mandar para o cliente. Preencher de novo e transcrever o proprio trabalho,
 * e o efeito pratico era gente deixando os campos em branco -- o que derrubava
 * a completude e fazia a pontuacao medir preenchimento de formulario em vez de
 * qualidade de visita.
 *
 * Agora o PDF e a fonte. O que se le dele vira sugestao na tela, SEMPRE
 * editavel, e vira a base da avaliacao.
 *
 * ── POR QUE SUGESTAO, E NAO VERDADE ────────────────────────────────────────
 *
 * A leitura depende do layout do documento, que e feito por fora deste sistema
 * e pode mudar amanha sem ninguem avisar. Entao nada aqui pode ser tratado como
 * certo: tudo que sai daqui chega a tela como campo preenchido que a pessoa
 * confere e corrige. Um extrator que "sabe" o nome da empresa e que erra em
 * silencio e pior do que um campo vazio.
 *
 * Por isso, tambem, cada achado vem com o TEXTO DE ONDE saiu (`origem`): quando
 * a leitura errar, da para ver o que ela leu, em vez de adivinhar.
 */
const { PDFParse } = require("pdf-parse");
const midiaStorage = require("../../infrastructure/storage/midia.storage");
const { ITENS_MAPEAMENTO } = require("./pontuacao.externa");
const logger = require("../../config/logger");

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// Acento fora, minusculas: o PDF escreve "TÉCNICO RESPONSÁVEL" em caixa alta e
// o texto corrido escreve "tecnico responsavel". Comparar cru erraria os dois.
const chave = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * O VALOR QUE VEM DEPOIS DE UM ROTULO.
 *
 * O extrator de texto entrega o PDF linha a linha, e neste layout o rotulo fica
 * numa linha ("CLIENTE") e o valor na seguinte ("PERSPECTIVA"). Tambem aceita
 * "CLIENTE: PERSPECTIVA" na mesma linha, que e como outros geradores escrevem.
 *
 * Pula linha vazia entre os dois, e PARA no primeiro rotulo conhecido: sem esse
 * freio, um rotulo sem valor engoliria o titulo da secao seguinte como se fosse
 * a resposta.
 */
function valorDoRotulo(linhas, rotulos, outrosRotulos = []) {
  const alvos = rotulos.map(chave);
  const barreiras = outrosRotulos.map(chave);
  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i];
    const k = chave(linha);
    const alvo = alvos.find((a) => k === a || k.startsWith(`${a}:`) || k.startsWith(`${a} :`));
    if (!alvo) continue;

    // Mesma linha, depois dos dois pontos.
    const doisPontos = linha.indexOf(":");
    if (doisPontos >= 0 && linha.slice(doisPontos + 1).trim()) {
      return { valor: linha.slice(doisPontos + 1).trim(), origem: linha.trim() };
    }
    // Proxima linha util.
    for (let j = i + 1; j < Math.min(i + 4, linhas.length); j += 1) {
      const seguinte = linhas[j].trim();
      if (!seguinte) continue;
      if (barreiras.some((b) => chave(seguinte) === b)) break;
      return { valor: seguinte, origem: `${linha.trim()} → ${seguinte}` };
    }
  }
  return null;
}

/**
 * A DATA DA VISITA.
 *
 * ── O QUE ESTE PDF NAO TEM ─────────────────────────────────────────────────
 *
 * O relatorio de exemplo escreve "Setembro / 2026": MES e ANO, sem dia. E o
 * mes e justamente o que importa para o ranking (e ele que decide em qual
 * competencia o trabalho conta), entao a leitura vale a pena mesmo incompleta.
 *
 * Sem o dia, assume o DIA 1 e diz isso (`diaPresumido`), para a tela poder
 * avisar em vez de fingir precisao que o documento nao tem. Nunca chuta o dia
 * de hoje: uma visita de setembro registrada em outubro cairia no mes errado.
 */
function dataDaVisita(linhas, texto) {
  const achado = valorDoRotulo(
    linhas,
    ["data do atendimento", "data da visita", "data"],
    ["cliente", "tecnico responsavel", "empresa prestadora"]
  );
  const candidatos = [achado?.valor, texto].filter(Boolean);

  for (const bruto of candidatos) {
    // 05/09/2026 ou 05-09-2026
    const completa = /(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{4})/.exec(bruto);
    if (completa) {
      const [, d, m, a] = completa;
      if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) {
        return { iso: `${a}-${String(+m).padStart(2, "0")}-${String(+d).padStart(2, "0")}`, diaPresumido: false, origem: achado?.origem || completa[0] };
      }
    }
    // "Setembro / 2026", "setembro de 2026"
    const porExtenso = new RegExp(`(${MESES.join("|")})\\s*(?:/|de)?\\s*(\\d{4})`, "i").exec(chave(bruto).replace(/marco/g, "março"));
    if (porExtenso) {
      const mes = MESES.indexOf(chave(porExtenso[1]).replace("marco", "março")) + 1;
      if (mes > 0) {
        return { iso: `${porExtenso[2]}-${String(mes).padStart(2, "0")}-01`, diaPresumido: true, origem: achado?.origem || porExtenso[0] };
      }
    }
    // "09/2026"
    const mesAno = /\b(0[1-9]|1[0-2])\s*\/\s*(\d{4})\b/.exec(bruto);
    if (mesAno) {
      return { iso: `${mesAno[2]}-${mesAno[1]}-01`, diaPresumido: true, origem: achado?.origem || mesAno[0] };
    }
  }
  return null;
}

/**
 * QUANTAS FOTOS O RELATORIO TRAZ.
 *
 * Conta as LEGENDAS ("Foto 01 - ...", "Imagem 2"), e nao as imagens embutidas
 * do arquivo: logotipo, icone e linha decorativa tambem sao imagens, e contar
 * tudo daria evidencia de graca para um relatorio sem foto nenhuma.
 *
 * Legenda numerada e o que uma foto de campo tem e um enfeite nao tem.
 */
function contarFotos(texto) {
  const marcas = texto.match(/\b(foto|imagem|registro fotografico)\s*n?º?\s*\d+/gi) || [];
  const unicas = new Set(marcas.map((m) => chave(m).replace(/\s+/g, " ")));
  return unicas.size;
}

/**
 * O QUE O RELATORIO COBRE, item a item do checklist.
 *
 * A COMPLETUDE PASSA A SAIR DAQUI, e nao de oito caixas de texto preenchidas a
 * mao. A regra continua a mesma do ranking (`ITENS_MAPEAMENTO`); o que muda e
 * de onde vem a resposta -- do documento que o cliente recebeu, em vez de um
 * formulario paralelo que ninguem le depois.
 *
 * Cada item e dado por coberto quando o texto traz alguma das palavras dele.
 * E uma leitura GROSSA, e assumidamente: ela responde "o relatorio fala disso?",
 * que e a pergunta que a parcela sempre fez. Julgar a qualidade do que esta
 * escrito e trabalho do supervisor, que aprova ou devolve.
 */
// AS CHAVES SAO AS DE `ITENS_MAPEAMENTO`, e nao nomes parecidos.
//
// Errei isso na primeira versao ("links" e "sistemas" em vez de "internet" e
// "softwares") e o efeito foi silencioso do jeito ruim: os dois itens ficavam
// SEMPRE em branco, a completude nascia menor para todo mundo, e nada acusava.
// A checagem logo abaixo existe para que isso nao volte calado.
const PALAVRAS = {
  infraestrutura: ["rack", "switch", "roteador", "cabeamento", "rede", "patch", "nobreak", "regua", "energia", "eletric"],
  servidores: ["servidor", "estacao", "desktop", "computador", "optiplex", "workstation", "maquina"],
  backup: ["backup", "retencao", "restore", "copia de seguranca", "nuvem", "cloud"],
  seguranca: ["antivirus", "firewall", "seguranca", "endpoint", "senha", "acesso"],
  internet: ["link", "provedor", "operadora", "vivo", "claro", "internet", "fibra", "modem", "onu", "datacom"],
  telefonia: ["telefonia", "ramal", "pabx", "voip", "sip", "aligera", "siemens"],
  softwares: ["sistema", "licenca", "software", "erp", "office", "windows"],
  riscos: ["risco", "pendencia", "manutencao", "trocar", "substituir", "desgaste", "critico", "urgente", "preventiva"],
};

// Falha ALTO, no carregamento do modulo: um item do checklist sem palavras
// nunca seria dado como coberto, e um erro de digitacao aqui viraria pontuacao
// menor para a equipe inteira sem nenhum sintoma.
for (const item of ITENS_MAPEAMENTO) {
  if (!PALAVRAS[item.chave]?.length) {
    throw new Error(`analise.relatorio: faltam palavras para o item "${item.chave}" do checklist`);
  }
}

function coberturaDoTexto(texto) {
  const t = chave(texto);
  const out = {};
  for (const item of ITENS_MAPEAMENTO) {
    const palavras = PALAVRAS[item.chave] || [];
    const achadas = palavras.filter((p) => t.includes(chave(p)));
    out[item.chave] = { coberto: achadas.length > 0, palavras: achadas.slice(0, 4) };
  }
  return out;
}

/**
 * LE O PDF e devolve o que der para aproveitar.
 *
 * NUNCA LANCA por causa do conteudo: um PDF ilegivel, protegido por senha, ou
 * gerado por uma ferramenta que so grava imagem nao pode impedir o tecnico de
 * registrar a visita. Devolve `{ lido: false, motivo }` e a tela cai no
 * preenchimento manual -- o relatorio e a entrega, a leitura e a conveniencia.
 */
async function analisarRelatorio(caminhoRelativo) {
  const aberto = await midiaStorage.abrirParaLeitura(caminhoRelativo);
  if (!aberto) return { lido: false, motivo: "Arquivo não encontrado no servidor." };

  const pedacos = [];
  for await (const p of aberto.stream) pedacos.push(p);
  const buffer = Buffer.concat(pedacos);

  let texto = "";
  let paginas = 0;
  const leitor = new PDFParse({ data: buffer });
  try {
    const r = await leitor.getText();
    texto = r?.text || "";
    paginas = r?.pages?.length || 0;
  } catch (e) {
    logger.warn("Nao foi possivel ler o PDF do relatorio", { message: e.message });
    return { lido: false, motivo: "Não foi possível ler o texto deste PDF." };
  } finally {
    await leitor.destroy?.().catch(() => {});
  }

  // PDF so de imagem (digitalizado): tem paginas e nao tem texto. Vale dizer
  // isso em vez de devolver tudo vazio como se o documento fosse ruim.
  if (texto.trim().length < 40) {
    return {
      lido: false,
      paginas,
      motivo: "Este PDF não tem texto — parece ser um documento digitalizado (só imagem).",
    };
  }

  const linhas = texto.split("\n").map((l) => l.replace(/\s+/g, " ").trim());

  const ROTULOS = ["cliente", "data do atendimento", "tecnico responsavel", "empresa prestadora"];
  const empresa = valorDoRotulo(linhas, ["cliente", "empresa visitada", "empresa"], ROTULOS);
  const tecnico = valorDoRotulo(linhas, ["tecnico responsavel", "tecnico"], ROTULOS);
  const data = dataDaVisita(linhas, texto);
  const cobertura = coberturaDoTexto(texto);
  const fotos = contarFotos(texto);

  return {
    lido: true,
    paginas,
    // `null` quando nao achou -- e a tela pede o campo, em vez de inventar.
    empresa: empresa?.valor?.slice(0, 160) || null,
    empresaOrigem: empresa?.origem || null,
    tecnico: tecnico?.valor?.slice(0, 160) || null,
    dataVisita: data?.iso || null,
    dataDiaPresumido: !!data?.diaPresumido,
    dataOrigem: data?.origem || null,
    fotos,
    cobertura,
    itensCobertos: Object.values(cobertura).filter((c) => c.coberto).length,
    totalItens: ITENS_MAPEAMENTO.length,
    caracteres: texto.length,
  };
}

module.exports = { analisarRelatorio, contarFotos, coberturaDoTexto, dataDaVisita, valorDoRotulo };
