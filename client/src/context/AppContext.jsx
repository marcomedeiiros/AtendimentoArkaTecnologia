/**
 AppContext estado global compartilhado entre todas as rotas.
 Centraliza conversas, fluxos, equipe e parceiros que antes viviam
 dentro do componente App em Home.jsx. Cada rota le/escreve aqui
 via useAppContext(), eliminando prop-drilling e permitindo que
 qualquer pagina acesse o mesmo estado sem re-montar dados
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { EquipeAPI, FluxosAPI, ParceirosAPI, ConversasAPI, WhatsAppAPI } from '../services/api';
import { playPing } from '../utils/sound';
import { mesclarConversa } from '../utils/mesclarConversa';

// NAO existe mais SEED aqui de proposito.
//
// Antes, quando a API falhava, o contexto injetava listas de exemplo com ids
// falsos (e1, f1, c1...). O back-end nao conhece esses ids, entao apagar um
// deles sumia da tela mas nao apagava nada; no F5 o SEED era injetado de novo
// e o item "voltava". Agora, se o back-end estiver fora, as listas ficam
// vazias e `apiOffline` avisa o usuario nada de dados fantasma

const ALERTA_SEM_FLUXO = 'alerta-sem-fluxo';

// Ordena conversas pela mensagem mais recente (desc). Conversas sem mensagem
// caem para o fim.
function tsConversa(c) {
  return c?.ultimaMensagemEm ? new Date(c.ultimaMensagemEm).getTime() : 0;
}
function ordenarConversas(lista) {
  return [...lista].sort((a, b) => tsConversa(b) - tsConversa(a));
}

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
  // Contador que sobe a cada evento de conversa vindo do servidor. Painéis que
  // não vivem do estado de `conversas` (Help Desk, indicadores) observam isto
  // para se recarregarem sozinhos, em vez de cada um abrir o seu próprio
  // polling -- um mecanismo de tempo real só, o SSE, para a aplicação inteira.
  const [sinalConversas,    setSinalConversas]    = useState(0);
  // Idem para a agenda de contatos, que vive dentro das telas que a usam
  // (Contatos e a busca da Central) e não no estado global.
  const [sinalContatos,     setSinalContatos]     = useState(0);
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
      setConversas(ordenarConversas(resolver(co)));

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
      if (Array.isArray(co)) {
        // Passa pela MESMA regra de merge dos outros caminhos. Sem isto, esta
        // releitura (que roda a cada 30s) substituia tudo e desfazia o que ainda
        // nao tinha sido confirmado -- era ela que fazia a mensagem apagada
        // "voltar" alguns segundos depois, e a recem-enviada sumir.
        setConversas(prev => {
          const porId = new Map(prev.map(c => [c.id, c]));
          return ordenarConversas(co.map(c => mesclarConversa(porId.get(c.id), c)));
        });
      }
      setApiOffline(false);
    } catch { /* back-end offline: mantem estado atual */ }
  }, []);

  // Releitura sob demanda da equipe. A Gestao da Equipe chama isto apos aprovar,
  // trocar cargo ou excluir alguem: sem essa releitura, o <select> de cargo
  // (controlado por m.cargo) voltava para o valor antigo e parecia "nao salvar".
  const recarregarEquipe = useCallback(async () => {
    try {
      const eq = await EquipeAPI.listar();
      if (Array.isArray(eq)) setEquipe(eq);
    } catch { /* back-end offline: mantem estado atual */ }
  }, []);

  // Mesma ideia para os clientes (CNPJ): a Central usa esta lista para mostrar
  // a razao social de quem ja se identificou, entao cadastrar/editar um parceiro
  // precisa refletir na hora, sem F5.
  const recarregarParceiros = useCallback(async () => {
    try {
      const pa = await ParceirosAPI.listar();
      if (Array.isArray(pa)) setParceiros(pa);
    } catch { /* back-end offline: mantem estado atual */ }
  }, []);

  // Patch incremental vindo do SSE: substitui/insere/remove uma conversa sem
  // recarregar a lista inteira. O disparo de som/notificacao continua no efeito
  // de msgCountsRef, que reage a qualquer mudanca em `conversas`.
  const aplicarEvento = useCallback((evt) => {
    if (!evt?.type) return;
    // Uma LISTA mudou no servidor (clientes, equipe). O evento traz só o nome do
    // recurso: relemos pela API normal, com as permissões daquele operador
    // aplicadas -- empurrar o conteúdo pelo stream exigiria repetir aqui cada
    // regra de acesso das rotas.
    if (evt.type === 'recurso:update') {
      if (evt.recurso === 'parceiros') recarregarParceiros();
      if (evt.recurso === 'equipe') recarregarEquipe();
      if (evt.recurso === 'contatos') setSinalContatos(n => n + 1);
      return;
    }
    if (evt.type === 'conversa:delete') {
      setConversas(prev => prev.filter(c => c.id !== evt.id));
      setSinalConversas(n => n + 1);
      return;
    }
    if (evt.type === 'conversa:update' && evt.conversa?.id) {
      setSinalConversas(n => n + 1);
      setConversas(prev => {
        const atual = prev.find(c => c.id === evt.conversa.id);
        // Exclusao e MONOTONICA: se uma mensagem ja esta apagada no cliente, um
        // evento SSE mais antigo (sem a exclusao) NAO pode "des-apagar" -- senao
        // a mensagem apagada "volta" na tela (flicker). O soft-delete e permanente
        // no banco, entao manter deletada=true e sempre correto.
        // Regra unica de merge (ver utils/mesclarConversa): exclusao monotonica
        // + mensagens otimistas preservadas. Vale tanto para o SSE quanto para
        // as respostas HTTP, senao um caminho desfaz o que o outro fez.
        const incoming = mesclarConversa(atual, evt.conversa);
        const lista = atual
          ? prev.map(c => (c.id === incoming.id ? incoming : c))
          : [incoming, ...prev];
        return ordenarConversas(lista);
      });
    }
  }, [recarregarParceiros, recarregarEquipe]);

  // Tempo real por SSE do nosso back-end. O EventSource nao envia header
  // Authorization, entao pegamos um ticket de uso unico antes de abrir o stream.
  // Em queda, reconecta com backoff e reconcilia o estado via recarregarConversas.
  useEffect(() => {
    let es = null;
    let reconnectTimer = null;
    let parado = false;

    const agendarReconexao = () => {
      if (parado || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        recarregarConversas();
        conectar();
      }, 5000);
    };

    const conectar = async () => {
      if (parado) return;
      try {
        const resp = await ConversasAPI.streamTicket();
        const ticket = resp?.ticket;
        if (parado || !ticket) return agendarReconexao();
        es = new EventSource(`/api/conversas/stream?ticket=${encodeURIComponent(ticket)}`);
        es.onmessage = (e) => {
          try { aplicarEvento(JSON.parse(e.data)); } catch { /* heartbeat/evento nao-json */ }
        };
        es.onopen = () => setApiOffline(false);
        es.onerror = () => {
          if (es) { es.close(); es = null; }
          agendarReconexao();
        };
      } catch {
        agendarReconexao();
      }
    };

    conectar();
    return () => {
      parado = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, [aplicarEvento, recarregarConversas]);

  // Fallback lento: reconcilia caso algum evento SSE se perca.
  useEffect(() => {
    const id = setInterval(recarregarConversas, 30000);
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
    // Durante o carregamento inicial (tela de loading), o historico de conversas
    // que ja existia ao logar NAO e "mensagem nova". Zeramos a base e saimos sem
    // tocar: sem isto, a primeira leitura das conversas do servidor tratava todo
    // o historico como recem-chegado e o som de notificacao disparava ainda na
    // tela de carregamento. So depois que o painel de atendimento carrega
    // (`carregando` falso) e que uma mensagem de fato nova passa a tocar.
    if (carregando) {
      msgCountsRef.current = null;
      return;
    }

    // SÓ MENSAGEM DO CLIENTE TOCA O SINO.
    //
    // A contagem olha `origem === 'cliente'` (o campo cru do servidor), e não o
    // lado da bolha: a pesquisa de satisfação e os avisos automáticos saem do
    // BOT e não podem soar como se o cliente tivesse escrito. Antes isso
    // dependia de `de !== 'cliente'` funcionar por acaso -- agora é explícito.
    const ehDoCliente = (m) => (m.origem ? m.origem === 'cliente' : m.de === 'cliente');
    const counts = {};
    conversas.forEach(c => {
      counts[c.id] = (c.mensagens || []).filter(ehDoCliente).length;
    });
    const anterior = msgCountsRef.current;
    if (anterior !== null) {
      const novas = [];
      conversas.forEach(c => {
        const antes = anterior[c.id] ?? 0;
        const agora = counts[c.id] ?? 0;
        if (agora > antes) {
          const ultima = [...(c.mensagens || [])].reverse().find(ehDoCliente);
          novas.push({
            id: `${c.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            convId: c.id,
            tipo: 'mensagem',
            cliente: c.cliente,
            fotoUrl: c.fotoUrl || null,
            texto: ultima?.texto || 'Nova mensagem',
            em: Date.now(),
            lida: false
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
  }, [conversas, carregando, removerNotificacao, registrarNoHistorico]);

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
          lida: false
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

  // A presenca da equipe muda sem ninguem clicar em nada: alguem abre o painel
  // e fica online, fecha e some depois da janela. Sem esta releitura, a Gestao
  // da Equipe mostraria para sempre o estado do instante em que a aba abriu.
  useEffect(() => {
    let ativo = true;
    const id = setInterval(async () => {
      try {
        const lista = await EquipeAPI.listar();
        if (ativo && Array.isArray(lista)) setEquipe(lista);
      } catch { /* back-end fora: mantem a ultima lista conhecida */ }
    }, 30000);
    return () => { ativo = false; clearInterval(id); };
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
      equipe,            recarregarEquipe,
      fluxos,            atualizarFluxos,
      parceiros,         atualizarParceiros, recarregarParceiros,
      conversas,         atualizarConversas, recarregarConversas,
      // Pulsos de "algo mudou" para os painéis derivados, vindos do mesmo SSE.
      sinalConversas,   sinalContatos,
      whatsAppConectado, setWhatsAppConectado,
      notificacoes,      removerNotificacao,
      historico,         marcarNotificacoesLidas, limparHistorico,
      apiOffline
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
