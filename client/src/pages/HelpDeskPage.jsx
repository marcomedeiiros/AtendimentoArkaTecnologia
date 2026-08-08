/**
 * O Help Desk agora vive como ABA dentro da Visão Geral (Dashboard), ao lado de
 * Avaliações. Este arquivo virou um wrapper fino do painel, sem rota própria no
 * menu -- mantido só para não quebrar imports antigos. A fonte única do conteúdo
 * é components/pages/HelpDeskPainel.jsx.
 */
import HelpDeskPainel from '../components/pages/HelpDeskPainel';

export default function HelpDeskPage() {
  return <div className="fade-in"><HelpDeskPainel /></div>;
}
