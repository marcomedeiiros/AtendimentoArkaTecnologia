#!/usr/bin/env bash
# VERIFICACAO DA SESSAO DO WHATSAPP -- rode NA VM, dentro de ~/arka-chat.
#
#   bash deploy/verificar-sessao.sh
#
# Responde tres perguntas, com evidencia e sem tocar em nada:
#
#   1. a sessao pareada esta PERSISTIDA (sobrevive a restart)?
#   2. o vigia esta RECONECTANDO sozinho quando cai?
#   3. o QR so aparece quando o WhatsApp realmente deslogou?
#
# Nao escreve, nao reinicia, nao apaga. Pode rodar com o atendimento no ar.
set -uo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
INSTANCIA="${WHATSAPP_INSTANCE:-arka-wapi-oficial}"
[ -f .env ] && set -a && . ./.env && set +a
INSTANCIA="${WHATSAPP_INSTANCE:-$INSTANCIA}"

titulo() { printf '\n\033[1m%s\033[0m\n%s\n' "$1" "$(printf '%.0s-' {1..70})"; }
ok()     { printf '  \033[32mOK   \033[0m %s\n' "$1"; }
falha()  { printf '  \033[31mFALHA\033[0m %s\n' "$1"; }
nota()   { printf '         %s\n' "$1"; }

# ── 1. OS VOLUMES ───────────────────────────────────────────────────────────
# Sem volume nomeado a sessao vive no filesystem do container: um
# `docker compose up --build` a levaria junto, e o QR voltaria toda vez.
titulo "1. VOLUMES -- a sessao esta fora do container?"
for vol in arka-chat_evolution_instances arka-chat_evolution_pg arka-chat_arka_data; do
  if docker volume inspect "$vol" >/dev/null 2>&1; then
    ok "volume $vol existe ($(docker volume inspect -f '{{.Mountpoint}}' "$vol"))"
  else
    falha "volume $vol NAO existe -- a sessao nao sobrevive a recriacao do container"
  fi
done

# ── 2. A CREDENCIAL NO BANCO DA EVOLUTION ───────────────────────────────────
# E O QUE PERMITE LOGAR SEM QR. Se `creds` tem bytes, o pareamento esta vivo,
# independentemente do que a tela estiver mostrando.
titulo "2. CREDENCIAL DO PAREAMENTO (Postgres da Evolution)"
CREDS=$($COMPOSE exec -T evolution-db psql -U evolution -d evolution -tA -c \
  "SELECT length(s.creds) FROM \"Session\" s JOIN \"Instance\" i ON i.id = s.\"sessionId\" WHERE i.name = '$INSTANCIA';" 2>/dev/null | tr -d '[:space:]')
if [ -n "$CREDS" ] && [ "$CREDS" -gt 0 ] 2>/dev/null; then
  ok "credencial presente: $CREDS bytes -- reconectar NAO precisa de QR"
else
  falha "sem credencial para '$INSTANCIA' no banco da Evolution"
  nota "Se o cofre (item 3) tiver copia, o vigia devolve sozinho no proximo ciclo."
fi

MOTIVO=$($COMPOSE exec -T evolution-db psql -U evolution -d evolution -tA -c \
  "SELECT COALESCE(\"disconnectionReasonCode\"::text,'-') || ' em ' || COALESCE(\"disconnectionAt\"::text,'-') FROM \"Instance\" WHERE name = '$INSTANCIA';" 2>/dev/null | tr -d '\r')
nota "ultima desconexao: ${MOTIVO:-desconhecida}   (401/403 = logout real; o resto e queda temporaria)"

CHAVES=$($COMPOSE exec -T evolution-api sh -c 'ls -1 /evolution/instances/*/ 2>/dev/null | wc -l' 2>/dev/null | tr -d '[:space:]')
nota "chaves do Signal no volume da Evolution: ${CHAVES:-0} arquivo(s)"

# ── 3. O COFRE ──────────────────────────────────────────────────────────────
# A rede de seguranca contra a Evolution 2.4.0-rc2, que apaga a credencial num
# timeout de rede (408). Sem cofre, uma queda de internet custa um QR.
titulo "3. COFRE DA SESSAO (copia no volume do Arka)"
if $COMPOSE exec -T api sh -c '[ -f /data/sessao-whatsapp/*/creds.json ]' 2>/dev/null; then
  ok "o cofre tem copia da credencial"
  $COMPOSE exec -T api sh -c 'cat /data/sessao-whatsapp/*/meta.json' 2>/dev/null | sed 's/^/         /'
else
  falha "cofre VAZIO -- uma queda que apague a credencial vai exigir QR"
  nota "O cofre so copia quando o vigia ve a instancia em 'open'. Se voce acabou"
  nota "de parear, espere ate ~15s e rode de novo."
fi
$COMPOSE exec -T api sh -c 'echo "         EVOLUTION_DB_URL=${EVOLUTION_DB_URL:+definida}${EVOLUTION_DB_URL:-AUSENTE (cofre inativo)}"' 2>/dev/null

# ── 4. O ESTADO REAL, DIRETO DA EVOLUTION ───────────────────────────────────
# Nao e o que a tela diz: e o que a API responde.
titulo "4. ESTADO REAL DA INSTANCIA (Evolution API)"
ESTADO=$(curl -s -o /tmp/.arka-estado -w '%{http_code}' \
  -H "apikey: ${EVOLUTION_API_KEY:-}" \
  "http://127.0.0.1:8080/instance/connectionState/$INSTANCIA")
nota "HTTP $ESTADO"
cat /tmp/.arka-estado 2>/dev/null | sed 's/^/         /'; echo
case "$(cat /tmp/.arka-estado 2>/dev/null)" in
  *'"open"'*)       ok "socket ABERTO -- WhatsApp conectado" ;;
  *'"connecting"'*) nota "handshake em andamento (normal por ate ~3 min com syncFullHistory)" ;;
  *'"close"'*)      nota "socket fechado -- o vigia religa sozinho se a credencial existir (item 2)" ;;
  *)                falha "a Evolution nao respondeu o estado -- veja 'docker compose logs evolution-api'" ;;
esac
rm -f /tmp/.arka-estado

# ── 5. O VIGIA EM ACAO ──────────────────────────────────────────────────────
# As linhas que provam reconexao sem QR. "Session still valid -- preserving
# credentials" seguida de "Online" e o ciclo completo dando certo.
titulo "5. O QUE O VIGIA FEZ (ultimas 24h de log da API)"
$COMPOSE logs --since 24h api 2>/dev/null \
  | grep -E "\[WhatsApp\]|\[Cofre\]" \
  | tail -25 | sed 's/^/  /'
echo
LOGOUTS=$($COMPOSE logs --since 24h api 2>/dev/null | grep -c "LOGOUT REAL DETECTADO")
RECONEXOES=$($COMPOSE logs --since 24h api 2>/dev/null | grep -c "Reconnect attempt")
RESTAUROU=$($COMPOSE logs --since 24h api 2>/dev/null | grep -c "CREDENCIAL RESTAURADA")
nota "reconexoes tentadas: $RECONEXOES | credencial restaurada do cofre: $RESTAUROU | logouts reais: $LOGOUTS"
if [ "$LOGOUTS" -gt 0 ]; then
  falha "houve logout REAL nas ultimas 24h -- neste caso o QR e legitimo"
else
  ok "nenhum logout real: todo QR pedido nas ultimas 24h foi por acao humana"
fi

titulo "COMO PROVAR O RECONNECT AGORA (opcional, derruba a conexao por ~1 min)"
cat <<'FIM'
  Rode e acompanhe o log em outra aba:

    docker compose -f docker-compose.prod.yml logs -f api | grep '\[WhatsApp\]'
    docker compose -f docker-compose.prod.yml restart evolution-api

  O que TEM de aparecer, nesta ordem, e sem nenhum QR no meio:

    [WhatsApp] Connection closed
    [WhatsApp] Reason: <codigo>            <- 408/428/440/515 = temporario
    [WhatsApp] Session still valid -- preserving credentials
    [WhatsApp] Reconnect attempt: 1
    [WhatsApp] Online

  Depois rode este script de novo: o item 2 deve continuar com os MESMOS bytes
  de credencial. Byte igual = mesma sessao = nao houve reparear.
FIM
