const prisma = require("../../infrastructure/database/prisma.client");
const logger = require("../../config/logger");

// Permissoes de acesso por PERFIL (cargo) a cada MODULO (tela) do painel.
//
// Autoridade: esta matriz vive no banco e e consultada no servidor a cada
// requisicao protegida. O cliente recebe apenas a lista de modulos que PODE ver
// (para esconder o menu) -- ele nunca decide acesso.
//
// Regras invioláveis (defesa em profundidade):
//   - Administrador tem acesso total e NAO e editavel: nunca se tranca fora e
//     nao adianta o cliente mandar outra coisa.
//   - So o Administrador edita a matriz (checado na rota).
//   - Modulo desconhecido -> negado. Perfil desconhecido -> so o padrao.

// Catalogo de modulos. `grupo` define o padrao:
//   B = operacional, liberado para todos os cargos por padrao
//   A = gestao/config, liberado so para Comercial por padrao (Admin sempre tem)
const MODULOS = [
  { chave: "atendimento",   nome: "Central de Atendimento", grupo: "B" },
  { chave: "contatos",      nome: "Contatos",               grupo: "B" },
  { chave: "parceiros",     nome: "Clientes (CNPJ)",        grupo: "B" },
  { chave: "mensagens",     nome: "Mensagens Rápidas",      grupo: "B" },
  { chave: "massa",         nome: "Envio em Massa",         grupo: "B" },
  { chave: "dashboard",     nome: "Visão Geral",            grupo: "A" },
  { chave: "fluxos",        nome: "Fluxo de Automações",    grupo: "A" },
  { chave: "whatsapp",      nome: "Integração WhatsApp",    grupo: "A" },
  { chave: "equipe",        nome: "Gestão da Equipe",       grupo: "A" },
  { chave: "configuracoes", nome: "Configurações",          grupo: "A" },
  { chave: "bugs",          nome: "Relatos de Bugs",        grupo: "A" },
  { chave: "agenda",        nome: "Agenda",                 grupo: "A" },
];

const CHAVES_MODULO = new Set(MODULOS.map((m) => m.chave));
// Perfis editaveis. Administrador de proposito fora: acesso total imutavel.
const CARGOS_EDITAVEIS = ["Financeiro", "Técnico", "Comercial"];
const CHAVE_CONFIG = "permissoes.perfis";

function padraoModulo(cargo, modulo) {
  const def = MODULOS.find((m) => m.chave === modulo);
  if (!def) return false;
  if (def.grupo === "B") return true;
  return cargo === "Comercial"; // grupo A: so Comercial por padrao
}

function matrizPadrao() {
  const out = {};
  for (const cargo of CARGOS_EDITAVEIS) {
    out[cargo] = {};
    for (const m of MODULOS) out[cargo][m.chave] = padraoModulo(cargo, m.chave);
  }
  return out;
}

class PermissaoService {
  constructor() {
    this._cache = null;
  }

  invalidarCache() {
    this._cache = null;
  }

  // Matriz efetiva = padrao com o que estiver salvo por cima. Assim um modulo
  // novo no catalogo ja nasce com o padrao, sem precisar re-salvar.
  async _carregar() {
    if (this._cache) return this._cache;
    const base = matrizPadrao();
    try {
      const linha = await prisma.configuracao.findUnique({ where: { chave: CHAVE_CONFIG } });
      if (linha?.valor) {
        const salvo = JSON.parse(linha.valor);
        for (const cargo of CARGOS_EDITAVEIS) {
          if (!salvo[cargo]) continue;
          for (const m of MODULOS) {
            if (typeof salvo[cargo][m.chave] === "boolean") {
              base[cargo][m.chave] = salvo[cargo][m.chave];
            }
          }
        }
      }
    } catch (e) {
      logger.warn("Falha ao ler permissoes, usando padrao", { message: e.message });
    }
    this._cache = base;
    return base;
  }

  // Um cargo pode acessar um modulo? Administrador sempre; modulo invalido nunca.
  async moduloPermitido(cargo, modulo) {
    if (cargo === "Administrador") return true;
    if (!CHAVES_MODULO.has(modulo)) return false;
    const matriz = await this._carregar();
    return matriz[cargo]?.[modulo] === true;
  }

  // Lista de modulos que o cargo pode ver (para o menu do cliente).
  async modulosDe(cargo) {
    if (cargo === "Administrador") return MODULOS.map((m) => m.chave);
    const matriz = await this._carregar();
    const perfil = matriz[cargo] || {};
    return MODULOS.filter((m) => perfil[m.chave] === true).map((m) => m.chave);
  }

  // Para o editor (admin): catalogo + matriz efetiva atual.
  async paraEditor() {
    const matriz = await this._carregar();
    return {
      modulos: MODULOS.map(({ chave, nome, grupo }) => ({ chave, nome, grupo })),
      cargosEditaveis: CARGOS_EDITAVEIS,
      // Administrador sempre com tudo marcado, so para exibir (nao editavel).
      matriz: {
        Administrador: Object.fromEntries(MODULOS.map((m) => [m.chave, true])),
        ...matriz,
      },
    };
  }

  // Salva SOMENTE o que e valido: perfis editaveis e modulos conhecidos, sempre
  // booleanos. Ignora Administrador e qualquer chave estranha vinda do cliente.
  async salvar(entrada = {}) {
    const limpa = {};
    for (const cargo of CARGOS_EDITAVEIS) {
      limpa[cargo] = {};
      const doInput = entrada?.[cargo] || {};
      for (const m of MODULOS) {
        limpa[cargo][m.chave] =
          typeof doInput[m.chave] === "boolean"
            ? doInput[m.chave]
            : padraoModulo(cargo, m.chave);
      }
    }

    await prisma.configuracao.upsert({
      where: { chave: CHAVE_CONFIG },
      update: { valor: JSON.stringify(limpa) },
      create: { chave: CHAVE_CONFIG, valor: JSON.stringify(limpa) },
    });
    this.invalidarCache();
    logger.info("Permissoes de perfis atualizadas");
    return this.paraEditor();
  }
}

module.exports = new PermissaoService();
module.exports.MODULOS = MODULOS;
module.exports.CARGOS_EDITAVEIS = CARGOS_EDITAVEIS;
