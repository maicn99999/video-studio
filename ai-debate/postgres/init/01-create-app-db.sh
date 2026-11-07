#!/bin/sh
# Tạo CSDL riêng cho ứng dụng (CSDL mặc định POSTGRES_DB dành cho n8n). Chỉ chạy ở lần khởi tạo đầu tiên.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" -v app_pw="$APP_DB_PASSWORD" -v app_db="$APP_DB_NAME" <<'EOSQL'
CREATE USER :"app_user" WITH PASSWORD :'app_pw';
CREATE DATABASE :"app_db" OWNER :"app_user";
REVOKE ALL ON DATABASE :"app_db" FROM PUBLIC;
EOSQL
