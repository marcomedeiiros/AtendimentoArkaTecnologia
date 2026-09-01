/**
 * MODO TV -- a fila numa parede, no formato do Painel da Equipe.
 *
 * Antes isto era uma ROTA (`/painel`, "Painel da Equipe") mais um Modo TV
 * separado que projetava a fila em cartoes grandes. Eram duas paredes para a
 * mesma parede, e quem pendurava a TV precisava escolher qual das duas. Agora
 * ha uma: o botao da TV, no cabecalho da Central, abre ESTA tela em cima de
 * tudo.
 *
 * O que ela mostra e UMA pergunta: quem esta esperando, e ha quanto tempo. O
 * podio, o CSAT, a meta do dia e os tempos medios sairam: numa parede eles
 * competiam com a unica informacao daqui que exige acao imediata. Indicador de
 * desempenho e assunto de relatorio (Visao Geral), nao de alarme.
 *
 * ── AS TRES REGRAS QUE DECIDEM ESTE ARQUIVO ────────────────────────────────
 *
 *  1. NINGUEM CLICA. A tela fica numa TV, sem teclado e sem mouse. Nao ha
 *     filtro, aba, tooltip nem ordenacao: tudo que importa esta visivel ao
 *     mesmo tempo, porque nao existe segundo passo. O UNICO controle e o Sair
 *     (e o ESC), que existe para quem abriu o painel num computador.
 *
 *  2. LE-SE A TRES METROS. Numero e o que salta; rotulo e apoio. Por isso os
 *     valores usam tamanhos que pareceriam exagerados num relatorio e os
 *     rotulos ficam pequenos e em caixa alta.
 *
 *  3. A TELA SE ATUALIZA SOZINHA a cada 30 s. Uma TV que mostra dado de ontem
 *     e pior do que uma TV apagada, porque parece atual.
 */
import { useEffect, useState, useCallback } from 'react';
import { Inbox, WifiOff, X, AlertCircle } from 'lucide-react';
import Portal from './Portal';
import { DashboardAPI } from '../services/api';

const ATUALIZAR_MS = 30_000;

// Espera legivel de longe: "18 min", "1 h 07".
const espera = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);

export default function ModoTv({ onFechar }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(false);
  const [agora, setAgora] = useState(new Date());

  const carregar = useCallback(async () => {
    try {
      setDados(await DashboardAPI.painel());
      setErro(false);
    } catch {
      // MANTEM O ULTIMO QUADRO NA TELA. Numa TV, trocar a fila por uma
      // mensagem de erro apaga a informacao de quem esta olhando de longe --
      // e a queda costuma durar segundos. O aviso vai num canto, discreto,
      // e a fila fica ate voltar a ser verdade.
      //
      // Se ainda NAO ha quadro nenhum, o corpo mostra o aviso: sem isto a tela
      // ficaria em "Carregando…" para sempre -- o caso de quem tem a Central
      // mas nao o modulo `dashboard`, que a API barra com 403.
      setErro(true);
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, ATUALIZAR_MS);
    return () => clearInterval(id);
  }, [carregar]);

  // Relogio proprio, mais rapido que a recarga: e ele que faz a espera da fila
  // ANDAR entre uma atualizacao e outra (a conta usa `esperaDesde`, o instante
  // que veio do servidor). Sem isso os minutos ficariam parados por 30 s numa
  // tela cuja unica promessa e mostrar o agora.
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 20_000);
    return () => clearInterval(id);
  }, []);

  // ESC fecha, como em qualquer camada por cima da tela. Quem esta na frente da
  // TV nao usa; quem abriu no computador espera que funcione.
  useEffect(() => {
    const onTecla = (e) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', onTecla);
    return () => window.removeEventListener('keydown', onTecla);
  }, [onFechar]);

  const fila = dados?.fila;

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] bg-grafite-900 flex flex-col gap-4 p-5 xl:p-7 overflow-hidden">
        {/* Cabecalho enxuto: identidade, relogio, aviso de conexao e a saida. */}
        <header className="flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h1 className="font-display font-bold text-white text-2xl xl:text-3xl leading-none truncate">
              Fila de atendimento
            </h1>
            <p className="text-xs text-slate-400 mt-1 truncate">
              atualiza sozinho a cada 30 segundos
            </p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {erro && dados && (
              <span className="flex items-center gap-1.5 text-xs text-espera-400" title="Mostrando o último quadro recebido">
                <WifiOff size={14} /> sem conexão
              </span>
            )}
            <span className="font-display font-bold text-white text-3xl xl:text-4xl tabular-nums leading-none">
              {agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
            {/* O UNICO CONTROLE DA TELA. A TV nao tem mouse, entao ele nunca
                sera usado la -- existe para quem abriu o painel num computador
                e precisa voltar para a Central. */}
            <button
              type="button"
              onClick={onFechar}
              title="Sair do modo TV (ESC)"
              className="px-3 sm:px-4 py-2 rounded-xl bg-grafite-600 hover:bg-grafite-500 text-texto text-sm font-bold flex items-center gap-2 transition-colors shrink-0"
            >
              <X size={18} /> <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </header>

        {/* Primeira carga (ou primeira carga que falhou): a moldura ja esta na
            tela, entao o Sair funciona mesmo quando nao ha dado nenhum. */}
        {!fila ? (
          <div className="flex-1 grid place-items-center text-center">
            {erro ? (
              <div className="max-w-md space-y-2">
                <AlertCircle size={32} className="text-espera-400 mx-auto" />
                <p className="font-display text-lg text-white">Não foi possível carregar a fila</p>
                <p className="text-sm text-slate-400">
                  Tentando de novo a cada 30 segundos. Se não voltar, seu perfil pode não ter
                  acesso ao módulo de indicadores.
                </p>
              </div>
            ) : (
              <p className="font-display text-lg text-slate-500">Carregando o painel…</p>
            )}
          </div>
        ) : (
          /* O painel ocupa a tela inteira e rola POR DENTRO: a tela em si nunca
             rola, porque ninguem vai rolar uma TV. */
          <section className="flex-1 min-h-0 glass-panel border border-linha rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between shrink-0">
              <span className="flex items-center gap-2 text-slate-400">
                <Inbox size={16} />
                <span className="text-[11px] font-bold uppercase tracking-[0.12em]">Aguardando atendimento</span>
              </span>
              <span className="font-display font-bold text-white text-4xl xl:text-5xl leading-none tabular-nums">
                {fila.length}
              </span>
            </div>

            {fila.length === 0 ? (
              <div className="flex-1 grid place-items-center text-center">
                <div>
                  <p className="font-display font-bold text-ativo-400 text-3xl">Fila vazia</p>
                  <p className="text-sm text-slate-400 mt-1">Nenhum cliente esperando.</p>
                </div>
              </div>
            ) : (
              <ul className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-1">
                {fila.map((c) => {
                  const esperaMin = c.esperaDesde
                    ? Math.max(0, Math.round((agora - new Date(c.esperaDesde)) / 60000))
                    : c.esperaMin;
                  // Espera longa muda a cor da linha inteira: e o unico alarme
                  // desta tela, e precisa ser visto sem ninguem procurar.
                  const cor =
                    esperaMin >= 30
                      ? 'border-falha/40 bg-falha/10'
                      : esperaMin >= 15
                        ? 'border-espera/40 bg-espera/10'
                        : 'border-linha bg-grafite-700/50';
                  const corTempo =
                    esperaMin >= 30 ? 'text-falha-400' : esperaMin >= 15 ? 'text-espera-400' : 'text-slate-300';
                  return (
                    <li key={c.id} className={`border rounded-xl px-4 py-3 flex items-center gap-4 ${cor}`}>
                      <div className="flex-1 min-w-0">
                        <p className="font-display font-semibold text-white text-lg xl:text-xl truncate">
                          {c.cliente}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {c.ticket ? `AK${String(c.ticket).padStart(5, '0')} · ` : ''}
                          {c.setor}
                        </p>
                      </div>
                      <span className={`shrink-0 font-display font-bold text-2xl xl:text-3xl tabular-nums ${corTempo}`}>
                        {espera(esperaMin)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </Portal>
  );
}
