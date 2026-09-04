import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Trash2, Send, AlertCircle, Waves } from 'lucide-react';

/**
 * SUPRESSÃO DE RUÍDO -- o pedido que faz o áudio do atendimento sair limpo.
 *
 * Antes daqui a captação era `{ audio: true }`: o navegador entregava o
 * microfone cru, com o ar-condicionado, o teclado, o ventilador e a conversa da
 * mesa ao lado. Do outro lado, um cliente ouvindo tudo isso por cima da voz.
 *
 * As três chaves fazem coisas diferentes, e as três importam num escritório:
 *
 *   noiseSuppression  -> tira o ruído CONSTANTE de fundo (ar, ventilador, chiado)
 *   echoCancellation  -> tira o retorno do próprio alto-falante, que é o que faz
 *                        a gravação sair com eco quando ninguém usa fone
 *   autoGainControl   -> nivela o volume: quem fala longe do microfone não sai
 *                        sussurrando, quem fala perto não estoura
 *
 * `channelCount: 1` porque voz não tem estéreo: dois canais só dobrariam o
 * tamanho do arquivo com a mesma informação nos dois lados.
 *
 * NÃO é processamento nosso -- é o processamento nativo do navegador (o mesmo
 * que uma chamada de vídeo usa), pedido por constraint. Um filtro escrito à mão
 * com AudioContext custaria CPU, atrasaria a gravação e, feito por aproximação,
 * cortaria pedaço de voz junto com o ruído.
 */
const CONSTRAINTS_LIMPAS = {
  audio: {
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

/**
 * O CONTÊINER DO ÁUDIO -- e por que rotular não converte nada.
 *
 * Até 02/09/2026 o áudio saía daqui como `new MediaRecorder(stream)` (sem pedir
 * formato: no Chrome isso é WebM) e ia embrulhado num `Blob` com o rótulo
 * `audio/ogg`. Rótulo de Blob é só metadado -- os bytes continuavam WebM. O
 * WhatsApp acreditava no rótulo, tentava ler OGG, falhava, e a bolha chegava
 * ao cliente como aquela onda cinza sem botão de play.
 *
 * Conferido nos arquivos que a VM guardou: nome `.ogg`, primeiros bytes
 * `1A 45 DF A3` -- cabeçalho EBML, ou seja, WebM. OGG de verdade começa
 * com `OggS`.
 *
 * A correção é dizer a VERDADE sobre o que foi gravado. A Evolution tem ffmpeg
 * e converte para o OGG/Opus que o WhatsApp exige -- mas só acerta a conversão
 * se o formato de entrada estiver declarado corretamente.
 *
 * A ordem abaixo é preferência, não exigência: OGG/Opus primeiro (Firefox grava
 * nativamente, e aí não há conversão nenhuma), WebM/Opus depois (Chrome, Edge).
 * `isTypeSupported` não existe em navegador muito antigo, daí o `?.` e o
 * fallback para o padrão do navegador -- que agora é lido de volta em
 * `mediaRecorder.mimeType` em vez de ser adivinhado.
 */
const FORMATOS_PREFERIDOS = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];

function melhorFormatoSuportado() {
  for (const tipo of FORMATOS_PREFERIDOS) {
    if (window.MediaRecorder?.isTypeSupported?.(tipo)) return tipo;
  }
  return null;
}

/**
 * ISOLAMENTO DE VOZ -- o que o `noiseSuppression` NAO faz.
 *
 * A pergunta que motivou isto: "o supressor ajuda a nao pegar as vozes de
 * fundo?". Nao. O `noiseSuppression` mira ruido CONSTANTE (ar, ventilador,
 * chiado) e e treinado para PRESERVAR fala -- a voz do colega ao lado e fala,
 * entao ele a protege em vez de remover.
 *
 * `voiceIsolation` e a constraint que mira exatamente isso: manter quem esta
 * falando no microfone e abaixar o resto, inclusive outras vozes. E um pedido
 * OPCIONAL de proposito, e por duas razoes:
 *
 *   1. depende de suporte de baixo nivel do sistema/hardware -- onde nao houver,
 *      o navegador ignora a chave e a gravacao segue normal;
 *   2. quando funciona, e um processamento agressivo. Por isso a escada de
 *      tentativas em `capturarMicrofone`: se pedir isolamento fizer o navegador
 *      recusar a captura, tentamos de novo sem ele em vez de perder o audio.
 *
 * O selo na tela le o que o navegador CONFIRMOU (getSettings), nunca o que
 * pedimos: prometer "voz isolada" onde a plataforma nao suporta seria pior que
 * nao dizer nada.
 */
const CONSTRAINTS_COM_ISOLAMENTO = {
  audio: { ...CONSTRAINTS_LIMPAS.audio, voiceIsolation: true },
};

/**
 * QUAL MICROFONE -- a parte que nenhum filtro resolve.
 *
 * O pedido que motivou isto: "sai voz de outras pessoas, e preciso gritar para
 * gravar". As duas queixas tem a MESMA causa, e ela nao e de software.
 *
 * `getUserMedia` sem `deviceId` usa o padrao do sistema. Num notebook de
 * escritorio o padrao quase sempre e o ARRAY INTERNO -- que e projetado para
 * captar a sala toda, de longe. Com o fone de haste (o boom a centimetros da
 * boca), a voz de quem fala chega de 20 a 30 dB mais alta que a de qualquer
 * pessoa a dois metros. Isso e distancia, nao algoritmo: nenhum supressor
 * compra essa diferenca depois, porque na gravacao do array as duas vozes ja
 * chegaram com volumes parecidos.
 *
 * Por isso a escolha do microfone e PERSISTIDA -- e em localStorage, nao nas
 * preferencias do servidor como o tema e a barra lateral. O microfone e
 * propriedade da MAQUINA, nao da pessoa: o `deviceId` gravado aqui nao
 * significa nada no computador de casa, e sincroniza-lo entre maquinas so
 * levaria um id morto de uma para a outra.
 */
const CHAVE_MIC = 'central.microfone.deviceId';

function micSalvo() {
  try { return localStorage.getItem(CHAVE_MIC) || ''; } catch { return ''; }
}
function salvarMic(id) {
  try { id ? localStorage.setItem(CHAVE_MIC, id) : localStorage.removeItem(CHAVE_MIC); } catch { /* modo privado */ }
}

// Palavras que denunciam um fone de haste no rotulo do dispositivo. Serve para
// SUGERIR, nunca para decidir sozinho: se nada casar, fica o padrao do sistema
// e a pessoa escolhe na lista. Um palpite errado que se corrige com um clique e
// melhor que o padrao errado de hoje, que nao se corrige de jeito nenhum.
//
// `\bfone` e nao `fone`: em portugues "microFONE" contem "fone", entao o padrao
// solto casava com TODO microfone rotulado em portugues -- inclusive o array do
// notebook, que e exatamente o que se quer evitar. O limite de palavra deixa
// passar "Fone USB" e barra "Microfone (Realtek)".
const PISTAS_FONE = /headset|head-set|\bfone\b|boom|usb audio|jabra|logitech|plantronics|poly|\bdell\b|\bwh\d|\bhs\d/i;
// E as que denunciam o microfone embutido, que e justamente o que queremos
// evitar num escritorio.
const PISTAS_INTERNO = /array|internal|interno|integrad|built-?in|laptop|notebook|webcam|camera/i;

async function listarMicrofones() {
  try {
    const todos = await navigator.mediaDevices.enumerateDevices();
    return todos.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications');
  } catch {
    return [];
  }
}

/** O melhor palpite quando ninguem escolheu nada ainda. `null` = deixa o padrao. */
function sugerirMicrofone(lista) {
  const fone = lista.find((d) => PISTAS_FONE.test(d.label) && !PISTAS_INTERNO.test(d.label));
  return fone ? fone.deviceId : null;
}

/**
 * Pede o microfone com supressão e, se o navegador recusar as constraints, pede
 * de novo sem elas.
 *
 * O fallback não é zelo excessivo: `getUserMedia` rejeita com
 * `OverconstrainedError` quando o dispositivo não suporta algo que foi pedido, e
 * sem esta segunda tentativa o gravador simplesmente pararia de funcionar em
 * navegador antigo ou microfone incomum -- trocando "áudio com ruído" por
 * "nenhum áudio", que é muito pior.
 */
async function capturarMicrofone(deviceId = '') {
  const comDispositivo = deviceId ? { deviceId: { exact: deviceId } } : {};
  // Escada de tentativas, do melhor para o garantido. Cada degrau abre mão de
  // uma melhoria, nunca da gravação: ficar sem áudio é pior que áudio com ruído.
  //
  // Os degraus com `comDispositivo` vem primeiro, e os SEM vem depois de
  // proposito: o fone pode ter sido desconectado desde a ultima gravacao, e
  // `deviceId: { exact }` falha quando o aparelho sumiu. Melhor gravar pelo
  // microfone padrao do que recusar a gravacao porque o fone ficou em casa.
  const tentativas = [
    { audio: { ...CONSTRAINTS_COM_ISOLAMENTO.audio, ...comDispositivo } },
    { audio: { ...CONSTRAINTS_LIMPAS.audio, ...comDispositivo } },
    CONSTRAINTS_COM_ISOLAMENTO,
    CONSTRAINTS_LIMPAS,
    { audio: true },
  ];
  let ultimoErro = null;
  for (const constraints of tentativas) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      // Permissão negada é decisão do usuário: insistir com outras constraints
      // só produziria várias recusas em sequência.
      if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') throw e;
      ultimoErro = e;
    }
  }
  throw ultimoErro || new Error('Microfone indisponível');
}

export default function AudioRecorder({ onSendAudio, onCancel }) {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [erro, setErro] = useState('');
  const [supressao, setSupressao] = useState(false);
  const [isolamento, setIsolamento] = useState(false);
  // Microfones disponiveis e qual esta em uso AGORA (lido do proprio stream, e
  // nao do que pedimos -- o navegador pode ter entregado outro).
  const [microfones, setMicrofones] = useState([]);
  const [micAtual, setMicAtual] = useState('');
  const [trocando, setTrocando] = useState(false);
  // Nivel de entrada de 0 a 1. E o unico jeito de a pessoa DESCOBRIR que esta
  // gravando pelo microfone errado: no array interno, falar normal mal move a
  // barra; no fone de haste, ela sobe na hora.
  const [nivel, setNivel] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const quadroRef = useRef(null);

  useEffect(() => {
    iniciarGravacao();
    return () => {
      pararGravacaoSilenciosamente();
    };
  }, []);

  /**
   * MEDIDOR DE NIVEL.
   *
   * `AnalyserNode` no dominio do tempo, RMS por quadro. Nao processa o audio --
   * so observa: o que vai para o `MediaRecorder` continua sendo o stream cru do
   * navegador, com o processamento nativo dele. Um no de analise em paralelo
   * nao entra no caminho da gravacao.
   */
  const ligarMedidor = (stream) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const fonte = ctx.createMediaStreamSource(stream);
      const analisador = ctx.createAnalyser();
      analisador.fftSize = 512;
      fonte.connect(analisador);
      const dados = new Uint8Array(analisador.fftSize);

      const medir = () => {
        analisador.getByteTimeDomainData(dados);
        let soma = 0;
        for (let i = 0; i < dados.length; i += 1) {
          const v = (dados[i] - 128) / 128;
          soma += v * v;
        }
        const rms = Math.sqrt(soma / dados.length);
        // Escala com raiz: fala normal ocupa uma faixa baixa de RMS, e uma
        // barra linear ficaria quase parada justamente onde precisa informar.
        setNivel(Math.min(1, Math.sqrt(rms) * 1.8));
        quadroRef.current = requestAnimationFrame(medir);
      };
      medir();
    } catch {
      // Sem medidor a gravacao segue igual: e um auxilio de diagnostico, nao
      // uma etapa do envio.
    }
  };

  const desligarMedidor = () => {
    if (quadroRef.current) cancelAnimationFrame(quadroRef.current);
    quadroRef.current = null;
    try { audioCtxRef.current?.close(); } catch { /* ja fechado */ }
    audioCtxRef.current = null;
    setNivel(0);
  };

  const iniciarGravacao = async (deviceIdForcado = null) => {
    try {
      setErro('');
      const escolhido = deviceIdForcado != null ? deviceIdForcado : micSalvo();
      const stream = await capturarMicrofone(escolhido);
      // Registra o que o navegador de fato aplicou: cada uma dessas chaves é um
      // PEDIDO, e nem todo navegador/dispositivo atende. Mostrar só o que está
      // ativo de verdade evita prometer na tela o que não aconteceu -- e a
      // diferença importa: "ruído reduzido" e "voz isolada" resolvem problemas
      // diferentes (ver CONSTRAINTS_COM_ISOLAMENTO).
      const ajustes = stream.getAudioTracks()[0]?.getSettings?.() || {};
      setSupressao(ajustes.noiseSuppression === true);
      setIsolamento(ajustes.voiceIsolation === true);
      setMicAtual(ajustes.deviceId || '');

      ligarMedidor(stream);

      // A LISTA SO TEM ROTULO DEPOIS DA PERMISSAO.
      //
      // Antes de o usuario autorizar o microfone, `enumerateDevices` devolve os
      // dispositivos com `label` VAZIO -- e uma lista de "microfone 1, microfone
      // 2" nao ajuda ninguem a achar o fone. Por isso a enumeracao acontece
      // aqui, depois do getUserMedia, e nao na montagem do componente.
      listarMicrofones().then((lista) => {
        setMicrofones(lista);
        // Ninguem escolheu ainda: se houver um fone claro na lista, sugere ele
        // para a PROXIMA gravacao. Nao troca no meio desta -- interromper uma
        // gravacao em curso para "melhorar" seria pior que o problema.
        if (!micSalvo()) {
          const sugerido = sugerirMicrofone(lista);
          if (sugerido && sugerido !== (ajustes.deviceId || '')) salvarMic(sugerido);
        }
      });

      const formato = melhorFormatoSuportado();
      const mediaRecorder = new MediaRecorder(stream, formato ? { mimeType: formato } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);

      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setErro('Permissão de microfone negada ou indisponível.');
    }
  };

  const pararGravacaoSilenciosamente = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    desligarMedidor();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
  };

  /**
   * TROCAR DE MICROFONE recomeça a gravação, e isso é dito no rótulo.
   *
   * Não dá para emendar: o `MediaRecorder` está preso ao stream antigo, e trocar
   * a fonte no meio produziria um arquivo com duas metades de qualidades
   * diferentes. Recomeçar do zero é honesto -- e, na prática, a troca acontece
   * uma vez, no dia em que a pessoa descobre que estava gravando pelo microfone
   * do notebook.
   */
  const trocarMicrofone = async (deviceId) => {
    salvarMic(deviceId);
    setTrocando(true);
    pararGravacaoSilenciosamente();
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setIsRecording(false);
    setSeconds(0);
    await iniciarGravacao(deviceId);
    setTrocando(false);
  };

  // Rotulo curto do dispositivo: o do sistema costuma vir com o nome do driver
  // inteiro entre parenteses, que nao cabe na barra.
  const nomeMic = (d) => String(d.label || 'Microfone').replace(/\s*\([^)]*\)\s*$/, '').trim() || 'Microfone';

  const handleCancel = () => {
    pararGravacaoSilenciosamente();
    setIsRecording(false);
    if (onCancel) onCancel();
  };

  const handleSend = () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    if (timerRef.current) clearInterval(timerRef.current);

    mediaRecorderRef.current.onstop = () => {
      // O tipo sai do PRÓPRIO gravador: é o único que sabe o que gravou. Fixar
      // uma string aqui foi exatamente o que quebrou o áudio (ver
      // FORMATOS_PREFERIDOS).
      const tipoGravado = mediaRecorderRef.current.mimeType || melhorFormatoSuportado() || 'audio/webm';
      const audioBlob = new Blob(audioChunksRef.current, { type: tipoGravado });
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64DataUrl = reader.result;
        onSendAudio(base64DataUrl);
      };
      reader.readAsDataURL(audioBlob);

      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
    };

    mediaRecorderRef.current.stop();
  };

  const formatSecs = (s) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (erro) {
    return (
      <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-falha/15 text-falha-400 text-xs font-semibold border border-falha/30 w-full">
        <span className="flex items-center gap-1.5"><AlertCircle size={14} /> {erro}</span>
        <button onClick={handleCancel} className="underline text-[11px]">Fechar</button>
      </div>
    );
  }

  const micEmUso = microfones.find((d) => d.deviceId === micAtual);
  // Denuncia o caso que motivou tudo isto: gravando pelo microfone embutido,
  // num escritorio, com um fone disponivel na lista.
  const usandoInterno = micEmUso && PISTAS_INTERNO.test(micEmUso.label);
  const temFoneNaLista = microfones.some((d) => PISTAS_FONE.test(d.label) && !PISTAS_INTERNO.test(d.label));

  return (
    <div className="w-full space-y-1.5">
      {/* AVISO QUE APARECE SO QUANDO E O CASO.
          Gravar pelo microfone do notebook com um fone plugado e exatamente a
          situacao em que sai voz dos outros e a pessoa precisa gritar. Um selo
          permanente viraria paisagem; este so surge quando ha o que corrigir. */}
      {usandoInterno && temFoneNaLista && (
        <div className="flex items-start gap-1.5 px-2 text-[10px] text-espera-400">
          <AlertCircle size={11} className="shrink-0 mt-0.5" />
          <span>
            Gravando pelo microfone do computador. Com um fone de haste a sua voz
            fica bem acima da dos colegas escolha o fone ao lado.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 p-2 rounded-xl bg-red-500/10 border border-red-500/30 w-full">
      <div className="flex items-center gap-2 text-red-400 font-mono text-xs font-bold min-w-0">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping shrink-0" />
        <span>{trocando ? 'Trocando...' : `Gravando áudio... ${formatSecs(seconds)}`}</span>

        {/* MEDIDOR DE ENTRADA -- o diagnostico que nenhum texto substitui.
            Falar e ver a barra parada diz, em um segundo, que o microfone
            escolhido nao esta ouvindo quem fala. */}
        <span
          className="hidden sm:flex items-center gap-0.5 shrink-0"
          title="Nível do microfone: fale e veja se as barras sobem. Se quase não se mexerem, o microfone escolhido não é o que está perto da sua boca."
          aria-hidden="true"
        >
          {[0.15, 0.35, 0.55, 0.75, 0.9].map((limite) => (
            <span
              key={limite}
              className={`w-1 rounded-full transition-all duration-75 ${
                nivel >= limite ? 'h-3 bg-ativo-400' : 'h-1.5 bg-slate-600'
              }`}
            />
          ))}
        </span>
        {/* Só aparece quando o navegador CONFIRMOU a supressão (getSettings), e
            não porque nós a pedimos. Um selo que mente sobre a qualidade do
            áudio é pior do que nenhum selo. */}
        {(supressao || isolamento) && (
          <span
            className="hidden sm:inline-flex items-center gap-1 font-sans font-semibold text-[10px] px-1.5 py-0.5 rounded-md border bg-ativo/15 border-ativo/30 text-ativo-400 shrink-0"
            title={isolamento
              ? 'Isolamento de voz ativo: o navegador mantém quem fala no microfone e abaixa o resto, inclusive outras vozes.'
              : 'Filtrando o ruído de fundo (ar, ventilador, teclado), o eco e nivelando o volume. Voz de outra pessoa perto do microfone NÃO é removida -- para isso, use um fone com microfone.'}
          >
            <Waves size={11} /> {isolamento ? 'voz isolada' : 'ruído reduzido'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* SELETOR DE MICROFONE.
            So aparece com mais de uma opcao -- numa maquina com um microfone so
            ele nao decide nada e viraria enfeite. A escolha fica no localStorage
            desta maquina: o microfone e propriedade do computador, nao da conta
            (ver o comentario de CHAVE_MIC). */}
        {microfones.length > 1 && (
          <select
            value={micAtual}
            onChange={(e) => trocarMicrofone(e.target.value)}
            disabled={trocando}
            title="Microfone usado na gravação. Trocar recomeça a gravação do zero."
            className="hidden sm:block max-w-[9rem] bg-slate-800 border border-linha rounded-lg px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-acao/50 disabled:opacity-50"
          >
            {microfones.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{nomeMic(d)}</option>
            ))}
          </select>
        )}

        <button
          onClick={handleCancel}
          type="button"
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-falha-400 transition-colors"
          title="Cancelar gravação"
        >
          <Trash2 size={15} />
        </button>

        <button
          onClick={handleSend}
          type="button"
          disabled={trocando || !isRecording}
          className="px-3 py-1.5 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md disabled:opacity-50"
        >
          <Send size={13} /> Enviar Áudio
        </button>
      </div>
      </div>
    </div>
  );
}
