import React, { useState } from 'react';
import { MessageCircle, Power, QrCode } from 'lucide-react';
import { EmojiIcon } from '../components/pages/EmojiIcon';
import { useAppContext } from '../context/AppContext';

export default function WhatsAppPage() {
  const { whatsAppConectado, setWhatsAppConectado } = useAppContext();
  const [instancia,  setInstancia]  = useState('arka-wapi-oficial');
  const [webhookUrl, setWebhookUrl] = useState('https://api.arkatecnologia.com.br/webhook/v1/whatsapp');

  const conectado = whatsAppConectado;
  const setConectado = setWhatsAppConectado;

  return (
    <div className="fade-in space-y-6">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Integração WhatsApp API</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Gerencie a conexão oficial via WhatsApp Web, webhooks e sincronização de dados.</p>
        </div>
      </div>

<<<<<<< HEAD
=======
      {/* Status da instância */}
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
      <div className="glass-panel p-6 rounded-2xl border border-[#2A3040] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
            conectado
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
          }`}>
            <MessageCircle size={24} />
          </div>
          <div>
            <div className="font-bold text-base text-white flex items-center gap-2 font-display">
              Instância: {instancia}
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                conectado ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
              }`}>
                {conectado ? 'ONLINE' : 'DESCONECTADO'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">WebSocket API Estável • 99.9% Uptime</p>
          </div>
        </div>
        <button
          onClick={() => setConectado(!conectado)}
          className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            conectado
              ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30'
              : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
          }`}
        >
          <Power size={15} /> {conectado ? 'Desconectar WhatsApp' : 'Reconectar WhatsApp'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        <div className="glass-panel p-6 rounded-2xl border border-[#2A3040] text-center flex flex-col items-center justify-center">
          <h3 className="font-bold text-sm text-white font-display mb-1">QR Code de Autenticação</h3>
          <p className="text-xs text-slate-400 mb-4">Escaneie no app do WhatsApp: Dispositivos Conectados</p>
          <div className="p-4 bg-white rounded-2xl shadow-lg mb-4 inline-block">
            <QrCode size={160} className="text-slate-950" />
          </div>
          <EmojiIcon name="check" label="WhatsApp Pareado & Sincronizado" size="sm" />
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-[#2A3040] space-y-4">
          <h3 className="font-bold text-sm text-white font-display">Configurações de Webhook</h3>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">URL do Webhook (Recebimento)</label>
            <input
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-orange-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">Instância Ativa</label>
            <input
              value={instancia}
              onChange={e => setInstancia(e.target.value)}
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
            />
          </div>
          <div className="p-3 rounded-xl bg-[#1E2330] border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
            <EmojiIcon name="lock" label="" size="sm" />
            <span>Validação de CNPJ Arka Tecnologia habilitada.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
