/**
 * ABA "HORARIO DE ATENDIMENTO" -- a moldura que carrega e salva o expediente.
 *
 * O formulario em si e o `HorarioAtendimento`, que nao sabe salvar: ele guarda os
 * dias e as excecoes em estado local e, a cada alteracao, reserializa a chave
 * `chatbot.horario` e entrega ao pai. Antes esse pai era a tela de Configuracoes,
 * e o expediente ia junto com Evolution, n8n e chaves de API no mesmo "Salvar
 * configuracoes" -- decidir o horario da empresa nao tem nada a ver com
 * credencial de integracao. Agora o expediente vive ao lado dos fluxos, que e o
 * que ele governa (fora do horario o bot nao inicia fluxo nenhum), e este arquivo
 * e o pai novo.
 *
 * ── NENHUM ESTADO EM BRANCO E SILENCIOSO ───────────────────────────────────
 *
 * A primeira versao renderizava o formulario so quando o retrato do servidor
 * chegava (`!carregando && horario && <form/>`), e nao dizia nada nos outros
 * casos. Quando o retrato nao vinha, a aba mostrava a barra com o botao Salvar e
 * MAIS NADA -- e "a aba abre mas nao da para editar nada" e exatamente o que se
 * ve nesse estado. Um formulario ausente e indistinguivel de um formulario
 * travado para quem esta olhando.
 *
 * Agora cada caminho tem tela e saida:
 *   carregando        -> "Carregando o expediente..."
 *   403 do servidor   -> explica que falta o modulo Configuracoes
 *   outro erro        -> mostra a mensagem + botao Tentar de novo
 *   sem retrato       -> diz isso, em vez de nao desenhar nada
 *   retrato presente  -> o formulario, editavel
 *
 * A permissao NAO e mais checada aqui para decidir se o formulario aparece. A
 * lista `usuario.permissoes` do navegador pode estar velha (ela nasce no login),
 * e usa-la como porteiro esconderia o formulario de quem TEM acesso. Quem decide
 * e o servidor; a lista local so escolhe a redacao do aviso.
 */
import { useState, useEffect, useCallback } from 'react';
import { Save, Loader2, CheckCircle2, Lock, AlertCircle, RotateCcw } from 'lucide-react';
import { ConfiguracoesAPI } from '../../services/api';
import HorarioAtendimento from '../HorarioAtendimento';

export default function PainelHorarioAtendimento() {
  // `horario` e o retrato INTERPRETADO pelo servidor (objeto + resumo por
  // extenso + previa da mensagem); `rascunho` e a string JSON que o formulario
  // publicou e ainda nao foi gravada. `null` = nada mudou, e o botao fica
  // desligado: um PUT que regrava o mesmo valor so serve para dar a impressao de
  // que algo aconteceu.
  const [horario, setHorario] = useState(null);
  const [rascunho, setRascunho] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState('');
  const [semAcesso, setSemAcesso] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(''); setSemAcesso(false);
    try {
      const d = await ConfiguracoesAPI.obter();
      setHorario(d?.horario || null);
      setRascunho(null);
    } catch (e) {
      // 403 e resposta definitiva (falta o modulo), nao falha passageira: merece
      // texto proprio em vez da mensagem crua da API.
      if (e?.status === 403 || e?.codigo === 'FORBIDDEN_MODULE') setSemAcesso(true);
      else setErro(e.message || 'Não foi possível carregar o expediente.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async () => {
    if (rascunho == null) return;
    setSalvando(true); setErro('');
    try {
      // PAYLOAD PARCIAL, de proposito: o PUT grava apenas as chaves que recebe.
      // Mandar o mapa inteiro daqui arrastaria os segredos mascarados de volta
      // para uma tela que nao tem nada a ver com eles.
      await ConfiguracoesAPI.salvar({ 'chatbot.horario': rascunho });
      setSalvo(true);
      setTimeout(() => setSalvo(false), 3000);
      // Recarrega o retrato interpretado: o resumo e a previa sao calculados no
      // servidor pela mesma regra que o bot usa, e deixa-los com o quadro
      // anterior mostraria ao operador uma regra diferente da que foi gravada.
      await carregar();
    } catch (e) {
      setErro(e.message || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  if (semAcesso) {
    return (
      <div className="glass-panel p-6 rounded-2xl border border-linha max-w-xl space-y-2">
        <h3 className="font-bold text-sm text-white font-display flex items-center gap-2">
          <Lock size={16} className="text-slate-500" /> Horário de atendimento
        </h3>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          O expediente é gravado junto das configurações do sistema, e seu perfil não tem esse
          acesso. Fale com um Administrador para liberar o módulo{' '}
          <strong className="text-slate-300">Configurações</strong> ou pedir a alteração.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barra de salvar propria. O formulario abaixo ja tem titulo e explicacao,
          entao aqui fica so o que falta: o estado do rascunho e os botoes. */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[11px] text-slate-500 leading-relaxed max-w-xl">
          {rascunho != null
            ? 'Há alterações não salvas. Elas só passam a valer para o bot depois de salvar.'
            : 'O expediente vale para o bot: fora dele, o fluxo não inicia e a conversa fica em Pendentes.'}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={carregar}
            disabled={carregando || salvando}
            title="Recarregar o expediente que está salvo (descarta alterações não salvas)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-linha bg-grafite-700 text-slate-300 text-xs font-semibold hover:text-white hover:border-linha-forte transition-colors disabled:opacity-50"
          >
            <RotateCcw size={13} /> Recarregar
          </button>
          <button
            onClick={salvar}
            disabled={salvando || carregando || rascunho == null}
            title={rascunho != null ? 'Gravar o expediente' : 'Nada mudou desde o último salvamento'}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {salvando ? <Loader2 size={14} className="animate-spin" /> : salvo ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {salvando ? 'Salvando...' : salvo ? 'Salvo!' : 'Salvar horário'}
          </button>
        </div>
      </div>

      {erro && (
        <div className="flex items-start justify-between gap-3 p-3 rounded-xl bg-falha/10 border border-falha/30 text-xs text-falha-400">
          <span className="flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-px" /> {erro}
          </span>
          <button onClick={carregar} className="shrink-0 font-bold underline underline-offset-2 hover:text-white">
            Tentar de novo
          </button>
        </div>
      )}

      {carregando && (
        <div className="glass-panel p-6 rounded-2xl border border-linha flex items-center gap-2 text-xs text-slate-400">
          <Loader2 size={14} className="animate-spin" /> Carregando o expediente...
        </div>
      )}

      {/* SEM RETRATO E SEM ERRO: o caso que antes desenhava o vazio.
          
          Acontece se a resposta vier sem o campo `horario` (servidor mais antigo
          que o painel, por exemplo). Dizer isso e melhor que uma aba muda -- e o
          botao ao lado resolve na hora quando e coisa passageira. */}
      {!carregando && !erro && !horario && (
        <div className="glass-panel p-6 rounded-2xl border border-linha space-y-2 max-w-xl">
          <h3 className="font-bold text-sm text-white font-display flex items-center gap-2">
            <AlertCircle size={16} className="text-espera-400" /> Não foi possível ler o expediente atual
          </h3>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            O servidor respondeu, mas sem os dados do horário. Se o sistema acabou de ser
            atualizado, reinicie o servidor e clique em <strong className="text-slate-300">Recarregar</strong>.
          </p>
        </div>
      )}

      {/* `key` amarrado ao retrato do servidor: o formulario guarda os dias e as
          excecoes em estado local, e sem a chave ele nao reinicializaria depois
          de um Salvar -- a tela continuaria mostrando o rascunho anterior mesmo
          com outra configuracao gravada. */}
      {!carregando && horario && (
        <HorarioAtendimento
          key={JSON.stringify(horario.horario || {})}
          horario={horario.horario}
          resumo={horario.resumo}
          mensagemPrevia={horario.mensagemPrevia}
          semPeriodos={horario.semPeriodos}
          mensagemPadrao={horario.mensagemPadrao}
          onChange={(_chave, valor) => setRascunho(valor)}
        />
      )}
    </div>
  );
}
