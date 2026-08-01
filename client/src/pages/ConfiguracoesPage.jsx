import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Save, Loader2, CheckCircle2, XCircle, Plug,
  Database, Server, MessageCircle, Workflow
} from 'lucide-react';
import { ConfiguracoesAPI } from '../services/api';

const CAMPOS = {
  evolution: [
    { chave: 'evolution.url',      label: 'URL da Evolution API', placeholder: 'https://sua-evolution.com', mono: true },
    { chave: 'evolution.apiKey',   label: 'API Key',              placeholder: 'AUTHENTICATION_API_KEY', segredo: true },
    { chave: 'evolution.instance', label: 'Instância',            placeholder: 'arka-wapi-oficial' },
  ],
  n8n: [
    { chave: 'n8n.url',    label: 'URL do n8n', placeholder: 'http://localhost:5678', mono: true },
    { chave: 'n8n.apiKey', label: 'API Key',    placeholder: 'gerada em Settings > API no n8n', segredo: true },
    { chave: 'n8n.webhookFluxo', label: 'Webhook que recebe as mensagens', placeholder: 'http://localhost:5678/webhook/atendimento', mono: true },
  ],
};

// Quem responde o cliente quando chega uma mensagem.
const MODOS = [
  { id: 'n8n',    titulo: 'n8n no controle',   desc: 'Cada mensagem é encaminhada ao n8n, que decide e responde. O bot local nunca envia nada sozinho.' },
  { id: 'humano', titulo: 'Somente humano',    desc: 'A conversa só é registrada na Central. Nenhuma resposta automática é enviada.' },
  { id: 'local',  titulo: 'Fluxos do Arka',    desc: 'O motor de fluxos local responde por gatilho (comportamento antigo, sem n8n).' },
];

function Campo({ def, valor, onChange }) {
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1.5 font-medium">{def.label}</label>
      <input
        type={def.segredo ? 'password' : 'text'}
        value={valor}
        onChange={e => onChange(def.chave, e.target.value)}
        placeholder={def.placeholder}
        className={`w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-osso/50 ${def.mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

function CardServico({ titulo, Icon, campos, valores, onChange, onTestar, teste, testando }) {
  return (
    <div className="glass-panel p-6 rounded-2xl border border-linha space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold text-sm text-white font-display flex items-center gap-2">
          <Icon size={16} className="text-osso-200" /> {titulo}
        </h3>
        {teste && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ${
            teste.conectado ? 'bg-ativo/20 text-ativo-400' : 'bg-falha/20 text-falha-400'
          }`}>
            {teste.conectado ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
            {teste.conectado ? 'Conectado' : 'Offline'}
          </span>
        )}
      </div>

      {campos.map(def => (
        <Campo key={def.chave} def={def} valor={valores[def.chave] ?? ''} onChange={onChange} />
      ))}

      <button onClick={onTestar} disabled={testando}
        className="w-full px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 bg-grafite-700 border border-linha text-slate-300 hover:text-white hover:border-slate-600 transition-all disabled:opacity-60">
        {testando ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
        Testar conexão
      </button>

      {teste && !teste.conectado && teste.erro && (
        <p className="text-[11px] text-espera-400 bg-espera/10 border border-espera/30 rounded-lg p-2">{teste.erro}</p>
      )}
      {teste && teste.conectado && (
        <p className="text-[11px] text-ativo-400/80">
          {teste.versao && <>Versão {teste.versao} • </>}
          {teste.state && <>Estado: {teste.state} • </>}
          {teste.latenciaMs != null && <>{teste.latenciaMs} ms</>}
        </p>
      )}
    </div>
  );
}

export default function ConfiguracoesPage() {
  const [valores, setValores] = useState({});
  const [sistema, setSistema] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState('');
  const [testes, setTestes] = useState({});
  const [testando, setTestando] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const d = await ConfiguracoesAPI.obter();
      setValores(Object.fromEntries(Object.entries(d.valores).map(([k, v]) => [k, v.valor])));
      setSistema(d.sistema);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const onChange = (chave, valor) => {
    setValores(v => ({ ...v, [chave]: valor }));
    setSalvo(false);
  };

  const salvar = async () => {
    setSalvando(true); setErro('');
    try {
      const d = await ConfiguracoesAPI.salvar(valores);
      setValores(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.valor])));
      setSalvo(true);
      setTimeout(() => setSalvo(false), 3000);
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const testar = async (servico) => {
    setTestando(servico);
    try {
      const resultado = await ConfiguracoesAPI.testar(servico);
      setTestes(t => ({ ...t, [servico]: resultado }));
    } catch (e) {
      setTestes(t => ({ ...t, [servico]: { conectado: false, erro: e.message } }));
    } finally {
      setTestando(null);
    }
  };

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display flex items-center gap-2">
            <Settings size={22} className="text-osso-200" /> Configurações
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Conexões com a Evolution API e o n8n. Os valores salvos aqui têm prioridade sobre o .env.
          </p>
        </div>
        <button onClick={salvar} disabled={salvando || carregando}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-osso hover:bg-osso-200 text-slate-950 text-xs font-bold transition-all shrink-0 disabled:opacity-60">
          {salvando ? <Loader2 size={14} className="animate-spin" /> : salvo ? <CheckCircle2 size={14} /> : <Save size={14} />}
          {salvando ? 'Salvando...' : salvo ? 'Salvo!' : 'Salvar configurações'}
        </button>
      </div>

      {erro && (
        <div className="p-3 rounded-xl bg-falha/10 border border-falha/30 text-xs text-falha-400">{erro}</div>
      )}

      <p className="text-[11px] text-slate-500">
        Campos de API Key aparecem mascarados. Deixe como está para manter a chave atual;
        digite um valor novo apenas se quiser trocá-la.
      </p>

      {!carregando && (
        <div className="glass-panel p-6 rounded-2xl border border-linha space-y-3">
          <h3 className="font-bold text-sm text-white font-display flex items-center gap-2">
            <MessageCircle size={16} className="text-osso-200" /> Quem responde o cliente
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {MODOS.map(m => {
              const ativo = (valores['atendimento.modo'] || 'n8n') === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => onChange('atendimento.modo', m.id)}
                  className={`text-left p-4 rounded-xl border transition-all ${
                    ativo
                      ? 'bg-osso/15 border-osso/50'
                      : 'bg-grafite-700 border-linha hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2.5 h-2.5 rounded-full ${ativo ? 'bg-osso-200' : 'bg-slate-600'}`} />
                    <span className={`text-xs font-bold ${ativo ? 'text-osso-200' : 'text-slate-300'}`}>{m.titulo}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{m.desc}</p>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-500">
            Lembre de clicar em <strong className="text-slate-400">Salvar configurações</strong> após trocar.
          </p>
        </div>
      )}

      {carregando ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[0, 1].map(i => (
            <div key={i} className="glass-panel p-6 rounded-2xl border border-linha animate-pulse space-y-4">
              <div className="h-4 w-40 rounded bg-slate-700/50" />
              <div className="h-9 rounded-xl bg-slate-700/30" />
              <div className="h-9 rounded-xl bg-slate-700/30" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CardServico
            titulo="Evolution API (WhatsApp)" Icon={MessageCircle}
            campos={CAMPOS.evolution} valores={valores} onChange={onChange}
            onTestar={() => testar('evolution')} teste={testes.evolution} testando={testando === 'evolution'}
          />
          <CardServico
            titulo="n8n (Automações)" Icon={Workflow}
            campos={CAMPOS.n8n} valores={valores} onChange={onChange}
            onTestar={() => testar('n8n')} teste={testes.n8n} testando={testando === 'n8n'}
          />
        </div>
      )}

      {sistema && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-panel p-6 rounded-2xl border border-linha space-y-3">
            <h3 className="font-bold text-sm text-white font-display flex items-center gap-2">
              <Database size={16} className="text-blue-400" /> Banco de Dados
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-grafite-600 border border-slate-800">
                <div className="text-slate-500 text-[10px] uppercase mb-0.5">Status</div>
                <div className={sistema.banco.conectado ? 'text-ativo-400 font-semibold' : 'text-falha-400 font-semibold'}>
                  {sistema.banco.conectado ? 'Conectado' : 'Offline'}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-grafite-600 border border-slate-800">
                <div className="text-slate-500 text-[10px] uppercase mb-0.5">Tipo</div>
                <div className="text-slate-200 font-semibold">{sistema.banco.tipo}</div>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-2xl border border-linha space-y-3">
            <h3 className="font-bold text-sm text-white font-display flex items-center gap-2">
              <Server size={16} className="text-purple-400" /> Servidor
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[
                ['Ambiente', sistema.servidor.ambiente],
                ['Porta', sistema.servidor.porta],
                ['Node', sistema.servidor.node],
                ['Versão do app', sistema.versaoApp],
              ].map(([k, v]) => (
                <div key={k} className="p-3 rounded-xl bg-grafite-600 border border-slate-800">
                  <div className="text-slate-500 text-[10px] uppercase mb-0.5">{k}</div>
                  <div className="text-slate-200 font-semibold">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
