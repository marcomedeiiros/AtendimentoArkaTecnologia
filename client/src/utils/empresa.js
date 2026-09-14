/**
 * De que empresa é o cliente de uma conversa.
 *
 * Mora aqui, e não dentro de uma tela, porque duas telas fazem a mesma
 * pergunta: a conversa (no cabeçalho do atendimento) e a Visão Geral (na
 * coluna Empresa da tabela de feedbacks). Copiar a regra faria as duas
 * envelhecerem separadas -- e a que não fosse corrigida passaria a mostrar
 * outra empresa para o mesmo cliente, sem ninguém desconfiar.
 */
import { limparDocumento } from './documento';

/**
 * Nome da empresa do cliente, para exibição.
 *
 * O CNPJ continua no banco e continua sendo o que liga a conversa à empresa.
 * A razão social vem de dois lugares, nesta ordem: o cadastro vivo em
 * Clientes (CNPJ), para uma edição de nome valer na hora; e `conversa.empresa`,
 * gravada quando o CNPJ foi identificado, que sobrevive mesmo se o parceiro
 * sair do cadastro depois.
 */
export function empresaDaConversa(c, parceiros = []) {
  if (!c?.cnpjVerificado) return null;
  const digitos = limparDocumento(c.cnpj);
  const parceiro = digitos ? parceiros.find(p => limparDocumento(p.cnpj) === digitos) : null;
  return parceiro?.razaoSocial || c.empresa || null;
}

/**
 * O CNPJ que vale para exibir, só quando ele foi de fato verificado.
 *
 * Sem a checagem de `cnpjVerificado` a tela mostraria um documento que o
 * cliente digitou e o sistema recusou -- um número plausível, com cara de
 * confirmado, ligando a avaliação a uma empresa que pode não ser a dele.
 */
export function cnpjDaConversa(c) {
  if (!c?.cnpjVerificado) return '';
  return limparDocumento(c.cnpj);
}
