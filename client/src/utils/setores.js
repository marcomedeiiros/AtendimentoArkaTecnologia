/**
 * OS SETORES DE ATENDIMENTO -- uma lista só, para as telas não divergirem.
 *
 * Ela vivia dentro de `AtendimentoView`, onde nasceu junto com o modal de
 * iniciar conversa. Quando a lista de Contatos passou a perguntar o setor
 * antes de abrir a conversa, copiá-la seria o começo do problema: são os
 * MESMOS setores, e duas cópias divergem no dia em que alguém adicionar um
 * quinto e esquecer da outra tela.
 *
 * ── OS NOMES PRECISAM BATER CARACTERE POR CARACTERE ───────────────────────
 *
 * O `id` é o valor gravado no banco, e é por ele que o servidor decide quem vê
 * qual conversa (`shared/helpers/setor.helper.js`, `podeAcessarSetor`). Um
 * acento a menos aqui não vira erro em lugar nenhum -- vira conversa invisível
 * para o setor que deveria atendê-la.
 *
 * O quadro de escolha (os quatro cartões) mora em `components/QuadroSetores`:
 * aqui só o dado, porque este arquivo é importado por quem não desenha nada.
 */
export const SETORES_ATENDIMENTO = [
  // 'Geral' e o valor gravado no banco; na tela ele se chama 'Sem Setor',
  // que e o que ele significa: ninguem escolheu setor ainda.
  { id: 'Geral',      label: 'Sem Setor',  desc: 'Ainda sem triagem todo mundo vê.' },
  { id: 'Técnico',    desc: 'Suporte, instalação, defeito.' },
  { id: 'Financeiro', desc: 'Boleto, fatura, cobrança.' },
  { id: 'Comercial',  desc: 'Orçamento, proposta, novo contrato.' },
];
