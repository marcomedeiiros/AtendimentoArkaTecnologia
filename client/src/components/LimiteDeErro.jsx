import React from 'react';

/**
 * LIMITE DE ERRO -- o que impede uma tela quebrada de apagar o painel inteiro.
 *
 * Sem isto, QUALQUER excecao durante o render sobe ate a raiz, o React desmonta
 * a arvore toda e o operador fica com uma tela preta: sem menu, sem conversa,
 * sem uma palavra sobre o que houve. Foi o que aconteceu ao abrir o perfil do
 * contato -- e o pior nao foi o defeito, foi ele ter chegado ao usuario como
 * "sumiu tudo" em vez de "esta secao falhou".
 *
 * O que muda com o limite:
 *
 *   - a barra lateral e o resto do painel CONTINUAM de pe (ele envolve so o
 *     conteudo da rota);
 *   - a mensagem do erro aparece na tela, entao quem esta atendendo consegue
 *     dizer o que deu errado sem abrir o console;
 *   - "Tentar de novo" remonta a subarvore, o que resolve quando a falha veio
 *     de um estado ruim e nao de um defeito permanente.
 *
 * Precisa ser CLASSE: `componentDidCatch`/`getDerivedStateFromError` nao tem
 * equivalente em hook. E o unico componente de classe do projeto, e e por isso.
 */
export default class LimiteDeErro extends React.Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(erro, info) {
    // O console continua sendo o lugar da pilha completa -- a tela mostra so o
    // suficiente para a pessoa relatar o problema.
    console.error('[LimiteDeErro] a tela quebrou:', erro, info?.componentStack);
  }

  // Trocar de rota tem de limpar o erro: sem isto, um defeito numa tela
  // deixaria a mensagem presa para sempre, inclusive nas telas boas.
  componentDidUpdate(propsAnteriores) {
    if (this.state.erro && propsAnteriores.chave !== this.props.chave) {
      this.setState({ erro: null });
    }
  }

  render() {
    if (!this.state.erro) return this.props.children;

    return (
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-bold text-falha-400">Esta tela encontrou um erro.</p>
        <p className="max-w-lg break-words font-mono text-[11px] text-slate-400">
          {this.state.erro?.message || String(this.state.erro)}
        </p>
        <p className="max-w-md text-[11px] text-slate-500">
          O resto do painel continua funcionando. Se repetir, mande esta mensagem
          para quem cuida do sistema.
        </p>
        <button
          onClick={() => this.setState({ erro: null })}
          className="mt-1 rounded-lg bg-acao px-4 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-acao-200"
        >
          Tentar de novo
        </button>
      </div>
    );
  }
}
