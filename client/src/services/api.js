const API_BASE = '/api';

const TOKEN_KEY = 'arka_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

// Avisa a aplicacao de que a sessao acabou.
//
// Antes o front trazia o e-mail e a senha do administrador embutidos e
// reautenticava sozinho a cada 401 -- ou seja, ninguem nunca saia, e as
// credenciais de admin viajavam no bundle. Agora o 401 apaga o token e emite
// este evento; quem decide o que fazer e o AuthProvider, que manda a pessoa
// para /login.
const SEM_SESSAO = 'arka:sem-sessao';
function encerrarSessao() {
  setToken(null);
  window.dispatchEvent(new CustomEvent(SEM_SESSAO));
}

// Lanca Error com `.codigo` e `.campos` preenchidos a partir da resposta, para
// o formulario poder destacar o campo certo em vez de so mostrar um texto.
async function lerErro(response) {
  let corpo = null;
  try { corpo = await response.json(); } catch { /* resposta sem JSON */ }
  const erro = new Error(corpo?.error?.message || 'Não foi possível concluir a operação.');
  erro.codigo = corpo?.error?.code || null;
  erro.status = response.status;
  erro.campos = {};
  for (const d of corpo?.error?.details || []) {
    if (d?.field) erro.campos[d.field] = d.message;
  }
  return erro;
}

async function publico(endpoint, body) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await lerErro(response);
  const data = await response.json();
  return data.data !== undefined ? data.data : data;
}

async function request(endpoint, options = {}) {
  const token = getToken();

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, config);

  if (response.status === 401) {
    encerrarSessao();
    throw await lerErro(response);
  }

  if (!response.ok) throw await lerErro(response);

  const data = await response.json();
  return data.data !== undefined ? data.data : data;
}

export const AuthAPI = {
  entrar: async (email, senha) => {
    const data = await publico('/auth/login', { email, senha });
    setToken(data.token);
    return data.usuario;
  },
  cadastrar: async (dados) => {
    const data = await publico('/auth/cadastrar', dados);
    setToken(data.token);
    return data.usuario;
  },
  // Confirma que o token guardado ainda vale, e devolve quem e o dono dele.
  eu: () => request('/auth/me'),
  registroInfo: async () => {
    const r = await fetch(`${API_BASE}/auth/registro-info`);
    if (!r.ok) return { exigeCodigo: false };
    return (await r.json()).data;
  },
  sair: () => setToken(null),
  EVENTO_SEM_SESSAO: SEM_SESSAO,
};

// ── Auth API ──
// ── Contatos API ──
export const ContatosAPI = {
  listar: (q = '') => request(`/contatos${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  criar: (dados) => request('/contatos', { method: 'POST', body: JSON.stringify(dados) }),
  atualizar: (id, dados) => request(`/contatos/${id}`, { method: 'PUT', body: JSON.stringify(dados) }),
  remover: (id) => request(`/contatos/${id}`, { method: 'DELETE' }),
  // Importa a agenda real do WhatsApp conectado (via Evolution).
  sincronizar: (instance) => request('/contatos/sincronizar', { method: 'POST', body: JSON.stringify({ instance }) }),
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
const qs = (instance) => (instance ? `?instance=${encodeURIComponent(instance)}` : '');
export const WhatsAppAPI = {
  status: (instance) => request(`/whatsapp/status${qs(instance)}`),
  detalhes: (instance) => request(`/whatsapp/detalhes${qs(instance)}`),
  qrcode: (instance) => request(`/whatsapp/qrcode${qs(instance)}`),
  conectar: (instance) => request('/whatsapp/conectar', { method: 'POST', body: JSON.stringify({ instance }) }),
  desconectar: (instance) => request('/whatsapp/desconectar', { method: 'POST', body: JSON.stringify({ instance }) }),
  reiniciar: (instance) => request('/whatsapp/reiniciar', { method: 'POST', body: JSON.stringify({ instance }) }),
  excluir: (instance) => request('/whatsapp/instancia', { method: 'DELETE', body: JSON.stringify({ instance }) }),
};

// ── n8n API ──
export const N8nAPI = {
  status: () => request('/n8n/status'),
  listar: () => request('/n8n/workflows'),
  criar: (nome) => request('/n8n/workflows', { method: 'POST', body: JSON.stringify({ nome }) }),
  renomear: (id, nome) => request(`/n8n/workflows/${id}`, { method: 'PUT', body: JSON.stringify({ nome }) }),
  alternarAtivo: (id, ativo) => request(`/n8n/workflows/${id}/ativo`, { method: 'PATCH', body: JSON.stringify({ ativo }) }),
  executar: (id, payload = {}) => request(`/n8n/workflows/${id}/executar`, { method: 'POST', body: JSON.stringify({ payload }) }),
  remover: (id) => request(`/n8n/workflows/${id}`, { method: 'DELETE' }),
};

// ── Preferências de interface (por operador) ──
export const PreferenciasAPI = {
  obter: (chave) => request(`/preferencias/${encodeURIComponent(chave)}`),
  salvar: (chave, valor) => request(`/preferencias/${encodeURIComponent(chave)}`, {
    method: 'PUT',
    body: JSON.stringify({ valor }),
  }),
};

// ── Configurações API ──
export const ConfiguracoesAPI = {
  obter: () => request('/configuracoes'),
  salvar: (valores) => request('/configuracoes', { method: 'PUT', body: JSON.stringify(valores) }),
  testar: (servico) => request(`/configuracoes/testar/${servico}`, { method: 'POST' }),
};

// ── Conversas API ──
export const ConversasAPI = {
  listar: () => request('/conversas'),
  atender: (id) => request(`/conversas/${id}/atender`, { method: 'POST' }),
  enviarMensagem: (id, texto, respondendoAId = null) => request(`/conversas/${id}/mensagens`, { method: 'POST', body: JSON.stringify({ texto, respondendoAId }) }),
  editarMensagem: (mensagemId, texto) => request(`/conversas/mensagens/${mensagemId}`, { method: 'PATCH', body: JSON.stringify({ texto }) }),
  encaminharMensagem: (mensagemId, conversaDestinoId) => request('/conversas/mensagens/encaminhar', { method: 'POST', body: JSON.stringify({ mensagemId, conversaDestinoId }) }),
  solicitarCnpj: (id) => request(`/conversas/${id}/solicitar-cnpj`, { method: 'POST' }),
  validarCnpj: (id, cnpj) => request(`/conversas/${id}/validar-cnpj`, { method: 'POST', body: JSON.stringify({ cnpj }) }),
  atualizarStatus: (id, status) => request(`/conversas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  // Atalhos de status (os 3 estados da Central).
  pendente: (id) => request(`/conversas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'pendente' }) }),
  fechar: (id) => request(`/conversas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'fechada' }) }),
  reabrir: (id) => request(`/conversas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'aberta' }) }),
  marcarLido: (id) => request(`/conversas/${id}/lido`, { method: 'PATCH' }),
  // Favoritar / fixar / arquivar / ocultar persistido no banco (nao apaga nada).
  atualizarFlags: (id, flags) => request(`/conversas/${id}/flags`, { method: 'PATCH', body: JSON.stringify(flags) }),
  remover: (id) => request(`/conversas/${id}`, { method: 'DELETE' }),
  // Ticket de uso unico para autenticar o EventSource (SSE) sem JWT na URL.
  streamTicket: () => request('/conversas/stream-ticket', { method: 'POST' }),
  // Envio de midia via XHR: expoe progresso de upload e permite cancelar.
  // Retorna { promise, cancel }.
  enviarMidia: (id, payload, onProgress) => {
    const xhr = new XMLHttpRequest();
    const promise = new Promise((resolve, reject) => {
      xhr.open('POST', `${API_BASE}/conversas/${id}/midia`);
      xhr.setRequestHeader('Content-Type', 'application/json');
      const token = getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* resposta vazia */ }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data && data.data !== undefined ? data.data : data);
        } else {
          reject(new Error(data?.error?.message || `Erro ${xhr.status} ao enviar mídia`));
        }
      };
      xhr.onerror = () => reject(new Error('Falha de rede ao enviar mídia'));
      xhr.onabort = () => reject(new Error('cancelado'));
      xhr.send(JSON.stringify(payload));
    });
    return { promise, cancel: () => xhr.abort() };
  },
};
