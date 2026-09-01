import PainelParede from '../components/pages/PainelParede';

// A tela nao recebe nada do AppContext de proposito: ela busca o proprio dado
// em `/api/dashboard/painel` e se atualiza sozinha. Amarra-la ao contexto faria
// a TV depender do que as OUTRAS telas carregaram, e ela fica aberta sozinha.
export default function PainelPage() {
  return <PainelParede />;
}
