const API_BASE = '/api';

// Credenciais do operador padrao (criado pelo seed do back-end).
// Como ainda nao existe tela de login, o front autentica automaticamente.
const DEFAULT_CREDENTIALS = {
  email: 'admin@arkatecnologia.com.br',
  senha: 'Admin@123',
};

const TOKEN_KEY = 'arka_token';

const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

// Faz login e guarda o JWT. Retorna o token ou null se falhar.
let loginPromise = null;
async function login(credentials = DEFAULT_CREDENTIALS) {
  // Evita multiplos logins simultaneos (varias telas carregam ao mesmo tempo).
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Falha no login');
      const token = data?.data?.token;
      setToken(token);
      return token;
    } catch (err) {
      console.warn('[API] Falha ao autenticar:', err.message);
      setToken(null);
      return null;
    } finally {
      loginPromise = null;
    }
  })();
  return loginPromise;
}

async function request(endpoint, options = {}, _retry = true) {
  let token = getToken();
  if (!token) token = await login();

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config);

    // Token invalido/expirado: reautentica uma vez e repete a chamada.
    if (response.status === 401 && _retry) {
      setToken(null);
      const novo = await login();
      if (novo) return request(endpoint, options, false);
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'Erro na requisição');
    }
    return data.data !== undefined ? data.data : data;
  } catch (err) {
    console.warn(`[API] Fallback ou Erro em ${endpoint}:`, err.message);
    throw err;
  }
}

// ── Auth API ──
export const AuthAPI = {
  login,
  logout: () => setToken(null),
  getToken,
};

// ── Contatos API ──
export const ContatosAPI = {
  listar: (q = '') => request(`/contatos${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  criar: (dados) => request('/contatos', { method: 'POST', body: JSON.stringify(dados) }),
  atualizar: (id, dados) => request(`/contatos/${id}`, { method: 'PUT', body: JSON.stringify(dados) }),
  remover: (id) => request(`/contatos/${id}`, { method: 'DELETE' }),
};

// ── Parceiros API ──
export const ParceirosAPI = {
  listar: (q = '') => request(`/parceiros${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  criar: (dados) => request('/parceiros', { method: 'POST', body: JSON.stringify(dados) }),
  alternarStatus: (cnpj) => request(`/parceiros/${cnpj}/status`, { method: 'PATCH' }),
  remover: (cnpj) => request(`/parceiros/${cnpj}`, { method: 'DELETE' }),
};

// ── Fluxos API ──
export const FluxosAPI = {
  listar: () => request('/fluxos'),
  obter: (id) => request(`/fluxos/${id}`),
  criar: (dados) => request('/fluxos', { method: 'POST', body: JSON.stringify(dados) }),
  atualizar: (id, dados) => request(`/fluxos/${id}`, { method: 'PUT', body: JSON.stringify(dados) }),
  remover: (id) => request(`/fluxos/${id}`, { method: 'DELETE' }),
  removerTodos: () => request('/fluxos', { method: 'DELETE' }),
};

// ── Equipe API ──
export const EquipeAPI = {
  listar: () => request('/equipe'),
  criar: (dados) => request('/equipe', { method: 'POST', body: JSON.stringify(dados) }),
  atualizar: (id, dados) => request(`/equipe/${id}`, { method: 'PUT', body: JSON.stringify(dados) }),
  remover: (id) => request(`/equipe/${id}`, { method: 'DELETE' }),
};

// ── WhatsApp API ──
export const WhatsAppAPI = {
  status: () => request('/whatsapp/status'),
  conectar: () => request('/whatsapp/conectar', { method: 'POST' }),
  desconectar: () => request('/whatsapp/desconectar', { method: 'POST' }),
};

// ── Conversas API ──
export const ConversasAPI = {
  listar: () => request('/conversas'),
  atender: (id) => request(`/conversas/${id}/atender`, { method: 'POST' }),
  enviarMensagem: (id, texto) => request(`/conversas/${id}/mensagens`, { method: 'POST', body: JSON.stringify({ texto }) }),
  solicitarCnpj: (id) => request(`/conversas/${id}/solicitar-cnpj`, { method: 'POST' }),
  validarCnpj: (id, cnpj) => request(`/conversas/${id}/validar-cnpj`, { method: 'POST', body: JSON.stringify({ cnpj }) }),
  atualizarStatus: (id, status) => request(`/conversas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  marcarLido: (id) => request(`/conversas/${id}/lido`, { method: 'PATCH' }),
  remover: (id) => request(`/conversas/${id}`, { method: 'DELETE' }),
};
