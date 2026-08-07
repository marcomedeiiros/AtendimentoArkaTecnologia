import { useState } from 'react';
import { useNavigate, useLocation, Navigate, Link } from 'react-router-dom';
import { Loader2, LogIn, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getEmailLembrado } from '../services/api';
import AcessoLayout, { Campo, LinkAcesso } from '../components/layout/AcessoLayout';

export default function LoginPage() {
  const { usuario, entrar } = useAuth();
  const navigate = useNavigate();
  const local = useLocation();

  // Quem acabou de se cadastrar chega aqui com o e-mail no `state`. Ja vem
  // preenchido: a pessoa digitou isso segundos atras, pedir de novo e ruido.
  const recemCadastrado = !!local.state?.cadastrado;
  // Vindo do cadastro (state) ou de um login anterior com "lembrar-me": o e-mail
  // ja aparece preenchido. So o e-mail -- a senha nunca fica guardada por nos.
  const emailLembrado = getEmailLembrado();
  const emailInicial = local.state?.email || emailLembrado;
  const [email, setEmail] = useState(emailInicial);
  const [senha, setSenha] = useState('');
  // Marcado por padrao: manter a sessao e o caso comum (maquina propria). Se ha
  // e-mail lembrado, foi porque a pessoa deixou marcado antes. Quem esta em
  // maquina compartilhada desmarca e o token/e-mail nao ficam.
  const [lembrar, setLembrar] = useState(true);
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  // Quem ja tem sessao nao volta para o login pela URL.
  if (usuario) return <Navigate to="/atendimento" replace />;

  async function enviar(e) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email, senha, lembrar);
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

        {/* O foco vai para o primeiro campo que ainda esta vazio: com o e-mail
            ja preenchido (do cadastro ou do "lembrar-me"), comecar por ele
            obrigaria a pessoa a dar um Tab para chegar onde precisa digitar. */}
        <Campo
          id="email" rotulo="E-mail" type="email" autoComplete="email" required
          autoFocus={!emailInicial}
          placeholder=""
          value={email} onChange={e => setEmail(e.target.value)}
        />
        <Campo
          id="senha" rotulo="Senha" type="password" autoComplete="current-password" required
          autoFocus={!!emailInicial}
          placeholder=""
          value={senha} onChange={e => setSenha(e.target.value)}
        />

        <div className="flex items-center justify-between gap-3">
          <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-texto-suave">
            <input
              type="checkbox"
              checked={lembrar}
              onChange={e => setLembrar(e.target.checked)}
              className="h-4 w-4 rounded border-linha bg-grafite-800 text-acao accent-acao focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acao-200"
            />
            Lembrar-me
          </label>

          <Link
            to="/esqueci-senha"
            className="py-2 text-xs font-semibold text-acao-200 underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
          >
            Esqueci a senha
          </Link>
        </div>

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
