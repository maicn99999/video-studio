#!/usr/bin/env bash
# Sao lưu CSDL (lịch sử tranh luận + dữ liệu n8n) vào thư mục backups/.
# Đặt lịch hằng ngày:  crontab -e  ->  15 2 * * * cd /opt/ai-debate/ai-debate && ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
TS="$(date +%Y%m%d-%H%M%S)"
# Dùng biến môi trường sẵn có trong container postgres (không cần đọc .env ở máy chủ)
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$APP_DB_NAME" -Fc' > "backups/debate-$TS.dump"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d n8n -Fc' > "backups/n8n-$TS.dump"
chmod 600 backups/*.dump
# Giữ 14 bản gần nhất mỗi loại
ls -1t backups/debate-*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t backups/n8n-*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "Đã sao lưu: backups/debate-$TS.dump, backups/n8n-$TS.dump"
