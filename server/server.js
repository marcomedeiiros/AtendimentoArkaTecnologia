const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "http://localhost:5173"
}));

app.use(express.json());

app.get("/api/dashboard", (req, res) => {
  res.json({
    clientesWhatsapp: 125,
    atendimentosAtivos: 18,
    atendimentosFinalizados: 96,
    validacoesCnpj: 54
  });
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});