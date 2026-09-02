/**
 * ABA "HORARIO DE ATENDIMENTO" -- a moldura que salva o expediente.
 *
 * O formulario em si e o `HorarioAtendimento`, que nao sabe salvar: ele so
 * reserializa a chave `chatbot.horario` e entrega ao pai. Antes esse pai era a
 * tela de Configuracoes, e o expediente ia junto com Evolution, n8n e chaves de
 * API no mesmo "Salvar configuracoes" -- decidir o horario da empresa nao tem
 * nada a ver com credencial de integracao, e quem cuida do bot nao deveria
 * precisar passar pela tela dos segredos para mexer nele.
 *
 * Entao o expediente mudou de casa: vive ao lado dos fluxos, que e o que ele
 * governa (fora do horario o bot nao inicia fluxo nenhum). E este arquivo e o
 * pai novo -- carrega, guarda o rascunho e grava SO a chave do horario.
 *
 * PERMISSAO: a API de configuracao inteira exige o modulo `configuracoes`,
 * inclusive a leitura. Quem tem `fluxos` mas nao `configuracoes` tomaria 403 no
 * GET e veria uma aba quebrada, entao a aba se explica em vez de tentar.
 */
import { useState, useEffect, useCallback } from 'react';
import { Save, Loader2, CheckCircle2, Lock } from 'lucide-react';
import { ConfiguracoesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import HorarioAtendimento from '../HorarioAtendimento';

export default function PainelHorarioAtendimento() {
  const { usuario } = useAuth();
  // Sem lista de permissoes (sessao antiga) libera e deixa o servidor decidir --
  // mesma regra do menu e das rotas.
  const permissoes = usuario?.permissoes;
  const podeConfigurar = !Array.isArray(permissoes) || permissoes.includes('configuracoes');

  // `horario` e o retrato INTERPRETADO pelo servidor (objeto + resumo por
  // extenso + previa da mensagem); `rascunho` e a string JSON que o formulario
  // publicou e ainda nao foi gravada. `null` = nada mudou, e o botao fica
  // desligado: um PUT que regrava o mesmo valor so serve para dar a impressao
  // de que algo aconteceu.
  const [horario, setHorario] = useState(null);
  const [rascunho, setRascunho] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const d = await ConfiguracoesAPI.obter();
      setHorario(d.horario || null);
      setRascunho(null);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!podeConfigurar) { setCarregando(false); return; }
    carregar();
  }, [carregar, podeConfigurar]);

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
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  if (!podeConfigurar) {
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
          entao aqui fica so o que falta: o estado do rascunho e o botao. */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[11px] text-slate-500 leading-relaxed max-w-xl">
          {rascunho != null
            ? 'Há alterações não salvas. Elas só passam a valer para o bot depois de salvar.'
            : 'O expediente vale para o bot: fora dele, o fluxo não inicia e a conversa fica em Pendentes.'}
        </p>
        <button
          onClick={salvar}
          disabled={salvando || carregando || rascunho == null}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {salvando ? <Loader2 size={14} className="animate-spin" /> : salvo ? <CheckCircle2 size={14} /> : <Save size={14} />}
          {salvando ? 'Salvando...' : salvo ? 'Salvo!' : 'Salvar horário'}
        </button>
      </div>

      {erro && (
        <div className="p-3 rounded-xl bg-falha/10 border border-falha/30 text-xs text-falha-400">{erro}</div>
      )}

      {carregando && (
        <div className="glass-panel p-6 rounded-2xl border border-linha flex items-center gap-2 text-xs text-slate-400">
          <Loader2 size={14} className="animate-spin" /> Carregando o expediente...
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
