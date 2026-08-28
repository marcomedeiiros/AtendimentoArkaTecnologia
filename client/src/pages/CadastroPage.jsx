import { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Loader2, UserPlus, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthAPI } from '../services/api';
import AcessoLayout, { Campo, LinkAcesso } from '../components/layout/AcessoLayout';
import Turnstile from '../components/Turnstile';

export default function CadastroPage() {
  const { usuario, cadastrar } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ nome: '', email: '', senha: '', confirmar: '', codigo: '' });
  const [erro, setErro] = useState(null);
  const [campos, setCampos] = useState({});
  const [enviando, setEnviando] = useState(false);
  // O campo de convite so existe quando o servidor exige -- perguntamos a ele
  // em vez de deixar um campo opcional na tela sem ninguem saber se preenche.
  const [exigeCodigo, setExigeCodigo] = useState(false);
  /**
   * Token do desafio Turnstile.
   *
   * ── POR QUE ISTO NAO EXISTIA, E O QUE ACONTECIA SEM ELE ───────────────────
   *
   * A rota `POST /api/auth/cadastrar` sempre teve `exigirTurnstile` no
   * middleware -- igual ao login. Mas esta tela nunca desenhou o widget nem
   * mandou o campo: `cadastrar()` enviava so nome, e-mail, senha e codigo.
   *
   * Com as chaves configuradas, o servidor recebia `turnstileToken: undefined`,
   * o cliente do Turnstile devolvia `{ok:false, motivo:"token-ausente"}` e a
   * resposta era 403:
   *
   *     "Nao foi possivel confirmar que voce nao e um robo..."
   *
   * Ou seja: nao havia CAPTCHA falhando. Havia METADE do CAPTCHA -- o servidor
   * cobrava uma prova que a tela nao produzia, e NENHUM cadastro passava.
   *
   * O backend esta correto e nao foi tocado. O que faltava era esta metade.
   */
  const [turnstileToken, setTurnstileToken] = useState(null);

  useEffect(() => {
    AuthAPI.registroInfo()
      .then(i => setExigeCodigo(!!i?.exigeCodigo))
      .catch(() => {});
  }, []);

  if (usuario) return <Navigate to="/atendimento" replace />;

  const mudar = (campo) => (e) => {
    setForm(f => ({ ...f, [campo]: e.target.value }));
    setCampos(c => ({ ...c, [campo]: undefined }));
  };

  async function enviar(e) {
    e.preventDefault();
    setErro(null);
    setCampos({});

    // Conferido aqui porque o servidor nao recebe o campo de confirmacao: ele
    // existe so para pegar erro de digitacao antes de criar a conta.
    if (form.senha !== form.confirmar) {
      setCampos({ confirmar: 'As senhas não são iguais.' });
      return;
    }

    setEnviando(true);
    try {
      const criado = await cadastrar({
        nome: form.nome,
        email: form.email,
        senha: form.senha,
        ...(exigeCodigo ? { codigo: form.codigo } : {}),
        // Só vai quando existe: sem chaves configuradas o widget não renderiza
        // e o servidor também está com o desafio desligado — as duas pontas
        // ficam desligadas juntas, e mandar `null` só sujaria o corpo.
        ...(turnstileToken ? { turnstileToken } : {}),
      });
      // Criar conta nao e entrar. O login recebe o e-mail pelo `state` para
      // ja vir preenchido -- a pessoa acabou de digitar, repetir seria ruido.
      navigate('/login', {
        replace: true,
        state: { cadastrado: true, email: criado?.email || form.email },
      });
    } catch (err) {
      if (Object.keys(err.campos || {}).length) setCampos(err.campos);
      else setErro(err.message);
      setEnviando(false);
      // O token do Turnstile vale UMA vez. Depois de uma tentativa — mesmo
      // recusada por outro motivo, como e-mail já cadastrado — ele já foi
      // gasto: reapresentá-lo faria a Cloudflare responder
      // `timeout-or-duplicate`, e a segunda tentativa morreria com "não foi
      // possível confirmar que você não é um robô" em vez do erro real. Zerar
      // aqui faz o widget emitir um token novo. (Mesma regra da LoginPage.)
      setTurnstileToken(null);
      if (window.turnstile) { try { window.turnstile.reset(); } catch { /* sem widget */ } }
    }
  }

  return (
    <AcessoLayout
      titulo="Criar conta"
      subtitulo="Sua conta dá acesso à fila e ao histórico dos clientes."
      rodape={<>Já tem conta? <LinkAcesso to="/login">Entrar</LinkAcesso></>}
    >
      <form onSubmit={enviar} className="space-y-4" noValidate>
        <Campo
          id="nome" rotulo="Nome" autoComplete="name" required autoFocus
          placeholder=""
          value={form.nome} onChange={mudar('nome')} erro={campos.nome}
        />
        <Campo
          id="email" rotulo="E-mail" type="email" autoComplete="email" required
          placeholder=""
          value={form.email} onChange={mudar('email')} erro={campos.email}
        />
        <Campo
          id="senha" rotulo="Senha" type="password" autoComplete="new-password" required
          placeholder="" dica="Mínimo de 6 caracteres."
          value={form.senha} onChange={mudar('senha')} erro={campos.senha}
        />
        <Campo
          id="confirmar" rotulo="Confirmar senha" type="password" autoComplete="new-password" required
          placeholder=""
          value={form.confirmar} onChange={mudar('confirmar')} erro={campos.confirmar}
        />
        {exigeCodigo && (
          <Campo
            id="codigo" rotulo="Código de convite" required
            placeholder="Peça ao administrador do painel"
            value={form.codigo} onChange={mudar('codigo')} erro={campos.codigo}
          />
        )}

        {erro && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-falha/30 bg-falha/10 p-3">
            <AlertCircle size={15} className="mt-px shrink-0 text-falha-400" />
            <p className="text-xs leading-relaxed text-texto">{erro}</p>
          </div>
        )}

        {/* Não renderiza nada enquanto o Turnstile não estiver configurado no
            servidor as duas pontas ficam desligadas juntas. */}
        <Turnstile onToken={setTurnstileToken} />

        <button
          type="submit" disabled={enviando}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-acao py-3 text-sm font-bold text-slate-950 shadow-lg shadow-acao/20 transition-colors hover:bg-acao-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acao-200 disabled:opacity-60"
        >
          {enviando
            ? <><Loader2 size={16} className="animate-spin" /> Criando conta...</>
            : <><UserPlus size={16} /> Criar conta</>}
        </button>
      </form>
    </AcessoLayout>
  );
}
