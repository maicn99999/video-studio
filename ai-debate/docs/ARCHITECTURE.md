# Kiến trúc hệ thống

## Thành phần

| Container | Vai trò | Mở ra ngoài? |
|---|---|---|
| `caddy` | Reverse proxy, HTTPS tự động, chặn `/internal/*` | 80/443 |
| `app` (Node.js 22) | Giao diện web, API, **LLM Gateway** (giữ API key), xuất Markdown/PDF, lưu lịch sử | Chỉ qua Caddy |
| `n8n` (Community 2.46.6) | **Workflow engine**: điều phối 3 vòng tranh luận + trọng tài + lập báo cáo | `127.0.0.1:5678` (SSH tunnel) |
| `postgres` 17 | CSDL `n8n` (n8n) và `debate` (lịch sử, lượt gọi, chi phí) | Không |

## Luồng một phiên

```
Trình duyệt ── POST /api/debates ──► app: kiểm tra input, ngân sách ngày/tháng, số phiên đồng thời
                                      │ tạo bản ghi (status=queued)
                                      └─ POST n8n /webhook/ai-debate {sessionId} + x-internal-token
n8n "AI Debate — GPT vs Claude, trọng tài Muse":
  Webhook → IF token hợp lệ → POST /internal/sessions/:id/start (lưu executionId, lấy input)
  → Vòng 1: Code tạo 2 item (A,B) → HTTP /internal/llm (2 item chạy SONG SONG) → Code kiểm tra
  → Vòng 2: phản biện chéo   → HTTP → kiểm tra
  → Vòng 3: hoàn thiện        → HTTP → kiểm tra
  → Trọng tài: hồ sơ "mù" → HTTP → đọc JSON → IF hợp lệ?
        └─ không → yêu cầu Muse sửa JSON (1 lần) → đọc lại
  → Lập báo cáo tiếng Việt (điểm có trọng số tính bằng code) → POST /internal/sessions/:id/complete
Lỗi ở bất kỳ node nào → Error Workflow "AI Debate — Xử lý lỗi" → POST /internal/n8n-error → phiên = failed (kèm thông báo tiếng Việt)
Trình duyệt poll GET /api/debates/:id mỗi 3 giây để hiển thị trạng thái từng vòng.
```

## LLM Gateway (`app/src/llm`)

Mọi lời gọi AI đi qua `POST /internal/llm` `{sessionId, round, role, stage, system, prompt}`:

1. **Định tuyến vai trò:** A → OpenAI, B → Anthropic, judge → Meta (`config.roles`).
2. **Idempotency:** khóa `r{round}-{role}`; lượt đã thành công được trả lại từ CSDL → n8n retry node không gây tính phí lần 2. Lời gọi trùng đồng thời được gộp.
3. **Ngân sách:** ước tính chi phí xấu nhất (input ước lượng + `max_output_tokens`) và *giữ chỗ* trước khi gọi; từ chối nếu vượt trần phiên/ngày/tháng. Sau khi gọi, ghi chi phí thực theo `usage`.
4. **Giới hạn đồng thời** mỗi nhà cung cấp (semaphore).
5. **Retry:** 408/409/425/429/5xx/529, lỗi mạng, timeout → backoff lũy thừa có jitter, tôn trọng `retry-after`/`retry-after-ms`; không retry 400/401/403/404, `insufficient_quota`. Có timeout từng lần và deadline tổng.
6. **Chuẩn hóa phản hồi:** text, model thực tế, usage (input, cached, output, reasoning), stop reason; xử lý refusal / bị cắt token.
7. Luôn trả HTTP 200 `{ok:false, error:{code, message}}` cho lỗi nghiệp vụ để Code node n8n ném lỗi tiếng Việt rõ ràng.

## Bảo mật

- API key chỉ ở container `app` (env hoặc `*_FILE`). n8n chỉ biết `DEBATE_INTERNAL_TOKEN` và URL nội bộ.
- `/internal/*` yêu cầu `x-internal-token` (so sánh thời gian hằng) và bị Caddy chặn từ Internet.
- Giao diện: mật khẩu duy nhất, cookie HMAC `HttpOnly; Secure; SameSite=Strict`, chống CSRF bằng header tùy biến, giới hạn đăng nhập sai (10 lần/15 phút/IP).
- CSP `default-src 'self'` (không script inline, không CDN), nội dung AI hiển thị qua DOMPurify; PDF render bằng Chromium chặn toàn bộ request mạng.
- Workflow không chứa secret (có test kiểm tra).

## Lưu trữ

Bảng `debates` (input JSON, trạng thái, giai đoạn, báo cáo Markdown, phán quyết JSON, executionId n8n) và `turns` (mỗi lượt gọi AI: vòng, vai trò, model, nội dung, token, chi phí, số lần thử, thời gian, lỗi). Watchdog đánh dấu phiên treo quá `SESSION_TIMEOUT_MIN` là thất bại.

## Mã nguồn workflow

`n8n/workflows/*.json` được **sinh** từ `n8n/src/build-workflow.mjs` + `n8n/src/code/*.js` (thư viện chung `_lib.js` được chèn vào đầu mỗi Code node). Nhờ vậy prompt và logic chấm điểm có unit test, và CI phát hiện khi JSON chưa được build lại.

## Kiểm thử

| Lớp | Công cụ | Ghi chú |
|---|---|---|
| Unit | `node --test` | giá, retry, timeout, schema 3 provider, cấu hình, auth, parser JSON trọng tài |
| Tích hợp | app thật + mock LLM + `test/helpers/mini-n8n.js` thông dịch **đúng file workflow JSON** | 18 kịch bản: luồng đầy đủ, độc lập vòng 1, 429/500/timeout, JSON hỏng, 401, refusal, ngân sách, hủy, idempotency, xuất file, bảo mật |
| E2E | `scripts/e2e.sh`: Docker Compose với **n8n thật** + Postgres + mock LLM | 6 kịch bản |
| API thật | — | **Chưa chạy** (chưa có key) |
