import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-grafite-900 flex flex-col items-center justify-center gap-6 text-center p-8">
      <div className="p-5 rounded-2xl bg-osso/10 border border-osso/20 text-osso-200">
        <AlertTriangle size={48} />
      </div>
      <div>
        <h1 className="text-6xl font-bold text-white font-display tracking-tight">404</h1>
        <p className="text-slate-400 text-sm mt-2">
          A página que você tentou acessar não existe ou foi removida.
        </p>
      </div>
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-osso hover:bg-osso-200 text-slate-950 text-sm font-bold shadow-md shadow-osso/20 transition-all"
      >
        <ArrowLeft size={16} /> Voltar ao Dashboard
      </Link>
    </div>
  );
}
