import { useEffect, useRef, useState } from 'react';
import { AuthAPI } from '../services/api';

/**
 * Desafio Cloudflare Turnstile.
 *
 * O QUE ESTE COMPONENTE **NÃO** É: uma proteção. Ele só produz um token. Quem
 * decide se a operação passa é o servidor, que pergunta à Cloudflare se aquele
 * token é autêntico (ver turnstile.client.js). Um atacante pode não renderizar
 * este widget, apagá-lo do DOM ou mandar `turnstileToken: "sim"` no curl — e
 * nada disso o aproxima de entrar, porque a verificação não acontece aqui.
 *
 * A SITE KEY vem da API, não do bundle. Isso é deliberado: assim não existe
 * nenhuma variável de ambiente do Turnstile do lado do cliente (nada de
 * `VITE_*`), e trocar a chave na Cloudflare não exige rebuild do front. A
 * secret, evidentemente, nunca chega até aqui.
 *
 * Sem chaves configuradas, `ativo` volta false, o componente não renderiza nada
 * e o formulário segue funcionando — o servidor também estará com o desafio
 * desligado, então as duas pontas concordam.
 */
const URL_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let carregando = null;
function carregarScript() {
  if (window.turnstile) return Promise.resolve();
  if (carregando) return carregando;
  carregando = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = URL_SCRIPT;
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('turnstile-indisponivel'));
    document.head.appendChild(s);
  });
  return carregando;
}

/**
 * @param {(token: string|null) => void} onToken recebe o token, ou null quando
 *   o desafio expira/falha — o formulário deve limpar o que tinha guardado.
 * @param {string} [tema] 'auto' | 'light' | 'dark'
 */
export default function Turnstile({ onToken, tema = 'auto' }) {
  const caixa = useRef(null);
  const widgetId = useRef(null);
  const [config, setConfig] = useState(null);
  const [falhou, setFalhou] = useState(false);
  // `onToken` numa ref para o efeito não re-renderizar o widget a cada render
  // do formulário — remontar o desafio invalidaria o token recém-obtido.
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    let vivo = true;
    AuthAPI.turnstile().then((c) => vivo && setConfig(c));
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!config?.ativo || !config.siteKey || !caixa.current) return undefined;

    let removido = false;
    carregarScript()
      .then(() => {
        if (removido || !caixa.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(caixa.current, {
          sitekey: config.siteKey,
          theme: tema,
          callback: (token) => cb.current?.(token),
          // Token do Turnstile tem validade curta. Expirando, avisamos o
          // formulário para não enviar um desafio que o servidor vai recusar.
          'expired-callback': () => cb.current?.(null),
          'error-callback': () => { setFalhou(true); cb.current?.(null); },
        });
      })
      .catch(() => setFalhou(true));

    return () => {
      removido = true;
      try {
        if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      } catch { /* widget ja removido com o DOM */ }
    };
  }, [config, tema]);

  if (!config?.ativo) return null;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div ref={caixa} />
      {falhou && (
        <p className="text-[11px] text-espera-400 text-center">
          Não foi possível carregar a verificação de segurança. Verifique sua conexão e recarregue a página.
        </p>
      )}
    </div>
  );
}
