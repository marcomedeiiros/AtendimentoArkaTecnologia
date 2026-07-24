/**
 AppContext estado global compartilhado entre todas as rotas.
 Centraliza conversas, fluxos, equipe e parceiros que antes viviam
 dentro do componente App em Home.jsx. Cada rota le/escreve aqui
 via useAppContext(), eliminando prop-drilling e permitindo que
 qualquer pagina acesse o mesmo estado sem re-montar dados
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const DATA_VERSION = '2'; // incrementar aqui força reset do localStorage com os novos seeds
const temStorage = typeof window !== 'undefined' && !!window.storage;

async function carregar(chave, padrao) {
  try {
    if (temStorage) {
      const r = await window.storage.get(chave, true);
      return r ? JSON.parse(r.value) : padrao;
    }
    const raw = localStorage.getItem(chave);
    return raw ? JSON.parse(raw) : padrao;
  } catch { return padrao; }
}

async function salvar(chave, valor) {
  try {
    if (temStorage) await window.storage.set(chave, JSON.stringify(valor), true);
    else localStorage.setItem(chave, JSON.stringify(valor));
    return true;
  } catch { return false; }
}

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
  {
    id: 'f3', nome: 'Consulta de Horário de Suporte', gatilho: 'horário', ativo: true,
    passos: [
      { id: 'p31', tipo: 'gatilho',  titulo: 'Gatilho Recebido', desc: 'Cliente digita "horário"' },
      { id: 'p32', tipo: 'mensagem', titulo: 'Informa Horário',  desc: 'Nosso atendimento funciona de segunda a sexta, das 8h às 18h.' },
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
  {
    id: 'c2', cliente: 'Ricardo Nunes', telefone: '+55 21 99123-8877',
    statusAtendimento: 'aguardando', cnpj: null, cnpjVerificado: false, lido: false,
    mensagens: [{ de: 'cliente', texto: 'Preciso da 2ª via do boleto por favor.', hora: '09:40' }],
  },
  {
    id: 'c3', cliente: 'Beatriz Santos (Empresa Exemplo LTDA)', telefone: '+55 31 98877-1122',
    statusAtendimento: 'em_atendimento', cnpj: '11222333000181', cnpjVerificado: true, lido: true,
    mensagens: [
      { de: 'cliente', texto: 'Olá, solicito atendimento para renovação contratual.', hora: '09:50' },
      { de: 'equipe',  texto: '[🤖 Automação Arka]: Por favor, informe o CNPJ da empresa para consulta.', hora: '09:51' },
      { de: 'cliente', texto: 'Meu CNPJ é 11.222.333/0001-81', hora: '09:52' },
      { de: 'equipe',  texto: '✅ CNPJ 11.222.333/0001-81 validado! Empresa Exemplo LTDA Parceiro Cadastrado.', hora: '09:52' },
    ],
  },
];

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [carregando,        setCarregando]        = useState(true);
  const [equipe,            setEquipe]            = useState([]);
  const [fluxos,            setFluxos]            = useState([]);
  const [parceiros,         setParceiros]         = useState([]);
  const [conversas,         setConversas]         = useState([]);
  const [whatsAppConectado, setWhatsAppConectado] = useState(true);

  useEffect(() => {
    (async () => {
      // Verifica versão dos dados — se diferente, reinicializa com os seeds atuais
      const versaoSalva = localStorage.getItem('arka:data_version');
      if (versaoSalva !== DATA_VERSION) {
        localStorage.removeItem('arka:equipe');
        localStorage.removeItem('arka:fluxos');
        localStorage.removeItem('arka:parceiros');
        localStorage.removeItem('arka:conversas');
        localStorage.setItem('arka:data_version', DATA_VERSION);
      }

      const [eq, fl, pa, co] = await Promise.all([
        carregar('arka:equipe',    null),
        carregar('arka:fluxos',    null),
        carregar('arka:parceiros', null),
        carregar('arka:conversas', null),
      ]);
      const eqF = eq || SEED_EQUIPE;
      const flF = fl || SEED_FLUXOS;
      const paF = pa || SEED_PARCEIROS;
      const coF = co || SEED_CONVERSAS;
      if (!eq) salvar('arka:equipe',    eqF);
      if (!fl) salvar('arka:fluxos',    flF);
      if (!pa) salvar('arka:parceiros', paF);
      if (!co) salvar('arka:conversas', coF);
      setEquipe(eqF);
      setFluxos(flF);
      setParceiros(paF);
      setConversas(coF);
      setCarregando(false);
    })();
  }, []);

  const atualizarEquipe = useCallback(async (nova) => {
    setEquipe(nova);
    await salvar('arka:equipe', nova);
  }, []);

  const atualizarFluxos = useCallback(async (novo) => {
    setFluxos(novo);
    await salvar('arka:fluxos', novo);
  }, []);

  const atualizarParceiros = useCallback(async (nova) => {
    setParceiros(nova);
    await salvar('arka:parceiros', nova);
  }, []);

  const atualizarConversas = useCallback((novaOuFn) => {
    if (typeof novaOuFn === 'function') {
      setConversas(prev => {
        const resultado = novaOuFn(prev);
        salvar('arka:conversas', resultado);
        return resultado;
      });
    } else {
      setConversas(novaOuFn);
      salvar('arka:conversas', novaOuFn);
    }
  }, []);

  return (
    <AppContext.Provider value={{
      carregando,
      equipe,            atualizarEquipe,
      fluxos,            atualizarFluxos,
      parceiros,         atualizarParceiros,
      conversas,         atualizarConversas,
      whatsAppConectado, setWhatsAppConectado,
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
