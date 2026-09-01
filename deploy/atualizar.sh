#!/usr/bin/env bash
# Atualiza o Arka na VM para a versao mais recente do repositorio.
# Faz backup do banco antes de qualquer coisa.
#
#   bash deploy/atualizar.sh
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

echo "==> Backup antes de atualizar"
bash deploy/backup.sh

echo "==> Baixando o codigo novo"
git pull --ff-only

echo "==> Rebuildando"
$COMPOSE build

# CONFERE A CONFIGURACAO DO NGINX ANTES DE TROCAR O CONTAINER.
#
# O nginx serve o painel inteiro. Um ponto-e-virgula faltando derruba TUDO: o
# container novo nao sobe, o antigo ja foi embora, e o site fica fora do ar ate
# alguem descobrir o erro de digitacao. `nginx -t` custa um segundo e transforma
# esse acidente numa mensagem antes de qualquer coisa ser trocada.
echo "==> Conferindo a configuracao do nginx"
if ! $COMPOSE run --rm --no-deps --entrypoint nginx web -t; then
  echo "ERRO: a configuracao do nginx nao passou no teste." >&2
  echo "      Nada foi trocado -- o painel continua no ar com a versao atual." >&2
  exit 1
fi

echo "==> Subindo"
# O entrypoint da API aplica sozinho as mudancas de schema (prisma db push)
# quando o container novo sobe.
$COMPOSE up -d

echo "==> Limpando imagens antigas"
docker image prune -f

# ── E O CACHE DE BUILD, QUE NINGUEM LIMPAVA ─────────────────────────────────
#
# `docker image prune` nao toca no build cache. Ele so cresce: em 01/09/2026 a
# VM tinha 7,9 GB acumulados em 852 registros -- mais do que todas as imagens
# somadas, num disco de 48 GB que ja carrega 5 GB de backups.
#
# `--keep-storage 2GB` mantem o cache recente (o que de fato acelera o proximo
# build) e descarta o resto. Zerar tudo a cada deploy trocaria disco por tempo
# de build; um teto resolve os dois.
#
# O `||` cobre versoes de Docker sem `--keep-storage`: ali o corte e por idade.
docker builder prune -f --keep-storage 2GB >/dev/null 2>&1 ||
  docker builder prune -f --filter until=168h >/dev/null 2>&1 || true

echo
$COMPOSE ps
