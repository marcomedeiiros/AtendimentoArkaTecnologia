#!/usr/bin/env bash
# Instalacao do Arka na VM, do zero. Idempotente: rodar de novo nao apaga nada
# nem regera os segredos de um .env que ja exista.
#
#   bash deploy/instalar.sh
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

echo "==> Conferindo o Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "ERRO: docker nao encontrado. Instale com:"
  echo "      curl -fsSL https://get.docker.com | sh"
  echo "      sudo usermod -aG docker \$USER   # depois saia e entre de novo no SSH"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERRO: plugin 'docker compose' ausente. Instale o docker-compose-plugin."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "ERRO: sem permissao de falar com o Docker."
  echo "      sudo usermod -aG docker \$USER   # e reabra a sessao SSH"
  exit 1
fi

# ---------------------------------------------------------------------------
# .env
# ---------------------------------------------------------------------------
if [ -f .env ]; then
  echo "==> .env ja existe -- mantendo os segredos atuais"
else
  echo "==> Criando .env com segredos novos"
  cp .env.example .env

  set_env() { sed -i "s|^$1=.*|$1=$2|" .env; }
  gerar() { openssl rand -hex 24; }

  IP_SUGERIDO="$(hostname -I 2>/dev/null | awk '{print $1}')"
  read -r -p "IP da VM na rede interna [${IP_SUGERIDO}]: " IP_INFORMADO
  VM_IP="${IP_INFORMADO:-$IP_SUGERIDO}"

  read -r -p "Porta do painel [80]: " PORTA_INFORMADA
  WEB_PORT="${PORTA_INFORMADA:-80}"

  if [ "$WEB_PORT" = "80" ]; then
    URL_PAINEL="http://${VM_IP}"
  else
    URL_PAINEL="http://${VM_IP}:${WEB_PORT}"
  fi

  read -r -p "E-mail do administrador [admin@arkatecnologia.com.br]: " EMAIL_INFORMADO
  ADMIN_EMAIL="${EMAIL_INFORMADO:-admin@arkatecnologia.com.br}"

  ADMIN_PASSWORD="$(openssl rand -hex 12)"
  REGISTRO_CODIGO="$(openssl rand -hex 6)"

  set_env VM_IP                "$VM_IP"
  set_env WEB_PORT             "$WEB_PORT"
  set_env CORS_ORIGIN          "$URL_PAINEL"
  set_env JWT_SECRET           "$(gerar)"
  set_env EVOLUTION_API_KEY    "$(gerar)"
  set_env WEBHOOK_SECRET       "$(gerar)"
  set_env EVOLUTION_DB_PASSWORD "$(gerar)"
  set_env ADMIN_EMAIL          "$ADMIN_EMAIL"
  set_env ADMIN_PASSWORD       "$ADMIN_PASSWORD"
  set_env REGISTRO_CODIGO      "$REGISTRO_CODIGO"

  chmod 600 .env

  echo
  echo "  ---------------------------------------------------------------"
  echo "  ANOTE AGORA (fica gravado em .env, com permissao 600):"
  echo "    painel ......... $URL_PAINEL"
  echo "    usuario ........ $ADMIN_EMAIL"
  echo "    senha .......... $ADMIN_PASSWORD"
  echo "    codigo de cadastro da equipe ... $REGISTRO_CODIGO"
  echo "  ---------------------------------------------------------------"
  echo
fi

# ---------------------------------------------------------------------------
# Pasta de backup. A API roda como uid 1000 dentro do container e precisa
# conseguir escrever aqui.
# ---------------------------------------------------------------------------
echo "==> Preparando ./backups"
mkdir -p backups
if [ "$(stat -c '%u' backups)" != "1000" ]; then
  sudo chown 1000:1000 backups
fi

echo "==> Buildando as imagens (a primeira vez demora alguns minutos)"
$COMPOSE build

echo "==> Subindo a stack"
$COMPOSE up -d

echo "==> Aguardando a API responder"
# Le a porta do .env: numa reexecucao do script ela nao foi perguntada agora.
PORTA="$(grep -E '^WEB_PORT=' .env | cut -d= -f2)"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORTA:-80}/health" >/dev/null 2>&1; then
    echo "    API no ar."
    break
  fi
  sleep 2
done

echo
$COMPOSE ps
echo
echo "Pronto. Abra o painel, entre com o administrador e va em Integracao"
echo "WhatsApp -> Gerar QR para parear o telefone."
