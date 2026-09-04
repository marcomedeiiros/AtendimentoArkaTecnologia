import { useState, useEffect } from 'react';
import { User } from 'lucide-react';

// Paleta de cores para avatares gerados a partir do nome (sem foto real).
// Tons que combinam com o tema escuro do painel.
const CORES = [
  { bg: 'bg-acao/20',  ring: 'border-acao/40',  text: 'text-acao-200' },
  { bg: 'bg-blue-500/20',    ring: 'border-blue-500/40',    text: 'text-blue-300' },
  { bg: 'bg-ativo/20', ring: 'border-ativo/40', text: 'text-ativo-400' },
  { bg: 'bg-purple-500/20',  ring: 'border-purple-500/40',  text: 'text-purple-300' },
  { bg: 'bg-pink-500/20',    ring: 'border-pink-500/40',    text: 'text-pink-300' },
  { bg: 'bg-espera/20',   ring: 'border-espera/40',   text: 'text-espera-400' },
  { bg: 'bg-cyan-500/20',    ring: 'border-cyan-500/40',    text: 'text-cyan-300' },
];

/**
 * Iniciais do nome -- e por que `Array.from` no lugar de `[0]`.
 *
 * Um nome como "Miguel 🎮🎮" quebrava a tela: `partes[ultima][0]` pega o
 * primeiro CODE UNIT do emoji, que e METADE de um par surrogate. O navegador
 * nao tem como desenhar meio caractere e mostra o quadradinho de glifo
 * invalido -- foi o "M?" que apareceu no avatar.
 *
 * `Array.from` percorre por code point (o emoji inteiro conta como um), e o
 * filtro descarta o que nao e letra nem numero: emoji, pontuacao e simbolo nao
 * viram inicial de ninguem. Sobrando nada aproveitavel, devolve `null` -- e
 * quem chama decide o que desenhar no lugar.
 */
function iniciais(nome = '') {
  const letras = (s) => Array.from(String(s)).filter((c) => /[\p{L}\p{N}]/u.test(c));
  const partes = String(nome).trim().split(/\s+/).map(letras).filter((a) => a.length > 0);
  if (partes.length === 0) return null;
  if (partes.length === 1) return partes[0].slice(0, 2).join('').toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Um "nome" que na verdade e o telefone: contato que ainda nao foi salvo. A
// Central usa o proprio numero como rotulo nesse caso, e iniciais de numero
// ("55", "27") nao identificam ninguem.
function pareceTelefone(nome = '') {
  const s = String(nome).trim();
  return s.length >= 8 && /^[\d\s()+-]+$/.test(s);
}

function corDoNome(nome = '') {
  let hash = 0;
  for (let i = 0; i < nome.length; i++) hash = nome.charCodeAt(i) + ((hash << 5) - hash);
  return CORES[Math.abs(hash) % CORES.length];
}

const TAMANHOS = {
  sm: 'w-8 h-8 text-[11px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-12 h-12 text-sm',
  // Retrato do painel de perfil. Existe porque ali a foto e o ASSUNTO da tela,
  // nao um adorno ao lado de um nome -- no `lg` (48px) nao da para reconhecer
  // ninguem, que e justamente para o que a pessoa abriu o perfil.
  xl: 'w-24 h-24 text-2xl',
};

/**
 * @param {boolean} contato  Este avatar representa um CLIENTE (quem escreve
 *   para o numero), e nao alguem da equipe.
 *
 *   A distincao existe porque as duas metades precisam de coisas opostas.
 *   Da equipe somos nos: sao poucas pessoas, os nomes estao todos salvos, e as
 *   iniciais coloridas sao o que deixa reconhecer quem atendeu num relance --
 *   no ranking da TV, "DC / LU / RA" com a cor da medalha e o proprio desenho
 *   da tela. Trocar isso por tres bonecos iguais nao informaria nada.
 *
 *   Do cliente nao sabemos quase nada. Sem foto e sem contato salvo, o rotulo
 *   e o proprio telefone, e a inicial vira "55" ou "27" -- um par de digitos
 *   que nao identifica pessoa nenhuma e ainda finge que identifica. Ai o
 *   boneco cinza do WhatsApp e mais honesto: diz "nao ha foto", e pronto.
 */
export default function Avatar({
  nome = '', size = 'md', online = null, fotoUrl = null, className = '', contato = false,
}) {
  const cor = corDoNome(nome);
  // Se a foto falhar (URL expirada/sem foto), cai para as iniciais.
  const [erroFoto, setErroFoto] = useState(false);
  useEffect(() => { setErroFoto(false); }, [fotoUrl]);
  const mostrarFoto = fotoUrl && !erroFoto;

  const letras = iniciais(nome);
  // O BONECO ENTRA EM TRES SITUACOES, e as tres sao "nao ha o que mostrar":
  //   - e cliente e nao tem foto (o caso do pedido);
  //   - o nome e na verdade o telefone (contato nao salvo);
  //   - nao sobrou letra nenhuma do nome (so emoji, so pontuacao).
  const semRosto = !mostrarFoto && (contato || pareceTelefone(nome) || !letras);

  return (
    <div className={`relative shrink-0 ${className}`}>
      {mostrarFoto ? (
        <img
          src={fotoUrl}
          alt={nome}
          title={nome}
          onError={() => setErroFoto(true)}
          className={`${TAMANHOS[size] || TAMANHOS.md} rounded-full border ${cor.ring} object-cover`}
        />
      ) : semRosto ? (
        // Cinza neutro de proposito: colorir por nome faria o boneco parecer
        // identificar a pessoa, que e exatamente o que ele NAO faz. Tokens de
        // tema (e nao cinza literal) para nao virar mancha escura no tema claro.
        <div
          className={`${TAMANHOS[size] || TAMANHOS.md} rounded-full border border-linha-forte bg-grafite-600 text-texto-suave flex items-center justify-center`}
          title={nome}
        >
          <User className="w-[58%] h-[58%]" strokeWidth={2} aria-hidden="true" />
        </div>
      ) : (
        <div
          className={`${TAMANHOS[size] || TAMANHOS.md} rounded-full border ${cor.bg} ${cor.ring} ${cor.text} font-bold flex items-center justify-center`}
          title={nome}
        >
          {letras}
        </div>
      )}
      {online !== null && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-grafite-700 ${
            online ? 'bg-ativo-400' : 'bg-slate-500'
          }`}
        />
      )}
    </div>
  );
}
