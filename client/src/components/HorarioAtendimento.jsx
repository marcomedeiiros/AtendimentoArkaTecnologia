// HORÁRIO DE ATENDIMENTO -- a tela da regra de expediente.
//
// Ela grava UMA chave de configuração (`chatbot.horario`) como JSON. Até aqui não
// havia tela nenhuma: a chave existia, o motor a lia, e o único jeito de mexer no
// expediente era editar JSON à mão no banco -- então, na prática, ninguém mexia.
//
// ── O QUE ESTA TELA DELIBERADAMENTE NÃO FAZ ─────────────────────────────────
//
// Ela não decide se estamos dentro ou fora do expediente, e não monta a mensagem
// que o cliente recebe. Quem faz as duas coisas é `chatbot.horario.js`, no
// servidor, e é de lá que vêm o resumo por extenso e a prévia da mensagem
// (`GET /configuracoes` → `horario`). Recalcular isso em JavaScript de navegador
// criaria uma segunda regra de expediente -- e a que vale é a do bot.
//
// Por isso a prévia só atualiza depois de SALVAR: ela é a resposta do servidor,
// não um palpite da tela. O aviso no rodapé diz isso ao operador.
import { useState, useRef } from 'react';
import { Clock, Plus, X, CalendarOff, Info, Pencil, Eye, CornerDownLeft } from 'lucide-react';

// `Date#getDay`: 0 = domingo. Mesma numeração do JSON e do motor -- nenhuma
// tradução em lugar nenhum.
const DIAS = [
  { n: 1, nome: 'Segunda-feira' },
  { n: 2, nome: 'Terça-feira' },
  { n: 3, nome: 'Quarta-feira' },
  { n: 4, nome: 'Quinta-feira' },
  { n: 5, nome: 'Sexta-feira' },
  { n: 6, nome: 'Sábado' },
  { n: 0, nome: 'Domingo' },
];

// Fusos que fazem sentido para uma operação brasileira. Campo livre seria pior:
// um typo em `timezone` cai silenciosamente no fuso de Brasília (o motor não
// bloqueia atendimento por causa de configuração ilegível), e o operador ficaria
// sem entender por que o expediente "não mudou".
const FUSOS = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Cuiaba',
  'America/Belem',
  'America/Fortaleza',
  'America/Rio_Branco',
  'America/Noronha',
];

const PERIODO_PADRAO = { inicio: '08:00', fim: '18:00' };

// A forma que o servidor entrega já é a normalizada (a conversão do formato
// antigo acontece lá). Aqui só garantimos que todo dia existe no objeto, para os
// campos não aparecerem vazios em dia que nunca foi configurado.
function comTodosOsDias(horario) {
  const dias = {};
  for (const { n } of DIAS) {
    const d = horario?.dias?.[String(n)] || horario?.dias?.[n] || null;
    dias[n] = {
      ativo: d?.ativo === true,
      periodos: Array.isArray(d?.periodos) && d.periodos.length ? d.periodos : [{ ...PERIODO_PADRAO }],
    };
  }
  return dias;
}

function CampoHora({ valor, onChange, rotulo }) {
  const invalido = valor && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(valor);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] uppercase text-slate-500 tracking-wide">{rotulo}</span>
      <input
        type="time"
        value={valor || ''}
        onChange={(e) => onChange(e.target.value)}
        className={`bg-grafite-800 border rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-acao/50 ${
          invalido ? 'border-falha/60' : 'border-linha'
        }`}
      />
    </label>
  );
}

export default function HorarioAtendimento({ horario, resumo, mensagemPrevia, semPeriodos, mensagemPadrao, onChange }) {
  // `dias` e `excecoes` no estado local; cada alteração reserializa a chave
  // inteira para o pai (que a envia junto do "Salvar configurações"). Guardar
  // JSON no estado do pai e reparsear a cada tecla daria trabalho e nenhuma
  // vantagem: a chave é sempre gravada por completo.
  const [dias, setDias] = useState(() => comTodosOsDias(horario));
  const [excecoes, setExcecoes] = useState(() => (Array.isArray(horario?.excecoes) ? horario.excecoes : []));
  const [ativo, setAtivo] = useState(horario?.ativo === true);
  const [timezone, setTimezone] = useState(horario?.timezone || 'America/Sao_Paulo');
  const [mensagem, setMensagem] = useState(horario?.mensagem || '');
  const [reavisar, setReavisar] = useState(
    Number.isFinite(horario?.reavisarAposMin) ? horario.reavisarAposMin : 120
  );
  // O campo da mensagem, para o atalho da prévia levar o foco até ele.
  const campoMensagemRef = useRef(null);

  // Serializa e entrega ao pai. Recebe os pedaços que acabaram de mudar porque o
  // `setState` do React é assíncrono: ler o estado aqui pegaria o valor anterior.
  function publicar(patch = {}) {
    const atual = {
      ativo,
      timezone,
      mensagem,
      reavisarAposMin: reavisar,
      dias,
      excecoes,
      ...patch,
    };
    const payload = {
      ativo: atual.ativo,
      timezone: atual.timezone,
      // Dia desligado vai com `periodos: []`: guardar os horários de um dia
      // fechado deixaria lixo que ninguém lê, e o motor já trata dia inativo
      // como fechado independentemente do que houver ali.
      dias: Object.fromEntries(
        DIAS.map(({ n }) => {
          const d = atual.dias[n];
          return [String(n), { ativo: !!d.ativo, periodos: d.ativo ? d.periodos : [] }];
        })
      ),
      excecoes: atual.excecoes.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(String(e.data || ''))),
      mensagem: atual.mensagem || '',
      reavisarAposMin: Number(atual.reavisarAposMin) || 0,
    };
    onChange('chatbot.horario', JSON.stringify(payload));
  }

  const mudarDia = (n, patch) => {
    const novos = { ...dias, [n]: { ...dias[n], ...patch } };
    setDias(novos);
    publicar({ dias: novos });
  };
  const mudarPeriodo = (n, i, patch) => {
    const periodos = dias[n].periodos.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    mudarDia(n, { periodos });
  };
  const addPeriodo = (n) => mudarDia(n, { periodos: [...dias[n].periodos, { ...PERIODO_PADRAO }] });
  const removerPeriodo = (n, i) => {
    const periodos = dias[n].periodos.filter((_, idx) => idx !== i);
    // Sem período nenhum o dia é fechado -- então tirar o último equivale a
    // desligar o dia, e é melhor dizê-lo no estado do que deixar um dia "ativo"
    // que o motor lê como fechado.
    mudarDia(n, periodos.length ? { periodos } : { ativo: false, periodos: [{ ...PERIODO_PADRAO }] });
  };

  const mudarExcecoes = (novas) => {
    setExcecoes(novas);
    publicar({ excecoes: novas });
  };

  return (
    <div className="glass-panel p-6 rounded-2xl border border-linha space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-white font-display flex items-center gap-2">
            <Clock size={16} className="text-acao-200" /> Horário de atendimento
          </h3>
          <p className="text-[11px] text-slate-400 leading-relaxed mt-1 max-w-xl">
            Fora do horário, o bot não inicia o fluxo: ele avisa o cliente e mantém a conversa
            em <strong className="text-slate-300">Pendentes</strong> para a equipe atender no próximo
            período. Quem já está no meio de um menu ou escrevendo uma resposta continua normalmente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setAtivo(!ativo); publicar({ ativo: !ativo }); }}
          className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
            ativo
              ? 'bg-ativo/15 border-ativo/50 text-ativo-400'
              : 'bg-grafite-700 border-linha text-slate-400 hover:border-linha-forte'
          }`}
        >
          {ativo ? '● Regra ativa' : '○ Atende a qualquer hora'}
        </button>
      </div>

      {!ativo && (
        <p className="text-[11px] text-slate-500 bg-grafite-700/60 border border-linha rounded-xl p-3 leading-relaxed">
          Com a regra desligada o bot atende 24 horas os campos abaixo ficam guardados e voltam a
          valer quando você reativar.
        </p>
      )}

      {ativo && semPeriodos && (
        <p className="text-[11px] text-espera-400 bg-espera/10 border border-espera/30 rounded-xl p-3 leading-relaxed">
          A regra está ativa mas <strong>nenhum dia tem horário válido</strong> na configuração
          salva. Do jeito que está, o bot considera a empresa fechada em todos os dias.
        </p>
      )}

      {/* ── FUSO ─────────────────────────────────────────────────────────────
          Não é enfeite: o servidor roda em UTC no container. Sem fuso próprio,
          um expediente de 08:00–18:00 valia das 05:00 às 15:00 locais. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-400 font-medium">Fuso horário</span>
          <select
            value={timezone}
            onChange={(e) => { setTimezone(e.target.value); publicar({ timezone: e.target.value }); }}
            className="bg-grafite-700 border border-linha rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-acao/50"
          >
            {FUSOS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-400 font-medium">
            Repetir o aviso somente após (minutos)
          </span>
          <input
            type="number"
            min="0"
            max="1440"
            value={reavisar}
            onChange={(e) => { setReavisar(e.target.value); publicar({ reavisarAposMin: e.target.value }); }}
            className="bg-grafite-700 border border-linha rounded-xl px-3 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-acao/50"
          />
          <span className="text-[10px] text-slate-500 leading-relaxed">
            O cliente que manda três mensagens seguidas às 22h recebe UM aviso.
            0 = avisa em toda mensagem.
          </span>
        </label>
      </div>

      {/* ── OS DIAS ────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-300">Dias e períodos</div>
        {DIAS.map(({ n, nome }) => {
          const dia = dias[n];
          return (
            <div
              key={n}
              className={`rounded-xl border p-3 space-y-2.5 transition-colors ${
                dia.ativo ? 'bg-grafite-700/80 border-linha' : 'bg-grafite-800/60 border-linha/60'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => mudarDia(n, { ativo: !dia.ativo })}
                  className="flex items-center gap-2 text-left"
                >
                  <span
                    className={`w-9 h-5 rounded-full relative transition-colors ${
                      dia.ativo ? 'bg-acao' : 'bg-slate-600'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                        dia.ativo ? 'left-4' : 'left-0.5'
                      }`}
                    />
                  </span>
                  <span className={`text-xs font-bold ${dia.ativo ? 'text-white' : 'text-slate-500'}`}>
                    {nome}
                  </span>
                </button>
                {dia.ativo ? (
                  <button
                    type="button"
                    onClick={() => addPeriodo(n)}
                    className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-acao/10 border border-acao/30 text-acao-200 hover:bg-acao/20 flex items-center gap-1"
                  >
                    <Plus size={11} /> Período
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Fechado</span>
                )}
              </div>

              {dia.ativo && dia.periodos.map((p, i) => (
                <div key={i} className="flex items-end gap-2 pl-11">
                  <CampoHora rotulo="Abre" valor={p.inicio} onChange={(v) => mudarPeriodo(n, i, { inicio: v })} />
                  <span className="text-slate-500 text-xs pb-2">às</span>
                  <CampoHora rotulo="Fecha" valor={p.fim} onChange={(v) => mudarPeriodo(n, i, { fim: v })} />
                  {dia.periodos.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removerPeriodo(n, i)}
                      className="mb-1 p-1.5 rounded-lg text-slate-500 hover:text-falha-400 hover:bg-falha/10"
                      title="Remover este período"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
              {dia.ativo && dia.periodos.length > 1 && (
                <p className="text-[10px] text-slate-500 pl-11">
                  Dois períodos = intervalo fechado entre eles (almoço).
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── FERIADOS E EXCEÇÕES ────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <CalendarOff size={13} className="text-espera-400" /> Feriados e exceções
          </div>
          <button
            type="button"
            onClick={() => mudarExcecoes([...excecoes, { data: '', fechado: true, periodos: [], descricao: '' }])}
            className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-espera/10 border border-espera/30 text-espera-400 hover:bg-espera/20 flex items-center gap-1"
          >
            <Plus size={11} /> Adicionar data
          </button>
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Uma data específica vence o dia da semana. Sem período, a data é fechada; com período,
          ela tem um expediente diferente (véspera até meio-dia, por exemplo).
        </p>
        {excecoes.length === 0 && (
          <p className="text-[11px] text-slate-600 italic">Nenhuma exceção cadastrada.</p>
        )}
        {excecoes.map((e, i) => {
          const trocar = (patch) => mudarExcecoes(excecoes.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
          const periodo = e.periodos?.[0] || { ...PERIODO_PADRAO };
          return (
            <div key={i} className="rounded-xl bg-grafite-700/80 border border-linha p-3 space-y-2.5">
              <div className="flex items-end gap-2 flex-wrap">
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] uppercase text-slate-500 tracking-wide">Data</span>
                  <input
                    type="date"
                    value={e.data || ''}
                    onChange={(ev) => trocar({ data: ev.target.value })}
                    className="bg-grafite-800 border border-linha rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-acao/50"
                  />
                </label>
                <label className="flex flex-col gap-1 flex-1 min-w-[10rem]">
                  <span className="text-[9px] uppercase text-slate-500 tracking-wide">Descrição</span>
                  <input
                    type="text"
                    value={e.descricao || ''}
                    onChange={(ev) => trocar({ descricao: ev.target.value })}
                    placeholder="Natal, Independência, recesso..."
                    className="bg-grafite-800 border border-linha rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-acao/50"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => mudarExcecoes(excecoes.filter((_, idx) => idx !== i))}
                  className="mb-1 p-1.5 rounded-lg text-slate-500 hover:text-falha-400 hover:bg-falha/10"
                  title="Remover esta exceção"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() =>
                    trocar(
                      e.fechado
                        ? { fechado: false, periodos: [{ ...PERIODO_PADRAO }] }
                        : { fechado: true, periodos: [] }
                    )
                  }
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors ${
                    e.fechado
                      ? 'bg-falha/10 border-falha/30 text-falha-400'
                      : 'bg-ativo/10 border-ativo/30 text-ativo-400'
                  }`}
                >
                  {e.fechado ? 'Fechado o dia todo' : 'Horário especial'}
                </button>
                {!e.fechado && (
                  <>
                    <CampoHora
                      rotulo="Abre"
                      valor={periodo.inicio}
                      onChange={(v) => trocar({ periodos: [{ ...periodo, inicio: v }] })}
                    />
                    <span className="text-slate-500 text-xs pb-2">às</span>
                    <CampoHora
                      rotulo="Fecha"
                      valor={periodo.fim}
                      onChange={(v) => trocar({ periodos: [{ ...periodo, fim: v }] })}
                    />
                  </>
                )}
              </div>
              {!/^\d{4}-\d{2}-\d{2}$/.test(String(e.data || '')) && (
                <p className="text-[10px] text-espera-400">
                  Sem data preenchida, esta exceção não será salva.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── A MENSAGEM ─────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Pencil size={12} className="text-acao-200" /> Mensagem enviada fora do horário
            <span className="font-normal text-[10px] text-acao-200">(este é o campo que se edita)</span>
          </div>
          {/* CARREGAR O PADRAO PARA EDITAR.
              
              Com o campo vazio o bot usa o texto padrao, que aparece aqui apenas
              como sugestao (placeholder) -- e sugestao nao da para editar. Para
              mudar uma frase, a pessoa tinha de redigitar as onze linhas do
              zero. Este botao traz o padrao para dentro do campo.
              
              Copia o TEMPLATE, com `{{horarios}}` no lugar da tabela -- e nunca
              a previa de baixo, que ja vem com os horarios expandidos. Copiar a
              previa chumbaria "08:00 as 18:00" no texto, e trocar o expediente
              deixaria o cliente lendo o horario antigo: exatamente o que o aviso
              logo abaixo pede para nao fazer. */}
          {mensagemPadrao && !mensagem.trim() && (
            <button
              type="button"
              onClick={() => { setMensagem(mensagemPadrao); publicar({ mensagem: mensagemPadrao }); }}
              title="Traz o texto padrão para o campo, para você editar em vez de digitar tudo de novo"
              className="shrink-0 px-2 py-1 rounded-lg text-[10px] font-semibold bg-acao/10 border border-acao/30 text-acao-200 hover:bg-acao/20 flex items-center gap-1"
            >
              <CornerDownLeft size={11} /> Editar o texto padrão
            </button>
          )}
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Use <code className="text-acao-200 font-mono">{'{{horarios}}'}</code> para inserir a tabela
          acima e <code className="text-acao-200 font-mono">{'{{excecao}}'}</code> para a descrição do
          feriado do dia. <strong className="text-slate-400">Não escreva os horários à mão</strong>:
          trocar o expediente aqui em cima tem de trocar o que o cliente lê.
        </p>
        <textarea
          ref={campoMensagemRef}
          rows={7}
          value={mensagem}
          onChange={(e) => { setMensagem(e.target.value); publicar({ mensagem: e.target.value }); }}
          placeholder={mensagemPadrao || ''}
          lang="pt-BR"
          spellCheck
          className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-acao/50 leading-relaxed"
        />
        <p className="text-[10px] text-slate-500">
          Em branco = usa o texto padrão (mostrado em cinza no campo, como sugestão).
        </p>
      </div>

      {/* ── O QUE ESTÁ VALENDO AGORA (resposta do servidor) ────────────────── */}
      {(resumo || mensagemPrevia) && (
        <div className="rounded-xl bg-grafite-800/70 border border-linha p-3.5 space-y-2.5">
          <div className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            <Info size={12} className="text-acao-200" /> O que está salvo e valendo agora
          </div>
          {resumo && (
            <pre className="text-[11px] text-slate-400 font-mono whitespace-pre-wrap leading-relaxed">
              {resumo}
            </pre>
          )}
          {mensagemPrevia && (
            <div>
              {/* ESTE BLOCO NAO SE EDITA -- e precisa dizer isso.
                  
                  Ele parece um campo de texto (moldura, fundo proprio, texto da
                  mensagem inteira) e e a primeira coisa que a pessoa tenta
                  editar. Nao da: e a resposta do SERVIDOR, com `{{horarios}}` ja
                  trocado pela tabela real -- e existe justamente para conferir o
                  que o cliente vai ler. O rotulo diz o que e, e o atalho leva
                  para o campo certo em vez de deixar a pessoa procurando. */}
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="text-[10px] uppercase text-slate-500 tracking-wide flex items-center gap-1">
                  <Eye size={11} /> Prévia da mensagem · somente leitura
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const el = campoMensagemRef.current;
                    if (!el) return;
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.focus();
                  }}
                  className="shrink-0 text-[10px] font-semibold text-acao-200 hover:underline underline-offset-2 flex items-center gap-1"
                >
                  <Pencil size={10} /> Editar a mensagem
                </button>
              </div>
              <pre className="text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed bg-grafite-700/60 rounded-lg p-2.5 border border-linha/60 select-text">
                {mensagemPrevia}
              </pre>
            </div>
          )}
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Este bloco é o retrato do que está <strong className="text-slate-400">gravado</strong>,
            calculado pelo servidor pela mesma regra que o bot usa não é um campo, e só muda
            depois de <strong className="text-slate-400">Salvar horário</strong>.
          </p>
        </div>
      )}
    </div>
  );
}
