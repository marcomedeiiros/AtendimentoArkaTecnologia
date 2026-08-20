import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageCircle, Power, QrCode, Loader2, RefreshCw, RotateCcw,
  Trash2, Copy, Check
} from 'lucide-react';
import { EmojiIcon } from '../components/pages/EmojiIcon';
import { useAppContext } from '../context/AppContext';
import { WhatsAppAPI } from '../services/api';

// Enquanto a instancia nao pareia, o QR da Evolution expira em ~30s.
const QR_REFRESH_MS = 25000;
// /detalhes dispara 4 chamadas a Evolution (estado, perfil, webhook, versao).
// A cada 5s isso inundava a Evolution e estourava o rate limit do back-end.
const STATUS_POLL_MS = 20000;

const STATUS_UI = {
  Online:        { badge: 'bg-ativo/20 text-ativo-400', box: 'bg-ativo/15 text-ativo-400 border border-ativo/30' },
  Conectando:    { badge: 'bg-espera/20 text-espera-400',     box: 'bg-espera/15 text-espera-400 border border-espera/30' },
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
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

  const erroEvolution = useCallback((e) => {
    const detalhe = String(e?.message || '').replace(/\.\s*$/, '');
    setAviso(
      `Não foi possível falar com a Evolution API${detalhe ? `: ${detalhe}` : ''} ` +
      'verifique se ela está no ar e se EVOLUTION_API_URL/KEY estão configurados no servidor.'
    );
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
      setDetalhes(null);
      return null;
    }
  }, [setWhatsAppConectado]);

  const gerarQr = useCallback(async () => {
    setCarregandoQr(true); setAviso('');
    try {
      const r = await WhatsAppAPI.qrcode(instanciaRef.current);
      // A Evolution devolve o base64 ja com ou sem o prefixo data:.
      const b64 = r?.qrcode || null;
      setQrcode(b64 ? (String(b64).startsWith('data:') ? b64 : `data:image/png;base64,${b64}`) : null);
      setPairingCode(r?.pairingCode || null);
      if (!b64 && !r?.pairingCode) setAviso('A Evolution não retornou QR Code. Se a instância já estiver conectada, desconecte antes de gerar um novo.');
    } catch (e) {
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

  useEffect(() => {
    if (conectado || !qrcode) return;
    const id = setInterval(gerarQr, QR_REFRESH_MS);
    return () => clearInterval(id);
  }, [conectado, qrcode, gerarQr]);

  async function alternarConexao() {
    setOcupado(true); setAviso('');
    try {
      if (conectado) {
        await WhatsAppAPI.desconectar(instancia);
        setWhatsAppConectado(false);
        setQrcode(null);
      } else {
        await gerarQr();
      }
      await carregarDetalhes();
    } catch (e) {
      erroEvolution(e);
    } finally {
      setOcupado(false);
    }
  }

  async function reconectar() {
    setOcupado(true); setAviso('');
    try {
      await WhatsAppAPI.reiniciar(instancia);
      await carregarDetalhes();
    } catch (e) { erroEvolution(e); } finally { setOcupado(false); }
  }

  async function excluirInstancia() {
    // Acao destrutiva e irreversivel: exige digitar o nome da instancia.
    // Um confirm simples era aceito sem leitura e derrubava a conexao inteira.
    const resposta = window.prompt(
      `⚠️ ATENÇÃO: isso APAGA a instância "${instancia}" na Evolution.\n\n` +
      `Você perderá o pareamento e precisará escanear o QR Code de novo.\n` +
      `Para apenas reiniciar a conexão, cancele e use "Reconectar".\n\n` +
      `Para confirmar, digite o nome da instância:`
    );
    if (resposta !== instancia) {
      if (resposta !== null) window.alert('Nome não confere. Exclusão cancelada.');
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
    <div className="fade-in space-y-6">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-linha">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Integração WhatsApp API</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Gerencie a conexão oficial via WhatsApp Web, webhooks e sincronização de dados.</p>
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
          <button onClick={reconectar} disabled={ocupado} className={botaoSec} title="Reiniciar a instância na Evolution">
            <RotateCcw size={14} /> Reconectar
          </button>
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

      {aviso && (
        <div className="p-3 rounded-xl bg-espera/10 border border-espera/30 text-xs text-espera-400">
          {aviso}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        <div className="glass-panel p-6 rounded-2xl border border-linha text-center flex flex-col items-center justify-center">
          <h3 className="font-bold text-sm text-white font-display mb-1">QR Code de Autenticação</h3>
          <p className="text-xs text-slate-400 mb-4">Escaneie no app do WhatsApp: Dispositivos Conectados</p>

          <div className="p-4 bg-white rounded-2xl shadow-lg mb-4 inline-block">
            {carregandoQr ? (
              <div className="w-40 h-40 flex items-center justify-center">
                <Loader2 size={40} className="text-slate-950 animate-spin" />
              </div>
            ) : qrcode ? (
              <img src={qrcode} alt="QR Code de autenticação" className="w-40 h-40 object-contain" />
            ) : (
              <QrCode size={160} className={conectado ? 'text-slate-300' : 'text-slate-950'} />
            )}
          </div>

          {pairingCode && (
            <div className="mb-3 text-xs text-slate-300">
              Código de pareamento: <span className="font-mono font-bold text-acao-200 tracking-widest">{pairingCode}</span>
            </div>
          )}

          {conectado ? (
            <EmojiIcon name="check" label="WhatsApp Pareado & Sincronizado" size="sm" />
          ) : (
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <button onClick={gerarQr} disabled={carregandoQr}
                className="px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-2 bg-ativo hover:bg-ativo-400 text-slate-950 transition-all disabled:opacity-60">
                <QrCode size={14} /> Gerar QR
              </button>
              <button onClick={gerarQr} disabled={carregandoQr} className={botaoSec} title="Renovar o QR Code">
                <RefreshCw size={14} className={carregandoQr ? 'animate-spin' : ''} /> Atualizar QR
              </button>
            </div>
          )}

          {!conectado && qrcode && (
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
              placeholder="Nenhum webhook configurado na instância"
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
