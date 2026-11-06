# XAU Rebound Scalp – EA MT5 (bản nghiên cứu)

EA scalp XAUUSD dựa trên nảy hồi kỹ thuật tại vùng hỗ trợ/kháng cự mạnh.
**Chỉ dùng để backtest / demo trước.**

## Quy tắc đã lập trình (v2)

### A. Vùng hỗ trợ / kháng cự đa khung, có chấm điểm

Mỗi giờ (nến H1 mới) và mỗi ngày mới EA dựng lại vùng:

| Nguồn | Trọng số mặc định |
|---|---|
| Đỉnh/đáy swing **D1** (fractal 2 nến mỗi bên, 60 ngày) | 5 |
| Đỉnh/đáy swing **H4** (3 nến mỗi bên, 180 nến) | 4 |
| Đỉnh/đáy swing **H1** (3 nến mỗi bên, 240 nến) | 3 |
| Đỉnh/đáy swing **M15** (4 nến mỗi bên, 300 nến) | 1.5 |
| Đỉnh/đáy **tuần trước** | 5 |
| Đỉnh/đáy **ngày trước** | 4 |
| Giá đóng ngày trước / giá mở cửa hôm nay | 2 / 2 |
| Số tròn lớn (bội 50$) / nhỏ (bội 10$) | 3 / 1 |

- Các mức nằm gần nhau (trong 1 độ rộng vùng = **0.25 × ATR(H1)**, giới hạn 1–5$) được gom thành 1 vùng.
- **Điểm vùng** = tổng trọng số các nguồn (mỗi nguồn tính 1 lần) + **2 điểm cho mỗi nguồn hợp lưu thêm** + **1 điểm cho mỗi lần giá đã bị từ chối** tại vùng trên H1 (tối đa 5).
- Chỉ xét các mức cách giá ≤ 1.5 × ATR(D1). Giữ vùng có điểm ≥ ngưỡng, tối đa 8 vùng mạnh nhất.
- Ví dụ: đỉnh H4 + đỉnh ngày trước + số tròn 50 → 4 + 4 + 3 + 2×2 = 15 điểm, cộng thêm số lần phản ứng.

### B. Tần suất 2–10 lần chạm / ngày

- EA đếm số lần giá M1 chạm vào vùng mạnh trong ngày (ở ngoài vùng ≥15 phút rồi quay lại mới tính là lần mới).
- `InpAutoCalibrate = true`: cuối mỗi ngày, nếu > 10 lần chạm → **tăng** ngưỡng điểm 1 bậc (chỉ giữ vùng mạnh hơn); nếu < 2 lần → **giảm** 1 bậc. Ngưỡng nằm trong khoảng 5–20.
- Journal in mỗi ngày: số lần chạm, số lệnh, ngưỡng điểm. Kết thúc test in **thống kê tổng**: trung bình lần chạm/ngày, số ngày đạt mục tiêu, số tín hiệu, số lệnh, tỉ lệ khớp.

### C. Tín hiệu nến M1 & lệnh (giữ nguyên v1)

| Quy tắc | Tham số |
|---|---|
| Râu nến M1 đâm vào vùng (xuyên quá mép tối đa 0.5 × độ rộng vùng), giá mở & đóng vẫn ở ngoài phía bên kia | `InpMaxPierce` |
| Râu > 50%, thân > 10% biên độ nến | `InpMinWickPct`, `InpMinBodyPct` |
| Biên độ nến > trung bình biên độ 14 nến trước | `InpATRPeriod`, `InpATRMult` |
| Lệnh Limit ở giữa nến, SL = đỉnh (Sell) / đáy (Buy), TP = đầu kia | `InpEntryPct`, `InpSLBuffer`, `InpTPOffset` |
| Hủy sau 2 phút không khớp | `InpExpiryMinutes` |

Thêm: lọc spread, 1 lệnh/lúc, tối đa 10 lệnh/ngày, lọc giờ, lot cố định hoặc % rủi ro.
Trên chart: vùng **đỏ** = kháng cự (trên giá), **xanh** = hỗ trợ; số bên phải là điểm; rê chuột vào vùng để xem các nguồn hợp lưu.

## Cài đặt

1. MT5 → `File > Open Data Folder` → copy `XAU_ReboundScalp.mq5` vào `MQL5/Experts/`.
2. Mở MetaEditor, mở file, bấm **Compile** (F7).
3. Strategy Tester (Ctrl+R):
   - Expert: `XAU_ReboundScalp`, Symbol: `XAUUSD` (đúng tên của sàn, vd `XAUUSDm`, `GOLD`)
   - Modelling: **Every tick based on real ticks** (bắt buộc – lệnh chờ 2 phút và TP/SL trong 1 nến M1 cần tick thật, chế độ OHLC sẽ cho kết quả sai)
   - Timeframe chart: M1 (EA luôn tự dùng M1 cho tín hiệu)
   - Bật **Visual mode** lần đầu để xem vùng và lệnh có đúng ý không.

> Lưu ý đơn vị: các tham số giá (`InpZoneMinWidth`, `InpMaxSpread`, `InpSLBuffer`, …) tính bằng **USD giá vàng**, không phải points. Ví dụ 1.50 = 1.5$ (150 points với sàn 2 chữ số).

## Những điểm cần nghiên cứu khi test

1. **Tỉ lệ R:R = 1:1 nhưng spread ăn vào cả 2 phía.** Sell khớp theo Bid, nhưng TP/SL đóng theo Ask → TP thực tế xa hơn, SL gần hơn 1 khoảng spread. Ví dụ nến 4$, spread 0.3$: lợi nhuận ~1.7$, lỗ ~2.3$ → **cần win rate > ~58%** mới hòa vốn. Thử `InpTPOffset = spread` để TP dễ khớp hơn, so sánh kết quả.
2. **Entry giữa nến có thể ít khớp.** Thử `InpEntryPct` = 30/40/50/60 — gần đỉnh hơn thì giá tốt hơn nhưng ít khớp hơn.
3. **Định nghĩa vùng.** Thử `InpZoneWidthATR` 0.15–0.4, tắt/bật từng khung (`InpUseM15`…) và chỉnh trọng số để xem nguồn nào thật sự giúp tăng win rate. Có thể tắt auto-calibrate và đặt ngưỡng cố định để so sánh.
4. **Tần suất**: xem dòng thống kê cuối test – trung bình lần chạm/ngày có nằm trong 2–10 không. Nếu thường xuyên chạm trần/sàn ngưỡng (20/5), cần chỉnh lại trọng số.
5. **Bộ lọc ATR**: thử `InpATRMult` 1.2–1.5 (nến thật sự đột biến).
6. **Giờ giao dịch**: XAU phiên Á thường đi ngang, phiên Âu/Mỹ biến động mạnh. Bật `InpUseHours` và so sánh từng phiên. Tránh giờ tin (NFP, CPI, FOMC).
7. Dùng tab **Optimization** trong Strategy Tester để quét tham số, nhưng cẩn thận overfit: tối ưu trên 1 giai đoạn, kiểm tra lại trên giai đoạn khác (forward test).

## Log

Mỗi tín hiệu, lệnh đặt, lệnh hủy đều được in ra tab *Journal* của tester để đối chiếu.
