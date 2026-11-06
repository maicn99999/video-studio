# XAU Rebound Scalp – EA MT5 (bản nghiên cứu, v3)

EA scalp XAUUSD dựa trên nảy hồi kỹ thuật tại vùng hỗ trợ/kháng cự mạnh.
**Chỉ dùng để backtest / demo trước.**

| File | Mô tả |
|---|---|
| `XAU_ReboundScalp.mq5` | EA chính |
| `XRS_ExportNews.mq5` | Script xuất lịch tin CPI/NFP/FOMC ra file để EA dùng khi backtest |

## A. Vùng hỗ trợ / kháng cự mạnh – thang 100 điểm, chỉ dùng vùng > 70

EA dựng lại vùng mỗi nến H1 mới và mỗi ngày mới.

**Bước 1 – Thu thập mức giá** (chỉ lấy các mức cách giá ≤ 2 × ATR(D1)):
- Đỉnh/đáy swing (fractal) trên **W1, D1, H4, H1, M15**
- Đỉnh/đáy **tuần trước**, đỉnh/đáy **ngày trước**, **giá đóng** ngày trước, **giá mở cửa** hôm nay
- **Số tròn** tâm lý: bội 50$ (lớn), bội 10$ (nhỏ)

**Bước 2 – Gom vùng:** các mức nằm trong 1 độ rộng vùng (= 0.3 × ATR(H1), giới hạn 1.5–8$) gom thành 1 vùng.

**Bước 3 – Chấm điểm:**

| # | Thành phần | Điểm | Cách tính |
|---|---|---|---|
| 1 | Cấu trúc khung lớn | 0–30 | Khung cao nhất có swing trong vùng: W1 30 · D1 28 · H4 22 · H1 15 · M15 7 |
| 2 | Mức giá then chốt | 0–20 | Mức mạnh nhất: tuần trước 20 · ngày trước 16 · số tròn 50 12 · đóng ngày trước 8 · mở cửa ngày 8 · số tròn 10 4; mỗi mức trùng thêm +4 |
| 3 | Hợp lưu | 0–15 | Số nguồn khác nhau trùng tại vùng: 2 nguồn 7 · 3 nguồn 11 · ≥4 nguồn 15 |
| 4 | Bị từ chối trên H1 | 0–20 | Mỗi nến H1 chạm vùng, râu ≥ 40% rồi đóng cửa bật ra khỏi vùng: +4 (240 nến H1 gần nhất) |
| 5 | Lực bật | 0–10 | Quãng giá bật ra xa nhất trong 6 nến H1 sau lần bị từ chối; bật ≥ 3 × ATR(H1) = 10 điểm |
| 6 | Độ mới | 0–5 | Lần bị từ chối gần nhất trong 24h: 5 · trong 72h: 3 |
| 7 | Trừ điểm | 0 đến −15 | Mỗi lần nến H1 đóng cửa xuyên từ bên này sang bên kia vùng: −3 (lần đầu không trừ, vì có thể là đổi vai kháng cự ↔ hỗ trợ) |

Ví dụ một vùng đạt 70+: swing H4 (22) + đỉnh ngày trước + số tròn 50 (16 + 4 = 20) + 3 nguồn (11) + 3 lần bị từ chối (12) + lực bật 2 ATR (7) = **72 điểm**.

Mỗi lần cập nhật, Journal in danh sách vùng kèm điểm từng thành phần. Trên chart: vùng **đỏ** = kháng cự, **xanh** = hỗ trợ, số bên phải là điểm, rê chuột để xem chi tiết.
Mọi điểm số đều là tham số input, chỉnh được.

## B. Quy tắc vào lệnh (nến M5 vừa đóng)

| Quy tắc | Tham số |
|---|---|
| Râu nến M5 đâm vào vùng (xuyên quá mép tối đa 0.5 × độ rộng vùng), giá mở & đóng vẫn ở ngoài phía bên kia | `InpMaxPierce` |
| Kháng cự: râu trên > 50%; Hỗ trợ: râu dưới > 50%; thân > 10% | `InpMinWickPct`, `InpMinBodyPct` |
| Biên độ nến > trung bình biên độ 14 nến M5 trước đó | `InpATRPeriod`, `InpATRMult` |
| **SELL chỉ khi giá đi lên chạm kháng cự**: trong 6 nến M5 trước, giá từng ở dưới mép dưới vùng ≥ 0.5 × độ rộng vùng và chưa có nến nào đóng cửa trên vùng. BUY ngược lại | `InpRequireApproach`, `InpApproachBars`, `InpApproachDist` |
| Lệnh Limit ở giữa nến, SL = đỉnh (Sell) / đáy (Buy), TP = đầu kia | `InpEntryPct`, `InpSLBuffer`, `InpTPOffset` |
| **Hủy lệnh chờ sau 4 phút** không khớp | `InpExpiryMinutes` |

### Không vào lệnh liên tục khi giá giằng co trong vùng
1. **Khóa vùng:** đã đặt lệnh ở vùng nào thì khóa vùng đó, đến khi giá rời xa vùng ≥ 1 × độ rộng vùng (hoặc sau 24h) mới được giao dịch lại vùng đó.
2. **Lọc giằng co:** trong 12 nến M5 trước tín hiệu, nếu có > 3 nến đã nằm trong vùng thì bỏ qua (giá đang sideway trong vùng, không phải chạm rồi bật).

### Tạm dừng khi có tin CPI, NFP, FOMC
- Dừng **30 phút trước đến 30 phút sau** tin; hủy lệnh chờ khi bắt đầu giờ tin (tùy chọn đóng cả lệnh đang mở).
- **Chạy thật/demo:** EA đọc trực tiếp lịch kinh tế MT5 (tin USD, mức quan trọng cao, tên có chứa CPI / Nonfarm / FOMC / Fed Interest Rate).
- **Backtest:** lịch kinh tế không chạy trong Strategy Tester, nên cần làm 1 lần:
  1. Copy `XRS_ExportNews.mq5` vào `MQL5/Scripts/`, compile.
  2. Kéo script vào chart bất kỳ (tài khoản đang kết nối) → tạo file `MQL5/Files/XRS_news.csv`.
  3. EA tự đưa file này vào tester (`#property tester_file`). Journal sẽ in "Đã tải N tin…". Nếu thấy dòng CẢNH BÁO nghĩa là chưa có file.
- Thời gian trong lịch là giờ server của sàn, nên phải xuất file trên đúng sàn dùng để backtest.

## Cài đặt & test

1. MT5 → `File > Open Data Folder` → copy `XAU_ReboundScalp.mq5` vào `MQL5/Experts/`, `XRS_ExportNews.mq5` vào `MQL5/Scripts/`.
2. Mở MetaEditor, compile cả 2 (F7). Chạy script xuất tin (mục trên).
3. Strategy Tester (Ctrl+R):
   - Symbol: `XAUUSD` (đúng tên của sàn, vd `XAUUSDm`, `GOLD`), chart M5
   - Modelling: **Every tick based on real ticks** (bắt buộc – lệnh chờ 4 phút và TP/SL trong 1 nến M5 cần tick thật)
   - Bật **Visual mode** lần đầu để kiểm tra vùng và lệnh có đúng ý không.
   - Cần đủ lịch sử W1/D1 trước ngày bắt đầu test (vd test từ 2025 thì phải có dữ liệu từ 2024).

> Đơn vị: các tham số giá (`InpZoneMinWidth`, `InpMaxSpread`, `InpSLBuffer`, …) tính bằng **USD giá vàng**, không phải points.

Cuối mỗi lần test, Journal in thống kê: số tín hiệu, số lệnh chờ, tỉ lệ khớp, và số lần bỏ qua theo từng lý do (sai hướng, giằng co, vùng khóa, giờ tin).

## Những điểm cần nghiên cứu khi test

1. **Spread và R:R 1:1.** Sell khớp theo Bid nhưng TP/SL đóng theo Ask → lời ít hơn, lỗ nhiều hơn 1 khoảng spread. Nến M5 lớn hơn M1 nên tỉ lệ spread/biên độ nhỏ hơn, có lợi. Vẫn cần win rate > 50% đáng kể mới có lãi.
2. **Ngưỡng 70 điểm:** xem trong Journal có bao nhiêu vùng > 70 mỗi lần cập nhật. Nếu thường xuyên 0 vùng → hạ trọng số hoặc ngưỡng; nếu quá nhiều → tăng ngưỡng.
3. **Entry giữa nến:** thử `InpEntryPct` 40/50/60 để cân bằng giá vào và tỉ lệ khớp.
4. **Bộ lọc ATR:** thử `InpATRMult` 1.2–1.5.
5. **Giờ giao dịch:** so sánh phiên Á vs Âu/Mỹ bằng `InpUseHours`.
6. Tối ưu tham số trên 1 giai đoạn rồi kiểm tra lại trên giai đoạn khác để tránh overfit.
