import { useState, useEffect } from 'react';

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

function iniciais(nome = '') {
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
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

export default function Avatar({ nome = '', size = 'md', online = null, fotoUrl = null, className = '' }) {
  const cor = corDoNome(nome);
  // Se a foto falhar (URL expirada/sem foto), cai para as iniciais.
  const [erroFoto, setErroFoto] = useState(false);
  useEffect(() => { setErroFoto(false); }, [fotoUrl]);
  const mostrarFoto = fotoUrl && !erroFoto;

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
      ) : (
        <div
          className={`${TAMANHOS[size] || TAMANHOS.md} rounded-full border ${cor.bg} ${cor.ring} ${cor.text} font-bold flex items-center justify-center`}
          title={nome}
        >
          {iniciais(nome)}
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
