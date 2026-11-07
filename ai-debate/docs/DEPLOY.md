# Hướng dẫn triển khai lên VPS (từng bước, cho người không chuyên)

Thời gian: khoảng 30–45 phút. Bạn chỉ cần sao chép & dán lệnh.

> ⚠️ **Chi phí:** thuê VPS, tên miền và dùng API của OpenAI / Anthropic / Meta đều **tốn phí**. Dự án này **không tự mua hay tạo** bất kỳ dịch vụ trả phí nào — bạn tự quyết định và thanh toán.

---

## 1. Chuẩn bị

| Cần có | Gợi ý |
|---|---|
| VPS Linux | Ubuntu 24.04 LTS, **2 vCPU, 4 GB RAM, 40 GB SSD** (tối thiểu 2 GB RAM). Ví dụ: Hetzner, DigitalOcean, Vultr, Lightsail, hoặc nhà cung cấp trong nước. |
| Tên miền | Một tên miền / tên miền con, ví dụ `debate.congty.vn` |
| API key OpenAI | https://platform.openai.com/api-keys — tài khoản cần nạp tiền và có quyền dùng `gpt-6-sol` |
| API key Anthropic | https://platform.claude.com/settings/keys — model `claude-opus-5-5` |
| API key Meta Model API | https://dev.meta.ai → Model API dashboard → tab **API keys** — model `muse-wonder-1.0` |

Mẹo: đặt **giới hạn chi tiêu (spend limit)** trên trang billing của cả 3 nhà cung cấp — đây là lớp bảo vệ thứ hai ngoài giới hạn trong ứng dụng.

## 2. Trỏ tên miền về VPS

Trong trang quản lý DNS của tên miền, tạo bản ghi:

| Loại | Tên | Giá trị |
|---|---|---|
| A | `debate` (hoặc `@`) | Địa chỉ IPv4 của VPS |

Đợi 5–30 phút. Kiểm tra: `ping debate.congty.vn` phải ra đúng IP VPS.

## 3. Đăng nhập VPS & cài Docker

Trên máy tính của bạn (Windows dùng PowerShell, macOS dùng Terminal):

```bash
ssh root@<IP-VPS>
```

Trên VPS:

```bash
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version     # phải in ra phiên bản

# Tường lửa: chỉ mở SSH, HTTP, HTTPS
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

> Docker tự mở cổng qua iptables. Trong `docker-compose.yml`, Postgres **không** mở cổng ra ngoài, n8n chỉ mở trên `127.0.0.1` — chỉ Caddy (80/443) công khai.

## 4. Tải mã nguồn

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/maicn99999/video-studio.git ai-debate
cd /opt/ai-debate/ai-debate
```

## 5. Tạo file cấu hình `.env`

```bash
./scripts/setup.sh
```

Script hỏi tên miền, mật khẩu đăng nhập, rồi **tự sinh các secret ngẫu nhiên** (mật khẩu CSDL, khóa mã hóa n8n, token nội bộ…). File `.env` được đặt quyền `600`.

Điền 3 API key:

```bash
nano .env
```

Tìm và điền:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
META_API_KEY=...
```

Lưu: `Ctrl+O`, `Enter`, thoát: `Ctrl+X`.

### Lưu key bằng Docker secrets (tùy chọn)

Nếu không muốn key nằm trong `.env`, để trống 3 dòng trên và dùng file secret:

```bash
mkdir -p secrets && chmod 700 secrets
printf '%s' 'sk-...'     > secrets/openai_api_key.txt
printf '%s' 'sk-ant-...' > secrets/anthropic_api_key.txt
printf '%s' '...'        > secrets/meta_api_key.txt
chmod 600 secrets/*.txt
# Khi khởi động, thêm file override:
docker compose -f docker-compose.yml -f docker-compose.secrets.yml up -d --build
```

Ứng dụng hỗ trợ mọi biến `*_FILE` (ví dụ `OPENAI_API_KEY_FILE`) nên bạn có thể trỏ tới secret do Docker Swarm, Vault Agent, Doppler, Infisical… mount vào container.

## 6. Khởi động

```bash
docker compose up -d --build
```

Lần đầu mất 3–8 phút (tải image, cài Chromium để xuất PDF). Kiểm tra:

```bash
docker compose ps                       # tất cả "running"/"healthy"
docker compose logs n8n | grep ai-debate
# phải thấy: [ai-debate] Đã publish workflow AI Debate.
```

## 7. Đăng nhập

Mở `https://debate.congty.vn` → nhập `APP_PASSWORD`. Caddy tự cấp chứng chỉ HTTPS (Let's Encrypt) trong lần truy cập đầu.

Nếu banner vàng báo **"Chưa cấu hình API key"** → kiểm tra lại `.env` rồi chạy `docker compose up -d`.

## 8. (Tùy chọn) Mở giao diện n8n

n8n **không** được mở ra Internet (an toàn hơn). Khi cần xem workflow / lịch sử thực thi:

```bash
# Trên máy tính của bạn:
ssh -L 5678:localhost:5678 root@<IP-VPS>
# Giữ cửa sổ này, mở trình duyệt: http://localhost:5678
```

Lần đầu n8n yêu cầu **tạo tài khoản owner** — hãy tạo ngay. Bạn sẽ thấy 2 workflow:
- **AI Debate — GPT vs Claude, trọng tài Muse** (Published)
- **AI Debate — Xử lý lỗi** (Published)

> Workflow được import lại mỗi lần n8n khởi động (`N8N_AUTO_IMPORT=true`). Nếu bạn muốn tự chỉnh workflow trong giao diện n8n và giữ thay đổi, đặt `N8N_AUTO_IMPORT=false` trong `.env`.
> Muốn tự import thủ công: n8n → **Workflows → Import from File** → chọn `n8n/workflows/ai-debate-error.json` trước, rồi `n8n/workflows/ai-debate.json`; bấm **Publish** cho cả hai. Container n8n cần các biến `APP_INTERNAL_URL`, `DEBATE_INTERNAL_TOKEN`, `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (đã có sẵn trong compose).

## 9. Kiểm tra lần đầu với API thật

Hệ thống mới chỉ được kiểm thử bằng **mock API**. Lần đầu dùng key thật, làm như sau để phát hiện sớm vấn đề mà không tốn nhiều tiền:

1. Tạm đặt giới hạn thấp trong `.env`: `MAX_COST_PER_SESSION_USD=1`, `DEBATE_MAX_OUTPUT_TOKENS=6000`, `JUDGE_MAX_OUTPUT_TOKENS=8000`, rồi `docker compose up -d`.
2. Tạo một phiên với vấn đề ngắn.
3. Theo dõi: `docker compose logs -f app`. Các lỗi hay gặp:
   - `401` → key sai / chưa kích hoạt; `403` → tài khoản chưa có quyền dùng model;
   - `404 ... model` → model ID không có trong tài khoản: kiểm tra lại `OPENAI_MODEL` / `ANTHROPIC_MODEL` / `META_MODEL`;
   - `400 ... reasoning` / `effort` → giảm `*_REASONING_EFFORT` / `ANTHROPIC_EFFORT` xuống `medium`;
   - Meta trả lỗi định dạng → thử `META_API_STYLE=chat`.
4. Khi phiên hoàn tất: so sánh chi phí trong mục **Chi phí** với trang billing của từng nhà cung cấp (sau vài giờ). Nếu giá thay đổi, cập nhật `PRICE_OVERRIDES_JSON`.
5. Trả giới hạn về mức mong muốn.

## 10. Sao lưu tự động hằng ngày

```bash
crontab -e
# thêm dòng (2:15 sáng mỗi ngày):
15 2 * * * cd /opt/ai-debate/ai-debate && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Nên sao chép thư mục `backups/` và file `.env` ra nơi khác (Google Drive, máy cá nhân…). **Mất `N8N_ENCRYPTION_KEY` = mất khả năng giải mã dữ liệu n8n.**

## 11. Cập nhật phiên bản mới

```bash
cd /opt/ai-debate/ai-debate
./scripts/update.sh        # sao lưu → git pull → build lại → khởi động
```

Nâng n8n: đổi `N8N_VERSION` trong `.env` (kiểm tra ghi chú phát hành của n8n trước), rồi `docker compose up -d`.

## 12. Chạy không có tên miền (chỉ để thử)

Không khuyến nghị cho dùng thật (mật khẩu đi qua HTTP không mã hóa). Nếu chỉ muốn thử trên mạng nội bộ: dùng chế độ mock (README) hoặc đặt `APP_DOMAIN=:80` và `COOKIE_SECURE=false`.

## 13. Gỡ cài đặt

```bash
cd /opt/ai-debate/ai-debate
docker compose down          # dừng, GIỮ dữ liệu
docker compose down -v       # dừng và XÓA toàn bộ dữ liệu (không thể hoàn tác)
```

Nhớ thu hồi API key trên trang của các nhà cung cấp nếu không dùng nữa.
