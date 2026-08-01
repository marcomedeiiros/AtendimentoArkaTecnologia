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
        // Neutros do WhatsApp Web (tema escuro). Sao verde-azulados, nao cinza
        // puro: e o que da o ar de "produto de mensageria" em vez de painel
        // generico -- e foram calibrados para leitura de conversa o dia inteiro.
        grafite: {
          900: '#0B141A', // fundo da aplicacao
          800: '#111B21', // sidebar / cabecalho
          700: '#182229', // painel
          600: '#202C33', // painel elevado / hover / bolha recebida
          500: '#2A3942', // divisor
        },
        linha: {
          DEFAULT: '#2A3942',
          forte: '#3B4A54',
        },
        // Acao primaria: o verde-teal do WhatsApp. O operador ja associa essa
        // cor a "enviar/confirmar", entao ela nao precisa ser aprendida.
        acao: {
          DEFAULT: '#00A884',
          200: '#06CF9C', // hover
          400: '#00BD96',
          600: '#017561', // pressionado
        },
        bolha: '#005C4B', // mensagem enviada (verde escuro do WhatsApp)
        // ---- estados ----
        espera: { DEFAULT: '#FFAB00', 400: '#FFC24D', 600: '#C98600' }, // pendente / nao lidas
        ativo:  { DEFAULT: '#06CF9C', 400: '#4FE0BC', 600: '#049A75' }, // aberta / online
        quieto: { DEFAULT: '#8696A0', 400: '#A4B2BB', 600: '#667781' }, // fechada (recua)
        falha:  { DEFAULT: '#F15C6D', 400: '#F58A96', 600: '#C23D4C' }, // SO erro real
        lida:   { DEFAULT: '#53BDEB', 400: '#7FD1F0', 600: '#3A93BA' }, // check-duplo (o azul do WhatsApp)
        texto: {
          DEFAULT: '#E9EDEF',
          suave: '#8696A0',
          fraco: '#667781',
        },
      }
    },
  },
  plugins: [],
}
