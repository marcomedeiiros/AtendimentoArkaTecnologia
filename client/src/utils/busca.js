/**
 * Regras de busca compartilhadas pela lista de Contatos e pela Central de
 * Atendimento -- as duas telas precisam achar a MESMA pessoa com o MESMO texto
 * digitado. Enquanto cada tela tinha o seu jeitinho, procurar "João" na Central
 * nao achava quem estava salvo em Contatos.
 */

// Ignora acento e caixa: "joao" acha "João", "SILVA" acha "Silva".
export function normalizarBusca(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

// Telefone comparavel: so digitos e sem o DDI 55. A agenda importada do
// WhatsApp grava 5527999990000, mas na busca ninguem digita o 55 -- sem tirar o
// DDI dos dois lados, procurar o proprio numero do contato nao achava nada.
export function telefoneComparavel(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length > 11 && d.startsWith('55') ? d.slice(2) : d;
}

/**
 * Um contato bate com a busca? Cobre exatamente o que o campo promete:
 * nome, WhatsApp, empresa ou e-mail.
 */
export function contatoCombina(contato, termo) {
  const q = normalizarBusca(termo);
  if (!q) return false;
  const qTel = telefoneComparavel(termo);
  return (
    normalizarBusca(contato?.nome).includes(q) ||
    normalizarBusca(contato?.empresa).includes(q) ||
    normalizarBusca(contato?.email).includes(q) ||
    (!!qTel && telefoneComparavel(contato?.telefone).includes(qTel))
  );
}
