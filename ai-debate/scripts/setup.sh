#!/usr/bin/env bash
# Tạo file .env với các secret ngẫu nhiên. Chạy 1 lần trên VPS:  ./scripts/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo "File .env đã tồn tại — không ghi đè. Xóa hoặc đổi tên nếu muốn tạo lại."
  exit 1
fi
command -v openssl >/dev/null || { echo "Cần cài openssl (sudo apt install -y openssl)"; exit 1; }

rand() { openssl rand -hex "$1"; }
read -r -p "Tên miền cho AI Debate (vd: debate.tenmien.vn): " DOMAIN
read -r -s -p "Mật khẩu đăng nhập giao diện (để trống = tự sinh): " PASS; echo
[ -z "$PASS" ] && PASS="$(rand 9)" && GEN_PASS=1
if [ "${#PASS}" -lt 10 ]; then echo "Mật khẩu phải ≥ 10 ký tự."; exit 1; fi
case "$PASS" in *\'*) echo "Mật khẩu không được chứa dấu nháy đơn (')."; exit 1;; esac

cp .env.example .env
set_kv() { # set_kv KEY VALUE  (an toàn với ký tự đặc biệt)
  local k="$1" v="$2"
  KEY="$k" VAL="$v" awk 'BEGIN{k=ENVIRON["KEY"]; v=ENVIRON["VAL"]} $0 ~ "^"k"=" {print k"="v; next} {print}' .env > .env.tmp && mv .env.tmp .env
}
set_kv APP_DOMAIN "$DOMAIN"
set_kv APP_PASSWORD "'$PASS'"   # nháy đơn: Docker Compose không diễn giải ký tự $
set_kv SESSION_SECRET "$(rand 32)"
set_kv DEBATE_INTERNAL_TOKEN "$(rand 32)"
set_kv N8N_ENCRYPTION_KEY "$(rand 32)"
set_kv POSTGRES_PASSWORD "$(rand 24)"
set_kv APP_DB_PASSWORD "$(rand 24)"
chmod 600 .env

echo ""
echo "✅ Đã tạo .env (quyền 600)."
[ "${GEN_PASS:-0}" = 1 ] && echo "   Mật khẩu đăng nhập được sinh tự động: $PASS  (hãy lưu lại!)"
echo "👉 Tiếp theo: mở .env và điền OPENAI_API_KEY, ANTHROPIC_API_KEY, META_API_KEY:"
echo "      nano .env"
echo "   rồi chạy:  docker compose up -d --build"
