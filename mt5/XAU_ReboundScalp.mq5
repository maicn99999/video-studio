//+------------------------------------------------------------------+
//|                                            XAU_ReboundScalp.mq5  |
//|  Scalp XAUUSD theo nảy hồi kỹ thuật tại vùng S/R mạnh đa khung   |
//|                                                                  |
//|  A. Xác định vùng S/R (đa khung, chấm điểm):                     |
//|     - Đỉnh/đáy swing: D1, H4, H1, M15                            |
//|     - Đỉnh/đáy tuần trước, ngày trước, giá đóng ngày trước,      |
//|       giá mở cửa ngày                                            |
//|     - Số tròn tâm lý (50$, 10$)                                  |
//|     - Gom các mức gần nhau (độ rộng theo ATR H1) thành vùng       |
//|     - Điểm = tổng trọng số nguồn + thưởng hợp lưu nhiều nguồn     |
//|              + số lần giá đã phản ứng (rejection) trên H1         |
//|     - Chỉ giữ vùng có điểm >= ngưỡng, tối đa N vùng mạnh nhất     |
//|  B. Tần suất: mục tiêu 2-10 lần chạm vùng mạnh / ngày.            |
//|     EA đếm số lần chạm mỗi ngày, tự nâng/hạ ngưỡng điểm           |
//|     (auto-calibrate) để giữ tần suất trong khoảng mục tiêu.       |
//|  C. Tín hiệu M1 (nến vừa đóng) tại vùng:                          |
//|     - Râu (trên với kháng cự / dưới với hỗ trợ) > 50% nến        |
//|     - Thân > 10% nến                                             |
//|     - Biên độ nến > trung bình biên độ 14 nến trước               |
//|  D. Lệnh Limit giữa nến, SL/TP ở 2 đầu nến, hủy sau 2 phút.       |
//+------------------------------------------------------------------+
#property copyright "XAU Rebound Scalp - research version"
#property version   "2.00"
#property description "Scalp XAU: vùng S/R đa khung có chấm điểm, nến M1 rút chân, lệnh Limit giữa nến"

#include <Trade\Trade.mqh>

//====================== INPUTS ======================================
input group "=== Swing đa khung (bật / số nến nhìn lại / độ mạnh fractal / trọng số) ==="
input bool   InpUseD1        = true;  // Dùng swing D1
input int    InpD1Lookback   = 60;    //   D1: số nến nhìn lại
input int    InpD1Strength   = 2;     //   D1: số nến mỗi bên
input double InpWD1          = 5.0;   //   D1: trọng số
input bool   InpUseH4        = true;  // Dùng swing H4
input int    InpH4Lookback   = 180;   //   H4: số nến nhìn lại
input int    InpH4Strength   = 3;     //   H4: số nến mỗi bên
input double InpWH4          = 4.0;   //   H4: trọng số
input bool   InpUseH1        = true;  // Dùng swing H1
input int    InpH1Lookback   = 240;   //   H1: số nến nhìn lại
input int    InpH1Strength   = 3;     //   H1: số nến mỗi bên
input double InpWH1          = 3.0;   //   H1: trọng số
input bool   InpUseM15       = true;  // Dùng swing M15
input int    InpM15Lookback  = 300;   //   M15: số nến nhìn lại
input int    InpM15Strength  = 4;     //   M15: số nến mỗi bên
input double InpWM15         = 1.5;   //   M15: trọng số

input group "=== Mức giá quan trọng ==="
input double InpWPrevWeek    = 5.0;   // Trọng số đỉnh/đáy tuần trước
input double InpWPrevDay     = 4.0;   // Trọng số đỉnh/đáy ngày trước
input double InpWPrevClose   = 2.0;   // Trọng số giá đóng cửa ngày trước
input double InpWDayOpen     = 2.0;   // Trọng số giá mở cửa ngày hôm nay
input double InpRoundMajor   = 50.0;  // Số tròn lớn (bước giá, 0 = tắt)
input double InpWRoundMajor  = 3.0;   //   trọng số
input double InpRoundMinor   = 10.0;  // Số tròn nhỏ (bước giá, 0 = tắt)
input double InpWRoundMinor  = 1.0;   //   trọng số

input group "=== Gom vùng & chấm điểm ==="
input double InpZoneWidthATR   = 0.25; // Độ rộng vùng = ATR(H1) x hệ số
input double InpZoneMinWidth   = 1.0;  // Độ rộng tối thiểu (USD)
input double InpZoneMaxWidth   = 5.0;  // Độ rộng tối đa (USD)
input double InpMaxDistATR     = 1.5;  // Chỉ xét mức cách giá <= ATR(D1) x hệ số
input double InpConfluenceBonus= 2.0;  // Thưởng điểm cho mỗi nguồn hợp lưu thêm
input int    InpReactionBars   = 240;  // Số nến H1 để đếm phản ứng giá
input double InpReactionWeight = 1.0;  // Điểm cho mỗi lần phản ứng
input int    InpReactionCap    = 5;    // Tối đa số lần phản ứng được tính
input int    InpMaxZones       = 8;    // Số vùng mạnh nhất tối đa được giữ
input bool   InpDrawZones      = true; // Vẽ vùng lên chart

input group "=== Tần suất mục tiêu (lần chạm vùng mạnh / ngày) ==="
input double InpMinScore       = 9.0;  // Ngưỡng điểm ban đầu
input bool   InpAutoCalibrate  = true; // Tự điều chỉnh ngưỡng theo tần suất
input int    InpTargetMinTouch = 2;    // Mục tiêu tối thiểu lần chạm / ngày
input int    InpTargetMaxTouch = 10;   // Mục tiêu tối đa lần chạm / ngày
input double InpScoreStep      = 1.0;  // Bước tăng/giảm ngưỡng mỗi ngày
input double InpScoreFloor     = 5.0;  // Ngưỡng thấp nhất
input double InpScoreCeil      = 20.0; // Ngưỡng cao nhất
input int    InpTouchGapMin    = 15;   // Ở ngoài vùng >= N phút mới tính lần chạm mới

input group "=== Tín hiệu nến M1 ==="
input double InpMinWickPct   = 50.0;  // Râu tối thiểu (% biên độ nến)
input double InpMinBodyPct   = 10.0;  // Thân tối thiểu (% biên độ nến)
input int    InpATRPeriod    = 14;    // Số nến tính độ dài trung bình
input double InpATRMult      = 1.0;   // Nến tín hiệu phải > trung bình x hệ số
input double InpMaxPierce    = 0.5;   // Râu xuyên quá mép vùng tối đa (x độ rộng vùng)
input bool   InpAllowSell    = true;  // Cho phép Sell tại kháng cự
input bool   InpAllowBuy     = true;  // Cho phép Buy tại hỗ trợ

input group "=== Lệnh ==="
input double InpLots          = 0.01;  // Khối lượng cố định
input double InpRiskPercent   = 0.0;   // >0: tính lot theo % rủi ro balance
input double InpEntryPct      = 50.0;  // Vị trí entry trong nến (50 = giữa nến)
input double InpSLBuffer      = 0.0;   // Cộng thêm vào SL (USD)
input double InpTPOffset      = 0.0;   // Kéo TP vào trong (USD)
input int    InpExpiryMinutes = 2;     // Hủy lệnh chờ sau N phút
input double InpMaxSpread     = 0.50;  // Spread tối đa (USD)
input bool   InpOneTradeOnly  = true;  // Chỉ 1 lệnh tại 1 thời điểm
input int    InpMaxTradesDay  = 10;    // Số lệnh chờ tối đa / ngày
input ulong  InpMagic         = 20261106; // Magic number

input group "=== Giờ giao dịch (giờ server) ==="
input bool   InpUseHours      = false; // Bật lọc giờ
input int    InpStartHour     = 8;     // Giờ bắt đầu
input int    InpEndHour       = 22;    // Giờ kết thúc

//====================== TYPES / GLOBALS =============================
enum ESrc
  {
   SRC_D1 = 0, SRC_H4, SRC_H1, SRC_M15,
   SRC_PWEEK, SRC_PDAY, SRC_PCLOSE, SRC_DOPEN,
   SRC_RMAJOR, SRC_RMINOR, SRC_COUNT
  };
string SRC_NAME[] = {"D1","H4","H1","M15","PrevWeek","PrevDay","PrevClose","DayOpen","Round","RoundMinor"};

struct SLevel { double price; double weight; int src; };
struct SZone
  {
   double lo, hi, center, score, baseScore;
   int    srcMask, reactions;
  };
struct STouch { double price; datetime time; };

CTrade   trade;
SLevel   g_levels[];
SZone    g_zones[];
STouch   g_touches[];
int      g_hATRH1 = INVALID_HANDLE, g_hATRD1 = INVALID_HANDLE;
double   g_zoneWidth = 0, g_maxDist = 0, g_refPrice = 0;
double   g_minScore  = 0;
datetime g_lastM1Bar = 0, g_lastH1Bar = 0, g_curDay = 0;
int      g_todayTouches = 0, g_todayTrades = 0;
// thống kê
int      g_days = 0, g_totalTouches = 0, g_daysInTarget = 0;
int      g_signals = 0, g_ordersPlaced = 0, g_fills = 0;
const string OBJ_PREFIX = "XRS_";

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);

   if(InpATRPeriod < 1 || InpTargetMinTouch > InpTargetMaxTouch || InpMaxZones < 1)
      return(INIT_PARAMETERS_INCORRECT);

   g_hATRH1 = iATR(_Symbol, PERIOD_H1, 14);
   g_hATRD1 = iATR(_Symbol, PERIOD_D1, 14);
   if(g_hATRH1 == INVALID_HANDLE || g_hATRD1 == INVALID_HANDLE)
      return(INIT_FAILED);

   g_minScore = InpMinScore;
   g_curDay   = iTime(_Symbol, PERIOD_D1, 0);
   BuildZones();
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, OBJ_PREFIX);
   if(g_hATRH1 != INVALID_HANDLE) IndicatorRelease(g_hATRH1);
   if(g_hATRD1 != INVALID_HANDLE) IndicatorRelease(g_hATRD1);

   PrintFormat("===== THỐNG KÊ XRS ===== Số ngày: %d | TB lần chạm vùng mạnh/ngày: %.1f | Ngày đạt mục tiêu %d-%d: %d",
               g_days, g_days > 0 ? (double)g_totalTouches / g_days : 0.0,
               InpTargetMinTouch, InpTargetMaxTouch, g_daysInTarget);
   PrintFormat("Tín hiệu: %d | Lệnh chờ đặt: %d | Khớp: %d (%.0f%%) | Ngưỡng điểm cuối: %.1f",
               g_signals, g_ordersPlaced, g_fills,
               g_ordersPlaced > 0 ? 100.0 * g_fills / g_ordersPlaced : 0.0, g_minScore);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   CancelExpiredOrders();

   //--- Ngày mới: thống kê + tự điều chỉnh ngưỡng
   datetime d = iTime(_Symbol, PERIOD_D1, 0);
   if(d != 0 && d != g_curDay)
     {
      OnNewDay();
      g_curDay = d;
      BuildZones();
     }

   //--- Cập nhật vùng mỗi nến H1 mới
   datetime h = iTime(_Symbol, PERIOD_H1, 0);
   if(h != g_lastH1Bar)
     {
      g_lastH1Bar = h;
      BuildZones();
     }

   //--- Nến M1 vừa đóng
   datetime m = iTime(_Symbol, PERIOD_M1, 0);
   if(m == 0 || m == g_lastM1Bar)
      return;
   g_lastM1Bar = m;

   MqlRates bars[];
   ArraySetAsSeries(bars, true);
   int need = InpATRPeriod + 1;
   if(CopyRates(_Symbol, PERIOD_M1, 1, need, bars) < need)
      return;

   TrackTouches(bars[0]);
   CheckSignal(bars);
  }

//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;
   if(!HistoryDealSelect(trans.deal))
      return;
   if((ulong)HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != InpMagic)
      return;
   if(HistoryDealGetInteger(trans.deal, DEAL_ENTRY) == DEAL_ENTRY_IN)
      g_fills++;
  }

//====================== NGÀY MỚI / TẦN SUẤT ========================
void OnNewDay()
  {
   if(g_curDay == 0)
      return;
   g_days++;
   g_totalTouches += g_todayTouches;
   bool inTarget = (g_todayTouches >= InpTargetMinTouch && g_todayTouches <= InpTargetMaxTouch);
   if(inTarget) g_daysInTarget++;

   double old = g_minScore;
   if(InpAutoCalibrate)
     {
      if(g_todayTouches > InpTargetMaxTouch)      g_minScore += InpScoreStep;
      else if(g_todayTouches < InpTargetMinTouch) g_minScore -= InpScoreStep;
      g_minScore = MathMax(InpScoreFloor, MathMin(InpScoreCeil, g_minScore));
     }
   PrintFormat("Ngày %s: %d lần chạm vùng mạnh, %d lệnh chờ | ngưỡng điểm %.1f -> %.1f",
               TimeToString(g_curDay, TIME_DATE), g_todayTouches, g_todayTrades, old, g_minScore);
   g_todayTouches = 0;
   g_todayTrades  = 0;
  }

//+------------------------------------------------------------------+
//| Đếm lần chạm: nến M1 chạm vùng mạnh, đã ở ngoài vùng >= gap phút |
//+------------------------------------------------------------------+
void TrackTouches(const MqlRates &bar)
  {
   // bỏ các lần chạm cũ
   int n = ArraySize(g_touches), k = 0;
   for(int i = 0; i < n; i++)
      if(bar.time - g_touches[i].time < 86400)
         g_touches[k++] = g_touches[i];
   ArrayResize(g_touches, k);

   for(int z = 0; z < ArraySize(g_zones); z++)
     {
      if(bar.high < g_zones[z].lo || bar.low > g_zones[z].hi)
         continue;
      bool recent = false;
      for(int t = 0; t < ArraySize(g_touches); t++)
        {
         if(MathAbs(g_touches[t].price - g_zones[z].center) <= g_zoneWidth &&
            bar.time - g_touches[t].time < InpTouchGapMin * 60)
           {
            g_touches[t].time = bar.time; // giá vẫn lởn vởn trong vùng -> cùng 1 lần chạm
            recent = true;
            break;
           }
        }
      if(!recent)
        {
         int s = ArraySize(g_touches);
         ArrayResize(g_touches, s + 1);
         g_touches[s].price = g_zones[z].center;
         g_touches[s].time  = bar.time;
         g_todayTouches++;
        }
     }
  }

//====================== XÂY DỰNG VÙNG ==============================
double GetBuf(int handle)
  {
   double b[];
   if(CopyBuffer(handle, 0, 1, 1, b) != 1) return 0;
   return b[0];
  }

void AddLevel(double price, double weight, int src)
  {
   if(price <= 0 || weight <= 0) return;
   if(MathAbs(price - g_refPrice) > g_maxDist) return;
   int n = ArraySize(g_levels);
   ArrayResize(g_levels, n + 1);
   g_levels[n].price  = price;
   g_levels[n].weight = weight;
   g_levels[n].src    = src;
  }

void AddSwings(ENUM_TIMEFRAMES tf, int lookback, int s, double weight, int src)
  {
   MqlRates r[];
   ArraySetAsSeries(r, true);
   int got = CopyRates(_Symbol, tf, 1, lookback, r);
   if(got < 2 * s + 1) return;
   for(int i = s; i < got - s; i++)
     {
      bool isHigh = true, isLow = true;
      for(int k = 1; k <= s; k++)
        {
         // r[i-k] mới hơn, r[i+k] cũ hơn
         if(r[i].high <= r[i - k].high || r[i].high < r[i + k].high) isHigh = false;
         if(r[i].low  >= r[i - k].low  || r[i].low  > r[i + k].low)  isLow  = false;
         if(!isHigh && !isLow) break;
        }
      if(isHigh) AddLevel(r[i].high, weight, src);
      if(isLow)  AddLevel(r[i].low,  weight, src);
     }
  }

void AddRoundLevels(double step, double weight, int src, double skipStep)
  {
   if(step <= 0) return;
   double p = MathFloor((g_refPrice - g_maxDist) / step) * step;
   for(; p <= g_refPrice + g_maxDist; p += step)
     {
      if(skipStep > 0)
        {
         double r = MathMod(p, skipStep);
         if(r < 1e-6 || skipStep - r < 1e-6) continue; // đã có ở số tròn lớn
        }
      AddLevel(p, weight, src);
     }
  }

int BitCount(int m) { int c = 0; while(m) { c += (m & 1); m >>= 1; } return c; }

void BuildZones()
  {
   ArrayResize(g_levels, 0);
   ArrayResize(g_zones, 0);

   double atrH1 = GetBuf(g_hATRH1);
   double atrD1 = GetBuf(g_hATRD1);
   if(atrH1 <= 0 || atrD1 <= 0)
      return;
   g_zoneWidth = MathMax(InpZoneMinWidth, MathMin(InpZoneMaxWidth, atrH1 * InpZoneWidthATR));
   g_maxDist   = atrD1 * InpMaxDistATR;
   g_refPrice  = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(g_refPrice <= 0) return;

   //--- 1. Thu thập mức giá từ các nguồn
   if(InpUseD1)  AddSwings(PERIOD_D1,  InpD1Lookback,  InpD1Strength,  InpWD1,  SRC_D1);
   if(InpUseH4)  AddSwings(PERIOD_H4,  InpH4Lookback,  InpH4Strength,  InpWH4,  SRC_H4);
   if(InpUseH1)  AddSwings(PERIOD_H1,  InpH1Lookback,  InpH1Strength,  InpWH1,  SRC_H1);
   if(InpUseM15) AddSwings(PERIOD_M15, InpM15Lookback, InpM15Strength, InpWM15, SRC_M15);

   AddLevel(iHigh(_Symbol, PERIOD_W1, 1), InpWPrevWeek, SRC_PWEEK);
   AddLevel(iLow (_Symbol, PERIOD_W1, 1), InpWPrevWeek, SRC_PWEEK);
   AddLevel(iHigh(_Symbol, PERIOD_D1, 1), InpWPrevDay,  SRC_PDAY);
   AddLevel(iLow (_Symbol, PERIOD_D1, 1), InpWPrevDay,  SRC_PDAY);
   AddLevel(iClose(_Symbol, PERIOD_D1, 1), InpWPrevClose, SRC_PCLOSE);
   AddLevel(iOpen (_Symbol, PERIOD_D1, 0), InpWDayOpen,   SRC_DOPEN);

   AddRoundLevels(InpRoundMajor, InpWRoundMajor, SRC_RMAJOR, 0);
   AddRoundLevels(InpRoundMinor, InpWRoundMinor, SRC_RMINOR, InpRoundMajor);

   int nlv = ArraySize(g_levels);
   if(nlv == 0) return;

   //--- 2. Sắp xếp theo giá (insertion sort)
   for(int i = 1; i < nlv; i++)
     {
      SLevel key = g_levels[i];
      int j = i - 1;
      while(j >= 0 && g_levels[j].price > key.price) { g_levels[j + 1] = g_levels[j]; j--; }
      g_levels[j + 1] = key;
     }

   //--- 3. Gom cụm -> vùng ứng viên
   SZone cand[];
   int nc = 0, i0 = 0;
   while(i0 < nlv)
     {
      double wsum = 0, psum = 0;
      int    mask = 0;
      int    j    = i0;
      // cùng 1 nguồn trong 1 cụm chỉ cộng trọng số 1 lần (tránh 1 khung "đếm trùng")
      double srcW[10];
      ArrayInitialize(srcW, 0);
      while(j < nlv && g_levels[j].price - g_levels[i0].price <= g_zoneWidth)
        {
         psum += g_levels[j].price * g_levels[j].weight;
         wsum += g_levels[j].weight;
         mask |= (1 << g_levels[j].src);
         srcW[g_levels[j].src] = MathMax(srcW[g_levels[j].src], g_levels[j].weight);
         j++;
        }
      double base = 0;
      for(int s = 0; s < SRC_COUNT; s++) base += srcW[s];
      base += InpConfluenceBonus * (BitCount(mask) - 1);

      ArrayResize(cand, nc + 1);
      cand[nc].center    = psum / wsum;
      cand[nc].lo        = cand[nc].center - g_zoneWidth / 2.0;
      cand[nc].hi        = cand[nc].center + g_zoneWidth / 2.0;
      cand[nc].srcMask   = mask;
      cand[nc].baseScore = base;
      cand[nc].reactions = 0;
      cand[nc].score     = base;
      nc++;
      i0 = j;
     }

   //--- 4. Đếm số lần giá phản ứng (rejection) tại vùng trên H1
   MqlRates h1[];
   ArraySetAsSeries(h1, true);
   int gotH1 = CopyRates(_Symbol, PERIOD_H1, 1, InpReactionBars, h1);
   for(int z = 0; z < nc; z++)
     {
      int react = 0, lastIdx = -100;
      for(int b = gotH1 - 1; b >= 0; b--)
        {
         bool rejDown = (h1[b].high >= cand[z].lo && h1[b].close < cand[z].lo); // chạm & bị đẩy xuống
         bool rejUp   = (h1[b].low  <= cand[z].hi && h1[b].close > cand[z].hi); // chạm & bị đẩy lên
         if((rejDown || rejUp) && (lastIdx - b > 2 || lastIdx < 0))
           {
            react++;
            lastIdx = b;
           }
        }
      cand[z].reactions = react;
      cand[z].score = cand[z].baseScore + InpReactionWeight * MathMin(react, InpReactionCap);
     }

   //--- 5. Lọc theo ngưỡng điểm, giữ top N
   for(int z = 0; z < nc; z++)
     {
      if(cand[z].score < g_minScore) continue;
      int n = ArraySize(g_zones);
      ArrayResize(g_zones, n + 1);
      g_zones[n] = cand[z];
     }
   int nz = ArraySize(g_zones);
   for(int a = 1; a < nz; a++)
     {
      SZone key = g_zones[a];
      int b = a - 1;
      while(b >= 0 && g_zones[b].score < key.score) { g_zones[b + 1] = g_zones[b]; b--; }
      g_zones[b + 1] = key;
     }
   if(nz > InpMaxZones) ArrayResize(g_zones, InpMaxZones);

   if(InpDrawZones && !MQLInfoInteger(MQL_OPTIMIZATION))
      DrawZones();
  }

//+------------------------------------------------------------------+
string ZoneDesc(const SZone &z)
  {
   string s = "";
   for(int i = 0; i < SRC_COUNT; i++)
      if((z.srcMask & (1 << i)) != 0)
         s += (s == "" ? "" : "+") + SRC_NAME[i];
   return StringFormat("%.2f-%.2f | điểm %.1f | %s | %d phản ứng H1", z.lo, z.hi, z.score, s, z.reactions);
  }

void DrawZones()
  {
   ObjectsDeleteAll(0, OBJ_PREFIX);
   datetime t1 = TimeCurrent() - 86400;
   datetime t2 = TimeCurrent() + 3600 * 3;
   for(int i = 0; i < ArraySize(g_zones); i++)
     {
      string name = OBJ_PREFIX + "Z" + IntegerToString(i);
      color  c    = (g_zones[i].center > g_refPrice) ? clrIndianRed : clrSeaGreen;
      ObjectCreate(0, name, OBJ_RECTANGLE, 0, t1, g_zones[i].hi, t2, g_zones[i].lo);
      ObjectSetInteger(0, name, OBJPROP_COLOR, c);
      ObjectSetInteger(0, name, OBJPROP_FILL, true);
      ObjectSetInteger(0, name, OBJPROP_BACK, true);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetString (0, name, OBJPROP_TOOLTIP, ZoneDesc(g_zones[i]));

      string lbl = OBJ_PREFIX + "L" + IntegerToString(i);
      ObjectCreate(0, lbl, OBJ_TEXT, 0, t2, g_zones[i].hi);
      ObjectSetString (0, lbl, OBJPROP_TEXT, StringFormat("%.1f", g_zones[i].score));
      ObjectSetInteger(0, lbl, OBJPROP_COLOR, c);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE, 8);
      ObjectSetInteger(0, lbl, OBJPROP_SELECTABLE, false);
     }
   ChartRedraw();
  }

//====================== TÍN HIỆU ===================================
void CheckSignal(const MqlRates &m[])
  {
   if(ArraySize(g_zones) == 0) return;
   if(InpUseHours && !InTradingHours()) return;
   if(g_todayTrades >= InpMaxTradesDay) return;
   if(InpOneTradeOnly && HasOwnOrderOrPosition()) return;

   double H = m[0].high, L = m[0].low, O = m[0].open, C = m[0].close;
   double range = H - L;
   if(range <= 0) return;

   double avg = 0;
   for(int k = 1; k <= InpATRPeriod; k++)
      avg += m[k].high - m[k].low;
   avg /= InpATRPeriod;
   if(range <= avg * InpATRMult) return;

   double body  = MathAbs(C - O);
   double upper = H - MathMax(O, C);
   double lower = MathMin(O, C) - L;
   bool bodyOK  = body > range * InpMinBodyPct / 100.0;
   bool sellPat = InpAllowSell && bodyOK && upper > range * InpMinWickPct / 100.0;
   bool buyPat  = InpAllowBuy  && bodyOK && lower > range * InpMinWickPct / 100.0;
   if(!sellPat && !buyPat) return;

   double pierce = g_zoneWidth * InpMaxPierce;
   for(int i = 0; i < ArraySize(g_zones); i++)
     {
      double zlo = g_zones[i].lo, zhi = g_zones[i].hi;
      // Kháng cự: râu trên đâm vào vùng từ dưới lên, mở & đóng dưới mép trên
      if(sellPat && H >= zlo && H <= zhi + pierce && C < zhi && O < zhi)
        {
         g_signals++;
         PrintFormat("SELL signal %s | H=%.2f L=%.2f range=%.2f avg=%.2f | %s",
                     TimeToString(m[0].time), H, L, range, avg, ZoneDesc(g_zones[i]));
         PlaceOrder(false, H, L);
         return;
        }
      // Hỗ trợ: râu dưới đâm vào vùng từ trên xuống, mở & đóng trên mép dưới
      if(buyPat && L <= zhi && L >= zlo - pierce && C > zlo && O > zlo)
        {
         g_signals++;
         PrintFormat("BUY signal %s | H=%.2f L=%.2f range=%.2f avg=%.2f | %s",
                     TimeToString(m[0].time), H, L, range, avg, ZoneDesc(g_zones[i]));
         PlaceOrder(true, H, L);
         return;
        }
     }
  }

//====================== LỆNH =======================================
void PlaceOrder(bool isBuy, double H, double L)
  {
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(ask - bid > InpMaxSpread)
     {
      PrintFormat("Bỏ qua: spread %.2f > %.2f", ask - bid, InpMaxSpread);
      return;
     }

   double range = H - L;
   double entry, sl, tp;
   if(isBuy)
     {
      entry = H - range * InpEntryPct / 100.0;
      sl    = L - InpSLBuffer;
      tp    = H - InpTPOffset;
     }
   else
     {
      entry = L + range * InpEntryPct / 100.0;
      sl    = H + InpSLBuffer;
      tp    = L + InpTPOffset;
     }
   entry = NormPrice(entry);
   sl    = NormPrice(sl);
   tp    = NormPrice(tp);

   double minDist = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(isBuy)
     {
      if(entry >= ask - minDist) { Print("Bỏ qua: giá đã ở dưới/sát entry Buy Limit"); return; }
      if(entry - sl < minDist || tp - entry < minDist) { Print("Bỏ qua: SL/TP quá gần (stops level)"); return; }
     }
   else
     {
      if(entry <= bid + minDist) { Print("Bỏ qua: giá đã ở trên/sát entry Sell Limit"); return; }
      if(sl - entry < minDist || entry - tp < minDist) { Print("Bỏ qua: SL/TP quá gần (stops level)"); return; }
     }

   double lots = CalcLots(MathAbs(entry - sl));
   if(lots <= 0) return;

   ENUM_ORDER_TYPE_TIME ttype = ORDER_TIME_GTC;
   datetime expiry = 0;
   int expMode = (int)SymbolInfoInteger(_Symbol, SYMBOL_EXPIRATION_MODE);
   if((expMode & SYMBOL_EXPIRATION_SPECIFIED) == SYMBOL_EXPIRATION_SPECIFIED)
     {
      ttype  = ORDER_TIME_SPECIFIED;
      expiry = TimeCurrent() + InpExpiryMinutes * 60;
     }

   bool ok = isBuy ? trade.BuyLimit (lots, entry, _Symbol, sl, tp, ttype, expiry, "XRS buy")
                   : trade.SellLimit(lots, entry, _Symbol, sl, tp, ttype, expiry, "XRS sell");
   if(!ok && ttype == ORDER_TIME_SPECIFIED)
      ok = isBuy ? trade.BuyLimit (lots, entry, _Symbol, sl, tp, ORDER_TIME_GTC, 0, "XRS buy")
                 : trade.SellLimit(lots, entry, _Symbol, sl, tp, ORDER_TIME_GTC, 0, "XRS sell");

   if(ok) { g_ordersPlaced++; g_todayTrades++; }
   PrintFormat("%s LIMIT lots=%.2f entry=%.2f sl=%.2f tp=%.2f -> %s (%u %s)",
               isBuy ? "BUY" : "SELL", lots, entry, sl, tp,
               ok ? "OK" : "FAIL", trade.ResultRetcode(), trade.ResultRetcodeDescription());
  }

//+------------------------------------------------------------------+
void CancelExpiredOrders()
  {
   datetime now = TimeCurrent();
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) != _Symbol) continue;
      if((ulong)OrderGetInteger(ORDER_MAGIC) != InpMagic) continue;
      datetime setup = (datetime)OrderGetInteger(ORDER_TIME_SETUP);
      if(now - setup >= InpExpiryMinutes * 60)
         if(trade.OrderDelete(ticket))
            PrintFormat("Hủy lệnh chờ #%I64u sau %d phút không khớp", ticket, InpExpiryMinutes);
     }
  }

bool HasOwnOrderOrPosition()
  {
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t != 0 && OrderGetString(ORDER_SYMBOL) == _Symbol && (ulong)OrderGetInteger(ORDER_MAGIC) == InpMagic)
         return true;
     }
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t != 0 && PositionGetString(POSITION_SYMBOL) == _Symbol && (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return true;
     }
   return false;
  }

double CalcLots(double slDist)
  {
   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double lots   = InpLots;
   if(InpRiskPercent > 0 && slDist > 0)
     {
      double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
      double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(tickVal > 0 && tickSize > 0)
         lots = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPercent / 100.0 / (slDist / tickSize * tickVal);
     }
   if(step > 0) lots = MathFloor(lots / step) * step;
   lots = MathMax(minLot, MathMin(maxLot, lots));
   return NormalizeDouble(lots, 2);
  }

double NormPrice(double p)
  {
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(ts <= 0) return NormalizeDouble(p, _Digits);
   return NormalizeDouble(MathRound(p / ts) * ts, _Digits);
  }

bool InTradingHours()
  {
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   if(InpStartHour <= InpEndHour)
      return (dt.hour >= InpStartHour && dt.hour < InpEndHour);
   return (dt.hour >= InpStartHour || dt.hour < InpEndHour);
  }
//+------------------------------------------------------------------+
