import { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Loader2, UserPlus, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthAPI } from '../services/api';
import AcessoLayout, { Campo, LinkAcesso } from '../components/layout/AcessoLayout';

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
      await cadastrar({
        nome: form.nome,
        email: form.email,
        senha: form.senha,
        ...(exigeCodigo ? { codigo: form.codigo } : {}),
      });
      navigate('/atendimento', { replace: true });
    } catch (err) {
      if (Object.keys(err.campos || {}).length) setCampos(err.campos);
      else setErro(err.message);
      setEnviando(false);
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
