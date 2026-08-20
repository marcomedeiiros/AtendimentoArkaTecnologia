/**
 * Página de perfil do operador (/perfil).
 *
 * Versão em tela cheia do menu de perfil (o modal era apertado). Permite trocar
 * o nome de exibição, o nome de assinatura dos chats e a senha -- tudo do
 * PRÓPRIO usuário. O servidor identifica o dono pelo token (nunca por id no
 * corpo), então ninguém edita a conta de outro por aqui.
 */
import { useState } from 'react';
import { User, PenLine, KeyRound, Loader2, Save, ShieldCheck, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthAPI } from '../services/api';
import Avatar from '../components/Avatar';

// Campo de senha com botao de mostrar/ocultar. Em escopo de MODULO de proposito:
// definido dentro do componente da pagina, ele seria recriado a cada render e o
// input perderia o foco no meio da digitacao. Comeca sempre oculto; mostrar e
// acao explicita da pessoa e nao guarda nada -- so alterna o `type` do input.
function CampoSenha({ id, rotulo, inputCls, labelCls, ...props }) {
  const [mostrar, setMostrar] = useState(false);
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{rotulo}</label>
      <div className="relative">
        <input id={id} type={mostrar ? 'text' : 'password'} className={`${inputCls} pr-11`} {...props} />
        <button
          type="button"
          onClick={() => setMostrar(m => !m)}
          aria-label={mostrar ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={mostrar}
          title={mostrar ? 'Ocultar senha' : 'Mostrar senha'}
          className="absolute inset-y-0 right-0 flex items-center rounded-r-xl px-3 text-texto-suave transition-colors hover:text-texto focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acao-200"
        >
          {mostrar ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

export default function PerfilPage() {
  const navigate = useNavigate();
  const { usuario, assinaturaCustom, assinaturaNome, salvarAssinatura, atualizarUsuario } = useAuth();

  const [nome, setNome] = useState(usuario?.nome || '');
  const [assinatura, setAssinatura] = useState(assinaturaCustom || '');
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [msgPerfil, setMsgPerfil] = useState(null);

  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [msgSenha, setMsgSenha] = useState(null);

  const primeiroNome = (usuario?.nome || '').trim().split(/\s+/)[0] || '';

  async function salvarPerfil(e) {
    e.preventDefault();
    setMsgPerfil(null);
    if (nome.trim().length < 2) {
      setMsgPerfil({ tipo: 'erro', texto: 'Informe o nome completo (mínimo 2 letras).' });
      return;
    }
    setSalvandoPerfil(true);
    try {
      let mudou = false;
      if (nome.trim() !== (usuario?.nome || '').trim()) {
        const atualizado = await AuthAPI.atualizarPerfil({ nome: nome.trim() });
        atualizarUsuario({ nome: atualizado.nome });
        mudou = true;
      }
      if (assinatura.trim() !== (assinaturaCustom || '').trim()) {
        await salvarAssinatura(assinatura.trim());
        mudou = true;
      }
      setMsgPerfil({ tipo: 'ok', texto: mudou ? 'Perfil atualizado com sucesso.' : 'Nada para salvar.' });
    } catch (err) {
      setMsgPerfil({ tipo: 'erro', texto: err.message });
    } finally {
      setSalvandoPerfil(false);
    }
  }

  async function trocarSenha(e) {
    e.preventDefault();
    setMsgSenha(null);
    if (novaSenha.length < 6) {
      setMsgSenha({ tipo: 'erro', texto: 'A nova senha precisa de pelo menos 6 caracteres.' });
      return;
    }
    if (novaSenha !== confirmar) {
      setMsgSenha({ tipo: 'erro', texto: 'A confirmação não confere com a nova senha.' });
      return;
    }
    setSalvandoSenha(true);
    try {
      await AuthAPI.trocarSenha(senhaAtual, novaSenha);
      setSenhaAtual(''); setNovaSenha(''); setConfirmar('');
      setMsgSenha({ tipo: 'ok', texto: 'Senha trocada com sucesso.' });
    } catch (err) {
      setMsgSenha({ tipo: 'erro', texto: err.message });
    } finally {
      setSalvandoSenha(false);
    }
  }

  const inputCls =
    'w-full rounded-xl border border-linha bg-grafite-800 px-3.5 py-2.5 text-sm text-texto placeholder-texto-fraco outline-none transition-colors focus:border-acao focus:ring-2 focus:ring-acao/25';
  const labelCls = 'mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-texto-suave';

  function Aviso({ msg }) {
    if (!msg) return null;
    const ok = msg.tipo === 'ok';
    return (
      <p className={`text-xs font-semibold ${ok ? 'text-ativo-400' : 'text-falha-400'}`}>{msg.texto}</p>
    );
  }

  return (
    <div className="fade-in mx-auto w-full max-w-3xl space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 border-b border-linha pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            title="Voltar"
            className="rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <ArrowLeft size={18} />
          </button>
          <Avatar nome={usuario?.nome || ''} size="lg" />
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight text-white">Meu perfil</h1>
            <p className="truncate font-mono text-xs text-texto-suave">{usuario?.email}</p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-acao/30 bg-acao/15 px-3 py-1 text-xs font-semibold text-acao-200">
          <ShieldCheck size={13} /> {usuario?.cargo}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Dados do perfil */}
        <form onSubmit={salvarPerfil} className="glass-panel space-y-4 rounded-2xl border border-linha p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <User size={15} className="text-acao-200" /> Dados do perfil
          </h2>

          <div>
            <label htmlFor="perfil-nome" className={labelCls}>Nome de exibição</label>
            <input id="perfil-nome" value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} placeholder="Seu nome" />
          </div>

          <div>
            <label htmlFor="perfil-assinatura" className={labelCls}>
              <PenLine size={11} className="mr-1 -mt-0.5 inline" /> Nome de assinatura dos chats
            </label>
            <input
              id="perfil-assinatura"
              value={assinatura}
              onChange={(e) => setAssinatura(e.target.value)}
              className={inputCls}
              placeholder={`Padrão: ${primeiroNome || 'seu primeiro nome'}`}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-texto-fraco">
              É o nome que aparece em negrito na 1ª linha das suas mensagens quando a assinatura
              está ligada na Central deixe em branco para usar o padrão
              (<strong className="text-texto-suave">{assinaturaNome}</strong>).
            </p>
          </div>

          <Aviso msg={msgPerfil} />
          <div className="flex justify-end">
            <button type="submit" disabled={salvandoPerfil}
              className="flex items-center gap-1.5 rounded-xl bg-acao px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-acao-200 disabled:opacity-60">
              {salvandoPerfil ? <><Loader2 size={14} className="animate-spin" /> Salvando...</> : <><Save size={14} /> Salvar alterações</>}
            </button>
          </div>
        </form>

        {/* Segurança */}
        <form onSubmit={trocarSenha} className="glass-panel space-y-4 rounded-2xl border border-linha p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <KeyRound size={15} className="text-acao-200" /> Segurança
          </h2>

          <CampoSenha
            id="senha-atual" rotulo="Senha atual" autoComplete="current-password"
            inputCls={inputCls} labelCls={labelCls} placeholder="••••••"
            value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)}
          />
          <CampoSenha
            id="senha-nova" rotulo="Nova senha" autoComplete="new-password"
            inputCls={inputCls} labelCls={labelCls} placeholder="Mínimo de 6 caracteres"
            value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)}
          />
          <CampoSenha
            id="senha-confirmar" rotulo="Confirmar nova senha" autoComplete="new-password"
            inputCls={inputCls} labelCls={labelCls} placeholder="Repita a nova senha"
            value={confirmar} onChange={(e) => setConfirmar(e.target.value)}
          />

          <Aviso msg={msgSenha} />
          <div className="flex justify-end">
            <button type="submit" disabled={salvandoSenha || !senhaAtual || !novaSenha}
              className="flex items-center gap-1.5 rounded-xl border border-linha bg-grafite-700 px-4 py-2.5 text-xs font-bold text-texto hover:text-white disabled:opacity-60">
              {salvandoSenha ? <><Loader2 size={14} className="animate-spin" /> Trocando...</> : <><KeyRound size={14} /> Trocar senha</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
