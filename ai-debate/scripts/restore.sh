#!/usr/bin/env bash
# Khôi phục lịch sử tranh luận:  ./scripts/restore.sh backups/debate-YYYYmmdd-HHMMSS.dump
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?Cách dùng: ./scripts/restore.sh backups/debate-....dump}"
[ -f "$FILE" ] || { echo "Không thấy file $FILE"; exit 1; }
read -r -p "Dữ liệu lịch sử hiện tại sẽ bị thay thế bằng bản sao lưu. Gõ 'dong y' để tiếp tục: " OK
[ "$OK" = "dong y" ] || { echo "Đã hủy."; exit 1; }
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$APP_DB_NAME" --clean --if-exists --no-owner --role="$APP_DB_USER"' < "$FILE"
docker compose restart app
echo "Đã khôi phục từ $FILE"
