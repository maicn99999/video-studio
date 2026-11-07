#!/bin/sh
# Khởi động n8n: tự import & publish 2 workflow AI Debate (idempotent) rồi chạy n8n.
# Tắt tự import bằng N8N_AUTO_IMPORT=false nếu bạn muốn giữ chỉnh sửa làm trong giao diện n8n.
set -u
if [ "${N8N_AUTO_IMPORT:-true}" = "true" ] && [ -d /workflows ]; then
  echo "[ai-debate] Đang import workflow từ /workflows ..."
  if n8n import:workflow --separate --input=/workflows; then
    ok=1
    # n8n 2.x: Error Workflow cũng phải được publish thì mới chạy được.
    for id in aiDebateErrorWf1 aiDebateMainWf01; do
      n8n publish:workflow --id="$id" || ok=0
    done
    if [ "$ok" = 1 ]; then
      echo "[ai-debate] Đã publish workflow AI Debate."
    else
      echo "[ai-debate] CẢNH BÁO: publish workflow thất bại — mở n8n và bấm Publish thủ công cho cả 2 workflow."
    fi
  else
    echo "[ai-debate] CẢNH BÁO: import workflow thất bại — xem log phía trên."
  fi
fi
exec /docker-entrypoint.sh start
