/**
 * Gestao da Equipe.
 *
 * Nao ha nada para cadastrar aqui: a equipe E quem tem conta no painel. Entrar
 * na lista significa criar conta em /cadastrar, e sair dela significa perder o
 * acesso. Antes esta tela mantinha uma lista propria, digitada a mao, que nao
 * tinha ligacao nenhuma com quem realmente entrava no sistema -- dava para
 * "adicionar" alguem que nunca conseguiria atender, e o online/offline era um
 * botao que a propria pessoa virava.
 *
 * O status agora e observado, nao declarado: vem do ultimo acesso registrado
 * pelo servidor a cada requisicao autenticada.
 */
import { useState, useEffect } from 'react';
import { Users, Circle, ShieldCheck, CheckCircle2, XCircle, KeyRound, Loader2, X, Clock, Trash2, SlidersHorizontal, Save, Lock } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { EquipeAPI, PermissoesAPI } from '../services/api';
import Avatar from '../components/Avatar';

function vistoEm(iso) {
  if (!iso) return 'nunca entrou';
  const seg = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 60) return 'agora há pouco';
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

const CARGOS = ['Administrador', 'Financeiro', 'Técnico', 'Comercial'];

export default function EquipePage() {
  const { equipe, recarregarEquipe } = useAppContext();
  const { usuario } = useAuth();
  const [loadingId, setLoadingId] = useState(null);
  const [erro, setErro] = useState('');
  const [okMsg, setOkMsg] = useState('');

  // Modal de redefinicao de senha: guarda o membro alvo e o rascunho da senha.
  const [resetAlvo, setResetAlvo] = useState(null);
  const [novaSenha, setNovaSenha] = useState('');
  const [resetErro, setResetErro] = useState('');
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  // Editor de permissoes por perfil (so Administrador). `perm` traz o catalogo
  // de modulos + a matriz efetiva; `permMatriz` e o rascunho editavel.
  const [perm, setPerm] = useState(null);
  const [permMatriz, setPermMatriz] = useState(null);
  const [permLoading, setPermLoading] = useState(false);
  const [permSalvando, setPermSalvando] = useState(false);
  const [permErro, setPermErro] = useState('');
  const [permOk, setPermOk] = useState('');

  function abrirReset(membro) {
    setResetAlvo(membro);
    setNovaSenha('');
    setResetErro('');
  }

  function fecharReset() {
    if (salvandoSenha) return;
    setResetAlvo(null);
    setNovaSenha('');
    setResetErro('');
  }

  async function confirmarReset(e) {
    e.preventDefault();
    if (novaSenha.length < 6) {
      setResetErro('A senha precisa de pelo menos 6 caracteres.');
      return;
    }
    setSalvandoSenha(true);
    setResetErro('');
    try {
      await EquipeAPI.redefinirSenha(resetAlvo.id, novaSenha);
      const nome = resetAlvo.nome;
      setResetAlvo(null);
      setNovaSenha('');
      setOkMsg(`Senha de ${nome} redefinida. Avise a nova senha por um canal seguro.`);
    } catch (err) {
      setResetErro(err.message);
    } finally {
      setSalvandoSenha(false);
    }
  }

  const [, forcarRedesenho] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forcarRedesenho(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const ehAdmin = usuario?.cargo === 'Administrador';
  const online = equipe.filter(m => m.status === 'online').length;
  const pendentes = equipe.filter(m => m.ativo === false).length;

  // Carrega a matriz de permissoes so para Administrador (o servidor tambem so
  // devolve para admin -- aqui e a 1a camada).
  useEffect(() => {
    if (!ehAdmin) return;
    let vivo = true;
    setPermLoading(true);
    setPermErro('');
    PermissoesAPI.obter()
      .then(d => { if (vivo) { setPerm(d); setPermMatriz(d.matriz); } })
      .catch(e => { if (vivo) setPermErro(e.message); })
      .finally(() => { if (vivo) setPermLoading(false); });
    return () => { vivo = false; };
  }, [ehAdmin]);

  function alternarPermissao(cargo, modulo) {
    setPermOk('');
    setPermMatriz(prev => ({
      ...prev,
      [cargo]: { ...prev[cargo], [modulo]: !prev[cargo]?.[modulo] },
    }));
  }

  async function salvarPermissoes() {
    setPermSalvando(true);
    setPermErro('');
    setPermOk('');
    try {
      // Envia so os perfis editaveis; Administrador nunca vai (acesso total).
      const payload = {};
      for (const c of perm.cargosEditaveis) payload[c] = permMatriz[c];
      const atualizado = await PermissoesAPI.salvar(payload);
      setPerm(atualizado);
      setPermMatriz(atualizado.matriz);
      setPermOk('Permissões salvas elas valem na próxima vez que cada pessoa carregar o painel no servidor já valem agora.');
    } catch (e) {
      setPermErro(e.message);
    } finally {
      setPermSalvando(false);
    }
  }

  async function alternarStatus(id, novoStatus) {
    setLoadingId(id);
    setErro('');
    setOkMsg('');
    try {
      await EquipeAPI.alterarStatus(id, novoStatus);
      if (recarregarEquipe) await recarregarEquipe();
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoadingId(null);
    }
  }

  async function mudarCargo(id, novoCargo) {
    setLoadingId(id);
    setErro('');
    setOkMsg('');
    try {
      await EquipeAPI.alterarCargo(id, novoCargo);
      if (recarregarEquipe) await recarregarEquipe();
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoadingId(null);
    }
  }

  async function excluirConta(membro) {
    if (!window.confirm(
      `Excluir definitivamente a conta de ${membro.nome}? Esta ação não pode ser desfeita. ` +
      `Os atendimentos que essa pessoa fez continuam registrados, mas ela perde o acesso.`
    )) return;
    setLoadingId(membro.id);
    setErro('');
    setOkMsg('');
    try {
      await EquipeAPI.excluir(membro.id);
      if (recarregarEquipe) await recarregarEquipe();
      setOkMsg(`Conta de ${membro.nome} excluída.`);
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoadingId(null);
    }
  }

  // Recusar um cadastro pendente = apagar a conta. Como so aparece antes da
  // aprovacao, e uma rejeicao do pedido de acesso, nao a exclusao de alguem que
  // ja fazia parte da equipe.
  async function recusarConta(membro) {
    if (!window.confirm(
      `Recusar e excluir o cadastro de ${membro.nome}? A pessoa precisará se cadastrar novamente para solicitar acesso.`
    )) return;
    setLoadingId(membro.id);
    setErro('');
    setOkMsg('');
    try {
      await EquipeAPI.excluir(membro.id);
      if (recarregarEquipe) await recarregarEquipe();
      setOkMsg(`Cadastro de ${membro.nome} recusado.`);
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="fade-in space-y-6">
      <div className="mb-8 flex flex-col gap-4 border-b border-linha pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Gestão da Equipe & Permissões</h1>
          <p className="mt-1 text-xs text-texto-suave sm:text-sm">
            Gerencie os usuários do sistema, altere cargos (Financeiro, Técnico, Comercial, Admin) e aprove contas pendentes.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-xs">
          {pendentes > 0 && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-espera/20 text-espera-400 font-semibold border border-espera/30">
              <Clock size={13} /> {pendentes} pendente(s)
            </span>
          )}
          <span className="flex items-center gap-2 text-texto-suave">
            <Users size={14} /> {equipe.length} {equipe.length === 1 ? 'conta' : 'contas'}
          </span>
          <span className="flex items-center gap-2 text-ativo-400">
            <Circle size={8} fill="currentColor" /> {online} online
          </span>
        </div>
      </div>

      {erro && (
        <div className="p-3 rounded-xl bg-falha/15 border border-falha/30 text-falha-400 text-xs font-semibold">
          {erro}
        </div>
      )}

      {okMsg && (
        <div className="flex items-start justify-between gap-3 p-3 rounded-xl bg-ativo/15 border border-ativo/30 text-ativo-400 text-xs font-semibold">
          <span>{okMsg}</span>
          <button onClick={() => setOkMsg('')} className="shrink-0 text-ativo-400/70 hover:text-ativo-400">
            <X size={14} />
          </button>
        </div>
      )}

      {ehAdmin && (
        <section className="glass-panel space-y-4 rounded-2xl border border-linha p-4 sm:p-5">
          <div className="flex flex-col gap-1 border-b border-linha pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-acao-200" />
              <h2 className="text-sm font-bold text-white">Permissões dos perfis</h2>
            </div>
            <p className="text-[11px] text-texto-suave">
              Escolha quais telas cada perfil acessa o acesso é conferido no servidor.
            </p>
          </div>

          {permErro && (
            <div className="rounded-xl border border-falha/30 bg-falha/15 p-2.5 text-[11px] font-semibold text-falha-400">
              {permErro}
            </div>
          )}
          {permOk && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-ativo/30 bg-ativo/15 p-2.5 text-[11px] font-semibold text-ativo-400">
              <span>{permOk}</span>
              <button onClick={() => setPermOk('')} className="shrink-0 text-ativo-400/70 hover:text-ativo-400"><X size={13} /></button>
            </div>
          )}

          {permLoading || !perm || !permMatriz ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-texto-suave">
              <Loader2 size={15} className="animate-spin" /> Carregando permissões...
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-xs">
                  <thead>
                    <tr className="text-texto-suave">
                      <th className="px-2 py-2 text-left font-semibold">Tela / Módulo</th>
                      {perm.cargosEditaveis.map(c => (
                        <th key={c} className="px-2 py-2 text-center font-semibold">{c}</th>
                      ))}
                      <th className="px-2 py-2 text-center font-semibold">
                        <span className="inline-flex items-center gap-1 text-acao-200">
                          <Lock size={11} /> Administrador
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {perm.modulos.map(mod => (
                      <tr key={mod.chave} className="border-t border-linha/70">
                        <td className="px-2 py-2 text-white">
                          {mod.nome}
                          {mod.grupo === 'B' && (
                            <span className="ml-1.5 rounded bg-grafite-700 px-1 py-0.5 font-mono text-[9px] text-texto-fraco">operacional</span>
                          )}
                        </td>
                        {perm.cargosEditaveis.map(c => (
                          <td key={c} className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={!!permMatriz[c]?.[mod.chave]}
                              onChange={() => alternarPermissao(c, mod.chave)}
                              className="h-4 w-4 cursor-pointer accent-acao"
                              aria-label={`${c} pode acessar ${mod.nome}`}
                            />
                          </td>
                        ))}
                        <td className="px-2 py-2 text-center">
                          {/* Administrador: acesso total imutavel. */}
                          <Lock size={13} className="mx-auto text-texto-fraco" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={salvarPermissoes}
                  disabled={permSalvando}
                  className="flex items-center gap-1.5 rounded-xl bg-acao px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-acao-200 disabled:opacity-60"
                >
                  {permSalvando
                    ? <><Loader2 size={13} className="animate-spin" /> Salvando...</>
                    : <><Save size={13} /> Salvar permissões</>}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {equipe.map(m => {
          const ehVoce = m.id === usuario?.id;
          const estaInativo = m.ativo === false;
          return (
            <div
              key={m.id}
              className={`glass-panel space-y-3 rounded-2xl p-4 flex flex-col justify-between border ${
                estaInativo
                  ? 'border-espera/50 bg-espera/5'
                  : m.status === 'online'
                  ? 'border-ativo/40'
                  : 'border-linha'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Avatar nome={m.nome} size="md" online={m.status === 'online' && !estaInativo} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-bold text-white">{m.nome}</span>
                      {ehVoce && (
                        <span className="shrink-0 rounded-md bg-acao/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-acao-200">
                          você
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[11px] text-texto-suave">{m.email}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-linha pt-3">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <ShieldCheck size={13} className={estaInativo ? 'text-texto-fraco' : 'text-acao-200'} />
                    {estaInativo ? (
                      // Conta ainda pendente: o cargo so faz sentido depois de
                      // aprovada, entao aqui nao ha seletor -- so aprovar ou recusar.
                      <span className="italic text-texto-fraco">Cargo definido após aprovação</span>
                    ) : ehAdmin ? (
                      <select
                        value={m.cargo}
                        disabled={loadingId === m.id}
                        onChange={e => mudarCargo(m.id, e.target.value)}
                        className="bg-grafite-700 border border-linha rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-acao/50"
                      >
                        {CARGOS.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="font-semibold text-white">{m.cargo}</span>
                    )}
                  </div>

                  <span
                    className={`flex shrink-0 items-center gap-1.5 text-[11px] font-semibold ${
                      estaInativo
                        ? 'text-espera-400'
                        : m.status === 'online'
                        ? 'text-ativo-400'
                        : 'text-texto-fraco'
                    }`}
                  >
                    <Circle size={7} fill="currentColor" />
                    {estaInativo ? 'Pendente' : m.status === 'online' ? 'Online' : vistoEm(m.ultimoAcessoEm)}
                  </span>
                </div>
              </div>

              {ehAdmin && !ehVoce && (
                <div className="pt-3 border-t border-linha flex items-center justify-end gap-2">
                  {estaInativo ? (
                    // Passo de triagem: uma conta recem-criada so pode ser aceita
                    // ou rejeitada. As demais acoes (cargo, senha, excluir) so
                    // aparecem depois que ela vira membro de fato.
                    <>
                      <button
                        disabled={loadingId === m.id}
                        onClick={() => alternarStatus(m.id, true)}
                        className="flex-1 px-3 py-1.5 rounded-xl bg-ativo/20 hover:bg-ativo/30 text-ativo-400 border border-ativo/30 text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                      >
                        <CheckCircle2 size={14} /> Aprovar
                      </button>
                      <button
                        disabled={loadingId === m.id}
                        onClick={() => recusarConta(m)}
                        className="flex-1 px-3 py-1.5 rounded-xl bg-falha/15 hover:bg-falha/25 text-falha-400 border border-falha/30 text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                      >
                        <XCircle size={14} /> Recusar
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        disabled={loadingId === m.id}
                        onClick={() => alternarStatus(m.id, false)}
                        className="px-2.5 py-1.5 rounded-xl bg-falha/15 hover:bg-falha/25 text-falha-400 border border-falha/30 text-[11px] font-semibold flex items-center gap-1 transition-all"
                      >
                        <XCircle size={13} /> Bloquear
                      </button>

                      <button
                        disabled={loadingId === m.id}
                        onClick={() => abrirReset(m)}
                        title="Redefinir senha"
                        className="px-2.5 py-1.5 rounded-xl bg-grafite-700 hover:bg-grafite-600 text-texto-suave hover:text-white border border-linha text-[11px] font-semibold flex items-center gap-1 transition-all"
                      >
                        <KeyRound size={13} /> Senha
                      </button>

                      <button
                        disabled={loadingId === m.id}
                        onClick={() => excluirConta(m)}
                        title="Excluir conta"
                        className="px-2.5 py-1.5 rounded-xl bg-falha/15 hover:bg-falha/25 text-falha-400 border border-falha/30 text-[11px] font-semibold flex items-center gap-1 transition-all"
                      >
                        <Trash2 size={13} /> Excluir
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {equipe.length === 0 && (
          <div className="glass-panel col-span-full rounded-2xl border border-linha py-12 text-center text-xs text-texto-suave">
            Nenhuma conta cadastrada ainda.
          </div>
        )}
      </div>

      {resetAlvo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={fecharReset}
        >
          <form
            onSubmit={confirmarReset}
            onClick={e => e.stopPropagation()}
            className="glass-panel w-full max-w-sm space-y-4 rounded-2xl border border-linha p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <KeyRound size={16} className="text-acao-200" />
                <h2 className="text-sm font-bold text-white">Redefinir senha</h2>
              </div>
              <button
                type="button"
                onClick={fecharReset}
                disabled={salvandoSenha}
                className="text-texto-suave hover:text-white disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs leading-relaxed text-texto-suave">
              Definindo uma nova senha para <strong className="text-white">{resetAlvo.nome}</strong>.
              Ela entra com esta senha e pode trocá-la depois.
            </p>

            <div>
              <label htmlFor="nova-senha" className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-texto-suave">
                Nova senha
              </label>
              <input
                id="nova-senha"
                type="password"
                autoFocus
                autoComplete="new-password"
                value={novaSenha}
                onChange={e => setNovaSenha(e.target.value)}
                placeholder="Mínimo de 6 caracteres"
                className="w-full rounded-xl border border-linha bg-grafite-800 px-3.5 py-2.5 text-sm text-texto placeholder-texto-fraco outline-none transition-colors focus:border-acao focus:ring-2 focus:ring-acao/25"
              />
            </div>

            {resetErro && (
              <p className="text-[11px] font-semibold text-falha-400">{resetErro}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={fecharReset}
                disabled={salvandoSenha}
                className="px-3 py-2 rounded-xl border border-linha text-xs font-semibold text-texto-suave hover:text-white disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvandoSenha}
                className="flex items-center gap-1.5 rounded-xl bg-acao px-3 py-2 text-xs font-bold text-slate-950 hover:bg-acao-200 disabled:opacity-60"
              >
                {salvandoSenha
                  ? <><Loader2 size={13} className="animate-spin" /> Salvando...</>
                  : <><KeyRound size={13} /> Redefinir</>}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
