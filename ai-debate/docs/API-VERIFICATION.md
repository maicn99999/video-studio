# Xác thực tài liệu API (endpoint, xác thực, schema, model ID, giá)

Ngày kiểm tra: **07/11/2026**. Trong môi trường phát triển, mạng bị giới hạn: **không truy cập trực tiếp được** `developers.openai.com` và `dev.meta.ai`; thông tin về hai nhà cung cấp này được lấy qua **kết quả tìm kiếm trỏ tới chính các trang tài liệu chính thức đó** (nội dung tóm tắt, không phải đọc toàn văn). Tài liệu Anthropic được đối chiếu với tài liệu tham chiếu chính thức đi kèm công cụ phát triển.

Mức độ tin cậy: ✅ đã đối chiếu tài liệu chính thức · 🟡 theo trích đoạn tài liệu chính thức qua tìm kiếm, chưa đọc toàn văn · ⚠️ chỉ có nguồn bên thứ ba / chưa xác thực.

## OpenAI — GPT-6 Sol

| Hạng mục | Giá trị dùng trong code | Mức độ |
|---|---|---|
| Model ID | `gpt-6-sol` (trang `developers.openai.com/api/docs/models/gpt-6-sol`) | 🟡 |
| Ghi chú | Trang model cho biết đã có model kế nhiệm **GPT-6.1 Sol** (`gpt-6.1-sol`). Hệ thống giữ `gpt-6-sol` theo yêu cầu; đổi bằng `OPENAI_MODEL` nếu muốn. | 🟡 |
| Endpoint | `POST https://api.openai.com/v1/responses` (Responses API) | 🟡 |
| Xác thực | `Authorization: Bearer $OPENAI_API_KEY` | ✅ (chuẩn OpenAI) |
| Request | `model`, `instructions`, `input`, `max_output_tokens`, `reasoning.effort`, `store:false` | 🟡 |
| `reasoning.effort` | `none`, `low`, `medium` (mặc định), `high`, `xhigh`, `max` — dùng `high` | 🟡 |
| Response | `output[]` (item `type:"message"` → `content[].type:"output_text"`), `status` (`incomplete` + `incomplete_details.reason`), `usage.input_tokens`, `usage.input_tokens_details.cached_tokens`, `usage.output_tokens`, `usage.output_tokens_details.reasoning_tokens` | 🟡 |
| Giá / 1M token | input $2.00 · cached input $0.20 · output $10.00; prompt > 272K token: input ×2, output ×1,5 | 🟡 |
| Ngữ cảnh | 1.050.000 token; output tối đa 128.000 | 🟡 |

## Anthropic — Claude Opus 5.5

| Hạng mục | Giá trị dùng trong code | Mức độ |
|---|---|---|
| Model ID | `claude-opus-5-5` (không có hậu tố ngày) | ✅ |
| Endpoint | `POST https://api.anthropic.com/v1/messages` | ✅ |
| Header | `x-api-key`, `anthropic-version: 2026-10-21`, `content-type: application/json` | ✅ |
| Thinking | Opus 5.5 luôn bật thinking; `{type:"disabled"}` và `budget_tokens` trả lỗi 400. Dùng `thinking:{type:"adaptive"}` + `output_config.effort` (`low`…`max`, mặc định của model là `medium`; hệ thống đặt `high`). | ✅ |
| Tham số bị loại bỏ | `temperature`, `top_p`, `top_k` trả 400 ở API version `2026-10-21` → không gửi | ✅ |
| Prefill | Không hỗ trợ prefill assistant → không dùng | ✅ |
| Refusal | HTTP 200 với `stop_reason:"refusal"` + `stop_details.category` → xử lý trước khi đọc `content`. Bật fallback phía máy chủ: `fallbacks:"default"` + header `anthropic-beta: server-side-fallback-2026-07-01` (tắt bằng `ANTHROPIC_REFUSAL_FALLBACK=false`). Chi phí tính theo `model` thực sự phục vụ trong phản hồi. | ✅ |
| Response | `content[]` (lọc `type:"text"`, bỏ qua `thinking`), `stop_reason` (`max_tokens` = bị cắt), `usage.input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens` | ✅ |
| Lỗi | 429 `rate_limit_error` (có `retry-after`), 529 `overloaded_error`, 5xx → retry; 400/401/403/404 → không retry | ✅ |
| Giá / 1M token | input $4.00 · output $20.00 · cache read $0.20 · cache write (5 phút) $5.00 | ✅ |
| Ngữ cảnh | 1M token; output tối đa 128K | ✅ |

## Meta Model API — Muse Wonder

| Hạng mục | Giá trị dùng trong code | Mức độ |
|---|---|---|
| Model ID | `muse-wonder-1.0` (Standard mode; ngữ cảnh 1.048.576 token) | 🟡 (`dev.meta.ai/docs/models`) |
| Base URL | `https://api.meta.ai/v1` | 🟡 (`dev.meta.ai/docs/api-reference`) |
| Xác thực | `Authorization: Bearer <key>` — tài liệu đặt tên biến là `MODEL_API_KEY`; dự án dùng `META_API_KEY` | 🟡 (`dev.meta.ai/docs/authentication`) |
| Endpoint | `POST /v1/responses` (ví dụ chính thức đầu tiên dùng Responses API + reasoning effort). Ngoài ra có Chat Completions và Messages tương thích. Đổi bằng `META_API_STYLE=chat`. | 🟡 |
| Schema Responses | Tương thích OpenAI Responses API (tài liệu nói dùng được OpenAI SDK chỉ bằng đổi base URL). Parser chấp nhận cả dạng Responses và Chat Completions. | 🟡 |
| `reasoning.effort` | Chỉ nguồn bên thứ ba liệt kê `minimal/low/medium/high/xhigh/max` → mặc định `high`, có thể đổi `META_REASONING_EFFORT` | ⚠️ |
| Trường `usage` | **Chưa xác thực được** — giả định giống OpenAI Responses. Nếu khác, chi phí Muse hiển thị có thể bằng 0 → kiểm tra lần đầu (DEPLOY.md mục 9). | ⚠️ |
| Giá / 1M token | input $4.00 · cached input $0.20 · output $20.00 (Standard). Web search tính riêng (không dùng). | 🟡 (`dev.meta.ai/docs/pricing-rate-limits`) |
| Rate limit | 3.000 request/phút, 4.000.000 token/phút | 🟡 |

## Việc cần làm khi có API key thật

1. Chạy 1 phiên với giới hạn thấp (DEPLOY.md mục 9).
2. Nếu có lỗi 400 về tham số: xem log `docker compose logs app`, điều chỉnh `*_EFFORT`, `META_API_STYLE`.
3. So sánh chi phí trong ứng dụng với trang billing; cập nhật `PRICE_OVERRIDES_JSON` nếu giá khác.
4. Mở `developers.openai.com` và `dev.meta.ai` để đọc lại toàn văn tài liệu — đặc biệt các mục đánh dấu ⚠️.

## Nguồn

- OpenAI: https://developers.openai.com/api/docs/models/gpt-6-sol · https://developers.openai.com/api/reference/resources/responses/methods/create · https://developers.openai.com/api/docs/guides/reasoning
- Anthropic: https://platform.claude.com/docs (Messages API, models, pricing, API versioning `2026-10-21`, refusals & fallback)
- Meta: https://dev.meta.ai/docs/models · https://dev.meta.ai/docs/authentication · https://dev.meta.ai/docs/api-reference · https://dev.meta.ai/docs/pricing-rate-limits · https://dev.meta.ai/docs/quickstart
