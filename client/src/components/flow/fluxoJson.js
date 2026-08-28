// Conversao de JSON de fluxo (import/export) do editor visual.
//
// Modulo puro de proposito: nenhuma dependencia de React ou do DOM, para poder
// ser testado e reutilizado fora do componente.
//
// Contrato do back-end (server/src/modules/fluxos/fluxo.dto.js, validado com
// zod): `tipo` precisa estar no enum abaixo, `titulo` nao pode ser vazio e
// `nome`/`gatilho` exigem 2+ caracteres. Um JSON vindo de fora (editado a mao,
// de outra instalacao ou de outro editor) nao tem essa garantia, entao tudo
// passa por normalizacao antes de subir - caso contrario o POST volta 400 sem
// explicacao nenhuma para o usuario.

import { hojeISO } from '../../utils/data';

// 'espera' torna visivel no canvas o relogio do bot (cliente calado / fila
// parada), que antes vivia escondido no config de uma anotacao. Precisa estar
// AQUI: a importacao descarta bloco de tipo desconhecido, entao um tipo novo
// fora desta lista some sem aviso ao importar o JSON.
export const TIPOS_PASSO = ['gatilho', 'mensagem', 'condicao', 'delay', 'acao', 'comentario', 'avaliacao', 'espera'];

// Gatilho curinga: o fluxo abre em qualquer mensagem em vez de esperar uma
// palavra-chave. Espelha o GATILHO_CURINGA do server/src/modules/chatbot.
export const GATILHO_CURINGA = '*';

export function gatilhoValido(gatilho) {
  const g = String(gatilho || '').trim();
  return g === GATILHO_CURINGA || g.length >= 2;
}

const ROTULO_TIPO = {
  gatilho: 'Gatilho',
  mensagem: 'Mensagem',
  condicao: 'Validar CNPJ',
  delay: 'Delay',
  acao: 'Ação ERP',
  comentario: 'Anotação',
  avaliacao: 'Pesquisa de Satisfação',
  espera: 'Espera / Timeout',
};

export function sanitizarPassosImportados(passos) {
  if (!Array.isArray(passos)) return [];
  const num = (...vals) => vals.find(v => typeof v === 'number' && Number.isFinite(v));
  const idsUsados = new Set();
  const limpos = [];

  passos.forEach((p, idx) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return;
    if (!TIPOS_PASSO.includes(p.tipo)) return; // bloco de tipo desconhecido: descarta

    let id = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : `p_${Date.now()}_${idx}`;
    while (idsUsados.has(id)) id = `${id}_${idx}`;
    idsUsados.add(id);

    const passo = {
      id,
      tipo: p.tipo,
      titulo: String(p.titulo ?? '').trim().slice(0, 120) || ROTULO_TIPO[p.tipo],
      desc: String(p.desc ?? p.descricao ?? ''),
      targetId: typeof p.targetId === 'string' && p.targetId.trim() ? p.targetId.trim() : null,
      ordem: idx,
    };
    if (typeof p.texto === 'string') passo.texto = p.texto;
    if (p.config && typeof p.config === 'object' && !Array.isArray(p.config)) passo.config = p.config;

    const x = num(p.x, p.posX); if (x !== undefined) passo.x = x;
    const y = num(p.y, p.posY); if (y !== undefined) passo.y = y;
    const w = num(p.w, p.largura); if (w !== undefined) passo.w = w;
    const h = num(p.h, p.altura); if (h !== undefined) passo.h = h;

    limpos.push(passo);
  });

  // Destino apontando para um bloco descartado viraria fio fantasma no canvas.
  // Vale para a saida principal e para cada ramificacao em config.opcoes.
  const existentes = new Set(limpos.map(p => p.id));
  const valido = (id) => (id && existentes.has(id) ? id : null);

  return limpos.map(p => {
    const limpo = { ...p, targetId: valido(p.targetId) };
    if (Array.isArray(p.config?.opcoes)) {
      limpo.config = {
        ...p.config,
        opcoes: p.config.opcoes
          .filter(op => op && typeof op === 'object')
          .map(op => ({ ...op, targetId: valido(op.targetId) })),
      };
    }
    return limpo;
  });
}

// ── Formato "nodeList / lineList" (editor de chatbot externo) ────────────────
// Estrutura bem diferente da nossa: os blocos ficam em `nodeList`, as ligacoes
// em `lineList`, e cada bloco ramifica por `conditions` - varias saidas, cada
// uma com suas palavras-chave e seu proprio destino. Nosso passo tem UMA saida
// (`targetId`), entao as ramificacoes vao para `config.opcoes`, que e campo
// livre (`Json?` no Prisma, `z.record(z.any())` no DTO): da para importar sem
// migracao de banco e sem perder informacao no caminho de volta.

// `action` das conditions do formato de origem.
const ACAO_CONDICAO = { 0: 'ir', 1: 'transferir', 3: 'encerrar' };

export function ehFormatoNodeList(dados) {
  return !!dados && typeof dados === 'object' && !Array.isArray(dados) && Array.isArray(dados.nodeList);
}

function pxParaNumero(valor) {
  const n = parseFloat(String(valor ?? '').replace('px', ''));
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function tipoDoNodeExterno(node) {
  if (node.type === 'start') return 'gatilho';
  if (node.type === 'configurations') return 'comentario';
  return 'mensagem'; // "node" e "line" viram mensagem com opcoes
}

function mensagemDoNodeExterno(node) {
  return (Array.isArray(node.interactions) ? node.interactions : [])
    .map(i => (i && i.data && typeof i.data.message === 'string' ? i.data.message : ''))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function opcoesDoNodeExterno(node) {
  return (Array.isArray(node.conditions) ? node.conditions : [])
    .map((c, idx) => {
      if (!c || typeof c !== 'object') return null;
      const palavrasChave = (Array.isArray(c.condition) ? c.condition : [])
        .filter(p => typeof p === 'string' && p.trim())
        .map(p => p.trim());
      const acao = ACAO_CONDICAO[c.action] || 'ir';
      const targetId = typeof c.nextStepId === 'string' && c.nextStepId ? c.nextStepId : null;

      // O editor de origem deixa rascunhos: condicao sem palavra-chave, sem
      // destino e sem acao especial nao representa saida nenhuma (e o caso da
      // unica condition do bloco AVULSO).
      if (!palavrasChave.length && !targetId && acao === 'ir') return null;

      const opcao = {
        id: typeof c.id === 'string' && c.id ? c.id : `op_${idx}`,
        ordem: idx,
        // "R" espera o cliente escolher uma das opcoes do menu; "US" segue com
        // qualquer resposta livre.
        esperaEscolha: c.type === 'R',
        rotulo: String(c.value || palavrasChave.join(',')).trim(),
        palavrasChave,
        acao,
        targetId,
      };
      if (c.queueId != null) opcao.filaId = c.queueId;
      if (typeof c.closeTicket === 'string' && c.closeTicket.trim()) {
        opcao.mensagemEncerramento = c.closeTicket.trim();
      }
      return opcao;
    })
    .filter(Boolean);
}

export function converterFluxoNodeList(dados) {
  const externos = (dados.nodeList || []).filter(
    n => n && typeof n === 'object' && typeof n.id === 'string'
  );
  const idsValidos = new Set(externos.map(n => n.id));

  // lineList e complementar, nao redundante: cobre ligacoes que nenhuma
  // condition descreve (start -> primeiro bloco) e por outro lado nao traz
  // algumas que as conditions tem (COMERCIAL -> VENDEDOR). Uniao dos dois.
  const linhas = new Map();
  (Array.isArray(dados.lineList) ? dados.lineList : []).forEach(l => {
    if (!l || typeof l.from !== 'string' || typeof l.to !== 'string') return;
    if (!linhas.has(l.from)) linhas.set(l.from, []);
    linhas.get(l.from).push({ to: l.to, label: typeof l.label === 'string' ? l.label : '' });
  });

  const passos = externos.map((node, idx) => {
    const tipo = tipoDoNodeExterno(node);
    const mensagem = mensagemDoNodeExterno(node);
    const opcoes = opcoesDoNodeExterno(node).filter(o => !o.targetId || idsValidos.has(o.targetId));

    const jaLigados = new Set(opcoes.map(o => o.targetId).filter(Boolean));
    (linhas.get(node.id) || []).forEach((l, i) => {
      if (!idsValidos.has(l.to) || jaLigados.has(l.to)) return;
      jaLigados.add(l.to);
      const palavrasChave = l.label ? l.label.split(',').map(s => s.trim()).filter(Boolean) : [];
      opcoes.push({
        id: `linha_${node.id}_${i}`,
        ordem: opcoes.length,
        esperaEscolha: palavrasChave.length > 0,
        rotulo: l.label,
        palavrasChave,
        acao: 'ir',
        targetId: l.to,
      });
    });

    const config = {};
    if (opcoes.length) config.opcoes = opcoes;
    if (node.variableKey) config.variavel = String(node.variableKey).trim();
    if (node.type) config.tipoOrigem = node.type;
    // Configuracoes globais do bot (fallback de nao-entendi, fora de horario,
    // encerramento automatico) nao tem equivalente no motor local. Guardamos
    // cru para nao perder na reexportacao, mas nada le isso hoje.
    if (node.type === 'configurations' && node.configurations && Object.keys(node.configurations).length) {
      config.configuracoesGlobais = node.configurations;
    }

    return {
      id: node.id,
      tipo,
      titulo: String(node.name || '').trim().slice(0, 120) || `Etapa ${idx + 1}`,
      desc: mensagem || (tipo === 'comentario'
        ? 'Configurações globais do bot (importadas, sem efeito no motor local).'
        : ''),
      texto: mensagem || undefined,
      config: Object.keys(config).length ? config : undefined,
      x: pxParaNumero(node.left),
      y: pxParaNumero(node.top),
      // Saida principal desenhada no canvas: a primeira ramificacao com destino.
      targetId: opcoes.find(o => o.targetId)?.targetId || null,
      ordem: idx,
    };
  });

  const nome = String(dados.name || '').trim();

  // Gatilho: neste formato o fluxo comeca por um bloco `start`, ou seja, abre na
  // primeira mensagem do cliente e nao numa palavra-chave. Isso corresponde ao
  // gatilho curinga "*" do motor. Se o bloco de Configuracoes trouxer uma
  // `keyword`, ela ganha - foi escolha explicita de quem montou o bot.
  const keyword = externos
    .map(n => n.configurations?.keyword?.message)
    .find(m => typeof m === 'string' && m.trim().length >= 2);

  return {
    nomeExplicito: nome.length >= 2,
    nome: nome.length >= 2 ? nome.slice(0, 120) : 'Fluxo Importado',
    gatilho: keyword ? keyword.trim().toLowerCase().slice(0, 120) : GATILHO_CURINGA,
    ativo: true,
    passos,
  };
}

// Aceita os formatos que fazem sentido na pratica: o `nodeList/lineList` acima,
// o objeto exportado por aqui, uma lista de fluxos, `{ fluxos: [...] }` ou
// apenas o array de passos.
export function extrairFluxosImportados(dados) {
  if (ehFormatoNodeList(dados)) {
    const convertido = converterFluxoNodeList(dados);
    return [{ ...convertido, passos: sanitizarPassosImportados(convertido.passos) }];
  }

  let brutos;
  if (Array.isArray(dados)) {
    const primeiro = dados[0];
    const eListaDePassos = primeiro && typeof primeiro === 'object' && 'tipo' in primeiro;
    brutos = eListaDePassos ? [{ passos: dados }] : dados;
  } else if (dados && Array.isArray(dados.fluxos)) {
    brutos = dados.fluxos;
  } else {
    brutos = [dados];
  }

  return brutos
    .filter(f => f && typeof f === 'object' && !Array.isArray(f))
    .map((f, idx) => {
      const nome = String(f.nome ?? '').trim();
      const gatilho = String(f.gatilho ?? '').trim();
      return {
        nomeExplicito: nome.length >= 2,
        nome: nome.length >= 2 ? nome.slice(0, 120) : `Fluxo Importado ${idx + 1}`,
        // `gatilhoValido`, e nao `length >= 2`: o curinga '*' tem UM caractere.
        //
        // A regra duplicada aqui reprovava justamente o gatilho do fluxo de
        // boas-vindas e o trocava por `importado_12345`. O efeito era silencioso
        // e total: reimportar o fluxo da ARKA fazia o bot parar de abrir na
        // primeira mensagem do cliente: ele passava a esperar alguem digitar uma
        // palavra-chave que ninguem conhece. A funcao logo acima ja dizia que
        // '*' vale, e o zod do servidor tambem o aceita por literal.
        gatilho: gatilhoValido(gatilho)
          ? gatilho.slice(0, 120)
          : `importado_${Date.now().toString().slice(-5)}${idx || ''}`,
        ativo: typeof f.ativo === 'boolean' ? f.ativo : true,
        passos: sanitizarPassosImportados(f.passos),
      };
    });
}

export function contarRamificacoes(passos = []) {
  return passos.reduce((total, p) => total + (p.config?.opcoes?.length || 0), 0);
}

export function nomeArquivoFluxo(nome) {
  const slug = String(nome || 'fluxo')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'fluxo';
  return `fluxo-${slug}-${hojeISO()}.json`;
}
