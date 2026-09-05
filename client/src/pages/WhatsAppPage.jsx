import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageCircle, Power, QrCode, Loader2, RefreshCw, RotateCcw,
  Trash2, Copy, Check, ShieldCheck, KeyRound, PowerOff
} from 'lucide-react';
import { EmojiIcon } from '../components/pages/EmojiIcon';
import { useAppContext } from '../context/AppContext';
import { WhatsAppAPI } from '../services/api';
import { FUSO_BR } from '../utils/data';
import { avisar, confirmar, pedirTexto } from '../utils/dialogo';

// Enquanto a instancia nao pareia, o QR da Evolution expira em ~30s.
const QR_REFRESH_MS = 25000;
// /detalhes dispara 4 chamadas a Evolution (estado, perfil, webhook, versao).
// A cada 5s isso inundava a Evolution e estourava o rate limit do back-end.
const STATUS_POLL_MS = 20000;

const STATUS_UI = {
  Online:        { badge: 'bg-ativo/20 text-ativo-400', box: 'bg-ativo/15 text-ativo-400 border border-ativo/30' },
  Conectando:    { badge: 'bg-espera/20 text-espera-400',     box: 'bg-espera/15 text-espera-400 border border-espera/30' },
  // Caiu e o servidor está religando com a MESMA sessão. Cor de espera, não de
  // falha: não há nada para o operador fazer, e nada foi perdido.
  Reconectando:  { badge: 'bg-espera/20 text-espera-400',     box: 'bg-espera/15 text-espera-400 border border-espera/30' },
  // A Evolution não respondeu. Isso não é o WhatsApp caído e NÃO se resolve com
  // QR -- se resolve olhando o container. Cor de falha, porque exige alguém.
  'Evolution indisponível': { badge: 'bg-falha/20 text-falha-400', box: 'bg-falha/15 text-falha-400 border border-falha/30' },
  // O servidor desistiu de religar sozinho: o pareamento caiu e so o celular
  // resolve. Cor de falha, nao de espera -- "Conectando" em amarelo passava a
  // ideia de que estava quase la, e ninguem ia buscar o telefone.
  'Reescaneie o QR': { badge: 'bg-falha/20 text-falha-400',   box: 'bg-falha/15 text-falha-400 border border-falha/30' },
  Desconectado:  { badge: 'bg-falha/20 text-falha-400',       box: 'bg-falha/15 text-falha-400 border border-falha/30' },
  Offline:       { badge: 'bg-slate-500/20 text-slate-400',     box: 'bg-slate-500/15 text-slate-400 border border-linha-forte' }
};

function formatarDuracao(desde) {
  if (!desde) return '-';
  const s = Math.floor((Date.now() - desde) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function formatarHora(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: FUSO_BR });
}

export default function WhatsAppPage() {
  const { whatsAppConectado, setWhatsAppConectado } = useAppContext();
  const [instancia,  setInstancia]  = useState('arka-wapi-oficial');
  const [detalhes,   setDetalhes]   = useState(null);
  const [qrcode,     setQrcode]     = useState(null);
  const [pairingCode, setPairingCode] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [carregandoQr, setCarregandoQr] = useState(false);
  const [aviso, setAviso] = useState('');
  const [copiado, setCopiado] = useState(false);
  const instanciaRef = useRef(instancia);
  instanciaRef.current = instancia;

  const status = detalhes?.statusLabel || (whatsAppConectado ? 'Online' : 'Offline');
  const conectado = status === 'Online';
  const ui = STATUS_UI[status] || STATUS_UI.Offline;

  // QUEM AUTORIZA O QR É O SERVIDOR. A tela só obedece.
  //
  // O padrão quando ainda não sabemos (`detalhes` nulo, primeira carga, back-end
  // sem resposta) é `false`: na dúvida NÃO se oferece QR. Era o inverso disso --
  // "não conectado, então mostre o QR" -- que fazia uma indisponibilidade da
  // Evolution virar um pedido de reescanear com a sessão intacta no banco.
  const podeMostrarQr = detalhes?.podeMostrarQr === true;
  const evolutionOnline = detalhes ? detalhes.evolutionOnline !== false : null;
  const reconectando =
    detalhes?.situacao === 'DISCONNECTED_TEMPORARY' ||
    detalhes?.situacao === 'RECONNECTING';

  /**
   * O ERRO COMO ELE É -- endpoint, HTTP e a frase da própria Evolution.
   *
   * A versão anterior imprimia só `e.message` e, quando a Evolution respondia
   * `response.message` como lista de objetos, isso chegava aqui já degradado
   * para "[object Object]": um erro sem conteúdo nenhum, que ainda por cima
   * culpava sempre EVOLUTION_API_URL/KEY -- inclusive quando a URL e a chave
   * estavam certas e o problema era outro.
   *
   * Agora o servidor manda `diagnostico` junto (endpoint, httpStatus, corpo) e
   * a tela mostra. E a frase de rodapé varia: só faz sentido mandar conferir
   * URL/KEY quando a API de fato não respondeu.
   */
  const erroEvolution = useCallback((e) => {
    const d = e?.diagnostico || {};
    const linhas = [];

    const detalhe = String(e?.message || '').trim();
    linhas.push(detalhe || 'A Evolution API recusou a operação.');

    if (d.endpoint) linhas.push(`Endpoint: ${d.metodo || 'GET'} ${d.endpoint}`);
    if (d.httpStatus) linhas.push(`HTTP: ${d.httpStatus}`);
    else if (e?.status) linhas.push(`HTTP: ${e.status}`);
    if (d.causa) linhas.push(`Causa: ${d.causa}`);
    if (d.resposta) linhas.push(`Resposta: ${d.resposta}`);

    if (e?.codigo === 'EVOLUTION_API_UNAVAILABLE') {
      linhas.push(
        'A Evolution não respondeu. Verifique se o container está no ar e se ' +
        'EVOLUTION_API_URL/KEY estão corretos. Isso NÃO significa que o ' +
        'pareamento do WhatsApp se perdeu.'
      );
    }

    setAviso(linhas.join('\n'));
  }, []);

  const carregarDetalhes = useCallback(async () => {
    try {
      const d = await WhatsAppAPI.detalhes(instanciaRef.current);
      setDetalhes(d);
      setWhatsAppConectado(!!d?.conectado);
      // Pareou: o QR nao serve mais.
      if (d?.conectado) { setQrcode(null); setPairingCode(null); }
      return d;
    } catch (e) {
      // ANTES ISTO ERA MUDO, e o silêncio mentia: com `detalhes` nulo a tela
      // caía para "Offline" e oferecia o QR, como se o pareamento tivesse ido
      // embora -- quando o que houve foi o painel não conseguir falar com o
      // próprio back-end. Guardamos o que já sabíamos e dizemos o que houve.
      erroEvolution(e);
      return null;
    }
  }, [setWhatsAppConectado, erroEvolution]);

  // Normaliza o base64 que a Evolution devolve com ou sem o prefixo data:.
  const comoImagem = (b64) =>
    b64 ? (String(b64).startsWith('data:') ? b64 : `data:image/png;base64,${b64}`) : null;

  /**
   * PEDIR O QR. O servidor pode recusar, e a recusa é uma proteção, não um bug.
   *
   * `forcar` só vem de um clique consciente ("Gerar QR mesmo assim"). Sem ele o
   * back-end devolve QR_DESNECESSARIO enquanto a sessão estiver válida -- e com
   * razão: `QRCODE_LIMIT=3` na Evolution faz um QR renovado à toa terminar em
   * `client.logout()`, que remove o aparelho do lado do WhatsApp. Pedir QR sem
   * precisar é a maneira mais rápida de perder o pareamento que estava de pé.
   */
  const gerarQr = useCallback(async ({ forcar = false, numero = null } = {}) => {
    setCarregandoQr(true); setAviso('');
    try {
      const r = await WhatsAppAPI.qrcode(instanciaRef.current, forcar, numero);
      const b64 = r?.qrcode || null;
      setQrcode(comoImagem(b64));
      setPairingCode(r?.pairingCode || null);
      // PEDIU CÓDIGO E VEIO SÓ QR. Quase sempre é o estado: a Evolution só
      // atende o pedido de código quando a instância está em `close`; em
      // `connecting` ela devolve o QR de memória e ignora o número. Sem este
      // recado, quem está longe do celular conclui que o recurso não existe.
      if (r?.codigoPedido && !r?.pairingCode) {
        setAviso(
          'A Evolution não devolveu o código de pareamento agora' +
          (r?.state ? ` (instância em "${r.state}")` : '') +
          '. Ela só emite o código com a instância em "close" espere o ciclo ' +
          'atual terminar (até ~1 min) e peça de novo. O QR ao lado continua válido.'
        );
      } else if (!b64 && !r?.pairingCode) {
        // "SE JÁ ESTIVER CONECTADA, DESCONECTE" era um palpite, e quase sempre o
        // errado: a causa real é a instância presa em `connecting`. Nesse estado
        // a Evolution devolve o QR que tem em memória -- vazio -- e ignora o
        // pedido (instance.controller.ts:330). Dizer o estado e o que fazer com
        // ele vale mais que oferecer a hipótese menos provável.
        setAviso(
          r?.state === 'connecting'
            ? 'A instância está presa em "connecting", e nesse estado a Evolution não ' +
              'emite QR nem código novos ela devolve o que tem em memória, que está vazio.\n\n' +
              'Clique em "Encerrar sessão" para derrubar o socket. Assim que o status virar ' +
              '"Desconectado", peça o QR ou o código de novo.'
            : 'A Evolution não retornou QR Code' +
              (r?.state ? ` (instância em "${r.state}")` : '') +
              '. Se ela já estiver conectada, use "Encerrar sessão" antes de gerar um novo.'
        );
      }
    } catch (e) {
      // Recusa do próprio servidor: a sessão está viva. Isso não é falha de
      // comunicação e não deve aparecer com a cara de uma.
      if (e?.codigo === 'QR_DESNECESSARIO' || e?.codigo === 'QR_DESNECESSARIO_CONECTADO') {
        setAviso(e.message);
        return;
      }
      // A INSTÂNCIA NÃO EXISTE MAIS. Recriar é destrutivo -- nasce uma instância
      // sem pareamento nenhum -- então NÃO é mais automático. O que fazia isso
      // sozinho podia, diante de um 404 passageiro, trocar uma sessão válida por
      // uma instância virgem. Agora quem decide é quem está olhando a tela.
      if (e?.codigo === 'INSTANCIA_INEXISTENTE') {
        const ok = await confirmar(
          `A instância "${instanciaRef.current}" não existe mais na Evolution.\n\n` +
          'Criar de novo começa do zero: será preciso escanear o QR Code para parear o ' +
          'WhatsApp outra vez. Se isso pode ser um erro passageiro da Evolution, cancele ' +
          'e tente "Reconectar" antes.',
          { titulo: 'Criar a instância de novo?', rotuloConfirmar: 'Criar instância', perigo: true }
        );
        if (!ok) { erroEvolution(e); return; }
        try {
          const nova = await WhatsAppAPI.criar(instanciaRef.current);
          setQrcode(comoImagem(nova?.qrcode));
          setPairingCode(null);
          setAviso(
            nova?.qrcode
              ? 'Instância recriada. Escaneie o QR Code abaixo para parear o WhatsApp.'
              : 'Instância recriada. Clique em "Gerar QR" para obter o código.'
          );
        } catch (erroCriar) {
          erroEvolution(erroCriar);
        }
        return;
      }
      erroEvolution(e);
    } finally {
      setCarregandoQr(false);
    }
  }, [erroEvolution]);

  // Status a cada 5s. Enquanto nao conecta, tambem renova o QR antes de expirar.
  useEffect(() => {
    carregarDetalhes();
    const id = setInterval(carregarDetalhes, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [carregarDetalhes]);

  // RENOVAÇÃO AUTOMÁTICA DO QR -- só enquanto o QR for legítimo.
  //
  // `podeMostrarQr` na dependência não é detalhe: sem ele, uma tela deixada
  // aberta continuava pedindo QR a cada 25s DEPOIS de a sessão voltar a ser
  // válida. Com `QRCODE_LIMIT=3`, três renovações à toa fazem a Evolution
  // chamar `client.logout()` -- a tela derrubaria o pareamento que o servidor
  // acabou de recuperar.
  useEffect(() => {
    if (conectado || !qrcode || !podeMostrarQr) return;
    const id = setInterval(() => gerarQr(), QR_REFRESH_MS);
    return () => clearInterval(id);
  }, [conectado, qrcode, podeMostrarQr, gerarQr]);

  // Some com o QR na tela assim que ele deixa de ser legítimo (a sessão voltou,
  // ou o vigia religou sozinho). Um QR esquecido na tela convida a escanear sem
  // necessidade, e escanear sem necessidade troca a sessão boa por outra.
  useEffect(() => {
    if (!podeMostrarQr && qrcode) { setQrcode(null); setPairingCode(null); }
  }, [podeMostrarQr, qrcode]);

  async function alternarConexao() {
    setOcupado(true); setAviso('');
    try {
      if (conectado) {
        await WhatsAppAPI.desconectar(instancia);
        setWhatsAppConectado(false);
        setQrcode(null);
      } else if (podeMostrarQr) {
        await gerarQr();
      } else {
        // "Conectar" com a sessão ainda válida é RECONECTAR, não reparear. Este
        // botão pedia QR em qualquer caso, e era um dos caminhos pelos quais um
        // pareamento vivo virava um pedido de reescanear.
        await reconectar();
      }
      await carregarDetalhes();
    } catch (e) {
      erroEvolution(e);
    } finally {
      setOcupado(false);
    }
  }

  /**
   * RECONECTAR = RECUPERAR A SESSÃO EXISTENTE. Nunca apagar, nunca recriar.
   *
   * A rota por trás deste botão mudou de comportamento: ela não manda mais um
   * `/instance/restart` cru (que a Evolution RECUSA quando a instância está em
   * `close`, devolvendo a recusa como HTTP 200 e virando erro na tela). Agora
   * ela entra no vigia, que escolhe `connect` ou `restart` pelo estado real,
   * restaura a credencial do cofre se a Evolution a tiver apagado numa queda
   * boba, e devolve o status. Se a sessão estiver mesmo invalidada, o status
   * volta como LOGGED_OUT e é aí -- e só aí -- que o QR aparece.
   */
  async function reconectar() {
    setOcupado(true); setAviso('');
    try {
      const r = await WhatsAppAPI.reiniciar(instancia);
      setDetalhes((d) => (d ? { ...d, ...r } : d));
      const atual = await carregarDetalhes();
      if (atual && !atual.conectado && !atual.podeMostrarQr) {
        setAviso(
          'Reconexão disparada com a MESMA sessão -- nenhum QR é necessário. ' +
          `Situação: ${atual.situacao || '-'}${atual.tentativaReconexao ? ` (tentativa ${atual.tentativaReconexao})` : ''}.`
        );
      }
    } catch (e) {
      // Sem atalho para "criar + QR" aqui. Recriar a instância destrói o
      // pareamento, e este botão existe justamente para preservá-lo -- quem
      // quiser recriar faz isso conscientemente pelo caminho do QR.
      erroEvolution(e);
    } finally { setOcupado(false); }
  }

  /**
   * ENCERRA A SESSÃO NA EVOLUTION -- o jeito de sair de um `connecting` travado.
   *
   * Não é o mesmo que "Excluir instância": a instância continua existindo, com
   * webhook e token. O que cai é o socket, e a instância vai para `close`.
   *
   * Precisa de confirmação porque, se a sessão FOSSE válida, isto a destruiria
   * -- é literalmente o `logout` do WhatsApp. O texto muda conforme o servidor
   * já ter concluído que o pareamento se perdeu (`podeMostrarQr`), porque nesses
   * dois casos o que está em jogo é bem diferente.
   */
  async function encerrarSessao() {
    const ok = await confirmar(
      podeMostrarQr
        ? 'Isso derruba a conexão da instância e a leva para o estado "close" ' +
          'que é o único em que a Evolution emite QR Code e código de pareamento novos.\n\n' +
          'O pareamento atual já está perdido, então não há nada a perder aqui. ' +
          'A instância, o webhook e o token continuam como estão.'
        : 'ATENÇÃO: o servidor considera a sessão VÁLIDA e está reconectando sozinho.\n\n' +
          'Encerrar a sessão é o logout do WhatsApp: o pareamento é desfeito e ' +
          'alguém precisará escanear o QR Code (ou digitar o código) de novo.\n\n' +
          'Se você só quer destravar a conexão, cancele e use "Reconectar".',
      {
        titulo: 'Encerrar a sessão do WhatsApp?',
        rotuloConfirmar: 'Encerrar sessão',
        perigo: true,
      }
    );
    if (!ok) return;

    setOcupado(true); setAviso('');
    try {
      await WhatsAppAPI.desconectar(instancia);
      setWhatsAppConectado(false);
      setQrcode(null);
      setPairingCode(null);
      setAviso(
        'Sessão encerrada. Aguarde alguns segundos até o status virar ' +
        '"Desconectado" e então clique em "Gerar QR" ou "Código por telefone".'
      );
      await carregarDetalhes();
    } catch (e) {
      erroEvolution(e);
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Pede o código de pareamento para o número informado.
   *
   * O número tem de ser o DO APARELHO que vai parear, com DDI e DDD. Ele não
   * vem de `detalhes.perfil.numero` porque, sem pareamento, esse campo está
   * vazio que é exatamente a situação em que este botão existe.
   */
  async function pedirCodigo() {
    const resposta = await pedirTexto(
      'Informe o número do WhatsApp que vai parear, com DDI e DDD.\n\n' +
      'A Evolution devolve um código de 8 caracteres. Quem estiver com o celular ' +
      'abre WhatsApp › Aparelhos conectados › Conectar um aparelho › ' +
      '"Conectar com número de telefone" e digita o código.',
      {
        titulo: 'Código de pareamento',
        valorInicial: detalhes?.perfil?.numero || '55',
        placeholder: '5527210300070',
        rotuloConfirmar: 'Gerar código',
      }
    );
    if (resposta === null) return;
    const digitos = String(resposta).replace(/\D/g, '');
    if (digitos.length < 12) {
      avisar('Número incompleto. Use DDI + DDD + número, só dígitos ex.: 5527210300070.');
      return;
    }
    await gerarQr({ numero: digitos });
  }

  async function excluirInstancia() {
    // Acao destrutiva e irreversivel: exige digitar o nome da instancia.
    // Um confirm simples era aceito sem leitura e derrubava a conexao inteira.
    const resposta = await pedirTexto(
      `Isso APAGA a instância "${instancia}" na Evolution.\n\n` +
      `Você perderá o pareamento e precisará escanear o QR Code de novo. ` +
      `Para apenas reiniciar a conexão, cancele e use "Reconectar".\n\n` +
      `Para confirmar, digite o nome da instância:`,
      {
        titulo: 'Apagar instância do WhatsApp',
        placeholder: instancia,
        rotuloConfirmar: 'Apagar instância',
        perigo: true,
      }
    );
    if (resposta !== instancia) {
      if (resposta !== null) avisar('Nome não confere. Exclusão cancelada.');
      return;
    }
    setOcupado(true); setAviso('');
    try {
      await WhatsAppAPI.excluir(instancia);
      setWhatsAppConectado(false);
      setQrcode(null);
      setDetalhes(null);
    } catch (e) { erroEvolution(e); } finally { setOcupado(false); }
  }

  function copiarToken() {
    const token = detalhes?.token;
    if (!token) return;
    navigator.clipboard?.writeText(token).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }

  const botaoSec = 'px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all disabled:opacity-60 bg-grafite-700 border border-linha text-slate-300 hover:text-white hover:border-linha-forte';

  return (
    <div className="fade-in space-y-6 baixa:lg:space-y-4">
      <div className="mb-8 baixa:lg:mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-linha">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Integração WhatsApp API</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Gerencie a conexão oficial via WhatsApp Web, webhooks e sincronização de dados</p>
        </div>
      </div>

      <div className="glass-panel p-6 rounded-2xl border border-linha flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden ${ui.box}`}>
            {detalhes?.perfil?.foto
              ? <img src={detalhes.perfil.foto} alt="perfil" className="w-full h-full object-cover" />
              : <MessageCircle size={24} />}
          </div>
          <div>
            <div className="font-bold text-base text-white flex items-center gap-2 font-display flex-wrap">
              Instância: {instancia}
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${ui.badge}`}>
                {status.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {detalhes?.perfil?.numero
                ? <>Número: <span className="font-mono text-slate-300">+{detalhes.perfil.numero}</span>{detalhes.perfil.nome ? ` • ${detalhes.perfil.nome}` : ''}</>
                : 'Nenhum número pareado'}
              {conectado && <> • Online há {formatarDuracao(detalhes?.conectadoDesde)}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={reconectar} disabled={ocupado} className={botaoSec} title="Recuperar a sessão existente -- não apaga nada e não pede QR">
            <RotateCcw size={14} /> Reconectar
          </button>
          {/* ENCERRAR SESSÃO -- a saída do `connecting` eterno.
              Só aparece DESCONECTADO, porque conectado o botão verde à direita
              já vira "Desconectar". A instância presa em `connecting` é um beco
              sem saída: nesse estado a Evolution devolve o QR que tem em memória
              (vazio) e ignora o pedido de código, então nem QR nem pareamento
              saem. Derrubar o socket a leva para `close`, que é o único estado
              em que ela emite QR e código novos. */}
          {!conectado && (
            <button onClick={encerrarSessao} disabled={ocupado} className={botaoSec}
              title="Derruba o socket e leva a instância para `close`, liberando QR e código novos">
              <PowerOff size={14} /> Encerrar sessão
            </button>
          )}
          <button onClick={excluirInstancia} disabled={ocupado}
            className="px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all disabled:opacity-60 bg-falha/15 border border-falha/30 text-falha-400 hover:bg-falha/25"
            title="Excluir instância na Evolution">
            <Trash2 size={14} /> Excluir Instância
          </button>
          <button
            onClick={alternarConexao}
            disabled={ocupado}
            className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all disabled:opacity-60 ${
              conectado
                ? 'bg-falha/15 hover:bg-falha/25 text-falha-400 border border-falha/30'
                : 'bg-ativo hover:bg-ativo-400 text-slate-950 shadow-md shadow-ativo/20'
            }`}
          >
            {ocupado ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
            {conectado ? 'Desconectar WhatsApp' : 'Conectar WhatsApp'}
          </button>
        </div>
      </div>

      {/* O servidor religa a instancia sozinho quando a conexao cai, mas nao
          quando o PAREAMENTO se perde -- ai a Evolution volta a pedir o QR e
          nenhum reinicio adianta. Sem este recado a tela ficava em
          "Conectando" indefinidamente e a equipe ficava sem WhatsApp sem saber
          que bastava alguem escanear. */}
      {detalhes?.perdeuPareamento && (
        <div className="p-3 rounded-xl bg-falha/10 border border-falha/30 text-xs text-falha-400">
          O pareamento com o WhatsApp foi perdido e o servidor não consegue
          restabelecê-lo sozinho. Clique em <strong>Gerar QR</strong> abaixo e
          escaneie com o celular do número em <strong>Aparelhos conectados</strong>.
        </div>
      )}

      {/* `whitespace-pre-line` porque o aviso agora é um relatório de várias
          linhas (endpoint, HTTP, resposta da Evolution) e não uma frase só. */}
      {aviso && (
        <div className="p-3 rounded-xl bg-espera/10 border border-espera/30 text-xs text-espera-400 whitespace-pre-line font-mono leading-relaxed">
          {aviso}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        <div className="glass-panel p-6 rounded-2xl border border-linha text-center flex flex-col items-center justify-center">
          <h3 className="font-bold text-sm text-white font-display mb-1">QR Code de Autenticação</h3>
          <p className="text-xs text-slate-400 mb-4">Escaneie no app do WhatsApp: Dispositivos Conectados</p>

          {/* `qr-cartao` (index.css) fixa branco/preto literais nos dois temas.
              Não trocar por `bg-white`/`text-slate-*`: aqui esses nomes são
              tokens de tema no claro viram quase-preto e quase-branco, e o QR
              deixa de ser legível por câmera. */}
          {/* O desenho de espera NÃO é esmaecido quando já está conectado: ele
              usa o preto cheio que `.qr-cartao` define. Em opacidade reduzida
              virava um cinza claro que parecia falha de carregamento, e não
              "você já está pareado" quem diz isso é a etiqueta verde abaixo. */}
          <div className="qr-cartao p-4 rounded-2xl shadow-lg mb-4 inline-block">
            {carregandoQr ? (
              <div className="w-40 h-40 flex items-center justify-center">
                <Loader2 size={40} className="animate-spin" />
              </div>
            ) : qrcode ? (
              <img src={qrcode} alt="QR Code de autenticação" className="w-40 h-40 object-contain" />
            ) : !conectado && !podeMostrarQr ? (
              // O desenho de QR aqui CONVIDAVA a escanear mesmo quando não havia
              // nada para parear. Com a sessão viva, o que a tela precisa mostrar
              // é que ela está guardada -- não um QR Code de enfeite.
              <div className="w-40 h-40 flex items-center justify-center">
                <ShieldCheck size={96} />
              </div>
            ) : (
              <QrCode size={160} />
            )}
          </div>

          {/* O código é para ser LIDO EM VOZ ALTA por telefone, então ele é o
              elemento mais legível do cartão grande, monoespaçado e espaçado.
              O passo a passo vem junto porque quem digita do outro lado quase
              nunca sabe onde fica "Conectar com número de telefone". */}
          {pairingCode && (
            <div className="mb-4 w-full max-w-xs p-3 rounded-xl bg-acao/10 border border-acao/30">
              <div className="text-[10px] uppercase text-slate-400 mb-1">Código de pareamento</div>
              <div className="font-mono font-bold text-xl text-acao-200 tracking-[0.25em] select-all">
                {pairingCode}
              </div>
              <p className="text-[10px] text-slate-400 mt-2 leading-relaxed text-left">
                No celular: <strong>WhatsApp › Aparelhos conectados › Conectar um aparelho ›
                Conectar com número de telefone</strong> e digite o código. Ele expira em
                poucos minutos — se vencer, peça outro.
              </p>
            </div>
          )}

          {/* O QR SÓ APARECE COM AUTORIZAÇÃO DO SERVIDOR.
              Três telas diferentes para três situações que antes eram uma só:
                conectado                 -> nada a fazer
                pode mostrar QR           -> logout real, ou nunca pareou
                nem uma coisa nem outra   -> a sessão está viva; o servidor cuida
              Era o último caso que aparecia como "escaneie o QR Code" e fazia
              alguém reparear um número que não precisava ser repareado. */}
          {conectado ? (
            <EmojiIcon name="check" label="WhatsApp Pareado & Sincronizado" size="sm" />
          ) : podeMostrarQr ? (
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <button onClick={() => gerarQr()} disabled={carregandoQr}
                className="px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-2 bg-ativo hover:bg-ativo-400 text-slate-950 transition-all disabled:opacity-60">
                <QrCode size={14} /> Gerar QR
              </button>
              <button onClick={() => gerarQr()} disabled={carregandoQr} className={botaoSec} title="Renovar o QR Code">
                <RefreshCw size={14} className={carregandoQr ? 'animate-spin' : ''} /> Atualizar QR
              </button>
              {/* PAREAR SEM ESTAR NA FRENTE DO CELULAR.
                  O WhatsApp aceita 8 caracteres digitados no aparelho no lugar
                  da câmera. Quem está fora da empresa dita o código por
                  telefone para quem está lá — era esta a saída que faltava
                  quando o pareamento caiu e o telefone ficou longe. */}
              <button onClick={pedirCodigo} disabled={carregandoQr} className={botaoSec}
                title="Receber um código de 8 caracteres para ditar a quem está com o celular">
                <KeyRound size={14} /> Código por telefone
              </button>
            </div>
          ) : evolutionOnline === false ? (
            <div className="text-xs text-falha-400 max-w-xs">
              <p className="font-bold mb-1">Evolution API indisponível</p>
              <p className="text-slate-400">
                O painel não conseguiu falar com a Evolution. Isso <strong>não</strong> é
                perda de pareamento e não se resolve com QR Code &mdash; verifique o
                container e a rede. A sessão do WhatsApp continua guardada.
              </p>
            </div>
          ) : (
            <div className="text-xs text-slate-400 max-w-xs">
              <p className="font-bold text-espera-400 mb-1">
                {reconectando ? 'Reconectando automaticamente' : 'Sessão preservada'}
              </p>
              <p>
                A sessão do WhatsApp continua válida &mdash; o servidor religa
                sozinho, sem QR Code.
                {detalhes?.tentativaReconexao ? ` Tentativa ${detalhes.tentativaReconexao}.` : ''}
              </p>
              {/* A SAÍDA CONSCIENTE. Fica discreta e avisa o custo: com
                  QRCODE_LIMIT=3 um QR pedido à toa pode terminar em logout de
                  verdade. Existe para o operador que sabe que precisa reparear
                  e não pode ficar refém do diagnóstico automático. */}
              <button
                onClick={async () => {
                  const ok = await confirmar(
                    'O servidor considera a sessão VÁLIDA e está reconectando sozinho.\n\n' +
                    'Gerar um QR Code agora pode fazer a Evolution derrubar o pareamento atual ' +
                    '(ela desconecta o aparelho ao estourar o limite de QRs).\n\n' +
                    'Só continue se você realmente pretende parear o número de novo.',
                    { titulo: 'Gerar QR mesmo assim?', rotuloConfirmar: 'Gerar QR mesmo assim', perigo: true }
                  );
                  if (ok) await gerarQr({ forcar: true });
                }}
                disabled={carregandoQr}
                className="mt-3 text-[10px] text-slate-500 underline hover:text-slate-300 disabled:opacity-60"
              >
                Preciso parear de novo mesmo assim
              </button>
            </div>
          )}

          {!conectado && qrcode && podeMostrarQr && (
            <p className="text-[10px] text-slate-500 mt-3">O QR renova automaticamente a cada 25s.</p>
          )}
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-linha space-y-4">
          <h3 className="font-bold text-sm text-white font-display">Configurações de Webhook</h3>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">URL do Webhook (Recebimento)</label>
            <input
              value={detalhes?.webhook?.url || ''}
              readOnly
              /* Vazio aqui NÃO significa "sem webhook". Nesta topologia quem
                 entrega os eventos é o webhook GLOBAL da Evolution
                 (WEBHOOK_GLOBAL_URL), que não aparece em /webhook/find da
                 instância. O texto antigo dizia o contrário e mandava investigar
                 um problema que não existe. */
              placeholder="Usando o webhook global da Evolution (WEBHOOK_GLOBAL_URL)"
              className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-acao/50"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">Instância Ativa</label>
            <input
              value={instancia}
              onChange={e => setInstancia(e.target.value)}
              className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-acao/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-grafite-600 border border-linha">
              <div className="text-slate-500 text-[10px] uppercase mb-0.5">Status</div>
              <div className="text-slate-200 font-semibold">{status}</div>
            </div>
            <div className="p-3 rounded-xl bg-grafite-600 border border-linha">
              <div className="text-slate-500 text-[10px] uppercase mb-0.5">Versão Evolution</div>
              <div className="text-slate-200 font-semibold">{detalhes?.versao || '-'}</div>
            </div>
            <div className="p-3 rounded-xl bg-grafite-600 border border-linha">
              <div className="text-slate-500 text-[10px] uppercase mb-0.5">Tempo Online</div>
              <div className="text-slate-200 font-semibold">{conectado ? formatarDuracao(detalhes?.conectadoDesde) : '-'}</div>
            </div>
            <div className="p-3 rounded-xl bg-grafite-600 border border-linha">
              <div className="text-slate-500 text-[10px] uppercase mb-0.5">Última Sincronização</div>
              <div className="text-slate-200 font-semibold">{formatarHora(detalhes?.ultimaSincronizacao)}</div>
            </div>
          </div>

          {/* SAÚDE DA CONEXÃO -- o que o vigia sabe, na tela.
              O back-end já devolvia tudo isto e nada aparecia; sem esses quatro
              campos, "Conectando" era indistinguível de "caiu e estou religando"
              e de "perdi o pareamento". São três situações com três respostas
              diferentes, e quem olha o painel precisa saber qual é. */}
          <div className="p-3 rounded-xl bg-grafite-600 border border-linha space-y-2">
            <div className="text-slate-500 text-[10px] uppercase">Saúde da conexão</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              <div className="text-slate-500">Situação</div>
              <div className="text-slate-200 font-mono">{detalhes?.situacao || '-'}</div>

              <div className="text-slate-500">Tentativa de reconexão</div>
              <div className="text-slate-200 font-mono">
                {detalhes?.tentativaReconexao ? `#${detalhes.tentativaReconexao}` : '-'}
              </div>

              <div className="text-slate-500" title="statusCode do Baileys que fechou o socket. 401/403 = logout real; o resto é queda temporária.">
                Motivo da desconexão
              </div>
              <div className="text-slate-200 font-mono">
                {detalhes?.motivoDesconexao != null
                  ? `${detalhes.motivoDesconexao}${[401, 403].includes(detalhes.motivoDesconexao) ? ' (logout real)' : ' (temporário)'}`
                  : '-'}
              </div>

              <div className="text-slate-500" title="Cópia da credencial do pareamento, usada quando a Evolution a apaga numa queda temporária.">
                Cofre da sessão
              </div>
              <div className="font-mono">
                {detalhes?.cofreSessao?.disponivel
                  ? detalhes.cofreSessao.temCofre
                    ? <span className="text-ativo-400">
                        guardada{detalhes.cofreSessao.salvoEm ? ` • ${formatarHora(detalhes.cofreSessao.salvoEm)}` : ''}
                      </span>
                    : <span className="text-espera-400">ativo, sem cópia ainda</span>
                  : <span className="text-falha-400">
                      inativo{detalhes?.cofreSessao?.motivoIndisponivel ? ` (${detalhes.cofreSessao.motivoIndisponivel})` : ''}
                    </span>}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-grafite-600 border border-linha">
            <div className="text-slate-500 text-[10px] uppercase mb-1.5">Eventos do Webhook</div>
            <div className="flex flex-wrap gap-1.5">
              {(detalhes?.webhook?.eventos?.length ? detalhes.webhook.eventos : ['-']).map(ev => (
                <span key={ev} className="text-[10px] px-2 py-0.5 rounded-full bg-grafite-700 border border-linha text-slate-300 font-mono">
                  {ev}
                </span>
              ))}
            </div>
          </div>

          <button onClick={copiarToken} disabled={!detalhes?.token} className={`${botaoSec} w-full justify-center`}>
            {copiado ? <Check size={14} className="text-ativo-400" /> : <Copy size={14} />}
            {copiado ? 'Token copiado!' : 'Copiar Token'}
          </button>

          <div className="p-3 rounded-xl bg-grafite-600 border border-linha text-xs text-slate-400 flex items-center gap-2">
            <EmojiIcon name="lock" label="" size="sm" />
            <span>Validação de CNPJ Arka Tecnologia habilitada.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
