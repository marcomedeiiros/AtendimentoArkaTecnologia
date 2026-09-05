const API_BASE = '/api';

// ── ONDE A SESSAO MORA ─────────────────────────────────────────────────────
//
// Ela mora em COOKIE HttpOnly, gravado pelo servidor. Isso significa que este
// arquivo NAO consegue le-la -- e esse e exatamente o ponto: se o JavaScript
// desta pagina nao le, o JavaScript de um XSS tambem nao. Antes a sessao ficava
// em `localStorage`, ao alcance de qualquer script injetado, e um unico XSS
// levava a credencial inteira embora.
//
// O que sobrou aqui e o necessario para conversar com esse esquema:
//
//   `arka_csrf`   cookie LEGIVEL de proposito. Copiado para o header
//                 `X-CSRF-Token` a cada escrita: um site externo consegue fazer
//                 o navegador ENVIAR nossos cookies, mas nao consegue LE-LOS, e
//                 por isso nao monta este header. Serve tambem como a resposta
//                 para "ha sessao neste navegador?", ja que os outros cookies
//                 sao invisiveis daqui.
//
//   as chaves de localStorage abaixo continuam existindo SO PARA MIGRAR quem ja
//   estava logado quando isto subiu. A primeira renovacao troca por cookies e
//   apaga o que havia. Ver `apagarLegado`.
const CSRF_COOKIE = 'arka_csrf';

function lerCookie(nome) {
  const alvo = `${nome}=`;
  for (const parte of String(document.cookie || '').split(';')) {
    const c = parte.trim();
    if (c.startsWith(alvo)) return decodeURIComponent(c.slice(alvo.length));
  }
  return '';
}

// Marca legivel que acompanha a sessao. Nao E a sessao -- e so o sinal de que
// existe uma, e o valor que prova que a requisicao partiu daqui.
const marcaSessao = () => lerCookie(CSRF_COOKIE);

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

/**
 * Apaga os tokens antigos do navegador.
 *
 * Chamado assim que o servidor confirma uma sessao em COOKIE. E o fim da
 * migracao: quem ja estava logado quando isto subiu tinha a sessao em
 * `localStorage`, e ela continuaria la, legivel por qualquer script, mesmo com
 * os cookies novos funcionando. Deixar os dois seria ficar com a porta velha
 * aberta ao lado da porta nova.
 *
 * Nao mexe na janela de inatividade nem no e-mail lembrado: aquilo e preferencia
 * de tela, nao credencial.
 */
function apagarLegado() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}

/**
 * Cabecalhos de toda requisicao autenticada.
 *
 * `X-CSRF-Token` devolve o valor do cookie legivel. Um site externo consegue
 * fazer o navegador ENVIAR nossos cookies, mas nao consegue LE-LOS -- entao nao
 * tem como montar este header. E o "double submit" que o servidor confere.
 *
 * `Authorization` so aparece enquanto houver token antigo guardado: e a ponte
 * para quem ainda nao migrou. Depois do primeiro login/renovacao com cookie ele
 * some, e a sessao passa a viajar so em cookie HttpOnly.
 */
function cabecalhosDeSessao(extra = {}) {
  const csrf = marcaSessao();
  const antigo = getToken();
  return {
    'Content-Type': 'application/json',
    ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    ...(antigo ? { Authorization: `Bearer ${antigo}` } : {}),
    ...extra,
  };
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
  // A MENSAGEM PODE NÃO SER STRING. `new Error(objeto)` chama ToString e grava
  // literalmente "[object Object]" -- foi assim que a tela de Integração
  // WhatsApp passou a exibir "Não foi possível falar com a Evolution API:
  // [object Object]". O servidor já foi corrigido para nunca mandar objeto
  // aqui; esta guarda é a segunda linha, para qualquer outra rota que ainda
  // possa mandar.
  const bruto = corpo?.error?.message;
  const texto =
    typeof bruto === 'string' && bruto.trim()
      ? bruto
      : bruto != null
        ? (() => { try { return JSON.stringify(bruto); } catch { return ''; } })()
        : '';

  const erro = new Error(texto || `Não foi possível concluir a operação. (HTTP ${response.status})`);
  erro.codigo = corpo?.error?.code || null;
  erro.status = response.status;
  // Contexto técnico da integração que falhou (endpoint, HTTP da origem, corpo
  // da resposta). Quem quiser mostrar "erro AQUI" em vez de "erro" usa isto.
  erro.diagnostico = corpo?.error?.diagnostico || null;
  erro.campos = {};
  for (const d of corpo?.error?.details || []) {
    if (d?.field) erro.campos[d.field] = d.message;
  }
  return erro;
}

// `credentials: 'same-origin'` e o que faz o navegador MANDAR os cookies de
// sessao -- e tambem receber os que o servidor grava no login. Sem isso, o
// login responderia 200, os cookies seriam descartados em silencio, e a proxima
// requisicao chegaria deslogada sem nenhum erro visivel.
//
// `same-origin` e nao `include`: painel e API saem do mesmo host (o nginx),
// entao nao ha motivo para mandar credencial para qualquer outra origem.
async function publico(endpoint, body) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: cabecalhosDeSessao(),
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

        // O refresh pode vir de DOIS lugares, e nesta ordem de preferencia:
        //   - o cookie `arka_renovacao` (HttpOnly, invisivel daqui): entao nao
        //     ha o que mandar no corpo, e a presenca do cookie legivel de CSRF
        //     e o unico sinal de que existe sessao neste navegador;
        //   - o `localStorage`, para quem ainda nao migrou.
        // Sem a primeira condicao, a renovacao desistiria sempre no modo novo --
        // e a sessao cairia no login a cada vencimento do token de acesso.
        const refreshToken = getRefreshToken();
        const marcaAntes = marcaSessao();
        if (!refreshToken && !marcaAntes) return null;
        // Ninguem na frente da tela pelo tempo do limite: nao renova. A aba
        // esquecida aberta por dias cai no login. (Um F5 zera esse relogio de
        // proposito -- recarregar e alguem ali; e voltar depois de fechar o
        // navegador continua valendo enquanto "Lembrar-me" estiver marcado.)
        if (inativoDemais()) return null;

        const lembrar = lembrarAtual();
        try {
          // Corpo com o token antigo SO enquanto ele existir. Com cookie, o
          // corpo vai vazio e quem identifica a sessao e o proprio cookie.
          const data = await publico('/auth/renovar', refreshToken ? { refreshToken } : {});
          if (data?.csrfToken) {
            // O servidor gravou cookies: a sessao mudou de lugar e o que estava
            // no navegador vira lixo perigoso. Fim da migracao para esta aba.
            apagarLegado();
          } else {
            setToken(data.token, lembrar, data.refreshToken);
          }
          guardarSessao(data.sessao, lembrar);
          return data.token || marcaSessao() || 'ok';
        } catch {
          // Falhou: se OUTRA ABA renovou no meio disso, a sessao esta viva e
          // nao ha o que fazer alem de aproveitar. No modo antigo isso se via
          // pelo token guardado; no modo cookie, pela marca de CSRF ter mudado
          // -- o servidor emite uma nova a cada renovacao.
          const marcaAgora = marcaSessao();
          if (marcaAgora && marcaAgora !== marcaAntes) return marcaAgora;
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
    credentials: 'same-origin',
    ...options,
    headers: cabecalhosDeSessao(options.headers),
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
  // `turnstileToken` vem do widget e viaja no corpo do login. Ele NAO prova
  // nada sozinho: quem valida e o servidor, perguntando a Cloudflare. Aqui ele
  // e apenas mais um campo do formulario.
  //
  // Esta assinatura precisa acompanhar a do AuthContext e a da LoginPage -- se
  // uma das tres ficar para tras, o token e descartado em silencio e o servidor
  // responde "token-ausente", com o widget mostrando "Sucesso!" na tela. Foi
  // exatamente o que aconteceu quando so este arquivo ficou sem atualizar.
  entrar: async (email, senha, lembrar = true, turnstileToken = null) => {
    const data = await publico('/auth/login', {
      email,
      senha,
      lembrar,
      ...(turnstileToken ? { turnstileToken } : {}),
    });
    // Se o servidor gravou cookies (`csrfToken` na resposta), a sessao mora
    // neles e NADA e guardado aqui -- e o ponto da mudanca: o que este arquivo
    // nao guarda, um XSS nao rouba. O `else` cobre uma API antiga durante um
    // deploy pela metade, para o login nao quebrar por causa disso.
    if (data?.csrfToken) apagarLegado();
    else setToken(data.token, lembrar, data.refreshToken);
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

  /**
   * Configuração pública do Turnstile, vinda do SERVIDOR.
   *
   * A site key não está no bundle de propósito: assim não existe nenhuma
   * variável de ambiente do Turnstile do lado do cliente, e trocar a chave na
   * Cloudflare não exige rebuild do front. A secret nunca passa por aqui ela
   * só existe no processo do servidor.
   *
   * Falha silenciosa devolvendo `ativo: false`: se esta chamada quebrar, o
   * widget simplesmente não aparece e o login segue funcionando. O contrário
   * (derrubar a tela de login porque uma consulta de configuração falhou) foi
   * exatamente o incidente que motivou trazer isto por inteiro.
   */
  turnstile: async () => {
    try {
      const r = await fetch(`${API_BASE}/auth/turnstile`);
      if (!r.ok) return { ativo: false, siteKey: null };
      return (await r.json()).data;
    } catch {
      return { ativo: false, siteKey: null };
    }
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
      // Chama o servidor SEMPRE que houver qualquer sinal de sessao -- e nao so
      // quando existe token guardado. Com a sessao em cookie nao ha nada
      // guardado aqui, e a condicao antiga faria o "Sair" apenas limpar a tela:
      // a sessao continuaria VIVA no servidor e os cookies no navegador, de
      // volta ao primeiro F5. Quem revoga e o servidor; isto aqui e so o pedido.
      if (refreshToken || marcaSessao()) {
        await publico('/auth/sair', refreshToken ? { refreshToken } : {});
      }
    } catch { /* offline ou sessao ja morta: limpa localmente do mesmo jeito */ }
    limparSessaoLocal();
    apagarLegado();
  },
  /**
   * SAIR DE TODOS OS DISPOSITIVOS.
   *
   * Quem encerra e o SERVIDOR: ele revoga todas as familias de refresh da conta,
   * e como o token de acesso carrega o id da sessao, os que ja estao em
   * circulacao param de valer na hora -- inclusive na maquina de outra pessoa.
   *
   * Limpar este navegador aqui e CONSEQUENCIA, nunca a acao em si. Se fosse so
   * isso, o botao apagaria o proprio login e deixaria intacta exatamente a
   * sessao de quem invadiu -- o contrario do que ele promete.
   *
   * Por isso tambem nao ha `try/catch` engolindo o erro, ao contrario do `sair`:
   * ali limpar localmente ja resolve o que o usuario queria; aqui, se o servidor
   * nao confirmou, nada foi encerrado, e a tela precisa dizer isso.
   */
  sairDeTodos: async () => {
    const r = await request('/auth/sair-todos', { method: 'POST' });
    limparSessaoLocal();
    return r;
  },
  // Ha sessao guardada neste navegador? Basta o refresh token: o token de acesso
  // pode ter vencido, e nesse caso a primeira chamada o renova sozinha.
  // Ha sessao neste navegador?
  //
  // Nao da mais para responder olhando o token: ele esta num cookie HttpOnly,
  // invisivel daqui -- e e essa invisibilidade que protege a sessao. Quem
  // responde e a MARCA legivel (`arka_csrf`), que o servidor grava junto. Ela
  // nao autentica nada; so diz "existe uma sessao aqui", que e o suficiente
  // para o painel decidir entre tentar carregar e mandar para o login.
  //
  // Os tokens antigos continuam contando enquanto houver quem nao migrou.
  temSessaoGuardada: () => !!marcaSessao() || !!getToken() || !!getRefreshToken(),
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
  // Nao ha `desvincularContato`: desassociar um CNPJ e decisao do cliente,
  // tomada no fluxo do bot. A rota correspondente tambem foi removida do
  // servidor -- ver parceiro.routes.js.
};

// ── Relatorios por cliente (CNPJ) ──
//
// Vem do SERVIDOR, e nao das `conversas` que o painel ja tem em maos: a
// listagem da Central e filtrada por setor para quem nao e Administrador, e um
// relatorio montado a partir dela sairia sem os chamados dos outros setores --
// sem nada na tela indicando a falta. O documento vai para o cliente.
export const RelatoriosAPI = {
  // `periodo`: dia | 7dias | mes | ano. `referencia` (AAAA-MM-DD) permite gerar
  // um periodo passado; ausente = hoje.
  clientes: (periodo = 'mes', referencia = null) =>
    request(`/relatorios/clientes?periodo=${encodeURIComponent(periodo)}${referencia ? `&referencia=${referencia}` : ''}`),
  empresa: (cnpj, periodo = 'mes', referencia = null) =>
    request(`/relatorios/clientes/${encodeURIComponent(cnpj)}?periodo=${encodeURIComponent(periodo)}${referencia ? `&referencia=${referencia}` : ''}`),
};

// ── Fluxos API ──
export const FluxosAPI = {
  listar: () => request('/fluxos'),
  obter: (id) => request(`/fluxos/${id}`),
  criar: (dados) => request('/fluxos', { method: 'POST', body: JSON.stringify(dados) }),
  atualizar: (id, dados) => request(`/fluxos/${id}`, { method: 'PUT', body: JSON.stringify(dados) }),
  remover: (id) => request(`/fluxos/${id}`, { method: 'DELETE' }),
  // `removerTodos` saiu daqui junto com o botão "Apagar todos os fluxos" e com
  // a rota `DELETE /api/fluxos`. Apagar toda a automação do bot de uma vez não
  // tem desfazer, e a exclusão individual acima cobre o uso legítimo.
  // Retrato de TODAS as regras do bot, fluxo a fluxo (painel Automacoes do BOT).
  automacoes: () => request('/fluxos/automacoes/resumo'),

  // ── BLOCOS ───────────────────────────────────────────────────────────────
  //
  // `atualizar` acima continua sendo o "salvar o desenho inteiro" (mover bloco,
  // ligar fio, importar JSON). O que vem abaixo é a edição PONTUAL de um bloco,
  // que o botão Salvar do painel de propriedades usa.
  //
  // A diferença que justifica as duas existirem não é o tamanho do corpo: é que
  // mandando o fluxo inteiro, duas abas editando blocos DIFERENTES do mesmo
  // fluxo se sobrescreviam cada PUT levava junto a versão antiga do bloco da
  // outra. Tocando só a própria linha, as duas edições sobrevivem.
  //
  // Todas devolvem o FLUXO inteiro, e não só o bloco: o editor precisa
  // reconciliar ligações e ordem, e uma resposta parcial o obrigaria a
  // adivinhar o resto.
  criarPasso: (fluxoId, passo) =>
    request(`/fluxos/${fluxoId}/passos`, { method: 'POST', body: JSON.stringify(passo) }),
  obterPasso: (fluxoId, passoId) => request(`/fluxos/${fluxoId}/passos/${passoId}`),
  atualizarPasso: (fluxoId, passoId, campos) =>
    request(`/fluxos/${fluxoId}/passos/${passoId}`, { method: 'PATCH', body: JSON.stringify(campos) }),
  removerPasso: (fluxoId, passoId) =>
    request(`/fluxos/${fluxoId}/passos/${passoId}`, { method: 'DELETE' }),
  reordenarPassos: (fluxoId, ids) =>
    request(`/fluxos/${fluxoId}/passos/ordem`, { method: 'PATCH', body: JSON.stringify({ ids }) }),
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
  // Setores EXTRAS -- os que a pessoa ve alem do que o cargo ja da. A lista
  // enviada e a lista final: o servidor descarta o que o cargo ja dava.
  alterarSetores: (id, setores) => request(`/equipe/${id}/setores`, { method: 'PATCH', body: JSON.stringify({ setores }) }),
  // Sem recuperacao por e-mail: um Administrador define a nova senha do membro.
  redefinirSenha: (id, senha) => request(`/equipe/${id}/senha`, { method: 'PATCH', body: JSON.stringify({ senha }) }),
  // Em QUAIS rankings a pessoa concorre: { equipes: ["sede","externo"] }. Vai a
  // lista final, e nao "adicione esta".
  alterarRanking: (id, dados) => request(`/equipe/${id}/ranking`, { method: 'PATCH', body: JSON.stringify(dados) }),
  excluir: (id) => request(`/equipe/${id}`, { method: 'DELETE' }),
};

/**
 * RANKINGS de desempenho -- dois, e nunca misturados.
 *
 * `equipe` e "sede" ou "externo". A pontuacao da sede e a MESMA do painel de
 * parede (o servidor reaproveita a funcao, nao ha segunda formula); a do
 * externo sai dos mapeamentos tecnicos.
 */
export const RankingsAPI = {
  obter: (equipe, competencia) =>
    request(`/rankings/${equipe}${competencia ? `?competencia=${competencia}` : ''}`),
  historico: (equipe, competencia, meses = 6) =>
    request(`/rankings/${equipe}/historico?meses=${meses}${competencia ? `&competencia=${competencia}` : ''}`),
  equipes: () => request('/rankings/equipes'),
  // Pesos e faixas da formula externa, para a tela explicar a posicao sem
  // repetir numero de regra no front.
  regras: () => request('/rankings/regras'),

  premiacoes: (competencia) =>
    request(`/rankings/premiacoes${competencia ? `?competencia=${competencia}` : ''}`),
  registrarPremiacao: (dados) => request('/rankings/premiacoes', { method: 'POST', body: JSON.stringify(dados) }),
  removerPremiacao: (id) => request(`/rankings/premiacoes/${id}`, { method: 'DELETE' }),

  // ── mapeamentos tecnicos (a fonte do ranking externo) ──
  listarMapeamentos: (filtros = {}) => {
    const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v));
    return request(`/rankings/mapeamentos${q.toString() ? `?${q}` : ''}`);
  },
  obterMapeamento: (id) => request(`/rankings/mapeamentos/${id}`),
  // LE o PDF e devolve o que ele diz (empresa, data, fotos, itens cobertos).
  // Nao cria nada: a resposta e SUGESTAO para o formulario, e quem confirma e
  // a pessoa. O arquivo sobe de novo no salvar -- aqui nada fica guardado.
  analisarMapeamento: (arquivo) => request('/rankings/mapeamentos/analisar', { method: 'POST', body: JSON.stringify({ arquivo }) }),
  // CONFIGURACAO dos relatorios -- so administrador (o servidor recusa os
  // outros nos dois verbos, inclusive na leitura: a tela expoe os pesos da
  // pontuacao, e quem e avaliado nao descobre a regua antes de ela ser
  // anunciada.
  configuracaoRelatorios: () => request('/rankings/configuracao'),
  salvarConfiguracaoRelatorios: (regras) => request('/rankings/configuracao', { method: 'PUT', body: JSON.stringify(regras) }),
  criarMapeamento: (dados) => request('/rankings/mapeamentos', { method: 'POST', body: JSON.stringify(dados) }),
  atualizarMapeamento: (id, dados) => request(`/rankings/mapeamentos/${id}`, { method: 'PATCH', body: JSON.stringify(dados) }),
  validarMapeamento: (id, dados) => request(`/rankings/mapeamentos/${id}/validar`, { method: 'POST', body: JSON.stringify(dados) }),
  removerMapeamento: (id) => request(`/rankings/mapeamentos/${id}`, { method: 'DELETE' }),
  /**
   * O ENDERECO do PDF do relatorio -- e nao o arquivo.
   *
   * Devolve URL porque o destino dela e um `<a href>`/`window.open`: puxar os
   * bytes por fetch so para montar um blob gastaria memoria a toa e tiraria do
   * navegador o visualizador de PDF que ele ja tem.
   *
   * GET com cookie de sessao (o navegador manda sozinho) e sem CSRF, que so
   * vale para escrita. Quem confere se ESTA pessoa pode ver ESTE relatorio e o
   * servidor, na rota.
   */
  urlArquivoMapeamento: (id) => `/api/rankings/mapeamentos/${id}/arquivo`,
};

// ── WhatsApp API ──
const qs = (instance) => (instance ? `?instance=${encodeURIComponent(instance)}` : '');
export const WhatsAppAPI = {
  status: (instance) => request(`/whatsapp/status${qs(instance)}`),
  detalhes: (instance) => request(`/whatsapp/detalhes${qs(instance)}`),
  // `forcar` é a saída consciente do operador: o servidor RECUSA gerar QR
  // enquanto a sessão estiver válida e o vigia conseguindo religar sozinho,
  // porque com `QRCODE_LIMIT=3` uma tela de QR renovando sozinha faz a Evolution
  // chamar `client.logout()` e destruir o pareamento de verdade.
  // `numero` pede CÓDIGO DE PAREAMENTO (8 caracteres) em vez de só o QR. Serve
  // a quem está longe do aparelho: dita o código por telefone para quem está
  // perto, que digita em Aparelhos conectados › Conectar com número.
  qrcode: (instance, forcar = false, numero = null) => {
    const p = new URLSearchParams();
    if (instance) p.set('instance', instance);
    if (forcar) p.set('forcar', '1');
    if (numero) p.set('numero', numero);
    const q = p.toString();
    return request(`/whatsapp/qrcode${q ? `?${q}` : ''}`);
  },
  conectar: (instance) => request('/whatsapp/conectar', { method: 'POST', body: JSON.stringify({ instance }) }),
  desconectar: (instance) => request('/whatsapp/desconectar', { method: 'POST', body: JSON.stringify({ instance }) }),
  reiniciar: (instance) => request('/whatsapp/reiniciar', { method: 'POST', body: JSON.stringify({ instance }) }),
  excluir: (instance) => request('/whatsapp/instancia', { method: 'DELETE', body: JSON.stringify({ instance }) }),
  // O PAR DO `excluir`. Faltava, e a falta custou 4h30 de atendimento parado em
  // 01/09/2026: excluida a instancia, o botao de QR chamava `/instance/connect`
  // num nome que nao existia mais, levava 404 da Evolution e devolvia erro. Nao
  // havia, pela tela, nenhuma forma de criar a instancia de novo.
  //
  // `baseUrlPublica` fica de fora de proposito: nesta topologia quem entrega os
  // eventos e o webhook GLOBAL da Evolution (`WEBHOOK_GLOBAL_URL`, apontando
  // para `http://api:3000` dentro da rede do compose). Mandar aqui a URL do
  // navegador gravaria na instancia um endereco que a Evolution nao alcanca.
  criar: (instance) => request('/whatsapp/instancia', { method: 'POST', body: JSON.stringify({ instance }) }),
  // Envio avulso (um numero) usado pela tela de Envio em Massa, um a um.
  enviar: (telefone, texto, instance) => request('/whatsapp/enviar', { method: 'POST', body: JSON.stringify({ telefone, texto, instance }) }),
};

// ── Dashboard / painel de parede ──
//
// A Visao Geral calcula as proprias metricas a partir do que ja esta no
// AppContext, e por isso nunca precisou de um cliente de API. O painel de
// parede precisa: ele agrega o MES INTEIRO de atendimentos e a fila, coisas que
// o contexto nao carrega -- e trazer isso para o navegador so para somar seria
// repetir o erro que custou 87 MB por chamada na listagem da Central.
export const DashboardAPI = {
  metricas: () => request('/dashboard'),
  painel: () => request('/dashboard/painel'),
  // Ranking do time inteiro (a mesma pontuacao da parede), com o ultimo
  // atendimento de cada pessoa.
  rankingEquipe: () => request('/dashboard/ranking-equipe'),
  // Zera a contagem de UM ranking a partir de agora ('sede' ou 'externo').
  // NAO apaga atendimento nem mapeamento nenhum -- ver
  // painel.service.marcoDeZeragem. Restrito a administrador no servidor.
  limparPainel: (ranking = 'sede') =>
    request('/dashboard/painel/limpar', { method: 'POST', body: JSON.stringify({ ranking }) }),
  restaurarPainel: (ranking = 'sede') =>
    request('/dashboard/painel/restaurar', { method: 'POST', body: JSON.stringify({ ranking }) }),
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
  // Edicao na triagem: descricao, prioridade e/ou imagens.
  // `imagens` undefined = nao mexer nos prints existentes (o servidor interpreta
  // a ausencia do campo como "manter o que tem"). null/[] = remover todos.
  atualizar: (id, { descricao, prioridade, imagens }) =>
    request(`/bugs/${id}`, { method: 'PATCH', body: JSON.stringify({ descricao, prioridade, imagens }) }),
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
  // RETRATO BARATO DO ESTADO de todas as conversas: status, setor, responsável e
  // versão, sem mensagem nenhuma. A `listar` traz todo o histórico (medido: 2,76
  // MB para 10 conversas de 800 mensagens), e por isso a reconciliação só rodava
  // a cada 5 minutos -- tempo em que uma conversa que o SSE perdeu ficava na aba
  // errada. Este retrato pode ser lido de minuto em minuto.
  estados: () => request('/conversas/estados'),
  // Uma conversa, direto do servidor. É o desempate quando o estado local pode
  // estar errado (ex.: falhou ao assumir): em vez de restaurar um retrato antigo
  // guardado na tela, perguntamos qual é a verdade.
  obter: (id) => request(`/conversas/${id}`),
  atender: (id) => request(`/conversas/${id}/atender`, { method: 'POST' }),
  // Conversa nova a partir de um numero digitado. Diferente de
  // `WhatsAppAPI.enviar`, que dispara no WhatsApp mas nao registra nada na
  // Central quando o numero ainda nao tem conversa.
  iniciarConversa: ({ telefone, nome, setor, texto }) =>
    request('/conversas/iniciar', { method: 'POST', body: JSON.stringify({ telefone, nome, setor, texto }) }),
  enviarMensagem: (id, texto, respondendoAId = null) => request(`/conversas/${id}/mensagens`, { method: 'POST', body: JSON.stringify({ texto, respondendoAId }) }),
  // Nota interna: rota própria, e não um parâmetro do enviarMensagem. O que não
  // sai para o cliente não compartilha caminho com o que sai.
  adicionarNota: (id, texto) => request(`/conversas/${id}/notas`, { method: 'POST', body: JSON.stringify({ texto }) }),
  editarMensagem: (mensagemId, texto) => request(`/conversas/mensagens/${mensagemId}`, { method: 'PATCH', body: JSON.stringify({ texto }) }),
  transcreverAudio: (mensagemId) => request(`/conversas/mensagens/${mensagemId}/transcrever`, { method: 'POST' }),
  // Corretor de ortografia/gramática da caixa de mensagem. Devolve
  // { texto, alterado } -- `alterado: false` = o texto já estava correto, e a
  // tela precisa saber a diferença para não dizer "corrigido" sem ter mudado nada.
  corrigirTexto: (texto) => request('/conversas/corrigir-texto', { method: 'POST', body: JSON.stringify({ texto }) }),
  apagarMensagem: (mensagemId) => request(`/conversas/mensagens/${mensagemId}`, { method: 'DELETE' }),
  encaminharMensagem: (mensagemId, conversaDestinoId) => request('/conversas/mensagens/encaminhar', { method: 'POST', body: JSON.stringify({ mensagemId, conversaDestinoId }) }),
  // Perfil publico do contato no WhatsApp: recado, foto e dados de conta
  // comercial. O resto (nome, empresa, setor, OS) ja vem no DTO da conversa.
  perfil: (id) => request(`/conversas/${id}/perfil`),
  solicitarCnpj: (id) => request(`/conversas/${id}/solicitar-cnpj`, { method: 'POST' }),
  validarCnpj: (id, cnpj) => request(`/conversas/${id}/validar-cnpj`, { method: 'POST', body: JSON.stringify({ cnpj }) }),
  // Par simetrico do validarCnpj: marca (ou desfaz) o atendimento avulso.
  marcarAvulso: (id, avulso) => request(`/conversas/${id}/avulso`, { method: 'PATCH', body: JSON.stringify({ avulso }) }),
  // NAO existe mais `desvincularCnpj`: o "X" saiu do cabecalho da conversa e a
  // rota DELETE /conversas/:id/cnpj deixou de existir no servidor. A correcao de
  // um CNPJ errado e feita pelo proprio cliente (responde "NAO" ao bot) ou pelo
  // administrador em Clientes (CNPJ).
  // Historico de OS (atendimentos) do cliente. A conversa ja traz a lista; esta
  // rota serve para reler so o historico sem baixar o fio inteiro.
  atendimentos: (id) => request(`/conversas/${id}/atendimentos`),
  // ── HISTÓRICO ANTIGO DO WHATSAPP (o que aconteceu no celular) ──
  //
  // A Central só registra o que passou por ela. O que a equipe conversou pelo
  // aparelho antes disso vive no banco da Evolution (quando o pareamento
  // sincronizou o histórico) e estas duas rotas o trazem para dentro do fio.
  //
  // A prévia é separada da importação de propósito: "não há nada para importar"
  // é uma resposta legítima e comum, e a tela precisa poder dizer isso sem
  // escrever nada no banco. Ambas exigem Administrador no servidor.
  historicoWhatsApp: (id) => request(`/conversas/${id}/historico-whatsapp`),
  importarHistorico: (id, opcoes = {}) =>
    request(`/conversas/${id}/importar-historico`, { method: 'POST', body: JSON.stringify(opcoes) }),
  atualizarStatus: (id, status) => request(`/conversas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  atualizarSetor: (id, setor) => request(`/conversas/${id}/setor`, { method: 'PATCH', body: JSON.stringify({ setor }) }),
  // Define/limpa o responsavel (compartilhado). atendenteId null = remover.
  definirAtendente: (id, atendenteId) => request(`/conversas/${id}/atendente`, { method: 'PATCH', body: JSON.stringify({ atendenteId }) }),
  /**
   * Para quem dá para transferir.
   *
   * NÃO usa `EquipeAPI.listar()` de propósito. Aquela rota exige o módulo
   * "equipe" o da tela de Gestão da Equipe que na matriz de permissões só o
   * Comercial tem por padrão. Técnico e Financeiro levavam 403 ali, e o
   * AppContext converte promessa rejeitada em lista vazia: o seletor aparecia
   * com "Nenhum outro operador com conta", de base cheia.
   *
   * Esta rota vive sob o módulo `atendimento`, que é o que a pessoa já precisa
   * ter para estar nesta tela, e devolve só o necessário para escolher um
   * destino. Com `conversaId`, cada operador vem com `podeVerConversa`.
   */
  atendentesParaTransferir: (conversaId = null) =>
    request(`/conversas/atendentes${conversaId ? `?conversaId=${encodeURIComponent(conversaId)}` : ''}`),
  avaliarAtendimento: (id, avaliacao, feedback) => request(`/conversas/${id}/avaliacao`, { method: 'POST', body: JSON.stringify({ avaliacao, feedback }) }),
  // Atalhos de status (os 3 estados da Central).
  pendente: (id) => request(`/conversas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'pendente' }) }),
  // Fechar exige o motivo do encerramento: o servidor recusa sem ele
  // (MOTIVO_OBRIGATORIO) e recusa o que não estiver na lista (MOTIVO_INVALIDO).
  //
  // `semPesquisa` é o fechamento "à força": mesmo fechamento, sem a pesquisa de
  // satisfação indo para o WhatsApp do cliente. O motivo continua obrigatório.
  fechar: (id, motivo, semPesquisa = false) => request(`/conversas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'fechada', motivo, semPesquisa }) }),
  motivosEncerramento: () => request('/conversas/motivos-encerramento'),
  reabrir: (id) => request(`/conversas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'aberta' }) }),
  marcarLido: (id) => request(`/conversas/${id}/lido`, { method: 'PATCH' }),
  // Favoritar / fixar / arquivar / ocultar persistido no banco (nao apaga nada).
  atualizarFlags: (id, flags) => request(`/conversas/${id}/flags`, { method: 'PATCH', body: JSON.stringify(flags) }),
  remover: (id) => request(`/conversas/${id}`, { method: 'DELETE' }),
  // Ticket de uso unico para autenticar o EventSource (SSE) sem JWT na URL.
  streamTicket: () => request('/conversas/stream-ticket', { method: 'POST' }),
  /**
   * Envio de midia via XHR. Retorna { promise, cancel }.
   *
   * ── POR QUE ESTE CAMINHO NAO USA `request` ────────────────────────────────
   *
   * Porque precisa de duas coisas que `fetch` nao da: PROGRESSO de upload e
   * CANCELAMENTO. Um vídeo de 20MB sem barra de progresso parece travado.
   *
   * ── E POR QUE ELE PRECISA DOS MESMOS CABECALHOS ───────────────────────────
   *
   * Ser um caminho separado foi exatamente o problema. Quando a sessao passou
   * para cookie HttpOnly, `request` ganhou o `X-CSRF-Token` e ESTA funcao ficou
   * para tras -- ela montava os cabecalhos a mao, com `Content-Type` e um
   * `Authorization` que, depois da migracao, nem existe mais (o token antigo do
   * localStorage foi apagado).
   *
   * O resultado: o XHR chegava ao servidor COM o cookie de sessao (o navegador
   * o manda sozinho), SEM Bearer e SEM o header de CSRF. E exatamente o caso
   * que o guard de double submit recusa:
   *
   *     403 "Requisicao sem confirmacao de origem. Recarregue a pagina."
   *
   * que a tela exibia como "Falha ao enviar mídia: ...". Valia para IMAGEM,
   * VIDEO, AUDIO, DOCUMENTO e LOCALIZACAO de uma vez -- todos saem por aqui, e
   * a requisicao morria no middleware, antes de qualquer codigo de mídia rodar.
   * Nao eram cinco defeitos: era um, na porta.
   *
   * A correcao e usar `cabecalhosDeSessao()`, a MESMA funcao do `request`. Isso
   * nao e so consertar: e impedir que aconteca de novo. Cabecalho de sessao
   * novo passa a valer aqui automaticamente, em vez de depender de alguem
   * lembrar deste arquivo.
   *
   * Os cabecalhos sao montados DENTRO de `disparar` de propósito: depois de uma
   * renovacao o `arka_csrf` e outro, e reenviar com o valor antigo levaria 403.
   */
  enviarMidia: (id, payload, onProgress) => {
    let xhrAtual = null;
    let cancelado = false;

    const disparar = (jaRenovou) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrAtual = xhr;
      xhr.open('POST', `${API_BASE}/conversas/${id}/midia`);
      for (const [nome, valor] of Object.entries(cabecalhosDeSessao())) {
        xhr.setRequestHeader(nome, valor);
      }
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
          // `getToken()` e null no modo cookie -- e `renovarSessao` conta com
          // isso: sem token guardado, quem identifica a sessao e o proprio
          // cookie de renovacao.
          return renovarSessao(getToken()).then(
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
