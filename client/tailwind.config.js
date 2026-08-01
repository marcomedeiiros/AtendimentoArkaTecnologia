/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
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
      colors: {
        // Grafite QUENTE (nao azul-preto): puxa o carvao do logo.
        grafite: {
          900: '#0E0F12', // fundo da aplicacao
          800: '#15171C', // sidebar
          700: '#1A1D24', // painel
          600: '#22262F', // painel elevado / hover
          500: '#2E333F', // divisor forte
        },
        linha: {
          DEFAULT: '#2F343F', // bordas
          forte: '#3D4351',
        },
        // Acao primaria: o logo invertido (marca escura -> superficie clara).
        // Nao colide com nenhuma cor de status, entao nunca gera ambiguidade.
        osso: {
          DEFAULT: '#EDE9E2',
          200: '#F5F2ED',
          400: '#D8D2C7',
          600: '#A8A296',
        },
        // ---- estados (o unico lugar com cor saturada) ----
        espera: { DEFAULT: '#E0A82E', 400: '#EBBE5C', 600: '#B8871F' }, // pendente / nao lidas
        ativo:  { DEFAULT: '#2FBF71', 400: '#5CD494', 600: '#22945A' }, // aberta / online
        quieto: { DEFAULT: '#727A8A', 400: '#8F97A6', 600: '#565D6B' }, // fechada (recua)
        falha:  { DEFAULT: '#E0524A', 400: '#EB7B74', 600: '#B33C36' }, // SO erro real
        lida:   { DEFAULT: '#4FA8E0', 400: '#7BC0EA', 600: '#3583B5' }, // check-duplo (convencao WhatsApp)
        texto: {
          DEFAULT: '#EDEFF3',
          suave: '#A2AAB8',
          fraco: '#6B7382',
        },
      }
    },
  },
  plugins: [],
}
