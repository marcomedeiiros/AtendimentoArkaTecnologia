import { SETORES_ATENDIMENTO } from '../utils/setores';

/**
 * O QUADRO DE ESCOLHA DO SETOR -- os mesmos quatro cartões, onde quer que se
 * pergunte.
 *
 * Existe porque a pergunta passou a ser feita em dois lugares -- o modal de
 * iniciar conversa, na Central, e o "Conversar" da lista de Contatos -- e a
 * resposta precisa ter a mesma cara nos dois. Repetir a grade seria repetir
 * também as decisões embutidas nela: que o não-escolhido é discreto, que o
 * escolhido ganha contorno, e que a descrição fica embaixo do nome (é ela que
 * responde "qual eu marco?" para quem não decora a lista).
 *
 * NADA vem marcado por quem chama: quem escolhe é a pessoa. Um valor
 * pré-selecionado transforma "escolher o setor" em "confirmar o que estava
 * lá" -- e o que estava lá era justamente SEM SETOR.
 */
export default function QuadroSetores({ valor, aoEscolher }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {SETORES_ATENDIMENTO.map(s => {
        const ativo = valor === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => aoEscolher(s.id)}
            aria-pressed={ativo}
            className={`text-left p-2.5 rounded-xl border transition-all ${
              ativo
                ? 'bg-acao/15 border-acao/50'
                : 'bg-grafite-700 border-linha hover:border-linha-forte'
            }`}
          >
            <div className={`text-[11px] font-bold ${ativo ? 'text-acao-200' : 'text-slate-300'}`}>
              {s.label || s.id}
            </div>
            <div className="text-[10px] text-slate-500 leading-snug mt-0.5">{s.desc}</div>
          </button>
        );
      })}
    </div>
  );
}
