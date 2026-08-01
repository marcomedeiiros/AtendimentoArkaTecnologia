import { useNavigate } from 'react-router-dom';
import Contatos from '../components/pages/Contatos';

export default function ContatosPage() {
  const navigate = useNavigate();
  return <Contatos setAba={(aba) => navigate('/' + aba)} />;
}
