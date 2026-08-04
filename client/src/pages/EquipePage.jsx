/**
 * Gestao da Equipe.
 *
 * Nao ha nada para cadastrar aqui: a equipe E quem tem conta no painel. Entrar
 * na lista significa criar conta em /cadastrar, e sair dela significa perder o
 * acesso. Antes esta tela mantinha uma lista propria, digitada a mao, que nao
 * tinha ligacao nenhuma com quem realmente entrava no sistema -- dava para
 * "adicionar" alguem que nunca conseguiria atender, e o online/offline era um
 * botao que a propria pessoa virava.
 *
 * O status agora e observado, nao declarado: vem do ultimo acesso registrado
 * pelo servidor a cada requisicao autenticada.
 */
import { useState, useEffect } from 'react';
import { Users, Circle, ShieldCheck } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import Avatar from '../components/Avatar';

// "há 3 min", "há 2 h", "ontem". Recebe ISO; null vira "nunca entrou".
function vistoEm(iso) {
  if (!iso) return 'nunca entrou';
  const seg = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 60) return 'agora há pouco';
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

export default function EquipePage() {
  const { equipe } = useAppContext();
  const { usuario } = useAuth();

  // O "visto há X" envelhece sozinho na tela; sem este tique ele congelaria no
  // valor que tinha quando a pagina montou.
  const [, forcarRedesenho] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forcarRedesenho(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const online = equipe.filter(m => m.status === 'online').length;

  return (
    <div className="fade-in space-y-6">
      <div className="mb-8 flex flex-col gap-4 border-b border-linha pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Gestão da Equipe</h1>
          <p className="mt-1 text-xs text-texto-suave sm:text-sm">
            Quem tem conta no painel da Arka Tecnologia. Novos operadores entram criando conta em{' '}
            <span className="font-mono text-acao-200">/cadastrar</span>.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-xs">
          <span className="flex items-center gap-2 text-texto-suave">
            <Users size={14} /> {equipe.length} {equipe.length === 1 ? 'conta' : 'contas'}
          </span>
          <span className="flex items-center gap-2 text-ativo-400">
            <Circle size={8} fill="currentColor" /> {online} online
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {equipe.map(m => {
          const ehVoce = m.id === usuario?.id;
          return (
            <div
              key={m.id}
              // `ring` e nao `border`: .glass-panel define a borda pelo atalho
              // `border:`, que sobrescreve qualquer border-color vindo do
              // Tailwind. O anel fica por fora e nao entra nessa disputa.
              className={`glass-panel space-y-3 rounded-2xl p-4 ${
                m.status === 'online' ? 'ring-1 ring-ativo/40' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                {/* `online` desenha a bolinha de presenca no proprio avatar */}
                <Avatar nome={m.nome} size="md" online={m.status === 'online'} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-bold text-white">{m.nome}</span>
                    {ehVoce && (
                      <span className="shrink-0 rounded-md bg-acao/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-acao-200">
                        você
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11px] text-texto-suave">{m.email}</div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-linha pt-3">
                <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-texto-suave">
                  <ShieldCheck size={12} className="shrink-0 text-texto-fraco" />
                  <span className="truncate">{m.cargo}</span>
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1.5 text-[11px] font-semibold ${
                    m.status === 'online' ? 'text-ativo-400' : 'text-texto-fraco'
                  }`}
                  title={m.status === 'online' ? 'Com o painel aberto agora' : `Último acesso ${vistoEm(m.ultimoAcessoEm)}`}
                >
                  <Circle size={7} fill="currentColor" />
                  {m.status === 'online' ? 'Online' : vistoEm(m.ultimoAcessoEm)}
                </span>
              </div>
            </div>
          );
        })}

        {equipe.length === 0 && (
          <div className="glass-panel col-span-full rounded-2xl border border-linha py-12 text-center text-xs text-texto-suave">
            Nenhuma conta ainda.
          </div>
        )}
      </div>
    </div>
  );
}
