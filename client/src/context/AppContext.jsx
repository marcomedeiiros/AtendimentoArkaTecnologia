/**
 AppContext estado global compartilhado entre todas as rotas.
 Centraliza conversas, fluxos, equipe e parceiros que antes viviam
 dentro do componente App em Home.jsx. Cada rota le/escreve aqui
 via useAppContext(), eliminando prop-drilling e permitindo que
 qualquer pagina acesse o mesmo estado sem re-montar dados
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { EquipeAPI, FluxosAPI, ParceirosAPI, ConversasAPI, WhatsAppAPI } from '../services/api';
import { playPing } from '../utils/sound';

// NAO existe mais SEED aqui de proposito.
//
// Antes, quando a API falhava, o contexto injetava listas de exemplo com ids
// falsos (e1, f1, c1...). O back-end nao conhece esses ids, entao apagar um
// deles sumia da tela mas nao apagava nada; no F5 o SEED era injetado de novo
// e o item "voltava". Agora, se o back-end estiver fora, as listas ficam
// vazias e `apiOffline` avisa o usuario nada de dados fantasma

const ALERTA_SEM_FLUXO = 'alerta-sem-fluxo';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [carregando,        setCarregando]        = useState(true);
  const [equipe,            setEquipe]            = useState([]);
  const [fluxos,            setFluxos]            = useState([]);
  const [parceiros,         setParceiros]         = useState([]);
  const [conversas,         setConversas]         = useState([]);
  const [whatsAppConectado, setWhatsAppConectado] = useState(false);
  const [notificacoes,      setNotificacoes]      = useState([]);
  const [historico,         setHistorico]         = useState([]);
  const [apiOffline,        setApiOffline]        = useState(false);
  const msgCountsRef = useRef(null);

  const carregarDadosDoServidor = useCallback(async () => {
    setCarregando(true);
    try {
      const [eq, fl, pa, co] = await Promise.allSettled([
        EquipeAPI.listar(),
        FluxosAPI.listar(),
        ParceirosAPI.listar(),
        ConversasAPI.listar(),
      ]);

      // Lista vazia vinda da API e um resultado legitimo: significa que o
      // usuario apagou tudo. Nunca substituimos por dados de exemplo.
      const resolver = (res) =>
        res.status === 'fulfilled' && Array.isArray(res.value) ? res.value : [];

      setEquipe(resolver(eq));
      setFluxos(resolver(fl));
      setParceiros(resolver(pa));
      setConversas(resolver(co));

      setApiOffline([eq, fl, pa, co].every(r => r.status === 'rejected'));
    } catch {
      setEquipe([]);
      setFluxos([]);
      setParceiros([]);
      setConversas([]);
      setApiOffline(true);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarDadosDoServidor();
  }, [carregarDadosDoServidor]);

  // Recarrega as conversas periodicamente para refletir novas mensagens que
  // chegam pelo WhatsApp (webhook) sem precisar de F5. So substitui o estado
  // se a API responder; se falhar, mantem o que ja esta em tela.
  const recarregarConversas = useCallback(async () => {
    try {
      const co = await ConversasAPI.listar();
      if (Array.isArray(co)) setConversas(co);
      setApiOffline(false);
    } catch { /* back-end offline: mantem estado atual */ }
  }, []);

  useEffect(() => {
    const id = setInterval(recarregarConversas, 8000);
    return () => clearInterval(id);
  }, [recarregarConversas]);

  const removerNotificacao = useCallback((id) => {
    setNotificacoes(prev => prev.filter(n => n.id !== id));
  }, []);

  // Historico do sino: diferente dos toasts, NAO some sozinho. Guarda as
  // ultimas 30 notificacoes para o pop-up do sino listar.
  const registrarNoHistorico = useCallback((itens) => {
    setHistorico(prev => [...itens, ...prev].slice(0, 30));
  }, []);

  const marcarNotificacoesLidas = useCallback(() => {
    setHistorico(prev => prev.map(n => ({ ...n, lida: true })));
  }, []);

  const limparHistorico = useCallback(() => setHistorico([]), []);

  useEffect(() => {
    const counts = {};
    conversas.forEach(c => {
      counts[c.id] = (c.mensagens || []).filter(m => m.de === 'cliente').length;
    });
    const anterior = msgCountsRef.current;
    if (anterior !== null) {
      const novas = [];
      conversas.forEach(c => {
        const antes = anterior[c.id] ?? 0;
        const agora = counts[c.id] ?? 0;
        if (agora > antes) {
          const ultima = [...(c.mensagens || [])].reverse().find(m => m.de === 'cliente');
          novas.push({
            id: `${c.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            convId: c.id,
            tipo: 'mensagem',
            cliente: c.cliente,
            texto: ultima?.texto || 'Nova mensagem',
            em: Date.now(),
            lida: false,
          });
        }
      });
      if (novas.length > 0) {
        playPing();
        setNotificacoes(prev => [...novas, ...prev].slice(0, 5));
        registrarNoHistorico(novas);
        novas.forEach(n => setTimeout(() => removerNotificacao(n.id), 7000));
      }
    }
    msgCountsRef.current = counts;
  }, [conversas, removerNotificacao, registrarNoHistorico]);

  const fluxosAtivos = fluxos.filter(f => f.ativo).length;
  useEffect(() => {
    if (carregando) return;
    setHistorico(prev => {
      const semFluxo = prev.find(n => n.id === ALERTA_SEM_FLUXO);
      if (fluxosAtivos === 0) {
        if (semFluxo) return prev;
        return [{
          id: ALERTA_SEM_FLUXO,
          tipo: 'alerta',
          cliente: 'Automação desativada',
          texto: 'Nenhum fluxo ativo o bot não vai responder sozinho. Crie ou ative um fluxo em Fluxo de Automações.',
          em: Date.now(),
          lida: false,
        }, ...prev].slice(0, 30);
      }
      return semFluxo ? prev.filter(n => n.id !== ALERTA_SEM_FLUXO) : prev;
    });
  }, [fluxosAtivos, carregando]);

  useEffect(() => {
    let ativo = true;
    const checar = async () => {
      try {
        const st = await WhatsAppAPI.status();
        if (ativo && st) setWhatsAppConectado(!!st.conectado);
      } catch { /* Evolution offline: mantem desconectado */ }
    };
    checar();
    const id = setInterval(checar, 10000);
    return () => { ativo = false; clearInterval(id); };
  }, []);

  const atualizarEquipe = useCallback(async (nova) => {
    setEquipe(nova);
  }, []);

  const atualizarFluxos = useCallback(async (novo) => {
    setFluxos(novo);
  }, []);

  const atualizarParceiros = useCallback(async (nova) => {
    setParceiros(nova);
  }, []);

  const atualizarConversas = useCallback((novaOuFn) => {
    if (typeof novaOuFn === 'function') {
      setConversas(prev => novaOuFn(prev));
    } else {
      setConversas(novaOuFn);
    }
  }, []);

  return (
    <AppContext.Provider value={{
      carregando,
      recargarDados: carregarDadosDoServidor,
      equipe,            atualizarEquipe,
      fluxos,            atualizarFluxos,
      parceiros,         atualizarParceiros,
      conversas,         atualizarConversas,
      whatsAppConectado, setWhatsAppConectado,
      notificacoes,      removerNotificacao,
      historico,         marcarNotificacoesLidas, limparHistorico,
      apiOffline,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext deve ser usado dentro de <AppProvider>');
  return ctx;
}
