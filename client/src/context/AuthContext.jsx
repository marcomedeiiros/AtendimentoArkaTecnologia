/**
 * Sessao do operador.
 *
 * Fica FORA do AppProvider de proposito: as telas de acesso nao devem carregar
 * conversas, fluxos nem abrir SSE. Quem esta na tela de login ainda nao tem
 * permissao para nada disso, e sem essa separacao o painel dispararia um punhado
 * de 401 antes mesmo de a pessoa digitar o e-mail.
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AuthAPI, PreferenciasAPI, registrarAtividade } from '../services/api';
import { aplicarTemaAcesso } from '../utils/tema';
import AvisoSessao from '../components/AvisoSessao';

const AuthContext = createContext(null);

// Preferencia (por usuario, no servidor) com o nome usado ao assinar mensagens.
const CHAVE_ASSINATURA = 'central.assinatura.nome';
// Preferencia (por usuario, no servidor) com o tema escolhido (claro/escuro).
const CHAVE_TEMA = 'interface.tema';
const primeiroNomeDe = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';

// Entrada e saida cobrem a tela inteira, entao saem rapido: tempo de ler a
// frase e nada mais. O aviso de sessao expirada e uma faixa que nao bloqueia
// nada, e pode ficar o dobro -- costuma chegar quando a pessoa nem estava
// olhando para a tela.
const DURACAO = { entrada: 1800, saida: 1800, expirou: 5000 };

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  // `verificando` cobre a janela entre abrir a pagina e saber se o token
  // guardado ainda vale. Sem esse estado, um F5 dentro do painel piscaria a
  // tela de login antes de o /auth/me responder.
  const [verificando, setVerificando] = useState(true);
  const [aviso, setAviso] = useState(null);
  const timerAviso = useRef(null);
  // Nome de assinatura personalizado (null = ainda nao carregado / usa o padrao).
  const [assinaturaCustom, setAssinaturaCustom] = useState(null);
  // Tema efetivo APOS o login (claro/escuro). Antes do login e sempre escuro.
  const [tema, setTema] = useState('dark');

  const avisar = useCallback((texto, tipo = 'entrada') => {
    clearTimeout(timerAviso.current);
    setAviso({ texto, tipo });
    timerAviso.current = setTimeout(() => setAviso(null), DURACAO[tipo] ?? 2000);
  }, []);

  useEffect(() => () => clearTimeout(timerAviso.current), []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      // Basta ter sessao guardada: se o token de acesso venceu (turno de 8h,
      // navegador reaberto dias depois), o proprio /auth/me renova sozinho por
      // dentro -- e por isso que o F5 nao joga mais ninguem no login.
      if (!AuthAPI.temSessaoGuardada()) { setVerificando(false); return; }
      try {
        const eu = await AuthAPI.eu();
        if (vivo) setUsuario(eu);
      } catch {
        // Nao deu nem para renovar (sessao revogada, expirada ou reusada):
        // segue para o login sem alarde.
        AuthAPI.sair();
      } finally {
        if (vivo) setVerificando(false);
      }
    })();
    return () => { vivo = false; };
  }, []);

  // Sinal de "tem alguem aqui", que sustenta a sessao deslizante. A renovacao
  // consulta este relogio: passado o limite de inatividade sem nenhum destes
  // eventos, ela para e a sessao cai no login. Passivo e capturante para nao
  // competir com nenhum handler da aplicacao.
  useEffect(() => {
    const eventos = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    const aoInteragir = () => registrarAtividade();
    const aoVoltar = () => { if (document.visibilityState === 'visible') registrarAtividade(); };
    eventos.forEach(e => window.addEventListener(e, aoInteragir, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      eventos.forEach(e => window.removeEventListener(e, aoInteragir, { capture: true }));
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, []);

  // Qualquer 401 vindo de qualquer chamada derruba a sessao aqui. Antes isso
  // acontecia em silencio e a pessoa era jogada no login sem entender por que.
  useEffect(() => {
    const aoPerderSessao = () => {
      setUsuario(atual => {
        if (atual) avisar('Sua sessão expirou. Entre novamente para continuar.', 'expirou');
        return null;
      });
      // Volta ao tema fixo de acesso: a tela de login nao herda o tema pessoal.
      setTema('dark');
      aplicarTemaAcesso();
    };
    window.addEventListener(AuthAPI.EVENTO_SEM_SESSAO, aoPerderSessao);
    return () => window.removeEventListener(AuthAPI.EVENTO_SEM_SESSAO, aoPerderSessao);
  }, [avisar]);

  // Carrega o nome de assinatura personalizado quando ha usuario logado. Vazio
  // = usa o padrao (primeiro nome). null enquanto nao carregou.
  useEffect(() => {
    if (!usuario?.id) { setAssinaturaCustom(null); return; }
    let vivo = true;
    PreferenciasAPI.obter(CHAVE_ASSINATURA)
      .then((r) => { if (vivo) setAssinaturaCustom(typeof r?.valor === 'string' ? r.valor : ''); })
      .catch(() => { if (vivo) setAssinaturaCustom(''); });
    return () => { vivo = false; };
  }, [usuario?.id]);

  // Carrega o tema pessoal (preferencia por usuario) quando ha alguem logado.
  // IMPORTANTE: aqui so guardamos o valor em estado -- quem APLICA no DOM e o
  // AppLayout, e so DEPOIS que o painel termina de carregar. Assim a tela de
  // carregamento ("Inicializando...") e a de "Verificando sessao" ficam sempre
  // no escuro fixo do boot; o claro/escuro escolhido so entra com o painel
  // pronto. Sem preferencia salva: escuro (padrao).
  useEffect(() => {
    if (!usuario?.id) return;
    let vivo = true;
    PreferenciasAPI.obter(CHAVE_TEMA)
      .then((r) => { if (vivo) setTema(r?.valor === 'light' ? 'light' : 'dark'); })
      .catch(() => { if (vivo) setTema('dark'); });
    return () => { vivo = false; };
  }, [usuario?.id]);

  // Alterna e SALVA o tema no backend (preferencia por usuario). Nao aplica no
  // DOM aqui: o AppLayout reage a mudanca de `tema` e aplica (painel ja pronto).
  const alternarTema = useCallback(() => {
    setTema((atual) => {
      const novo = atual === 'light' ? 'dark' : 'light';
      PreferenciasAPI.salvar(CHAVE_TEMA, novo).catch(() => {});
      return novo;
    });
  }, []);

  // Salva o nome de assinatura (preferencia por usuario). Reativo: como fica no
  // AuthContext, a Central e o menu de perfil enxergam o mesmo valor na hora.
  const salvarAssinatura = useCallback((nome) => {
    const limpo = String(nome || '').trim();
    setAssinaturaCustom(limpo);
    return PreferenciasAPI.salvar(CHAVE_ASSINATURA, limpo).catch(() => {});
  }, []);

  // Atualiza em memoria o usuario logado (ex.: apos editar o nome no perfil),
  // para o painel refletir sem precisar de F5.
  const atualizarUsuario = useCallback((parcial) => {
    setUsuario((u) => (u ? { ...u, ...parcial } : u));
  }, []);

  const entrar = useCallback(async (email, senha, lembrar = true) => {
    const eu = await AuthAPI.entrar(email, senha, lembrar);
    setUsuario(eu);
    // Saudacao curta: primeiro + ultimo nome (2 nomes, incluindo o sobrenome),
    // nao o nome inteiro nem so o primeiro. Nome de uma palavra so aparece ele.
    const partes = String(eu.nome || '').trim().split(/\s+/).filter(Boolean);
    const nomeCurto = partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1]}` : (partes[0] || '');
    avisar(`Você entrou como ${nomeCurto}.`, 'entrada');
    return eu;
  }, [avisar]);

  // Cadastrar NAO autentica: o servidor nao devolve token, e quem acabou de
  // criar a conta passa pelo login como qualquer outra pessoa.
  const cadastrar = useCallback((dados) => AuthAPI.cadastrar(dados), []);

  const sair = useCallback(() => {
    // Sem await: a tela sai NA HORA. O AuthAPI.sair cuida de avisar o servidor
    // (revogando a sessao) e de limpar o navegador mesmo se a rede falhar.
    AuthAPI.sair();
    setUsuario(null);
    // Ao sair, a interface volta ao tema escuro fixo das telas de acesso.
    setTema('dark');
    aplicarTemaAcesso();
    avisar('Você saiu da plataforma.', 'saida');
  }, [avisar]);

  // Nome efetivo da assinatura: o personalizado, ou o primeiro nome como padrao.
  const assinaturaNome = (assinaturaCustom && assinaturaCustom.trim()) || primeiroNomeDe(usuario?.nome);

  return (
    <AuthContext.Provider value={{
      usuario, verificando, entrar, cadastrar, sair, avisar,
      atualizarUsuario,
      assinaturaNome, assinaturaCustom, salvarAssinatura,
      tema, alternarTema,
    }}>
      {children}
      <AvisoSessao aviso={aviso} onFechar={() => setAviso(null)} />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
