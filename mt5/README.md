# XAU Rebound Scalp – EA MT5 (bản nghiên cứu)

EA scalp XAUUSD dựa trên nảy hồi kỹ thuật tại vùng hỗ trợ/kháng cự mạnh.
**Chỉ dùng để backtest / demo trước.**

## Quy tắc đã lập trình

| Bước | Quy tắc | Tham số |
|---|---|---|
| 1 | Tìm đỉnh/đáy swing trên khung M5, 288 nến gần nhất (~24h) | `InpZoneTF`, `InpZoneLookback`, `InpSwingStrength` |
| 2 | Gom các đỉnh/đáy gần nhau thành vùng rộng 1.5 USD | `InpZoneWidth` |
| 3 | Đếm số lần giá chạm vùng (cách nhau ≥3 nến ở ngoài vùng mới tính là lần mới). Chỉ giữ vùng có **2–10 lần chạm** | `InpMinTouches`, `InpMaxTouches`, `InpTouchGapBars` |
| 4 | Nến M1 vừa đóng có râu đâm vào vùng (cho xuyên tối đa 1 USD), mở & đóng vẫn ở phía bên kia vùng | `InpMaxPierce` |
| 5 | Râu (trên cho Sell / dưới cho Buy) **> 50%** biên độ, thân **> 10%** biên độ | `InpMinWickPct`, `InpMinBodyPct` |
| 6 | Biên độ nến (H−L) **> trung bình biên độ 14 nến trước đó** | `InpATRPeriod`, `InpATRMult` |
| 7 | Đặt **Sell Limit / Buy Limit tại giữa nến**, SL = đỉnh (Sell) / đáy (Buy), TP = đầu còn lại | `InpEntryPct`, `InpSLBuffer`, `InpTPOffset` |
| 8 | Sau **2 phút** chưa khớp → hủy lệnh | `InpExpiryMinutes` |

Thêm: lọc spread (`InpMaxSpread`), chỉ 1 lệnh tại 1 thời điểm, lọc giờ, lot cố định hoặc theo % rủi ro.
Vùng được vẽ lên chart (hình chữ nhật vàng, rê chuột để xem số lần chạm).

## Cài đặt

1. MT5 → `File > Open Data Folder` → copy `XAU_ReboundScalp.mq5` vào `MQL5/Experts/`.
2. Mở MetaEditor, mở file, bấm **Compile** (F7).
3. Strategy Tester (Ctrl+R):
   - Expert: `XAU_ReboundScalp`, Symbol: `XAUUSD` (đúng tên của sàn, vd `XAUUSDm`, `GOLD`)
   - Modelling: **Every tick based on real ticks** (bắt buộc – lệnh chờ 2 phút và TP/SL trong 1 nến M1 cần tick thật, chế độ OHLC sẽ cho kết quả sai)
   - Timeframe chart: M1 (EA luôn tự dùng M1 cho tín hiệu)
   - Bật **Visual mode** lần đầu để xem vùng và lệnh có đúng ý không.

> Lưu ý đơn vị: các tham số giá (`InpZoneWidth`, `InpMaxPierce`, `InpMaxSpread`, …) tính bằng **USD giá vàng**, không phải points. Ví dụ 1.50 = 1.5$ (150 points với sàn 2 chữ số).

## Những điểm cần nghiên cứu khi test

1. **Tỉ lệ R:R = 1:1 nhưng spread ăn vào cả 2 phía.** Sell khớp theo Bid, nhưng TP/SL đóng theo Ask → TP thực tế xa hơn, SL gần hơn 1 khoảng spread. Ví dụ nến 4$, spread 0.3$: lợi nhuận ~1.7$, lỗ ~2.3$ → **cần win rate > ~58%** mới hòa vốn. Thử `InpTPOffset = spread` để TP dễ khớp hơn, so sánh kết quả.
2. **Entry giữa nến có thể ít khớp.** Thử `InpEntryPct` = 30/40/50/60 — gần đỉnh hơn thì giá tốt hơn nhưng ít khớp hơn.
3. **Định nghĩa vùng.** Thử `InpZoneWidth` 1.0–3.0, `InpZoneTF` M5 vs M15, `InpSwingStrength` 2–5. Vùng quá hẹp → ít tín hiệu; quá rộng → vùng yếu.
4. **Số lần chạm 2–10**: thử giới hạn 3–6 để xem vùng "vừa đủ mạnh, chưa bị phá" có tốt hơn không.
5. **Bộ lọc ATR**: thử `InpATRMult` 1.2–1.5 (nến thật sự đột biến).
6. **Giờ giao dịch**: XAU phiên Á thường đi ngang, phiên Âu/Mỹ biến động mạnh. Bật `InpUseHours` và so sánh từng phiên. Tránh giờ tin (NFP, CPI, FOMC).
7. Dùng tab **Optimization** trong Strategy Tester để quét tham số, nhưng cẩn thận overfit: tối ưu trên 1 giai đoạn, kiểm tra lại trên giai đoạn khác (forward test).

## Log

Mỗi tín hiệu, lệnh đặt, lệnh hủy đều được in ra tab *Journal* của tester để đối chiếu.
