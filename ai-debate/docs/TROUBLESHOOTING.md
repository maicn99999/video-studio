# Khắc phục sự cố

Lệnh xem log hữu ích nhất: `docker compose logs --tail=100 app` và `docker compose logs --tail=100 n8n`.

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Không mở được trang web | DNS chưa trỏ đúng, cổng 80/443 bị chặn | `ping <tên miền>`; `ufw status`; `docker compose logs caddy` |
| "Mật khẩu không đúng" | Sai `APP_PASSWORD`; mật khẩu có ký tự `$` không đặt trong nháy đơn | Sửa `.env` (`APP_PASSWORD='...'`), `docker compose up -d` |
| Banner "Chưa cấu hình API key" | Thiếu key trong `.env` | Điền key, `docker compose up -d` |
| "Không khởi động được workflow n8n … HTTP 404" | Workflow chưa được publish | `docker compose logs n8n \| grep ai-debate`; `docker compose restart n8n`; hoặc vào n8n (SSH tunnel) bấm **Publish** cho cả 2 workflow |
| "Không khởi động được workflow n8n … fetch failed" | Container n8n chưa chạy xong | Đợi 1–2 phút; `docker compose ps` |
| "API key của … không hợp lệ (401)" | Key sai/bị thu hồi | Tạo key mới, cập nhật `.env` |
| "… (403)" / "… (404) model" | Tài khoản chưa có quyền dùng model, sai model ID | Kiểm tra trên trang nhà cung cấp; sửa `*_MODEL` |
| "… tài khoản hết hạn mức/thanh toán" | Hết credit / `insufficient_quota` | Nạp tiền trên trang billing |
| "Vượt giới hạn chi phí phiên/ngày/tháng" | Đúng thiết kế — bảo vệ chi phí | Đợi sang ngày/tháng mới (giờ UTC) hoặc tăng `MAX_COST_PER_*_USD` |
| "… hết giới hạn token trước khi trả lời" | Model suy luận quá dài | Tăng `DEBATE_MAX_OUTPUT_TOKENS` / `JUDGE_MAX_OUTPUT_TOKENS` hoặc giảm `*_EFFORT` |
| "… từ chối trả lời" | Bộ lọc an toàn của model | Diễn đạt lại vấn đề; với Claude, giữ `ANTHROPIC_REFUSAL_FALLBACK=true` |
| "… bị giới hạn tốc độ (429)" sau nhiều lần thử | Vượt rate limit tài khoản | Giảm `MAX_CONCURRENT_DEBATES`, `LLM_MAX_CONCURRENCY_PER_PROVIDER`; nâng tier tài khoản |
| Phiên bị đánh dấu "không có tiến triển trong 60 phút" | n8n bị dừng / khởi động lại giữa chừng | `docker compose ps`; chạy lại phiên (nút **Nhân bản**) |
| Xuất PDF lỗi | Image build không có Chromium (`WITH_PDF=false`) | Đặt `WITH_PDF=true`, `docker compose up -d --build`; tạm thời dùng nút **In** → "Lưu dưới dạng PDF" |
| Chi phí Muse hiển thị $0 | Meta trả `usage` khác định dạng giả định | Báo lại (kèm log); xem docs/API-VERIFICATION.md |
| Báo cáo có "⚠️ Cảnh báo: phán quyết chưa đầy đủ" | Trọng tài không trả JSON hợp lệ kể cả sau lần sửa | Báo cáo vẫn kèm phán quyết gốc; có thể chạy lại phiên |
| n8n log "Postgres 16 is outside the supported range" | Dùng image Postgres cũ | Mặc định đã là `postgres:17-alpine`; dữ liệu cũ cần `pg_dump`/`restore` khi nâng cấp phiên bản lớn |

Kiểm tra nhanh toàn hệ thống không tốn tiền: `./scripts/e2e.sh` (dùng mock API, chạy stack riêng, tự dọn dẹp).
