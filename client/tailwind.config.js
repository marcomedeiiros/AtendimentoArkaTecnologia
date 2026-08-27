/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      /**
       * BREAKPOINT DE ALTURA -- o que faltava para notebook.
       *
       * Os breakpoints do Tailwind são todos de LARGURA, e por isso a tela de
       * notebook passava batida: 1366px de largura entra em `lg`/`xl` e recebe o
       * mesmo tratamento de um monitor de mesa. Só que o que aperta num notebook
       * não é a largura -- são os 768px de ALTURA, que viram ~640px de viewport
       * depois da barra do navegador. Padding de 32px em cima e embaixo, mais um
       * `min-h-[550px]`, e a página já não cabe.
       *
       * `baixa` = tela curta. Vale para notebook (768/800/900) e também para
       * celular na horizontal -- nos dois casos a resposta certa é a mesma:
       * apertar o espaçamento vertical e não exigir altura mínima.
       *
       * Declarado em `extend` de propósito: assim ele entra DEPOIS dos
       * breakpoints padrão na folha gerada, e `baixa:p-4` vence `lg:p-8` numa
       * tela que é larga E curta -- que é exatamente o notebook.
       */
      screens: {
        baixa: { raw: '(max-height: 900px)' },
      },
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
        display: ['Poppins', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      // Sistema de cores da Central.
      //
      // Principio: a MOLDURA e monocromatica (como o logo da Arka, que e uma
      // marca em carvao sem cor); cor saturada so aparece onde significa ESTADO.
      // Isso vale para uma ferramenta usada o dia inteiro: o atendente precisa
      // ler status num relance, e nao competir com decoracao.
      // Sem isto, qualquer `border` sem cor explicita cai no cinza-claro padrao
      // do Tailwind (#E5E7EB) e vira uma linha esbranquiçada sobre o tema
      // escuro -- fora da paleta.
      borderColor: {
        DEFAULT: 'rgb(var(--linha) / <alpha-value>)',
      },
      // Cores tematizaveis: cada uma referencia uma variavel CSS (canais RGB)
      // definida em index.css. O `<alpha-value>` deixa os modificadores de
      // opacidade do Tailwind (bg-acao/15, border-linha/60...) continuarem
      // funcionando. Trocar de tema so redefine as variaveis -- nada aqui muda.
      colors: {
        white: 'rgb(var(--c-white) / <alpha-value>)',
        grafite: {
          900: 'rgb(var(--grafite-900) / <alpha-value>)', // fundo da aplicacao
          800: 'rgb(var(--grafite-800) / <alpha-value>)', // sidebar / cabecalho
          700: 'rgb(var(--grafite-700) / <alpha-value>)', // painel
          600: 'rgb(var(--grafite-600) / <alpha-value>)', // painel elevado / hover
          500: 'rgb(var(--grafite-500) / <alpha-value>)', // divisor
        },
        linha: {
          DEFAULT: 'rgb(var(--linha) / <alpha-value>)',
          forte: 'rgb(var(--linha-forte) / <alpha-value>)',
        },
        acao: {
          DEFAULT: 'rgb(var(--acao) / <alpha-value>)',
          200: 'rgb(var(--acao-200) / <alpha-value>)',
          400: 'rgb(var(--acao-400) / <alpha-value>)',
          600: 'rgb(var(--acao-600) / <alpha-value>)',
        },
        bolha: 'rgb(var(--bolha) / <alpha-value>)',
        // ---- estados ----
        espera: { DEFAULT: 'rgb(var(--espera) / <alpha-value>)', 400: 'rgb(var(--espera-400) / <alpha-value>)', 600: 'rgb(var(--espera-600) / <alpha-value>)' },
        ativo:  { DEFAULT: 'rgb(var(--ativo) / <alpha-value>)',  400: 'rgb(var(--ativo-400) / <alpha-value>)',  600: 'rgb(var(--ativo-600) / <alpha-value>)' },
        quieto: { DEFAULT: 'rgb(var(--quieto) / <alpha-value>)', 400: 'rgb(var(--quieto-400) / <alpha-value>)', 600: 'rgb(var(--quieto-600) / <alpha-value>)' },
        falha:  { DEFAULT: 'rgb(var(--falha) / <alpha-value>)',  400: 'rgb(var(--falha-400) / <alpha-value>)',  600: 'rgb(var(--falha-600) / <alpha-value>)' },
        lida:   { DEFAULT: 'rgb(var(--lida) / <alpha-value>)',   400: 'rgb(var(--lida-400) / <alpha-value>)',   600: 'rgb(var(--lida-600) / <alpha-value>)' },
        texto: {
          DEFAULT: 'rgb(var(--texto) / <alpha-value>)',
          suave: 'rgb(var(--texto-suave) / <alpha-value>)',
          fraco: 'rgb(var(--texto-fraco) / <alpha-value>)',
        },
        slate: {
          50: 'rgb(var(--slate-50) / <alpha-value>)',   100: 'rgb(var(--slate-100) / <alpha-value>)',
          200: 'rgb(var(--slate-200) / <alpha-value>)', 300: 'rgb(var(--slate-300) / <alpha-value>)',
          400: 'rgb(var(--slate-400) / <alpha-value>)', 500: 'rgb(var(--slate-500) / <alpha-value>)',
          600: 'rgb(var(--slate-600) / <alpha-value>)', 700: 'rgb(var(--slate-700) / <alpha-value>)',
          800: 'rgb(var(--slate-800) / <alpha-value>)', 900: 'rgb(var(--slate-900) / <alpha-value>)',
          950: 'rgb(var(--slate-950) / <alpha-value>)',
        },
      }
    },
  },
  plugins: [],
}
