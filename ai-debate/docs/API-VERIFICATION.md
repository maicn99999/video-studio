# Xác thực tài liệu API (endpoint, xác thực, schema, model ID, giá)

Ngày kiểm tra: **07/11/2026**. Trong môi trường phát triển, mạng bị giới hạn: **không truy cập trực tiếp được** `developers.openai.com` và `ai.google.dev`; thông tin về hai nhà cung cấp này được lấy qua **kết quả tìm kiếm trỏ tới chính các trang tài liệu chính thức đó** (nội dung tóm tắt, không phải đọc toàn văn). Tài liệu Anthropic được đối chiếu với tài liệu tham chiếu chính thức đi kèm công cụ phát triển.

Dự án đã chuyển trọng tài sang **Google Gemini** (08/11/2026); mục Meta cũ đã được gỡ.

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

## Google — Gemini 4 Argon (trọng tài)

Cập nhật 08/11/2026: trọng tài đổi từ Meta Muse Wonder sang Gemini theo yêu cầu. `ai.google.dev` cũng bị chặn trong môi trường phát triển → thông tin lấy qua kết quả tìm kiếm trỏ tới trang chính thức.

| Hạng mục | Giá trị dùng trong code | Mức độ |
|---|---|---|
| Model ID | `gemini-4-argon` (trang `ai.google.dev/gemini-api/docs/models/gemini-4-argon` ghi là ID ổn định; phát hành 13/10/2026; thay thế `gemini-3.1-pro-preview`) | 🟡 |
| Ngữ cảnh | 1.048.576 token (chung input + output); output mặc định tối đa 65.536 | 🟡 |
| Endpoint | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` (Google gọi đây là Generate Content API "Legacy" — vẫn hoạt động; có Interactions API mới hơn) | 🟡 |
| Xác thực | header `x-goog-api-key: $GEMINI_API_KEY` | 🟡 |
| Request | `systemInstruction.parts[].text`, `contents[].parts[].text`, `generationConfig.maxOutputTokens`, `generationConfig.thinkingConfig.thinkingLevel` (`low`/`medium`/`high`; `thinkingBudget` **không** hỗ trợ trên Gemini 4 và không được dùng cùng `thinkingLevel`), `generationConfig.responseMimeType: "application/json"` cho trọng tài | 🟡 (`systemInstruction`, `responseMimeType`: ⚠️ theo kiến thức API Gemini, chưa thấy trong trích đoạn) |
| Response | `candidates[0].content.parts[]` (bỏ phần `thought: true`), `finishReason` (`STOP`, `MAX_TOKENS`, `SAFETY`…), `promptFeedback.blockReason`, `modelVersion` | 🟡 |
| Usage | `usageMetadata.promptTokenCount`, `cachedContentTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount` (có thể vắng mặt → 0). Token suy luận **tính phí như output** → code cộng vào output | 🟡 |
| Giá / 1M token | Giá giới thiệu **đến hết 30/11/2026: $2 vào / $10 ra / $0,10 cache**; từ 01/12/2026: **$4 / $20** (code tự đổi theo ngày; cache sau đó giả định $0,20). Không có gói miễn phí | 🟡 (VentureBeat + trang Google) |
| Lỗi | 429 `RESOURCE_EXHAUSTED`, 500/503 `UNAVAILABLE` → retry; 400 `INVALID_ARGUMENT`, 403 `PERMISSION_DENIED`, 404 → không retry | 🟡 |
| Dự phòng | Nếu tài khoản chưa dùng được `gemini-4-argon`: `GEMINI_MODEL=gemini-3.1-pro-preview` ($2 / $12; > 200K token: $4 / $18) | 🟡 |

## Việc cần làm khi có API key thật

1. Chạy 1 phiên với giới hạn thấp (DEPLOY.md mục 9).
2. Nếu có lỗi 400 về tham số: xem log `docker compose logs app`, điều chỉnh `*_EFFORT` / `GEMINI_THINKING_LEVEL`.
3. So sánh chi phí trong ứng dụng với trang billing; cập nhật `PRICE_OVERRIDES_JSON` nếu giá khác.
4. Mở `developers.openai.com` và `ai.google.dev` để đọc lại toàn văn tài liệu — đặc biệt các mục đánh dấu ⚠️.

## Nguồn

- OpenAI: https://developers.openai.com/api/docs/models/gpt-6-sol · https://developers.openai.com/api/reference/resources/responses/methods/create · https://developers.openai.com/api/docs/guides/reasoning
- Anthropic: https://platform.claude.com/docs (Messages API, models, pricing, API versioning `2026-10-21`, refusals & fallback)
- Google: https://ai.google.dev/gemini-api/docs/models/gemini-4-argon · https://ai.google.dev/gemini-api/docs/pricing · https://ai.google.dev/gemini-api/docs/generate-content/thinking · https://venturebeat.com/technology/google-makes-gemini-4-argon-broadly-available-with-limited-time-low-api-pricing-of-2-10-per-1m-token
