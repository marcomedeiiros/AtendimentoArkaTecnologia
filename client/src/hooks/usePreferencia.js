import { useState, useEffect, useRef, useCallback } from 'react';
import { PreferenciasAPI } from '../services/api';

const PREFIXO = 'arka_pref_';

function lerCache(chave, padrao) {
  try {
    const bruto = localStorage.getItem(PREFIXO + chave);
    return bruto ? JSON.parse(bruto) : padrao;
  } catch {
    return padrao;
  }
}

function gravarCache(chave, valor) {
  try { localStorage.setItem(PREFIXO + chave, JSON.stringify(valor)); } catch { /* quota */ }
}

/**
 * Preferência de interface persistida por operador.
 *
 * Restaura do localStorage na primeira renderização (sem piscar) e, em seguida,
 * sincroniza com o back-end — assim o estado sobrevive ao F5 e acompanha o
 * operador ao reconectar de outro navegador. A escrita é adiada (debounce) para
 * não gerar uma requisição por clique.
 *
 * @param {string} chave  identificador da preferência (ex.: 'central.filtros')
 * @param {*} padrao      valor inicial quando não há nada salvo
 * @returns {[any, Function, boolean]} [valor, setValor, carregado]
 */
export function usePreferencia(chave, padrao) {
  const [valor, setValor] = useState(() => lerCache(chave, padrao));
  const [carregado, setCarregado] = useState(false);
  const timerRef = useRef(null);
  // Enquanto o servidor não respondeu, não sobrescrevemos o que ele tem.
  const prontoParaGravar = useRef(false);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const r = await PreferenciasAPI.obter(chave);
        if (!ativo) return;
        if (r?.valor != null) {
          // O servidor manda; mesclamos com o padrão para tolerar chaves novas.
          const doServidor =
            typeof r.valor === 'object' && !Array.isArray(r.valor) && typeof padrao === 'object' && !Array.isArray(padrao)
              ? { ...padrao, ...r.valor }
              : r.valor;
          setValor(doServidor);
          gravarCache(chave, doServidor);
        }
      } catch {
        // Back-end fora: seguimos com o cache local.
      } finally {
        if (ativo) {
          prontoParaGravar.current = true;
          setCarregado(true);
        }
      }
    })();
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const atualizar = useCallback((novoOuFn) => {
    setValor(anterior => {
      const novo = typeof novoOuFn === 'function' ? novoOuFn(anterior) : novoOuFn;
      gravarCache(chave, novo);
      if (prontoParaGravar.current) {
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          PreferenciasAPI.salvar(chave, novo).catch(() => { /* offline: cache basta */ });
        }, 600);
      }
      return novo;
    });
  }, [chave]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return [valor, atualizar, carregado];
}
