/**
 * "Esqueci a senha" -- pagina de orientacao, nao de autoatendimento.
 *
 * Nao ha recuperacao por e-mail no sistema (nenhum SMTP configurado, e as contas
 * nascem por convite em /cadastrar). A redefinicao e feita por um Administrador,
 * pela Gestao da Equipe -- entao aqui a gente explica exatamente esse caminho em
 * vez de fingir um fluxo de "enviar link" que nao existe.
 */
import { Navigate } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AcessoLayout, { LinkAcesso } from '../components/layout/AcessoLayout';

export default function EsqueciSenhaPage() {
  const { usuario } = useAuth();

  // Quem ja tem sessao nao precisa desta tela.
  if (usuario) return <Navigate to="/atendimento" replace />;

  return (
    <AcessoLayout
      titulo="Esqueci a senha"
      subtitulo="A redefinição é feita por um Administrador."
      rodape={<>Lembrou a senha? <LinkAcesso to="/login">Voltar ao login</LinkAcesso></>}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-linha bg-grafite-800 p-4">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-acao-200" />
          <p className="text-xs leading-relaxed text-texto-suave">
            Este painel não envia link de recuperação por e-mail. Para voltar a
            entrar, peça a um <strong className="text-texto">Administrador</strong> da
            sua equipe que defina uma nova senha para você.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-linha bg-grafite-800 p-4">
          <KeyRound size={16} className="mt-0.5 shrink-0 text-acao-200" />
          <div className="space-y-1.5 text-xs leading-relaxed text-texto-suave">
            <p className="font-semibold text-texto">Se você é o Administrador:</p>
            <p>
              Abra <strong className="text-texto">Gestão da Equipe</strong>, encontre
              a conta e use <strong className="text-texto">Redefinir senha</strong>.
              A pessoa entra com a nova senha e pode trocá-la depois.
            </p>
          </div>
        </div>
      </div>
    </AcessoLayout>
  );
}
