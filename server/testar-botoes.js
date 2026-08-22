/**
 * TESTE MANUAL (descartável) — botões e lista interativos via Evolution.
 *
 * Objetivo: descobrir se a sua instância (Evolution + WHATSAPP-BAILEYS) consegue
 * ENVIAR e RENDERIZAR botões/lista no celular do cliente, antes de a gente
 * implementar isso no fluxo de atendimento.
 *
 * Como rodar (na pasta server, com o servidor podendo estar rodando ou não):
 *
 *   node testar-botoes.js 5527999999999
 *
 * Onde 5527999999999 é o SEU número (com DDI 55 + DDD + número, sem +, espaços
 * ou traços). Depois, olhe no WhatsApp desse número:
 *   - Chegaram BOTÕES tocáveis? E a LISTA (menu "Ver opções")?
 *   - Ou chegou só texto / mensagem vazia?
 *
 * O script imprime a resposta da API para cada tentativa. Se der erro de
 * formato, o payload varia conforme a versão da Evolution — me manda a saída que
 * eu ajusto. Pode apagar este arquivo depois do teste.
 */
const evo = require("./src/infrastructure/external/evolution-api.client");

async function main() {
  const numero = process.argv[2];
  if (!numero || !/^\d{10,15}$/.test(numero)) {
    console.error("Uso: node testar-botoes.js <numero>  (ex.: 5527999999999)");
    process.exit(1);
  }

  const instancia = await evo.instanciaPadrao();
  console.log("Instância:", instancia);
  try {
    const versao = await evo.getVersion();
    console.log("Versão Evolution:", JSON.stringify(versao));
  } catch (e) {
    console.log("Não consegui ler a versão:", e.message);
  }

  // 1) BOTÕES DE RESPOSTA (máx. 3) — formato Evolution v2.
  const payloadBotoes = {
    number: numero,
    title: "Arka Tecnologia",
    description: "Escolha uma opção para direcionar seu atendimento:",
    footer: "Toque em um botão",
    buttons: [
      { type: "reply", displayText: "Setor Técnico", id: "1" },
      { type: "reply", displayText: "Comercial", id: "2" },
      { type: "reply", displayText: "Financeiro", id: "3" },
    ],
  };

  // 2) LISTA (até 10 itens) — formato Evolution v2.
  const payloadLista = {
    number: numero,
    title: "Atendimento Arka",
    description: "Escolha uma opção:",
    buttonText: "Ver opções",
    footerText: "Arka Tecnologia",
    sections: [
      {
        title: "Setores",
        rows: [
          { title: "Setor Técnico", description: "Suporte e chamados", rowId: "1" },
          { title: "Comercial", description: "Produtos e serviços", rowId: "2" },
          { title: "Adm/Financeiro", description: "Faturamento", rowId: "3" },
          { title: "Encerrar atendimento", description: "", rowId: "4" },
        ],
      },
    ],
  };

  const tentar = async (rotulo, path, body) => {
    console.log(`\n=== ${rotulo} → POST ${path} ===`);
    try {
      const r = await evo.request("POST", path, body);
      console.log("OK. Resposta:", JSON.stringify(r));
    } catch (e) {
      console.log("FALHOU:", e.message);
    }
  };

  await tentar("BOTÕES", `/message/sendButtons/${instancia}`, payloadBotoes);
  await tentar("LISTA", `/message/sendList/${instancia}`, payloadLista);

  console.log("\nPronto. Agora confira no WhatsApp do número", numero);
  process.exit(0);
}

main().catch((e) => {
  console.error("Erro inesperado:", e);
  process.exit(1);
});
