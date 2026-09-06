import { useState, useEffect, useRef, useCallback } from 'react';
import { ImagePlus, Trash2, Loader2 } from 'lucide-react';

/**
 * A LOGO DA EMPRESA na tela de Clientes (CNPJ) -- e o que aparece quando não há.
 *
 * O que estava lá era o mesmo ícone de prediozinho em todas as linhas: com 183
 * cadastros, 183 prediozinhos idênticos. Um ícone repetido não identifica
 * ninguém; ele só ocupa o lugar onde a identificação deveria estar, e ainda dá
 * a impressão de que o lugar já está preenchido.
 *
 * Sem logo, o desenho passa a ser as INICIAIS da razão social com uma cor
 * derivada do nome -- o mesmo recurso que o painel já usa para a equipe (ver
 * Avatar.jsx e o ranking do Modo TV). Duas empresas diferentes ficam diferentes
 * na lista mesmo antes de alguém subir imagem nenhuma.
 */

// Mesma paleta do Avatar da equipe: são os tons que funcionam nos dois temas.
const CORES = [
  { bg: 'bg-acao/20', ring: 'border-acao/40', text: 'text-acao-200' },
  { bg: 'bg-blue-500/20', ring: 'border-blue-500/40', text: 'text-blue-300' },
  { bg: 'bg-ativo/20', ring: 'border-ativo/40', text: 'text-ativo-400' },
  { bg: 'bg-purple-500/20', ring: 'border-purple-500/40', text: 'text-purple-300' },
  { bg: 'bg-pink-500/20', ring: 'border-pink-500/40', text: 'text-pink-300' },
  { bg: 'bg-espera/20', ring: 'border-espera/40', text: 'text-espera-400' },
  { bg: 'bg-cyan-500/20', ring: 'border-cyan-500/40', text: 'text-cyan-300' },
];

// Palavras que não identificam empresa nenhuma: estão em metade dos cadastros.
// "LTDA" e "ME" como inicial dariam "AL" para "A COLLI LTDA" e "ML" para
// "MERCADO LTDA" -- a segunda letra viria sempre da forma jurídica.
const RUIDO = new Set(['LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'S/A', 'MEI', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);

/**
 * Iniciais da razão social. `Array.from` (e não `[0]`) pelo mesmo motivo do
 * Avatar: um nome com emoji quebrava em meio par surrogate e virava o
 * quadradinho de glifo inválido.
 */
export function iniciaisEmpresa(nome = '') {
  const letras = (s) => Array.from(String(s)).filter((c) => /[\p{L}\p{N}]/u.test(c));
  const palavras = String(nome).trim().split(/\s+/)
    .filter((p) => !RUIDO.has(p.toUpperCase().replace(/[.]/g, '')))
    .map(letras)
    .filter((a) => a.length > 0);
  if (palavras.length === 0) return null;
  if (palavras.length === 1) return palavras[0].slice(0, 2).join('').toUpperCase();
  return (palavras[0][0] + palavras[1][0]).toUpperCase();
}

export function corDaEmpresa(nome = '') {
  let hash = 0;
  for (let i = 0; i < nome.length; i++) hash = nome.charCodeAt(i) + ((hash << 5) - hash);
  return CORES[Math.abs(hash) % CORES.length];
}

/**
 * Endereço dos bytes da logo.
 *
 * O `?v=` é a data da última troca, e não enfeite: sem ele a URL de uma empresa
 * nunca muda, e trocar a logo não trocaria nada na tela -- o navegador
 * continuaria servindo a imagem antiga do cache até alguém limpar na mão.
 *
 * Sem token na query: a rota está atrás da sessão, e o cookie é HttpOnly e
 * same-origin -- o navegador o manda sozinho num `<img src>`.
 */
export function urlLogo(parceiro) {
  if (!parceiro?.temLogo) return null;
  return `/api/parceiros/${encodeURIComponent(parceiro.cnpj)}/logo?v=${parceiro.logoEm || 0}`;
}

const TAMANHOS = {
  md: 'w-10 h-10 text-[11px] rounded-xl',
  lg: 'w-16 h-16 text-base rounded-2xl',
};

/** A logo (ou as iniciais) em modo leitura -- é o que a lista desenha. */
export function LogoCliente({ parceiro, size = 'md', className = '' }) {
  const url = urlLogo(parceiro);
  const [falhou, setFalhou] = useState(false);
  // A URL muda quando a logo muda; sem este reset, uma imagem que falhou uma vez
  // ficaria nas iniciais para sempre, mesmo depois de trocada.
  useEffect(() => { setFalhou(false); }, [url]);

  const cor = corDaEmpresa(parceiro?.razaoSocial || '');
  const letras = iniciaisEmpresa(parceiro?.razaoSocial || '');
  const dimensao = TAMANHOS[size] || TAMANHOS.md;

  if (url && !falhou) {
    return (
      <img
        src={url}
        alt={parceiro.razaoSocial}
        title={parceiro.razaoSocial}
        // `contain` e não `cover`: logo cortada deixa de ser a logo. Sobra
        // espaço nas laterais de uma marca horizontal, e é o certo aqui.
        onError={() => setFalhou(true)}
        className={`${dimensao} shrink-0 border border-linha bg-grafite-700 object-contain p-1 ${className}`}
      />
    );
  }

  return (
    <div
      title={parceiro?.razaoSocial}
      className={`${dimensao} ${cor.bg} ${cor.text} border ${cor.ring} flex shrink-0 items-center justify-center font-display font-bold ${className}`}
    >
      {letras || '—'}
    </div>
  );
}

// ---------------------------------------------------------------------------

const LADO_MAXIMO = 256;   // px -- é o maior que a tela desenha (`lg`), com folga
const MAX_ENTRADA = 12 * 1024 * 1024;  // arquivo bruto que aceitamos abrir

/**
 * Reduz e reempacota a imagem ANTES de enviar.
 *
 * Duas razões, e as duas importam:
 *
 *   TAMANHO -- a logo é desenhada num quadrado de 40px. Mandar o PNG de 4 MB
 *              que veio do designer para guardar isso é desperdício de disco,
 *              de banda e do tempo de quem abre a tela.
 *   SEGURANÇA -- os bytes que saem daqui foram GERADOS pelo canvas a partir dos
 *              pixels decodificados. O que estivesse pendurado no arquivo
 *              original (metadados, conteúdo depois do fim da imagem) não
 *              sobrevive ao caminho. O servidor confere a assinatura de novo --
 *              isto é a primeira camada, não a única.
 *
 * WebP primeiro por ser bem menor com a mesma qualidade, e por ter
 * transparência -- logo sem fundo é a regra, não a exceção. Onde o navegador
 * não souber gerar WebP, `toDataURL` devolve um PNG e o `startsWith` abaixo
 * percebe: nada de conferir versão de navegador, pergunta-se ao próprio.
 *
 * O fundo NÃO é pintado de branco: um `fillRect` aqui destruiria a
 * transparência de toda logo PNG, e ela apareceria dentro de um quadrado branco
 * no tema escuro.
 */
export async function prepararLogo(file) {
  if (!file) throw new Error('Nenhum arquivo.');
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('O arquivo precisa ser uma imagem.');
  }
  if (file.size > MAX_ENTRADA) {
    throw new Error(`A imagem tem ${Math.round(file.size / 1024 / 1024)} MB. O limite é ${MAX_ENTRADA / 1024 / 1024} MB.`);
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível ler esta imagem.'));
      el.src = url;
    });

    const maior = Math.max(img.naturalWidth, img.naturalHeight);
    if (!maior) throw new Error('Não foi possível ler esta imagem.');
    // `min(1, ...)`: uma logo de 64px não vira 256px esticada e borrada.
    const escala = Math.min(1, LADO_MAXIMO / maior);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const webp = canvas.toDataURL('image/webp', 0.92);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A primeira imagem de um evento de colar, ou `null`.
 *
 * O filtro por `kind === 'file'` não é detalhe: sem ele, o handler cancelaria
 * TODO Ctrl+V do modal e colar texto num campo pararia de funcionar -- trocar
 * algo que sempre funcionou por um recurso novo. Quem chama só chama
 * `preventDefault()` quando isto aqui devolve alguma coisa.
 */
export function imagemDoColar(evento) {
  const itens = evento?.clipboardData?.items;
  if (!itens) return null;
  for (const item of itens) {
    if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
      const arquivo = item.getAsFile();
      if (arquivo) return arquivo;
    }
  }
  return null;
}

/**
 * O controle EDITÁVEL da logo: clicar, arrastar para cima ou colar com Ctrl+V.
 *
 * @param {string|null} valor      data URL da imagem escolhida agora, `null`
 *                                 para "remover", `undefined` para "não mexeu".
 * @param {function}    onChange   recebe o novo `valor`.
 * @param {object}      parceiro   para desenhar a logo que já está salva.
 */
export function SeletorLogo({ valor, onChange, parceiro, onErro }) {
  const inputRef = useRef(null);
  const [arrastando, setArrastando] = useState(false);
  const [lendo, setLendo] = useState(false);

  const aceitar = useCallback(async (arquivo) => {
    if (!arquivo) return;
    setLendo(true);
    try {
      onChange(await prepararLogo(arquivo));
      onErro?.('');
    } catch (e) {
      onErro?.(e.message);
    } finally {
      setLendo(false);
    }
  }, [onChange, onErro]);

  // O que mostrar: a escolha desta edição vence a que está salva. `valor ===
  // null` é remoção pedida agora, e tem de aparecer como vazio ANTES de salvar
  // -- senão o botão de remover não daria sinal nenhum de ter funcionado.
  const previa = valor === undefined ? urlLogo(parceiro) : valor;
  const letras = iniciaisEmpresa(parceiro?.razaoSocial || '');
  const cor = corDaEmpresa(parceiro?.razaoSocial || '');

  return (
    <div
      className="flex items-center gap-3"
      /* O PRÓPRIO CONTROLE também escuta o colar, e não só a tela que o usa.
         Quem clica no quadradinho e dá Ctrl+V espera que funcione ali -- o
         handler da tela em volta só pega o evento se o foco estiver dentro
         dela, e um `<button>` focado é justamente o caso.

         `imagemDoColar` filtra por `kind === 'file'`: sem imagem na área de
         transferência, o evento segue seu caminho e o Ctrl+V normal dos campos
         continua funcionando. */
      onPaste={(e) => {
        const arquivo = imagemDoColar(e);
        if (!arquivo) return;
        e.preventDefault();
        aceitar(arquivo);
      }}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          aceitar(e.dataTransfer?.files?.[0]);
        }}
        title="Escolher a logo (ou arraste uma imagem, ou cole com Ctrl+V)"
        className={`relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border transition-colors ${
          arrastando ? 'border-acao bg-acao/10' : 'border-linha bg-grafite-700 hover:border-acao/50'
        }`}
      >
        {lendo ? (
          <Loader2 size={18} className="animate-spin text-acao-200" />
        ) : previa ? (
          <img src={previa} alt="Logo" className="h-full w-full object-contain p-1" />
        ) : letras ? (
          <span className={`font-display text-base font-bold ${cor.text}`}>{letras}</span>
        ) : (
          <ImagePlus size={20} className="text-slate-500" />
        )}
      </button>

      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-linha bg-grafite-700 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:text-white"
          >
            Escolher imagem
          </button>
          {previa && (
            <button
              type="button"
              onClick={() => { onChange(null); onErro?.(''); }}
              title="Remover a logo"
              className="flex items-center gap-1 rounded-lg border border-falha/30 px-2.5 py-1 text-[11px] font-semibold text-falha-400 hover:bg-falha/10"
            >
              <Trash2 size={11} /> Remover
            </button>
          )}
        </div>
        <p className="text-[10px] leading-relaxed text-slate-500">
          Arraste uma imagem aqui ou cole com <span className="font-semibold text-slate-400">Ctrl+V</span>.
          <br />PNG, JPG, WebP ou GIF.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          aceitar(e.target.files?.[0]);
          // Zera para o mesmo arquivo poder ser escolhido de novo depois de
          // removido -- sem isto, o `change` não dispara na segunda vez.
          e.target.value = '';
        }}
      />
    </div>
  );
}
