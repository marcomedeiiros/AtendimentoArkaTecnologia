/**
 * EM QUAIS RANKINGS UMA PESSOA CONCORRE -- lido da sessão.
 *
 * O servidor guarda isso como texto separado por vírgula ("sede,externo"), na
 * mesma forma dos setores extras. Aqui ele é lido em UM lugar só porque mais de
 * uma tela decide coisas a partir dele: a barra lateral esconde "Relatórios" de
 * quem não visita cliente, e a própria tela de Relatórios explica por que está
 * vazia quando alguém chega ali por um link antigo.
 *
 * Duas cópias dessa leitura significariam duas chances de discordarem sobre a
 * mesma pessoa -- e o sintoma seria um menu que mostra uma tela que a tela
 * recusa a abrir.
 *
 * ── ISTO NÃO É AUTORIZAÇÃO ─────────────────────────────────────────────────
 *
 * É organização de menu. Quem decide o que cada um pode ver e fazer com os
 * relatórios é o servidor, que relê o cadastro a cada chamada -- esconder um
 * item nunca foi proteção, e tirar alguém de uma equipe vale na hora lá, sem
 * depender do que a sessão desta aba carrega.
 */
const EQUIPES = ['sede', 'externo'];

export function equipesDoUsuario(usuario) {
  return String(usuario?.equipeRanking || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => EQUIPES.includes(s));
}

export const ehDaEquipeExterna = (usuario) => equipesDoUsuario(usuario).includes('externo');
export const ehDaEquipeSede = (usuario) => equipesDoUsuario(usuario).includes('sede');
