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
      colors: {
        arka: {
          bg: '#0B0D12',
          sidebar: '#11141C',
          panel: '#161922',
          panelAlt: '#1E2330',
          border: '#2A3040',
          borderLight: '#384156',
          text: '#F3F4F8',
          muted: '#94A3B8',
          accent: '#FF7A29',
          accentHover: '#FF8C42',
          accentSoft: 'rgba(255, 122, 41, 0.15)',
          verde: '#10B981',
          verdeBg: 'rgba(16, 185, 129, 0.15)',
          vermelho: '#EF4444',
          vermelhoBg: 'rgba(239, 68, 68, 0.15)',
          azul: '#3B82F6',
          azulBg: 'rgba(59, 130, 246, 0.15)',
          roxo: '#8B5CF6',
          roxoBg: 'rgba(139, 92, 246, 0.15)',
          amarelo: '#F59E0B',
          amareloBg: 'rgba(245, 158, 11, 0.15)',
        }
      }
    },
  },
  plugins: [],
}
