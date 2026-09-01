import { useEffect } from 'react';
import PainelParede from '../components/pages/PainelParede';
import { aplicarTemaAcesso } from '../utils/tema';

/**
 * A MOLDURA DA TV -- e por que esta pagina desenha a propria.
 *
 * Todas as outras telas vivem dentro do `AppLayout`, que da a elas a barra
 * lateral, o fundo e o respiro em volta. Esta nao: ela roda numa TV dedicada,
 * pendurada na parede, sem teclado e sem mouse. Nao ha para onde navegar, entao
 * o menu de 17rem so tiraria largura de uma tela cuja unica funcao e ser lida
 * de longe.
 *
 * O que sai e a MOLDURA, nao a protecao: a rota continua atras do portao de
 * sessao (`RotaProtegida`) e do gate de modulo (`RotaModulo`, com `/painel`
 * apontando para o modulo `dashboard`), e a API barra por conta propria.
 *
 * `h-dvh` e nao `h-screen`: em TV com navegador de fabrica a barra de endereco
 * as vezes ocupa altura real, e `vh` ignora isso -- o rodape da fila ficaria
 * cortado. `overflow-hidden` porque ninguem vai rolar uma parede: quem rola,
 * quando precisa, e a lista da fila, por dentro.
 */
export default function PainelPage() {
  // O tema pessoal do usuario e aplicado pelo AppLayout, que aqui nao existe.
  // Sem esta linha a TV herdaria o tema de quem por acaso tenha aberto a tela
  // antes no mesmo navegador -- e um painel de parede claro, num ambiente de
  // trabalho, e a diferenca entre legivel e ofuscante a tres metros.
  useEffect(() => {
    aplicarTemaAcesso();
  }, []);

  return (
    <div className="h-dvh w-full overflow-hidden bg-grafite-900 p-5 xl:p-7">
      <PainelParede />
    </div>
  );
}
