const API_BASE = '/api';

const TOKEN_KEY = 'arka_token';
// Token de renovacao: mora junto com o de acesso, e sob a mesma regra do
// "Lembrar-me". Ele e que faz a sessao atravessar o vencimento do JWT sem
// jogar o operador no login no meio do atendimento.
const REFRESH_KEY = 'arka_refresh';
// Janela de inatividade informada pelo servidor no login/renovacao.
const INATIVIDADE_KEY = 'arka_sessao_inatividade';

// "Lembrar-me" decide ONDE o token mora. Marcado: localStorage, sobrevive a
// fechar o navegador. Desmarcado: sessionStorage, evapora quando a aba fecha --
// bom para maquina compartilhada. getToken olha os dois porque, num F5, so
// descobrimos onde ele parou lendo de ambos.
export const getToken = () =>
  localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);

export const getRefreshToken = () =>
  localStorage.getItem(REFRESH_KEY) || sessionStorage.getItem(REFRESH_KEY);

// O "onde" e decidido uma vez, no login, e todo o resto o respeita: numa
// renovacao nao sabemos mais se a pessoa marcou "Lembrar-me", entao deduzimos
// pelo lugar em que o token estava. Sem isso, uma renovacao promoveria uma
// sessao "so nesta aba" para uma que sobrevive ao navegador fechado.
const lembrarAtual = () => localStorage.getItem(TOKEN_KEY) !== null || localStorage.getItem(REFRESH_KEY) !== null;

function setToken(token, lembrar = true, refreshToken = null) {
  // Limpa os dois antes de gravar: sem isso, um login "nao lembrar" deixaria um
  // token antigo no localStorage e a sessao voltaria sozinha no proximo F5.
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  const onde = lembrar ? localStorage : sessionStorage;
  if (token) onde.setItem(TOKEN_KEY, token);
  if (refreshToken) onde.setItem(REFRESH_KEY, refreshToken);
}

// ── Janela de inatividade ──────────────────────────────────────────────────
//
// A sessao renova sozinha enquanto ALGUEM esta usando o painel. Essa condicao
// ("alguem esta ali") so o navegador consegue observar -- o servidor ve
// requisicao, e o painel faz polling e mantem SSE aberto mesmo com a sala
// vazia. Por isso a checagem de inatividade vive aqui: passado o limite sem
// interacao nenhuma, paramos de renovar e a sessao cai no login.
//
// Isso NAO e autorizacao: quem valida, rotaciona e revoga sessao e o servidor.
// E politica de tela, e falha fechado -- no maximo mantem uma sessao que o
// servidor ja considera valida.
let ultimaInteracao = Date.now();
export function registrarAtividade() {
  ultimaInteracao = Date.now();
}
const limiteInatividadeMs = () => Number(sessionStorage.getItem(INATIVIDADE_KEY) || localStorage.getItem(INATIVIDADE_KEY)) || 0;
// ATENCAO: NAO chamar registrarAtividade() aqui. Renovar nao e sinal de que ha
// alguem na frente da tela -- e justamente o contrario, e o automatico do
// painel. Marcar atividade a cada renovacao zerava o relogio de inatividade e
// tornava a sessao imortal: com token de 1h e janela de 12h, a aba renovava a
// cada hora e a janela nunca fechava. So interacao humana (AuthContext) e o
// login contam como atividade.
function guardarSessao(sessao, lembrar) {
  const ms = Number(sessao?.inatividadeMs) || 0;
  localStorage.removeItem(INATIVIDADE_KEY);
  sessionStorage.removeItem(INATIVIDADE_KEY);
  if (ms > 0) (lembrar ? localStorage : sessionStorage).setItem(INATIVIDADE_KEY, String(ms));
}
function inativoDemais() {
  const limite = limiteInatividadeMs();
  return limite > 0 && Date.now() - ultimaInteracao > limite;
}

// "Lembrar-me" tambem guarda o ULTIMO e-mail para pre-preencher o formulario na
// proxima visita -- so o e-mail, nunca a senha (senha em texto no navegador e o
// que a regra de seguranca proibe; quem guarda senha e o gerenciador do
// navegador, via autoComplete). Desmarcar apaga o e-mail lembrado.
const EMAIL_KEY = 'arka_email';
export const getEmailLembrado = () => localStorage.getItem(EMAIL_KEY) || '';
function lembrarEmail(email, lembrar) {
  if (lembrar && email) localStorage.setItem(EMAIL_KEY, email);
  else localStorage.removeItem(EMAIL_KEY);
}

// Avisa a aplicacao de que a sessao acabou.
//
// Antes o front trazia o e-mail e a senha do administrador embutidos e
// reautenticava sozinho a cada 401 -- ou seja, ninguem nunca saia, e as
// credenciais de admin viajavam no bundle. Agora o 401 apaga o token e emite
// este evento; quem decide o que fazer e o AuthProvider, que manda a pessoa
// para /login.
const SEM_SESSAO = 'arka:sem-sessao';
function limparSessaoLocal() {
  setToken(null);
  localStorage.removeItem(INATIVIDADE_KEY);
  sessionStorage.removeItem(INATIVIDADE_KEY);
}
function encerrarSessao() {
  limparSessaoLocal();
  window.dispatchEvent(new CustomEvent(SEM_SESSAO));
}

// Lanca Error com `.codigo` e `.campos` preenchidos a partir da resposta, para
// o formulario poder destacar o campo certo em vez de so mostrar um texto.
async function lerErro(response) {
  let corpo = null;
  try { corpo = await response.json(); } catch { /* resposta sem JSON */ }
  // Sem JSON no corpo (erro do proxy/nginx, 500 seco, timeout) a mensagem
  // generica nao dizia nada -- incluir o status ajuda a diagnosticar.
  const erro = new Error(
    corpo?.error?.message || `Não foi possível concluir a operação. (HTTP ${response.status})`
  );
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

// Renovacao da sessao, em VOO UNICO.
//
// O painel dispara varias chamadas ao mesmo tempo (conversas, status do
// WhatsApp, preferencias). Quando o token vence, todas levam 401 juntas -- se
// cada uma renovasse por conta propria, a segunda usaria um refresh token que a
// primeira acabou de queimar e o servidor leria isso como REUSO, derrubando a
// sessao justamente na hora de salva-la. Por isso a promessa e compartilhada:
// quem chega durante uma renovacao em curso espera a mesma.
let renovacaoEmCurso = null;

// Serializa a renovacao ENTRE ABAS.
//
// O voo unico acima resolve a corrida dentro de uma aba, mas o operador tem a
// Central numa aba e Fluxos em outra, e as duas compartilham o mesmo
// localStorage. Vencendo o token, as duas mandariam o MESMO refresh token, e a
// segunda seria lida pelo servidor como REUSO -- derrubando as duas sessoes.
// Web Locks resolve de verdade; onde nao existe, a checagem de "outra aba ja
// renovou" (abaixo) cobre a maior parte dos casos, e o servidor ainda tem uma
// janela de tolerancia para o duplicado honesto.
function comTrava(fn) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  if (!locks || typeof locks.request !== 'function') return fn();
  return locks.request('arka-renovar-sessao', fn);
}

/**
 * Renova a sessao. `tokenQueFalhou` e o token de acesso que levou 401: se, ao
 * chegar a nossa vez, o que esta guardado JA e outro, quem renovou foi outra
 * aba -- aproveitamos o token dela em vez de queimar o refresh de novo.
 */
async function renovarSessao(tokenQueFalhou = null) {
  if (renovacaoEmCurso) return renovacaoEmCurso;

  renovacaoEmCurso = (async () => {
    try {
      return await comTrava(async () => {
        const atual = getToken();
        if (tokenQueFalhou && atual && atual !== tokenQueFalhou) return atual;

        const refreshToken = getRefreshToken();
        if (!refreshToken) return null;
        // Ninguem na frente da tela pelo tempo do limite: nao renova. A aba
        // esquecida aberta por dias cai no login. (Um F5 zera esse relogio de
        // proposito -- recarregar e alguem ali; e voltar depois de fechar o
        // navegador continua valendo enquanto "Lembrar-me" estiver marcado.)
        if (inativoDemais()) return null;

        const lembrar = lembrarAtual();
        try {
          const data = await publico('/auth/renovar', { refreshToken });
          setToken(data.token, lembrar, data.refreshToken);
          guardarSessao(data.sessao, lembrar);
          return data.token;
        } catch {
          // Falhou: se outra aba renovou no meio disso, a sessao esta viva e o
          // token dela serve. Senao, nao ha o que renovar.
          const depois = getToken();
          return depois && depois !== tokenQueFalhou && depois !== atual ? depois : null;
        }
      });
    } finally {
      renovacaoEmCurso = null;
    }
  })();

  return renovacaoEmCurso;
}

async function request(endpoint, options = {}, jaRenovou = false) {
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
    // Token vencido nao e fim de sessao: tenta renovar UMA vez e repete a
    // requisicao. `jaRenovou` e o que impede o laco -- se o 401 voltar depois
    // da renovacao, a sessao acabou de verdade.
    if (!jaRenovou) {
      const novo = await renovarSessao(token);
      if (novo) return request(endpoint, options, true);
    }
    encerrarSessao();
    throw await lerErro(response);
  }

  if (!response.ok) throw await lerErro(response);

  const data = await response.json();
  return data.data !== undefined ? data.data : data;
}

export const AuthAPI = {
  entrar: async (email, senha, lembrar = true) => {
    const data = await publico('/auth/login', { email, senha });
    setToken(data.token, lembrar, data.refreshToken);
    guardarSessao(data.sessao, lembrar);
    // Digitar e-mail e senha e, por definicao, alguem ali: e o unico ponto
    // automatico que pode zerar o relogio de inatividade.
    registrarAtividade();
    lembrarEmail(email, lembrar);
    return data.usuario;
  },
  // Cria a conta e pronto -- nao guarda token nenhum, porque o servidor nao
  // emite token no cadastro. Entrar e um passo separado, em /login.
  cadastrar: async (dados) => {
    const data = await publico('/auth/cadastrar', dados);
    return data.usuario;
  },
  // Confirma que o token guardado ainda vale, e devolve quem e o dono dele.
  eu: () => request('/auth/me'),
  // Edita o proprio perfil (nome). O servidor usa o token para saber de quem e.
  atualizarPerfil: (dados) => request('/auth/perfil', { method: 'PATCH', body: JSON.stringify(dados) }),
  // Troca a propria senha (exige a senha atual).
  trocarSenha: (senhaAtual, novaSenha) =>
    request('/auth/senha', { method: 'PATCH', body: JSON.stringify({ senhaAtual, novaSenha }) }),
  registroInfo: async () => {
    const r = await fetch(`${API_BASE}/auth/registro-info`);
    if (!r.ok) return { exigeCodigo: false };
    return (await r.json()).data;
  },
  // Sair de verdade: avisa o servidor para revogar a sessao (a familia inteira
  // do refresh token) e SO DEPOIS limpa o navegador. Antes, "sair" apagava o
  // token daqui e pronto -- quem tivesse uma copia seguia com a sessao viva.
  //
  // O await do servidor nao decide nada: se a rede falhar, a sessao local vai
  // embora de qualquer forma. Sair da tela nunca pode depender do back-end.
  sair: async () => {
    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) await publico('/auth/sair', { refreshToken });
    } catch { /* offline ou sessao ja morta: limpa localmente do mesmo jeito */ }
    limparSessaoLocal();
  },
  // Ha sessao guardada neste navegador? Basta o refresh token: o token de acesso
  // pode ter vencido, e nesse caso a primeira chamada o renova sozinha.
  temSessaoGuardada: () => !!getToken() || !!getRefreshToken(),
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
  atualizar: (cnpj, dados) => request(`/parceiros/${cnpj}`, { method: 'PUT', body: JSON.stringify(dados) }),
  alternarStatus: (cnpj) => request(`/parceiros/${cnpj}/status`, { method: 'PATCH' }),
  remover: (cnpj) => request(`/parceiros/${cnpj}`, { method: 'DELETE' }),
  // Desmarca um contato do WhatsApp desta empresa (limpa o CNPJ das conversas
  // daquele telefone).
  desvincularContato: (cnpj, telefone) =>
    request(`/parceiros/${cnpj}/contatos/${telefone}`, { method: 'DELETE' }),
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

// ── Chatbot API ──
export const ChatbotAPI = {
  // Conversa de teste contra um fluxo. Stateless: manda a lista completa de
  // mensagens do cliente e o servidor reproduz a conversa do zero. Nao envia
  // WhatsApp e nao grava conversa nem sessao.
  simular: (dados) => request('/chatbot/simular', { method: 'POST', body: JSON.stringify(dados) }),
};

// ── Equipe API ──
// So leitura: a equipe e derivada de quem tem conta. Entrar nela e criar conta
// em /cadastrar, e o status vem da presenca observada pelo servidor.
export const EquipeAPI = {
  listar: () => request('/equipe'),
  alterarStatus: (id, ativo) => request(`/equipe/${id}/status`, { method: 'PATCH', body: JSON.stringify({ ativo }) }),
  alterarCargo: (id, cargo) => request(`/equipe/${id}/cargo`, { method: 'PATCH', body: JSON.stringify({ cargo }) }),
  // Sem recuperacao por e-mail: um Administrador define a nova senha do membro.
  redefinirSenha: (id, senha) => request(`/equipe/${id}/senha`, { method: 'PATCH', body: JSON.stringify({ senha }) }),
  excluir: (id) => request(`/equipe/${id}`, { method: 'DELETE' }),
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
  // Envio avulso (um numero) usado pela tela de Envio em Massa, um a um.
  enviar: (telefone, texto, instance) => request('/whatsapp/enviar', { method: 'POST', body: JSON.stringify({ telefone, texto, instance }) }),
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

// ── Help Desk API ──
export const HelpDeskAPI = {
  metricas: () => request('/helpdesk'),
};

// ── Relatos de Bug / Feedback ──
// `criar` e aberto a qualquer pessoa logada (botao flutuante). Listar e mudar
// status/excluir sao restritos a Administrador tambem no servidor.
export const BugsAPI = {
  criar: (dados) => request('/bugs', { method: 'POST', body: JSON.stringify(dados) }),
  listar: (status = '') => request(`/bugs${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  atualizarStatus: (id, status) => request(`/bugs/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  // Edicao na triagem: so descricao e prioridade (o servidor recusa o resto).
  atualizar: (id, { descricao, prioridade }) =>
    request(`/bugs/${id}`, { method: 'PATCH', body: JSON.stringify({ descricao, prioridade }) }),
  remover: (id) => request(`/bugs/${id}`, { method: 'DELETE' }),
};

// ── Mensagens rápidas (compartilhadas pela equipe) ──
// `listar` é aberto a qualquer pessoa logada (o painel do atendimento precisa).
// Criar/editar/excluir é restrito ao módulo "mensagens" -- o servidor barra.
export const MensagensRapidasAPI = {
  listar: () => request('/mensagens-rapidas'),
  criar: (dados) => request('/mensagens-rapidas', { method: 'POST', body: JSON.stringify(dados) }),
  atualizar: (id, dados) => request(`/mensagens-rapidas/${id}`, { method: 'PUT', body: JSON.stringify(dados) }),
  remover: (id) => request(`/mensagens-rapidas/${id}`, { method: 'DELETE' }),
};

// ── Agenda (compartilhada pela equipe) ──
// Tudo controlado pelo módulo "agenda" (o servidor barra quem não tem acesso).
export const AgendaAPI = {
  listar: () => request('/agenda'),
  criar: (dados) => request('/agenda', { method: 'POST', body: JSON.stringify(dados) }),
  atualizar: (id, dados) => request(`/agenda/${id}`, { method: 'PUT', body: JSON.stringify(dados) }),
  definirConcluido: (id, concluido) => request(`/agenda/${id}/concluido`, { method: 'PATCH', body: JSON.stringify({ concluido }) }),
  remover: (id) => request(`/agenda/${id}`, { method: 'DELETE' }),
  limparConcluidosAntigos: () => request('/agenda/concluidos-antigos', { method: 'DELETE' }),
};

// ── Permissões de perfis ──
// Matriz perfil × módulo. Só Administrador lê/edita (o servidor barra o resto).
// O acesso em si é sempre decidido no servidor; isto é só o editor.
export const PermissoesAPI = {
  obter: () => request('/permissoes'),
  salvar: (matriz) => request('/permissoes', { method: 'PUT', body: JSON.stringify(matriz) }),
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
  // Conversa nova a partir de um numero digitado. Diferente de
  // `WhatsAppAPI.enviar`, que dispara no WhatsApp mas nao registra nada na
  // Central quando o numero ainda nao tem conversa.
  iniciarConversa: ({ telefone, nome, setor, texto }) =>
    request('/conversas/iniciar', { method: 'POST', body: JSON.stringify({ telefone, nome, setor, texto }) }),
  enviarMensagem: (id, texto, respondendoAId = null) => request(`/conversas/${id}/mensagens`, { method: 'POST', body: JSON.stringify({ texto, respondendoAId }) }),
  editarMensagem: (mensagemId, texto) => request(`/conversas/mensagens/${mensagemId}`, { method: 'PATCH', body: JSON.stringify({ texto }) }),
  transcreverAudio: (mensagemId) => request(`/conversas/mensagens/${mensagemId}/transcrever`, { method: 'POST' }),
  apagarMensagem: (mensagemId) => request(`/conversas/mensagens/${mensagemId}`, { method: 'DELETE' }),
  encaminharMensagem: (mensagemId, conversaDestinoId) => request('/conversas/mensagens/encaminhar', { method: 'POST', body: JSON.stringify({ mensagemId, conversaDestinoId }) }),
  solicitarCnpj: (id) => request(`/conversas/${id}/solicitar-cnpj`, { method: 'POST' }),
  validarCnpj: (id, cnpj) => request(`/conversas/${id}/validar-cnpj`, { method: 'POST', body: JSON.stringify({ cnpj }) }),
  // Desvincula o CNPJ: a conversa volta para "CNPJ pendente".
  desvincularCnpj: (id) => request(`/conversas/${id}/cnpj`, { method: 'DELETE' }),
  atualizarStatus: (id, status) => request(`/conversas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  atualizarSetor: (id, setor) => request(`/conversas/${id}/setor`, { method: 'PATCH', body: JSON.stringify({ setor }) }),
  // Define/limpa o responsavel (compartilhado). atendenteId null = remover.
  definirAtendente: (id, atendenteId) => request(`/conversas/${id}/atendente`, { method: 'PATCH', body: JSON.stringify({ atendenteId }) }),
  avaliarAtendimento: (id, avaliacao, feedback) => request(`/conversas/${id}/avaliacao`, { method: 'POST', body: JSON.stringify({ avaliacao, feedback }) }),
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
  // Este caminho e XHR (e nao `request`) porque precisa de progresso de upload
  // e de cancelamento -- entao a renovacao de sessao tambem tem que existir
  // aqui. Um video de 20MB pode atravessar o vencimento do token: sem isto, o
  // envio morria com 401 e a tela parecia dizer que midia nao funciona.
  enviarMidia: (id, payload, onProgress) => {
    let xhrAtual = null;
    let cancelado = false;

    const disparar = (jaRenovou) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrAtual = xhr;
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
          return resolve(data && data.data !== undefined ? data.data : data);
        }
        // Mesma regra do `request`: renova UMA vez e reenvia. O upload comeca do
        // zero -- nao ha envio parcial para retomar -- e por isso a barra de
        // progresso volta ao inicio.
        if (xhr.status === 401 && !jaRenovou && !cancelado) {
          return renovarSessao(token).then(
            (novo) => (novo ? disparar(true).then(resolve, reject) : reject(new Error('Sua sessão expirou. Entre novamente para enviar.'))),
            () => reject(new Error('Sua sessão expirou. Entre novamente para enviar.'))
          );
        }
        reject(new Error(data?.error?.message || `Erro ${xhr.status} ao enviar mídia`));
      };
      xhr.onerror = () => reject(new Error('Falha de rede ao enviar mídia'));
      xhr.onabort = () => reject(new Error('cancelado'));
      xhr.send(JSON.stringify(payload));
    });

    return {
      promise: disparar(false),
      // `cancelado` trava a retentativa: cancelar durante a renovacao nao pode
      // fazer o upload reaparecer depois.
      cancel: () => { cancelado = true; if (xhrAtual) xhrAtual.abort(); },
    };
  },
};

// ── Campanhas (Envio em Massa) ──
// O disparo roda no SERVIDOR: a tela cria a campanha, manda iniciar/pausar e
// acompanha o progresso. Nada de laco de envio nem estado no navegador.
export const CampanhasAPI = {
  listar: () => request('/campanhas'),
  obter: (id) => request(`/campanhas/${id}`),
  criar: (dados) => request('/campanhas', { method: 'POST', body: JSON.stringify(dados) }),
  iniciar: (id) => request(`/campanhas/${id}/iniciar`, { method: 'POST' }),
  pausar: (id) => request(`/campanhas/${id}/pausar`, { method: 'POST' }),
  cancelar: (id) => request(`/campanhas/${id}/cancelar`, { method: 'POST' }),
  remover: (id) => request(`/campanhas/${id}`, { method: 'DELETE' }),
};
