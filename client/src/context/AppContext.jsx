/**
 AppContext estado global compartilhado entre todas as rotas.
 Centraliza conversas, fluxos, equipe e parceiros que antes viviam
 dentro do componente App em Home.jsx. Cada rota le/escreve aqui
 via useAppContext(), eliminando prop-drilling e permitindo que
 qualquer pagina acesse o mesmo estado sem re-montar dados
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { EquipeAPI, FluxosAPI, ParceirosAPI, ConversasAPI, WhatsAppAPI, AuthAPI } from '../services/api';
import { tocarSomMonitoramento, tocarSomMensagem } from '../utils/sound';
import { notificar, estaOlhando, pedirPermissaoNoPrimeiroGesto } from '../utils/notificacao';
import { mesclarConversa, aplicarStatusMensagem } from '../utils/mesclarConversa';
import { useAuth } from './AuthContext';

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
  // Só para reaplicar a sessão quando a matriz de permissões muda (ver
  // `recarregarSessao`). O AppProvider vive DENTRO do AuthProvider (ver
  // RotaProtegida), então o hook está sempre disponível aqui.
  const { usuario, atualizarUsuario } = useAuth();

  // O aviso de mensagem nova fica SEMPRE ligado, e por isso não há botão para
  // pedir a permissão. Ela é pedida no primeiro clique de quem entrou -- o
  // navegador exige um gesto, e este é o primeiro que aparece.
  useEffect(() => {
    if (!usuario?.id) return;
    pedirPermissaoNoPrimeiroGesto();
  }, [usuario?.id]);
  const [carregando,        setCarregando]        = useState(true);
  const [equipe,            setEquipe]            = useState([]);
  const [fluxos,            setFluxos]            = useState([]);
  // A leitura dos fluxos DEU CERTO? Sem isto, lista vazia por falha e lista
  // vazia de verdade sao a mesma coisa -- e o alerta acusava o bot de desligado
  // quando o problema era so nao ter conseguido perguntar.
  const [fluxosCarregados,  setFluxosCarregados]  = useState(false);
  const [parceiros,         setParceiros]         = useState([]);
  const [conversas,         setConversas]         = useState([]);
  const [whatsAppConectado, setWhatsAppConectado] = useState(false);
  // ── O RÓTULO, NÃO SÓ O BOOLEANO ───────────────────────────────────────────
  //
  // `whatsAppConectado` é `state === "open"` e nada mais. O servidor distingue
  // seis situações (Online, Conectando, Reconectando, Reescaneie o QR, Evolution
  // indisponível, Instância não existe) e a Central de Atendimento reduzia tudo
  // isso a Online/Offline.
  //
  // O efeito em produção (10/09/2026): uma queda de 15 segundos que o vigia
  // resolve sozinho aparecia como "WhatsApp Offline", e a volta como "WhatsApp
  // Online". A pílula piscava a cada poll de 10s e foi lida como "a conexão cai
  // e volta toda hora" -- que é verdade sobre o socket, mas a tela não sabia
  // dizer que o servidor estava religando e nada havia sido perdido.
  //
  // `statusLabel` já vinha na resposta do /status e ninguém aqui lia.
  const [whatsAppStatus, setWhatsAppStatus] = useState(null);
  // ── O MODO TV MORA AQUI, E NÃO NO AtendimentoView ─────────────────────────
  //
  // Ele era estado local daquele componente, e isso impedia a regra dos sons de
  // existir: quem toca o som é este contexto, e daqui não havia como saber se a
  // TV estava ligada. Duas cópias sincronizadas por efeito resolveriam e
  // trariam o defeito clássico de ficarem fora de passo -- aí o som errado
  // toca, e é o tipo de bug que ninguém reproduz sob demanda.
  //
  // Fonte única: o `AtendimentoView` passa a ler e escrever esta.
  const [modoTv, setModoTv] = useState(false);
  // O efeito dos sons lê o valor ATUAL sem se reinscrever. Colocar `modoTv` nas
  // dependências dele faria a detecção de mensagem nova rodar de novo a cada
  // abre/fecha da TV, e o retrato anterior seria recalculado no meio.
  const modoTvRef = useRef(false);
  useEffect(() => { modoTvRef.current = modoTv; }, [modoTv]);
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
  // Última mensagem do cliente já notificada, por conversa (id da mensagem).
  // `null` = ainda não semeado (carregamento inicial). Ver o efeito que notifica.
  const ultimaMsgRef = useRef(null);
  // Pulso "chegou mensagem nova de cliente", para os painéis animarem sem
  // recontar nada por conta própria.
  const [sinalMensagemNova, setSinalMensagemNova] = useState(0);
  // Espelho de `conversas` para quem precisa LER o estado sem entrar nas
  // dependências de um efeito (a conferência de estado abaixo roda num intervalo
  // e não pode ser recriada a cada mensagem que chega).
  const conversasRef = useRef([]);

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
      // SE A LISTA DE FLUXOS FOI MESMO LIDA -- e não apenas "veio vazia".
      //
      // `resolver` transforma uma chamada RECUSADA em `[]`, que é o certo para
      // renderizar mas apaga a diferença entre "não há fluxo" e "não consegui
      // perguntar". O alerta "Automação desativada" lia esse `[]` e acusava o
      // bot de estar desligado sempre que a chamada falhava -- permissão, erro
      // no servidor, rede -- com os fluxos rodando normalmente do outro lado.
      setFluxosCarregados(fl.status === 'fulfilled' && Array.isArray(fl.value));
      setParceiros(resolver(pa));
      setConversas(ordenarConversas(resolver(co)));

      setApiOffline([eq, fl, pa, co].every(r => r.status === 'rejected'));
    } catch {
      setEquipe([]);
      setFluxos([]);
      setFluxosCarregados(false);
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

  /**
   * RELÊ A PRÓPRIA SESSÃO -- usada quando a matriz de permissões muda.
   *
   * `usuario.permissoes` é o que decide quais itens aparecem no menu e quais
   * rotas o `RotaModulo` deixa abrir. Ela nascia no login e não era recalculada,
   * então um módulo tirado de um perfil só desaparecia da tela do operador no
   * próximo F5 -- enquanto o servidor já recusava a API com 403. Era essa
   * defasagem que fazia a edição parecer não ter sido salva.
   *
   * Pergunta pela SESSÃO (`/auth/me`), e não pela matriz: o servidor devolve as
   * permissões do cargo de quem está perguntando, então nenhum operador recebe a
   * configuração dos outros perfis.
   */
  const recarregarSessao = useCallback(async () => {
    try {
      const eu = await AuthAPI.eu();
      if (eu?.id) atualizarUsuario({ cargo: eu.cargo, permissoes: eu.permissoes });
    } catch { /* sessão caindo: o AuthContext já trata o 401 */ }
  }, [atualizarUsuario]);

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
  // de ultimaMsgRef, que reage a qualquer mudanca em `conversas`.
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
      // A MATRIZ DE PERMISSÕES MUDOU -- relê a própria sessão.
      //
      // `usuario.permissoes` (a lista que monta o menu) nasce no login e não era
      // recalculada nunca. Tirar um módulo de um perfil passava a valer no
      // servidor imediatamente, mas o menu de quem estava logado continuava
      // mostrando o item -- e clicar nele dava uma tela vazia com 403 por baixo.
      //
      // Cada painel pergunta pela SUA sessão: o servidor responde com as
      // permissões do cargo de quem está perguntando, e nenhuma matriz de outro
      // perfil trafega para cá.
      if (evt.recurso === 'permissoes') recarregarSessao();
      return;
    }
    // Só o risquinho de UMA mensagem mudou (enviada/entregue/lida/erro).
    //
    // Não mexe em `sinalConversas` de propósito: um ACK não é atividade nova na
    // conversa, e contá-lo como tal tocaria o som de notificação a cada
    // confirmação de entrega. Também não reordena a lista -- a conversa não
    // "subiu" só porque o WhatsApp confirmou a entrega.
    if (evt.type === 'mensagem:status' && evt.conversaId && evt.mensagemId) {
      setConversas(prev => {
        const i = prev.findIndex(c => c.id === evt.conversaId);
        if (i < 0) return prev;
        const nova = aplicarStatusMensagem(prev[i], evt);
        if (nova === prev[i]) return prev; // nada mudou: sem re-render
        const lista = prev.slice();
        lista[i] = nova;
        return lista;
      });
      return;
    }
    if (evt.type === 'conversa:delete') {
      setConversas(prev => prev.filter(c => c.id !== evt.id));
      setSinalConversas(n => n + 1);
      return;
    }
    // A conversa foi TRANSFERIDA PARA OUTRO SETOR e este operador não a vê mais.
    //
    // Chega do stream no lugar do `conversa:update` que o filtro de setor
    // descartou. Sem isto, a conversa ficava na lista congelada no estado antigo
    // até um F5 -- transferir do Comercial para o Técnico não tirava nada da tela
    // de ninguém.
    //
    // NÃO mexe em `sinalConversas` de propósito: aquilo é sinal de atividade
    // NOVA, e usá-lo aqui tocaria o som de notificação para uma conversa que
    // está justamente saindo. Também não é `conversa:delete`: a conversa
    // continua existindo, só não é mais deste setor.
    if (evt.type === 'conversa:saiu-do-setor' && evt.id) {
      setConversas(prev => (prev.some(c => c.id === evt.id) ? prev.filter(c => c.id !== evt.id) : prev));
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
  }, [recarregarParceiros, recarregarEquipe, recarregarSessao]);

  // Tempo real por SSE do nosso back-end. O EventSource nao envia header
  // Authorization, entao pegamos um ticket de uso unico antes de abrir o stream.
  // Em queda, reconecta com backoff e reconcilia o estado via recarregarConversas.
  useEffect(() => {
    let es = null;
    let reconnectTimer = null;
    let parado = false;
    // Quando chegou o último sinal do servidor -- evento OU batimento.
    let ultimoSinal = Date.now();

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
          // QUALQUER coisa vinda do servidor conta como sinal de vida --
          // inclusive o batimento, que é justamente o sinal dos períodos sem
          // novidade. Marcar só em evento útil faria o vigia derrubar uma
          // conexão saudável numa hora de pouco movimento.
          ultimoSinal = Date.now();
          try { aplicarEvento(JSON.parse(e.data)); } catch { /* evento nao-json */ }
        };
        es.onopen = () => { ultimoSinal = Date.now(); setApiOffline(false); };
        es.onerror = () => {
          if (es) { es.close(); es = null; }
          agendarReconexao();
        };
      } catch {
        agendarReconexao();
      }
    };

    /**
     * VIGIA DO STREAM -- para a conexão que morre CALADA.
     *
     * `onerror` cobre a queda que o navegador percebe. Não cobre as outras
     * duas, que são as que doem: a aba congelada pelo navegador em segundo
     * plano (volta a rodar achando que está conectada) e o proxy que corta o
     * stream sem avisar ninguém. Nos dois casos o painel ficava parado até
     * alguém voltar para a aba -- que é exatamente o relato de "só move quando
     * eu volto para o navegador".
     *
     * O servidor manda batimento a cada 20s. Três perdidos seguidos é silêncio
     * demais para ser normal: reconecta e reconcilia. O próprio `setInterval`
     * daqui pode ser estrangulado em aba oculta -- e tudo bem: ele roda assim
     * que a aba volta a ter fôlego, que é quando o conserto importa.
     */
    const vigia = setInterval(() => {
      if (parado || reconnectTimer) return;
      if (Date.now() - ultimoSinal < 70000) return;
      if (es) { es.close(); es = null; }
      agendarReconexao();
    }, 15000);

    conectar();
    return () => {
      parado = true;
      clearInterval(vigia);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, [aplicarEvento, recarregarConversas]);

  /**
   * REDE DE SEGURANÇA -- e só isso.
   *
   * Era um `setInterval` de 30s recarregando a lista inteira. A listagem traz
   * todas as conversas com todas as mensagens: medido, 10 conversas de 800
   * mensagens custam 628ms de servidor e 2,76 MB -- por atendente, duas vezes
   * por minuto, mesmo com o SSE entregando tudo normalmente. Era trabalho
   * jogado fora que competia com o tráfego real de mensagens.
   *
   * O tempo real é o SSE. Esta releitura existe para os casos em que ele pode
   * ter perdido algo, e roda quando isso é plausível:
   *   - a cada 5 minutos (evento perdido sem queda de conexão);
   *   - ao voltar para a aba (o navegador estrangula timers em aba oculta);
   *   - ao reconectar o stream (já feito em `agendarReconexao`).
   *
   * O acelerador de 30s impede que alternar de aba vire uma rajada de
   * recarregamentos.
   */
  useEffect(() => {
    let ultima = 0;
    const reconciliar = () => {
      const agora = Date.now();
      if (agora - ultima < 30000) return;
      ultima = agora;
      recarregarConversas();
    };
    const id = setInterval(reconciliar, 300000);
    const aoVoltar = () => { if (document.visibilityState === 'visible') reconciliar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    // `focus` TAMBÉM, e não é redundante: ao voltar de outro programa a aba
    // muitas vezes nunca ficou "oculta" -- a janela só perdeu o foco --, então
    // `visibilitychange` não dispara. Era o caso relatado: o operador sai para
    // outro aplicativo e, ao voltar, a lista ainda estava velha.
    window.addEventListener('focus', reconciliar);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', reconciliar);
    };
  }, [recarregarConversas]);

  /**
   * CONFERÊNCIA DE ESTADO -- a cada 10 segundos, e barata.
   *
   * A rede de segurança acima só roda a cada 5 minutos porque a listagem
   * completa é caríssima. Isso deixava um buraco de até 5 minutos: se o SSE
   * perdesse UM evento, a conversa ficava na aba errada até lá.
   *
   * Foi o que aconteceu em 2026-08-28: o bot encerrou o atendimento, o banco
   * gravou `fechada` (log e OS confirmados), e a Central seguiu mostrando
   * "Pendente" -- o operador só via mudar apertando F5.
   *
   * `/conversas/estados` devolve apenas o que decide ABA e BADGE (status, setor,
   * responsável, não-lidas e versão), sem mensagem nenhuma: alguns bytes por
   * conversa. Dá para conferir frequentemente sem competir com o tráfego
   * real de mensagens.
   *
   * MELHORIAS APLICADAS:
   * 1. INTERVALO REDUZIDO para 10 segundos (era 60s)
   * 2. DETECTA TRANSFERÊNCIAS DE SETOR: se uma conversa não vem mais no estado
   *    (porque foi transferida para outro setor), ela é removida automaticamente
   *    da tela, sem precisar de F5
   * 3. ATUALIZA VERSÕES: quando detecta versão desatualizada, busca só aquela
   *    conversa completa, mantendo o custo baixo
   *
   * Com isto, transferências de setor aparecem em até 10 segundos, mesmo que
   * o SSE perca o evento `conversa:saiu-do-setor`.
   */
  useEffect(() => {
    let ativo = true;
    const conferir = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const estados = await ConversasAPI.estados();
        if (!ativo || !Array.isArray(estados)) return;
        const porId = new Map(conversasRef.current.map(c => [c.id, c]));
        
        // 1. DETECTAR CONVERSAS QUE SAÍRAM (não vieram no estado = transferidas/removidas)
        const idsNoServidor = new Set(estados.map(e => e.id));
        const idsNaTela = Array.from(porId.keys());
        const removidas = idsNaTela.filter(id => !idsNoServidor.has(id));
        
        if (removidas.length > 0) {
          setConversas(prev => prev.filter(c => !removidas.includes(c.id)));
        }
        
        // 2. DETECTAR CONVERSAS COM VERSÃO DESATUALIZADA
        const atrasadas = estados
          .filter(e => {
            const atual = porId.get(e.id);
            // Conversa que a tela não tem ainda: a listagem completa cuida dela
            // na próxima reconciliação -- aqui não há retrato para comparar.
            if (!atual) return false;
            return (
              typeof e.versao === 'number' &&
              typeof atual.versao === 'number' &&
              e.versao > atual.versao
            );
          })
          .map(e => e.id);
        for (const id of atrasadas) {
          try {
            const conv = await ConversasAPI.obter(id);
            if (!ativo || !conv?.id) continue;
            setConversas(prev => {
              const atual = prev.find(c => c.id === conv.id);
              const mesclada = mesclarConversa(atual, conv);
              return ordenarConversas(
                atual ? prev.map(c => (c.id === conv.id ? mesclada : c)) : [mesclada, ...prev]
              );
            });
          } catch { /* uma conversa que falhou nao pode parar as outras */ }
        }
      } catch { /* back-end offline: mantem estado atual */ }
    };
    const id = setInterval(conferir, 10000);
    return () => { ativo = false; clearInterval(id); };
  }, []);

  // Mantém o espelho de `conversas` em dia para a conferência acima.
  useEffect(() => { conversasRef.current = conversas; }, [conversas]);

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
      ultimaMsgRef.current = null;
      return;
    }

    // SÓ MENSAGEM DO CLIENTE TOCA O SINO.
    //
    // A contagem olha `origem === 'cliente'` (o campo cru do servidor), e não o
    // lado da bolha: a pesquisa de satisfação e os avisos automáticos saem do
    // BOT e não podem soar como se o cliente tivesse escrito. Antes isso
    // dependia de `de !== 'cliente'` funcionar por acaso -- agora é explícito.
    // A RESPOSTA DA PESQUISA NÃO CHAMA NINGUÉM.
    //
    // O "5" que o cliente manda para a pesquisa de satisfação é uma mensagem do
    // cliente como outra qualquer no banco, e tocava o som chamando o atendente
    // para uma conversa que acabou de fechar. Quem marca é o servidor
    // (`respostaPesquisa`), porque só ele sabe em que estado a sessão estava --
    // pela tela, "5" é indistinguível de qualquer outra mensagem.
    //
    // Se o cliente escrever DEPOIS de avaliar, aquela mensagem não tem a marca:
    // abre atendimento novo, entra em Pendentes e avisa normalmente.
    const ehDoCliente = (m) =>
      !m.respostaPesquisa && (m.origem ? m.origem === 'cliente' : m.de === 'cliente');

    /**
     * A ÚLTIMA mensagem do cliente -- e não QUANTAS existem.
     *
     * ── O DEFEITO QUE ISTO CONSERTA ───────────────────────────────────────
     *
     * Aqui se contava as mensagens do cliente por conversa e avisava quando o
     * número subia. Parecia certo, e notificava DUAS VEZES a mesma mensagem.
     *
     * A razão não está nesta função: a lista `mensagens` tem LARGURAS
     * diferentes conforme quem a entregou -- o evento SSE traz a cauda (30
     * últimas), a listagem traz 40, e `GET /conversas/:id` traz o histórico
     * inteiro. Como o merge nunca descarta mensagem (é preciso: ver
     * utils/mesclarConversa), quando o retrato mais LARGO chega -- segundos
     * depois, pela conferência de estado de 10s -- a contagem sobe de novo, e
     * sobe por causa de mensagens ANTIGAS. Este efeito lia aquilo como "chegou
     * outra" e tocava o som pela segunda vez, exibindo o texto da MESMA
     * mensagem. Quanto mais longo o histórico do cliente, mais garantido o aviso
     * duplicado.
     *
     * A identidade da última mensagem não tem esse problema: carregar histórico
     * antigo não muda quem é a última.
     */
    const marcaDaUltima = (c) => {
      const msgs = c.mensagens || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (ehDoCliente(msgs[i])) return msgs[i].id || `${msgs[i].texto}|${msgs[i].hora}`;
      }
      return null;
    };

    // ── SÓ REGISTRA QUEM TEM MARCA, e isto é uma correção ─────────────────
    //
    // Antes gravava `marcas[c.id] = null` para conversa sem mensagem de cliente
    // legível. Parecia inofensivo -- o laço abaixo pula marca nula --, mas o
    // `null` FICAVA no retrato anterior, e aí "esta conversa é nova?" passava a
    // ter duas respostas diferentes para a mesma situação:
    //
    //   tick A  a conversa chega sem mensagem legível -> grava null, não avisa
    //   tick B  a mensagem do cliente aparece         -> anterior[id] é null,
    //                                                    e não `undefined`
    //
    // No tick B a conversa É nova (nunca foi anunciada), mas o teste
    // `anterior[c.id] === undefined` respondia FALSO -- e no Modo TV, onde só
    // chamado novo toca, isso significava SILÊNCIO num chamado novo de verdade.
    // Era o defeito relatado: "o som do Modo TV parou de funcionar".
    //
    // Não gravar a marca nula resolve na origem: quem nunca teve mensagem
    // conhecida continua ausente do retrato, e ausente é o que "novo" quer
    // dizer. Não há risco de aviso duplicado, porque no tick A nada foi
    // anunciado.
    const marcas = {};
    conversas.forEach(c => {
      const m = marcaDaUltima(c);
      if (m) marcas[c.id] = m;
    });
    const anterior = ultimaMsgRef.current;
    if (anterior !== null) {
      const novas = [];
      conversas.forEach(c => {
        const marca = marcas[c.id];
        if (!marca) return;
        // `undefined` = conversa que a tela não tinha (cliente novo, ou conversa
        // transferida para este setor). Continua avisando, como antes.
        // Marca IGUAL = nada novo, mesmo que a lista de mensagens tenha crescido.
        if (anterior[c.id] === marca) return;
        const msgs = c.mensagens || [];
        const ultima = [...msgs].reverse().find(ehDoCliente);
        novas.push({
          id: `${c.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          convId: c.id,
          tipo: 'mensagem',
          cliente: c.cliente,
          fotoUrl: c.fotoUrl || null,
          texto: ultima?.texto || 'Nova mensagem',
          em: Date.now(),
          lida: false,
          // DE QUEM E A CONVERSA -- e o que decide se ISTO faz som (ver abaixo).
          // `null` = sem dono, ou seja, a fila.
          atendenteId: c.atendenteId || null,
          // ESTA ESPERANDO NA FILA? -- e o que decide o som do Modo TV (ver
          // abaixo). Mesma conta da aba "Pendentes" e da `filaModoTv`, para que
          // o som da TV nao possa discordar do que a propria TV mostra.
          pendente: c.statusAtendimento === 'pendente'
        });
      });
      if (novas.length > 0) {
        // ── QUAL DOS DOIS SONS: A TELA DECIDE, E NADA MAIS ───────────────────
        //
        //   Modo TV ligado     ARKACHATMonitoramento
        //   Central (sem TV)   blipnotificacaomensagem
        //
        // É o que os nomes dos arquivos dizem, e o que foi pedido: um som para a
        // tela de monitoramento na parede, outro para quem está no chat.
        //
        // ── DUAS TENTATIVAS MINHAS ANTES DESTA, E POR QUE AS DUAS ERRARAM ────
        //
        // 1. o Modo TV ficava em SILÊNCIO para conversa já conhecida, e só
        //    tocava em chamado novo. Isso deixava a TV muda na maior parte do
        //    tempo -- e silêncio decidido em código é indistinguível de defeito;
        // 2. depois passou a tocar o BLIP para conversa conhecida e o
        //    Monitoramento só para chamado novo. Continuava errado: na TV, o som
        //    do Monitoramento praticamente não saía, porque chamado novo é o
        //    caso raro.
        //
        // As duas versões nasceram de uma distinção que EU introduzi (chamado
        // novo x conversa conhecida) e que ninguém pediu. A regra pedida sempre
        // foi a de cima -- uma tela, um som --, e ela não precisa saber se a
        // conversa é nova. Por isso `houveChamadoNovo` saiu daqui: condição que
        // não decide nada é condição que volta a decidir errado.
        //
        // UM TOQUE POR RAJADA, não por mensagem: `novas` pode trazer várias
        // conversas na mesma passada, e cinco sons sobrepostos não informam mais
        // do que um. Era assim antes e continua.
        // ── E DE QUEM E O SOM: NA CENTRAL, DE QUEM ATENDEU. E SO ────────────
        //
        // O RELATO: na Central o som tocava para TODO MUNDO, em qualquer
        // conversa visivel. Quem nao atendeu aquele chamado passava o dia
        // ouvindo barulho pelo trabalho de outra pessoa -- e som que nao e meu e
        // som que eu aprendo a ignorar, inclusive quando for meu.
        //
        // Dois casos:
        //
        //   conversa COM dono    toca so para o dono, na Central;
        //   Modo TV              toca so pela FILA -- tela de parede nao tem
        //                        dono, mas tambem nao tem por que anunciar
        //                        conversa que ja esta na mao de alguem (ver o
        //                        bloco `paraATv`, logo abaixo).
        //
        // ── A FILA SAIU DAQUI (11/09/2026), E PARA ONDE ELA FOI ─────────────
        //
        // Havia um `!n.atendenteId ||` nesta conta: conversa sem dono tocava
        // para todos que a enxergavam, porque silenciar a fila trocaria um
        // incomodo por um cliente esperando.
        //
        // A FILA PASSOU A SER DO MODO TV, a pedido: e a tela feita para vigiar
        // exatamente isso. Som de chamado novo para quem nao vai pega-lo era a
        // ultima poluicao que sobrava depois do recorte por dono. E, no mesmo
        // pedido, a TV deixou de tocar por qualquer outra coisa: a fila e o que
        // ela mostra, e passou a ser tudo o que ela diz.
        //
        // O PRECO, dito em voz alta: com a TV desligada -- ou sem ninguem na
        // sala -- um chamado novo nao emite som em lugar nenhum. Isso inclui a
        // conversa que VOLTOU para a fila: se o cliente responder, ninguem ouve.
        // E decisao, nao esquecimento, e o que a sustenta e a fila continuar
        // VISIVEL na Central: o badge do menu mostra a contagem de pendentes, e
        // a lista de avisos e o sino seguem recebendo tudo do setor.
        //
        // O RECORTE E DO SOM, e nao do aviso. Ver nao e ouvir.
        const paraMeuOuvido = novas.filter((n) => n.atendenteId === usuario?.id);

        // ── E NA TV, SO A FILA. NAO O ATENDIMENTO EM CURSO ──────────────────
        //
        // O RELATO (11/09/2026): "no Modo TV ele fica notificando sem parar".
        // Estava certo. A condicao aqui era UMA -- `modoTvRef.current` -- e
        // entao QUALQUER mensagem de cliente tocava o alarme alto: inclusive a
        // vigesima mensagem de uma conversa que um atendente ja esta tocando,
        // ao vivo, naquele momento. Uma conversa comum rende dezenas de
        // mensagens, e cada uma virava um alarme de parede. Som que toca o
        // tempo todo nao avisa nada -- ele so ensina a sala a ignorar o som.
        //
        // A TV existe para vigiar QUEM NAO ESTA SENDO ATENDIDO. E o que a tela
        // mostra: a fila de Pendentes, e mais nada (ver `filaModoTv`, na
        // Central). O som passa a dizer a mesma coisa que a tela -- alguem
        // chegou, ou alguem que espera voltou a falar -- e cala no resto.
        //
        // Por que `pendente` e nao "chamado novo": conversa que VOLTOU para a
        // fila, ou que espera ha dez minutos e o cliente cobra de novo, tem de
        // soar. Ela esta na fila da mesma forma. Ja tentei duas vezes recortar
        // isto por "conversa nova" e errei as duas (ver acima) -- o criterio
        // que vale e o estado da conversa AGORA, o mesmo da tela.
        const paraATv = novas.filter((n) => n.pendente);

        // UM TOQUE POR RAJADA, não por mensagem (era assim antes e continua).
        if (modoTvRef.current) {
          if (paraATv.length > 0) tocarSomMonitoramento();
        } else if (paraMeuOuvido.length > 0) {
          tocarSomMensagem();
        }

        // ── O AVISO PARA QUEM NÃO ESTÁ OLHANDO ────────────────────────────
        //
        // O som só alcança quem está com o painel na frente. Em outra aba, em
        // outro programa ou com a janela minimizada, ele passa despercebido --
        // e o contador subindo não serve para quem não está vendo a tela.
        //
        // Enquanto a ABA continuar aberta, o SSE entrega e isto aparece. Com o
        // navegador FECHADO não chega, e nenhum ajuste aqui muda isso: sem aba
        // não há JavaScript rodando (ver `utils/notificacao`).
        //
        // Só quando a pessoa NÃO está olhando: um cartão do sistema por cima do
        // painel em foco é ruído, porque a conversa já entrou na lista dela.
        //
        // E SEGUE A MESMA REGRA DO SOM (`paraMeuOuvido`): um cartão do sistema
        // sobre conversa que não é minha é o mesmo incômodo em outro formato --
        // e pior, porque fica na tela até alguém fechar.
        if (!estaOlhando() && paraMeuOuvido.length > 0) {
          // UMA notificação, mesmo com várias conversas. Cinco cartões
          // empilhados para quem voltou do café é pior que um: ninguém lê
          // cinco, e a pilha esconde o resto da área de trabalho.
          const primeira = paraMeuOuvido[0];
          const outras = paraMeuOuvido.length - 1;
          notificar({
            titulo: outras > 0
              ? `${paraMeuOuvido.length} conversas com mensagem nova`
              : (primeira.cliente || 'Nova mensagem'),
            corpo: outras > 0
              ? `${primeira.cliente || 'Cliente'} e mais ${outras}`
              : primeira.texto,
            // A tag agrupa por conversa quando é uma só: mensagens seguidas do
            // mesmo cliente atualizam o mesmo aviso em vez de empilhar.
            tag: outras > 0 ? 'arka-varias' : `arka-${primeira.convId}`,
            // SEM navegar para a conversa. Levar direto a ela exigiria um
            // segundo caminho de navegação a partir daqui -- quem abre conversa
            // é a Central --, e dois caminhos para a mesma ação terminam com um
            // deles ficando para trás. O foco na janela já põe a pessoa na
            // lista, com a conversa no topo e o contador marcando.
          });
        }
        setNotificacoes(prev => [...novas, ...prev].slice(0, 5));
        registrarNoHistorico(novas);
        // Pulso para quem só precisa saber QUE chegou algo (a animação do sino na
        // Central). Antes ela tinha o próprio contador, com a própria regra --
        // duas contas para a mesma pergunta, e as duas erravam junto.
        setSinalMensagemNova(n => n + 1);
        novas.forEach(n => setTimeout(() => removerNotificacao(n.id), 7000));
      }
    }
    // MERGE, e não substituição: a conversa que sai da lista (transferida de
    // setor, ou ausente de um retrato) mantém a marca conhecida. Substituindo o
    // mapa, ela voltaria como `undefined` e o próximo retrato notificaria de novo
    // a mesma mensagem -- o mesmo defeito por outro caminho.
    ultimaMsgRef.current = { ...(anterior || {}), ...marcas };
  }, [conversas, carregando, removerNotificacao, registrarNoHistorico]);

  const fluxosAtivos = fluxos.filter(f => f.ativo).length;
  /**
   * "AUTOMAÇÃO DESATIVADA" -- e as duas condições que faltavam.
   *
   * ── SÓ QUANDO SE SABE ─────────────────────────────────────────────────────
   *
   * O alerta lia uma lista vazia e concluía "não há fluxo". Só que a lista
   * também fica vazia quando a leitura FALHA: `resolver` transforma uma chamada
   * recusada em `[]`, e a diferença entre "não há fluxo" e "não consegui
   * perguntar" desaparecia ali. Resultado: o painel acusava o bot de desligado
   * com os fluxos rodando normalmente.
   *
   * Agora só acusa quando a leitura deu certo E o resultado foi zero.
   *
   * ── SÓ PARA QUEM PODE RESOLVER ────────────────────────────────────────────
   *
   * A mensagem manda "criar ou ativar um fluxo em Fluxo de Automações" -- uma
   * tela que só o administrador abre. Para o resto da equipe era um aviso
   * insistente sobre algo que eles não têm como consertar, no meio das
   * notificações de mensagem de cliente, que é o que aquele sino existe para
   * mostrar.
   */
  const ehAdmin = usuario?.cargo === 'Administrador';
  useEffect(() => {
    if (carregando) return;
    setHistorico(prev => {
      const semFluxo = prev.find(n => n.id === ALERTA_SEM_FLUXO);
      if (fluxosCarregados && ehAdmin && fluxosAtivos === 0) {
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
      // Some assim que a condição deixa de valer -- inclusive quando ela deixou
      // de valer porque a leitura falhou, ou porque quem está olhando não é mais
      // administrador. Um alerta que fica depois de o motivo passar vira ruído
      // que ninguém sabe como calar.
      return semFluxo ? prev.filter(n => n.id !== ALERTA_SEM_FLUXO) : prev;
    });
  }, [fluxosAtivos, fluxosCarregados, ehAdmin, carregando]);

  useEffect(() => {
    let ativo = true;
    const checar = async () => {
      try {
        const st = await WhatsAppAPI.status();
        if (ativo && st) {
          setWhatsAppConectado(!!st.conectado);
          setWhatsAppStatus(st.statusLabel || null);
        }
      } catch {
        // A LEITURA FALHOU -- e isso NÃO é o WhatsApp offline.
        //
        // `whatsAppConectado` é deixado como está de propósito (o `catch` nunca
        // o derrubou, e não deve). O rótulo passa a `null`, que é o que a tela
        // interpreta como "não sei": melhor não afirmar nada do que afirmar
        // "Offline" a partir de uma requisição que não chegou.
        if (ativo) setWhatsAppStatus(null);
      }
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
      } catch (e) {
        // SEM PERMISSAO NAO E FALHA PASSAGEIRA -- e resposta definitiva.
        //
        // `GET /api/equipe` exige o modulo "equipe", e este intervalo rodava
        // para todo mundo. Quem nao tem o modulo levava 403 a cada 30 segundos
        // pelo turno inteiro, e o `catch` engolia tudo: 669 respostas 403 num
        // unico dia em producao (01/09/2026), a maior fonte de erro do log, sem
        // nunca aparecer para ninguem.
        //
        // O cargo nao muda no meio da sessao -- e quando muda, o servidor
        // derruba a sessao. Entao a primeira negativa encerra a repeticao;
        // qualquer outro erro (back-end fora, rede) continua tentando, que e
        // justamente o caso em que repetir faz sentido.
        if (e?.status === 403) clearInterval(id);
      }
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
      sinalConversas,   sinalContatos,   sinalMensagemNova,
      whatsAppConectado, setWhatsAppConectado,
      whatsAppStatus,
      modoTv, setModoTv,
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
