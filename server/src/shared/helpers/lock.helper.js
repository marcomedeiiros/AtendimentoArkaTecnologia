// Fila de execucao por chave (ex.: instancia:telefone).
//
// O WhatsApp entrega webhooks em paralelo. Sem isso, duas mensagens do mesmo
// cliente chegando juntas rodavam o engine ao mesmo tempo: as duas liam a
// sessao no mesmo estado, criavam conversas duplicadas e sobrescreviam o
// passo atual uma da outra. O servidor roda em um processo so, entao uma fila
// em memoria resolve.

const filas = new Map();

function comLock(chave, fn) {
  const anterior = filas.get(chave) || Promise.resolve();
  const resultado = anterior.then(() => fn());

  // A fila segue mesmo se a tarefa falhar, senao uma rejeicao travaria a chave.
  const proxima = resultado.then(
    () => {},
    () => {}
  );
  filas.set(chave, proxima);

  proxima.then(() => {
    if (filas.get(chave) === proxima) filas.delete(chave);
  });

  return resultado;
}

module.exports = { comLock };
