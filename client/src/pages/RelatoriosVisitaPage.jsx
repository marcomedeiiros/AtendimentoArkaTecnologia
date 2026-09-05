import Mapeamentos from '../components/pages/Mapeamentos';

// A tela se chama RELATÓRIOS no menu; o componente continua sendo o do
// mapeamento técnico, que é o que ela contém. O nome de arquivo acompanha a
// rota (/relatorios) para quem procurar pelo endereço achar o arquivo.
export default function RelatoriosVisitaPage() {
  return <Mapeamentos />;
}
