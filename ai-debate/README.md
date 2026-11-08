# ⚖️ AI Debate — Hội đồng tranh luận AI (n8n)

Bạn nhập **một vấn đề** bằng tiếng Việt → hệ thống tự cho **hai AI tranh luận** qua 3 vòng → **một AI trọng tài độc lập** chấm điểm → bạn nhận **báo cáo tiếng Việt** có bảng so sánh, điểm số, lập luận, rủi ro và kế hoạch hành động.

| Vai trò | Model | Model ID |
|---|---|---|
| Bên A (tranh luận) | GPT-6 Sol — OpenAI | `gpt-6-sol` |
| Bên B (tranh luận) | Claude Opus 5.5 — Anthropic | `claude-opus-5-5` |
| Trọng tài | Gemini 4 Argon — Google Gemini API | `gemini-4-argon` |

```
 Bạn (trình duyệt / điện thoại)
        │ HTTPS
   ┌────▼─────┐   webhook    ┌──────────────┐  /internal/llm   ┌─────────────────────┐
   │  Caddy   │──► app ─────►│  n8n (điều   │─────────────────►│ app: LLM Gateway     │──► OpenAI  (GPT-6 Sol)
   │ (HTTPS)  │   (giao diện,│  phối 3 vòng │◄─────────────────│ giữ API key, retry,  │──► Anthropic (Claude)
   └──────────┘   lịch sử,   │  + trọng tài)│  kết quả + chi phí│ timeout, ngân sách,  │──► Google (Gemini)
                  xuất file) └──────┬───────┘                   │ ghi token & chi phí  │
                                    └── Postgres (lịch sử, n8n) ─┴─────────────────────┘
```

## Quy trình tranh luận

1. **Vòng 1 — Phân tích độc lập:** GPT và Claude phân tích **song song**, không thấy kết quả của nhau.
2. **Vòng 2 — Phản biện chéo:** mỗi bên đọc phương án đối phương và phản biện chi tiết.
3. **Vòng 3 — Hoàn thiện:** mỗi bên tiếp thu / bác bỏ phản biện và chốt phương án cuối.
4. **Trọng tài Gemini:** chấm **"mù"** (không biết bên nào là GPT/Claude) theo tiêu chí & trọng số bạn đặt (0–10 điểm/tiêu chí, hệ thống tự tính điểm /100), chọn **A**, **B** hoặc **kết hợp**, nêu rõ **bất đồng chưa giải quyết**.
5. **Báo cáo tiếng Việt:** tóm tắt điều hành, bảng điểm, bảng so sánh, lập luận, giải pháp khuyến nghị, bất đồng, rủi ro, kế hoạch hành động, token & chi phí.

## Tính năng

- Giao diện web **tiếng Việt, mobile-first**, chế độ sáng/tối, đăng nhập bằng mật khẩu.
- Form: **vấn đề, bối cảnh, mục tiêu, ràng buộc, tiêu chí chấm điểm + trọng số** (tự lưu nháp).
- **Trạng thái theo từng vòng** cập nhật mỗi 3 giây; xem toàn văn từng vòng; có thể đóng trang, quay lại sau.
- **Lịch sử** phiên: tìm kiếm, lọc, xem lại, nhân bản, xóa.
- **Xuất Markdown / PDF** (PDF tạo trên máy chủ, đủ dấu tiếng Việt) và nút In.
- **Theo dõi token & chi phí** từng AI, từng lượt, theo ngày/tháng.
- **Giới hạn chi phí** theo phiên / ngày / tháng (kiểm tra *trước* mỗi lần gọi API).
- **Retry** có backoff + tôn trọng `retry-after` cho 429/5xx/529/timeout; **timeout** từng lần gọi và tổng; **giới hạn đồng thời** mỗi nhà cung cấp; **idempotency** (n8n retry không bị tính tiền 2 lần).
- API key **chỉ nằm trong biến môi trường / file secret của container `app`** — n8n, trình duyệt và Git không bao giờ thấy key.
- Docker Compose: **n8n Community + Postgres + app + Caddy (HTTPS tự động)**.

## ✅ Trạng thái kiểm thử — đọc kỹ

| Hạng mục | Kết quả |
|---|---|
| 28 unit test (giá, retry, timeout, rate limit, schema request/response, cấu hình, bảo mật) | ✅ đạt |
| 18 test tích hợp: app + gateway + **workflow JSON thật** (chạy bằng bộ thông dịch mini) + **mock API** | ✅ đạt |
| 6 bước E2E trên Docker: **n8n 2.46.6 thật** + Postgres + app + **mock API** (luồng đầy đủ, 429/500 retry, sửa JSON trọng tài, Error Workflow) | ✅ đạt |
| Gọi **API thật** của OpenAI / Anthropic / Google | ❌ **CHƯA kiểm thử** — chưa có API key. Mọi kiểm thử ở trên dùng **mock server** mô phỏng đúng schema tài liệu. |

Lần chạy đầu tiên với key thật, hãy làm theo mục **"Kiểm tra lần đầu với API thật"** trong [docs/DEPLOY.md](docs/DEPLOY.md#9-kiểm-tra-lần-đầu-với-api-thật). Chi tiết những gì đã/chưa xác thực trong tài liệu API: [docs/API-VERIFICATION.md](docs/API-VERIFICATION.md).

## 🚀 Cài đặt nhanh (VPS Ubuntu)

> Hướng dẫn từng bước cho người không chuyên: **[docs/DEPLOY.md](docs/DEPLOY.md)**

```bash
# 1. Cài Docker (Ubuntu 22.04/24.04)
curl -fsSL https://get.docker.com | sudo sh

# 2. Lấy mã nguồn
git clone https://github.com/maicn99999/video-studio.git
cd video-studio/ai-debate

# 3. Tạo file .env (tự sinh mật khẩu & secret)
./scripts/setup.sh

# 4. Điền 3 API key
nano .env        # OPENAI_API_KEY=..., ANTHROPIC_API_KEY=..., GEMINI_API_KEY=...

# 5. Khởi động
docker compose up -d --build
```

Mở `https://<tên-miền-của-bạn>` và đăng nhập bằng `APP_PASSWORD`.

### Chạy thử miễn phí bằng mock (không cần API key)

```bash
cp .env.example .env    # điền APP_PASSWORD, SESSION_SECRET... (hoặc dùng ./scripts/setup.sh)
docker compose -f docker-compose.yml -f docker-compose.mock.yml up -d --build postgres n8n app mock-llm
# Mở http://localhost:3000 — có dải màu tím "CHẾ ĐỘ MOCK" để nhắc đây không phải AI thật
```

Kiểm thử tự động toàn hệ thống: `./scripts/e2e.sh`

## 📅 Sử dụng hằng ngày

1. Mở trang web → **Phiên mới**.
2. Điền **Vấn đề** (bắt buộc), thêm **Bối cảnh / Mục tiêu / Ràng buộc** càng cụ thể càng tốt.
3. Xem lại **tiêu chí chấm điểm** (mặc định 5 tiêu chí; có thể sửa, thêm, xóa, đổi trọng số).
4. Bấm **⚖️ Bắt đầu tranh luận**. Một phiên thường mất **5–20 phút**. Có thể đóng trang.
5. Khi xong: tab **Báo cáo** → **⬇ PDF** hoặc **⬇ Markdown** để lưu/chia sẻ.
6. Mục **Chi phí** để xem đã tiêu bao nhiêu hôm nay / tháng này.

Mẹo: ghi rõ con số (ngân sách, nhân sự, thời hạn) ở *Ràng buộc*; đặt trọng số cao cho điều bạn quan tâm nhất. Báo cáo do AI tạo — hãy kiểm chứng trước khi ra quyết định quan trọng.

## 💰 Chi phí ước tính

Giá (USD / 1 triệu token, kiểm tra 07/11/2026): GPT-6 Sol $2 vào / $10 ra · Claude Opus 5.5 $4 / $20 · Gemini 4 Argon $2 / $10 (giá giới thiệu đến 30/11/2026, sau đó $4 / $20; token suy luận tính như output).
Một phiên = 7 lượt gọi (6 lượt tranh luận + 1 trọng tài, thêm 1 lượt nếu cần sửa JSON). **Ước tính thô: khoảng $0,5–1,5/phiên**, tùy độ dài và mức suy luận; mức trần mặc định **$3/phiên, $15/ngày, $100/tháng** (sửa trong `.env`). Đây là ước tính — hóa đơn chính thức xem trên trang billing của từng nhà cung cấp. Chi phí VPS (≈ $6–24/tháng) tính riêng.

## ⚙️ Cấu hình chính (`.env`)

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `APP_DOMAIN` | Tên miền cho HTTPS | — |
| `APP_PASSWORD` | Mật khẩu đăng nhập giao diện (≥ 10 ký tự) | — |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | API key 3 nhà cung cấp | — |
| `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL` | Model ID | `gpt-6-sol`, `claude-opus-5-5`, `gemini-4-argon` |
| `OPENAI_REASONING_EFFORT`, `ANTHROPIC_EFFORT`, `GEMINI_THINKING_LEVEL` | Mức suy luận (cao = tốt hơn, đắt hơn) | `high` |
| `MAX_COST_PER_SESSION_USD` / `_DAY_` / `_MONTH_` | Trần chi phí (0 = không giới hạn) | 3 / 15 / 100 |
| `MAX_CONCURRENT_DEBATES` | Số phiên chạy cùng lúc | 2 |
| `DEBATE_MAX_OUTPUT_TOKENS`, `JUDGE_MAX_OUTPUT_TOKENS` | Token ra tối đa mỗi lượt (gồm token suy luận) | 16000 / 20000 |
| `LLM_TIMEOUT_MS`, `LLM_CALL_DEADLINE_MS`, `LLM_MAX_RETRIES` | Timeout 1 lần gọi, tổng thời gian kể cả retry, số lần retry | 10 phút, 20 phút, 4 |
| `PRICE_OVERRIDES_JSON` | Cập nhật bảng giá khi nhà cung cấp đổi giá | trống |
| `ANTHROPIC_REFUSAL_FALLBACK` | Claude tự chuyển model dự phòng khi bộ lọc an toàn từ chối | `true` |

Danh sách đầy đủ có chú thích: [.env.example](.env.example).

## 🔐 Lưu API key an toàn

- Key chỉ nằm trong `.env` trên VPS (quyền `600`, đã có trong `.gitignore`) và **chỉ được truyền vào container `app`**. n8n gọi AI thông qua gateway nội bộ nên **n8n không giữ key**.
- Muốn dùng **Docker secrets / secret manager**: đặt `OPENAI_API_KEY_FILE=/run/secrets/openai_api_key` (tương tự cho 2 key còn lại) — ứng dụng đọc key từ file. Xem [docs/DEPLOY.md § Docker secrets](docs/DEPLOY.md#lưu-key-bằng-docker-secrets-tùy-chọn).
- Không dán key vào workflow n8n, không gửi key qua chat/email. Lộ key → thu hồi ngay trên trang của nhà cung cấp và tạo key mới.

## 🛠 Bảo trì

| Việc | Lệnh |
|---|---|
| Xem trạng thái | `docker compose ps` |
| Xem log | `docker compose logs -f app` / `docker compose logs -f n8n` |
| Khởi động lại | `docker compose restart` |
| Sao lưu CSDL | `./scripts/backup.sh` (đặt cron hằng ngày) |
| Khôi phục | `./scripts/restore.sh backups/debate-....dump` |
| Cập nhật phiên bản mới | `./scripts/update.sh` |
| Mở giao diện n8n | SSH tunnel: `ssh -L 5678:localhost:5678 user@vps` rồi mở http://localhost:5678 |

## 📁 Cấu trúc thư mục

```
ai-debate/
├── docker-compose.yml          # Production: postgres, n8n, app, caddy
├── docker-compose.mock.yml     # Chạy thử bằng mock API
├── Caddyfile                   # HTTPS tự động, chặn /internal/*
├── .env.example                # Mẫu cấu hình (không chứa secret)
├── app/                        # Ứng dụng Node.js
│   ├── src/llm/                # Gateway: providers.js, http.js (retry), pricing.js, gateway.js (ngân sách)
│   ├── src/export/render.js    # Xuất Markdown / PDF
│   ├── public/                 # Giao diện web (HTML/CSS/JS thuần)
│   ├── mock/server.js          # Mock OpenAI / Anthropic / Gemini (chỉ để test)
│   └── test/                   # Unit, tích hợp, E2E
├── n8n/
│   ├── workflows/              # ⬅ FILE JSON IMPORT VÀO n8n (sinh tự động)
│   ├── src/code/               # Mã nguồn các Code node (prompt, chấm điểm, báo cáo)
│   ├── src/build-workflow.mjs  # Build workflow JSON
│   └── init/entrypoint.sh      # Tự import & publish workflow khi n8n khởi động
├── postgres/init/              # Tạo CSDL cho app
├── scripts/                    # setup, backup, restore, update, e2e
└── docs/                       # DEPLOY, ARCHITECTURE, API-VERIFICATION, TROUBLESHOOTING
```

## 👩‍💻 Dành cho lập trình viên

```bash
cd app && npm ci
npm test                    # 52 test: unit + tích hợp (mock API + workflow JSON thật)
npm run build:workflow      # sau khi sửa n8n/src/code/*.js
npm run check:workflow      # CI kiểm tra JSON đã build lại chưa
../scripts/e2e.sh           # E2E với n8n thật trong Docker
```

Sửa prompt: chỉnh `n8n/src/code/*.js` → `npm run build:workflow` → `docker compose restart n8n` (tự import lại). Kiến trúc chi tiết: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Gặp lỗi: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
