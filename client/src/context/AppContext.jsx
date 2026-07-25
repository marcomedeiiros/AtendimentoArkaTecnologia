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

const SEED_EQUIPE = [
  { id: 'e1', nome: 'Marina Souza', cargo: 'Atendimento Especializado', status: 'online' },
  { id: 'e2', nome: 'Diego Alves',  cargo: 'Suporte Técnico N2',        status: 'offline' },
  { id: 'e3', nome: 'Bruna Lima',   cargo: 'Gerente Comercial',         status: 'online' },
];

const SEED_FLUXOS = [
  {
    id: 'f1', nome: 'Atendimento de Orçamentos', gatilho: 'orçamento', ativo: true,
    passos: [
      { id: 'p1', tipo: 'gatilho',  titulo: 'Gatilho Recebido',        desc: 'Cliente digita "orçamento"' },
      { id: 'p2', tipo: 'mensagem', titulo: 'Perguntar CNPJ',          desc: 'Solicita o CNPJ para consulta de cadastro' },
      { id: 'p3', tipo: 'condicao', titulo: 'Validar CNPJ do Cliente', desc: 'Verifica se possui contrato de parceiro ativo' },
      { id: 'p4', tipo: 'mensagem', titulo: 'Resposta Inicial Bot',    desc: 'Olá! Sou a IA da Arka. Vou preparar seu orçamento agora mesmo.' },
      { id: 'p5', tipo: 'delay',    titulo: 'Aguardar 1.5s',           desc: 'Simula digitação humana' },
      { id: 'p6', tipo: 'acao',     titulo: 'Desconto Automático',     desc: 'Se for parceiro -> Aplica 15% de desconto automático na proposta' },
    ],
  },
  {
    id: 'f2', nome: 'Reenvio de 2ª Via de Boleto', gatilho: 'boleto', ativo: true,
    passos: [
      { id: 'p21', tipo: 'gatilho',  titulo: 'Gatilho Recebido',     desc: 'Cliente digita "boleto"' },
      { id: 'p22', tipo: 'mensagem', titulo: 'Solicitar CNPJ',       desc: 'Por favor informe seu CNPJ para consultar títulos em aberto...' },
      { id: 'p23', tipo: 'delay',    titulo: 'Aguardar 2.0s',        desc: 'Consulta no sistema ERP Arka' },
      { id: 'p24', tipo: 'acao',     titulo: 'Gerar Linha Digitável', desc: 'Envia PDF + código Pix/Boleto atualizado' },
    ],
  },
];

const SEED_PARCEIROS = [
  { cnpj: '11222333000181', razaoSocial: 'Empresa Exemplo LTDA', status: 'ativo' },
  { cnpj: '00000000000191', razaoSocial: 'Banco do Brasil SA',   status: 'ativo' },
];

const SEED_CONVERSAS = [
  {
    id: 'c1', cliente: 'João Pereira', telefone: '+55 11 98765-4321',
    statusAtendimento: 'aguardando', cnpj: null, cnpjVerificado: false, lido: false,
    mensagens: [{ de: 'cliente', texto: 'Oi, boa tarde! Gostaria de um orçamento para a minha empresa.', hora: '09:12' }],
  },
];

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [carregando,        setCarregando]        = useState(true);
  const [equipe,            setEquipe]            = useState([]);
  const [fluxos,            setFluxos]            = useState([]);
  const [parceiros,         setParceiros]         = useState([]);
  const [conversas,         setConversas]         = useState([]);
  const [whatsAppConectado, setWhatsAppConectado] = useState(false);
  const [notificacoes,      setNotificacoes]      = useState([]);
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

      // Se a API respondeu (fulfilled) usamos o valor real do back-end, mesmo
      // que seja uma lista vazia. So caimos no SEED quando a chamada FALHA
      // (back-end offline). Isso evita itens "fantasma" com id falso que a API
      // nao reconhece e que fariam edicoes/exclusoes falharem silenciosamente.
      const resolver = (res, seed) =>
        res.status === 'fulfilled' && Array.isArray(res.value) ? res.value : seed;

      setEquipe(resolver(eq, SEED_EQUIPE));
      setFluxos(resolver(fl, SEED_FLUXOS));
      setParceiros(resolver(pa, SEED_PARCEIROS));
      setConversas(resolver(co, SEED_CONVERSAS));
    } catch {
      setEquipe(SEED_EQUIPE);
      setFluxos(SEED_FLUXOS);
      setParceiros(SEED_PARCEIROS);
      setConversas(SEED_CONVERSAS);
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
    } catch { /* back-end offline: mantem estado atual */ }
  }, []);

  useEffect(() => {
    const id = setInterval(recarregarConversas, 8000);
    return () => clearInterval(id);
  }, [recarregarConversas]);

  const removerNotificacao = useCallback((id) => {
    setNotificacoes(prev => prev.filter(n => n.id !== id));
  }, []);

  // Detecta mensagens novas de clientes (comparando com o snapshot anterior)
  // e dispara: som de sino + toast "fulano lhe mandou mensagem". Roda em
  // qualquer página, pois vive no contexto global.
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
            cliente: c.cliente,
            texto: ultima?.texto || 'Nova mensagem',
          });
        }
      });
      if (novas.length > 0) {
        playPing();
        setNotificacoes(prev => [...novas, ...prev].slice(0, 5));
        novas.forEach(n => setTimeout(() => removerNotificacao(n.id), 7000));
      }
    }
    msgCountsRef.current = counts;
  }, [conversas, removerNotificacao]);

  // Sincroniza o status real da conexao WhatsApp (Evolution API) a cada 10s.
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
