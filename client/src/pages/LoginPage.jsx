import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Loader2, LogIn, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AcessoLayout, { Campo, LinkAcesso } from '../components/layout/AcessoLayout';

export default function LoginPage() {
  const { usuario, entrar } = useAuth();
  const navigate = useNavigate();
  const local = useLocation();

  // Quem acabou de se cadastrar chega aqui com o e-mail no `state`. Ja vem
  // preenchido: a pessoa digitou isso segundos atras, pedir de novo e ruido.
  const recemCadastrado = !!local.state?.cadastrado;
  const [email, setEmail] = useState(local.state?.email || '');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  // Quem ja tem sessao nao volta para o login pela URL.
  if (usuario) return <Navigate to="/atendimento" replace />;

  async function enviar(e) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email, senha);
      // Devolve a pessoa para onde ela tentou ir antes de ser barrada.
      navigate(local.state?.de || '/atendimento', { replace: true });
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  return (
    <AcessoLayout
      titulo="Entrar"
      subtitulo="Assuma os atendimentos que estão na fila."
      rodape={<>Ainda não tem conta? <LinkAcesso to="/cadastrar">Criar conta</LinkAcesso></>}
    >
      <form onSubmit={enviar} className="space-y-4" noValidate>
        {recemCadastrado && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-acao/40 bg-acao/10 p-3">
            <CheckCircle2 size={15} className="mt-px shrink-0 text-acao-200" />
            <p className="text-xs leading-relaxed text-texto">
              <strong className="text-acao-200">Conta criada.</strong> Entre com a senha que você acabou de escolher.
            </p>
          </div>
        )}

        {/* O foco vai para o primeiro campo que ainda esta vazio: vindo do
            cadastro o e-mail ja veio preenchido, entao comecar por ele
            obrigaria a pessoa a dar um Tab para chegar onde precisa digitar. */}
        <Campo
          id="email" rotulo="E-mail" type="email" autoComplete="email" required
          autoFocus={!recemCadastrado}
          placeholder=""
          value={email} onChange={e => setEmail(e.target.value)}
        />
        <Campo
          id="senha" rotulo="Senha" type="password" autoComplete="current-password" required
          autoFocus={recemCadastrado}
          placeholder=""
          value={senha} onChange={e => setSenha(e.target.value)}
        />

        {erro && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-falha/30 bg-falha/10 p-3">
            <AlertCircle size={15} className="mt-px shrink-0 text-falha-400" />
            <p className="text-xs leading-relaxed text-texto">{erro}</p>
          </div>
        )}

        <button
          type="submit" disabled={enviando}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-acao py-3 text-sm font-bold text-slate-950 shadow-lg shadow-acao/20 transition-colors hover:bg-acao-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acao-200 disabled:opacity-60"
        >
          {enviando
            ? <><Loader2 size={16} className="animate-spin" /> Entrando...</>
            : <><LogIn size={16} /> Entrar</>}
        </button>
      </form>
    </AcessoLayout>
  );
}
