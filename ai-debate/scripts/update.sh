#!/usr/bin/env bash
# Cập nhật lên phiên bản mới nhất từ GitHub và khởi động lại.
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/backup.sh || echo "Cảnh báo: sao lưu thất bại, vẫn tiếp tục cập nhật."
git pull --ff-only
docker compose up -d --build
docker compose ps
