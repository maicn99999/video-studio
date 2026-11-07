#!/usr/bin/env bash
# Kiểm thử end-to-end với Docker: Postgres + n8n thật + app + MOCK LLM (không cần API key, không tốn tiền).
#   ./scripts/e2e.sh            chạy & dọn dẹp
#   KEEP=1 ./scripts/e2e.sh     giữ stack lại để xem (http://127.0.0.1:3300, n8n: http://127.0.0.1:5679)
# Biến tùy chọn: COMPOSE_EXTRA="-f my-override.yml", WITH_PDF=false
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=ai-debate-e2e
ENVF="$(mktemp)"
PASS="e2e-$(openssl rand -hex 8)"
cat > "$ENVF" <<ENV
APP_DOMAIN=localhost
APP_PASSWORD=$PASS
SESSION_SECRET=$(openssl rand -hex 32)
DEBATE_INTERNAL_TOKEN=$(openssl rand -hex 32)
N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
APP_DB_PASSWORD=$(openssl rand -hex 16)
APP_PORT_BIND=127.0.0.1:3300
N8N_PORT_BIND=127.0.0.1:5679
WITH_PDF=${WITH_PDF:-true}
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:17-alpine}
ENV
DC=(docker compose --env-file "$ENVF" -p "$PROJECT" -f docker-compose.yml -f docker-compose.mock.yml ${COMPOSE_EXTRA:-})
cleanup() {
  if [ "${KEEP:-0}" != 1 ]; then "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; fi
  rm -f "$ENVF"
}
trap cleanup EXIT

"${DC[@]}" up -d --build postgres n8n app mock-llm
echo "Đợi n8n import & publish workflow..."
for i in $(seq 1 90); do
  if "${DC[@]}" logs n8n 2>/dev/null | grep -q "Đã publish workflow AI Debate"; then break; fi
  sleep 2
done
"${DC[@]}" logs n8n | grep "\[ai-debate\]" || true
for i in $(seq 1 60); do curl -fs http://127.0.0.1:5679/healthz >/dev/null && break; sleep 2; done

set +e
E2E_APP_URL=http://127.0.0.1:3300 E2E_PASSWORD="$PASS" E2E_EXPECT_PDF="${WITH_PDF:-true}" node app/test/e2e/run-e2e.mjs
RC=$?
set -e
if [ $RC -ne 0 ]; then
  echo "---- log app ----"; "${DC[@]}" logs --tail=80 app
  echo "---- log n8n ----"; "${DC[@]}" logs --tail=80 n8n
fi
exit $RC
