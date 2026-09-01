import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // ── O PAINEL INTEIRO VINHA NUM ARQUIVO SO ──────────────────────────
        //
        // 1.442 KB (417 KB comprimido) num unico `index-*.js`, com o proprio
        // Vite avisando no build. Todo operador baixava o gerador de PDF, os
        // graficos e o editor de fluxos para abrir a Central -- e, a cada
        // deploy, baixava tudo de novo, porque um caractere alterado em
        // qualquer tela troca o hash do arquivo inteiro.
        //
        // A separacao abaixo e por RITMO DE MUDANCA, e nao por tamanho: o que
        // vem do node_modules muda quando alguem atualiza uma dependencia, o
        // que e nosso muda toda semana. Separados, o navegador reaproveita os
        // pedacos estaveis entre um deploy e outro.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // jsPDF e html2canvas saem daqui SEM NOME -- e isso e o ponto.
          //
          // Eles ja se separam sozinhos: `utils/exportarPdf.js` os carrega por
          // `import()` dinamico, e o Rollup transforma isso num pedaco
          // assincrono -- baixado no primeiro "Exportar", nunca antes. Nomear
          // um `manualChunks` para eles desfazia esse ganho: o pedaco passava a
          // ter uma aresta ESTATICA vindo do `index`, entrava no
          // `modulepreload` do HTML e voltava a ser baixado por todo mundo, na
          // abertura, mesmo sem ninguem exportar nada.
          //
          // `undefined` devolve a decisao ao Rollup, que os coloca no pedaco
          // assincrono. Sem esta linha eles caem no `vendor` do fim da funcao,
          // que e estatico -- o mesmo problema por outro caminho.
          if (id.includes('jspdf') || id.includes('html2canvas')) return undefined;

          // Chart.js: aparece no Dashboard e no Help Desk.
          if (id.includes('chart.js') || id.includes('react-chartjs')) return 'graficos';

          // O nucleo, que praticamente nunca muda.
          //
          // `react-router` fica DE FORA de proposito: ele depende de pacotes
          // que por sua vez dependem do React, e agrupa-lo aqui fecha um ciclo
          // entre os pedacos (`vendor -> react -> vendor`), que o Rollup avisa
          // e resolve duplicando codigo. `scheduler` entra porque e parte
          // interna do React e sai junto dele em toda versao.
          if (
            id.includes('/react-dom/') ||
            id.includes('/react/') ||
            id.includes('/scheduler/')
          ) {
            return 'react';
          }

          return 'vendor';
        },
      },
    },
    // O aviso continua ligado, so com o teto no tamanho que aceitamos hoje.
    // Subir este numero para calar o alerta seria trocar a medida pelo silencio.
    chunkSizeWarningLimit: 700,
  },
});
