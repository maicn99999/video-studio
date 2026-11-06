//+------------------------------------------------------------------+
//|                                            XAU_ReboundScalp.mq5  |
//|  v3 - Scalp XAUUSD theo nảy hồi kỹ thuật tại vùng S/R mạnh       |
//|                                                                  |
//|  A. Vùng S/R đa khung, chấm điểm 0-100, chỉ dùng vùng > 70:      |
//|     1. Cấu trúc khung lớn (0-30): swing W1 / D1 / H4 / H1 / M15  |
//|     2. Mức giá then chốt (0-20): đỉnh/đáy tuần & ngày trước,     |
//|        giá đóng ngày trước, giá mở cửa ngày, số tròn 50$ / 10$   |
//|     3. Hợp lưu (0-15): số nguồn khác nhau trùng tại vùng         |
//|     4. Số lần bị từ chối trên H1 (0-20)                          |
//|     5. Lực bật khỏi vùng, tính theo ATR H1 (0-10)                |
//|     6. Độ mới của lần phản ứng gần nhất (0-5)                    |
//|     7. Trừ điểm (0..-15): giá đóng cửa xuyên qua vùng nhiều lần  |
//|  B. Tín hiệu nến M5 vừa đóng tại vùng:                           |
//|     - Râu (trên: kháng cự / dưới: hỗ trợ) > 50%, thân > 10%      |
//|     - Biên độ nến > trung bình biên độ 14 nến M5 trước           |
//|     - SELL: giá đi lên chạm kháng cự; BUY: giá đi xuống chạm hỗ trợ|
//|     - Không vào lại vùng vừa giao dịch khi giá còn giằng co      |
//|  C. Lệnh Limit giữa nến, SL/TP ở 2 đầu nến, hủy sau 4 phút.      |
//|  D. Tạm dừng trước/sau tin CPI, NFP, FOMC.                       |
//+------------------------------------------------------------------+
#property copyright "XAU Rebound Scalp - research version"
#property version   "3.00"
#property description "Scalp XAU: vùng S/R đa khung >70/100 điểm, nến M5 rút chân, lệnh Limit giữa nến, lọc tin"
#property tester_file "XRS_news.csv"

#include <Trade\Trade.mqh>

#define SRC_N 11
enum ESrc
  {
   SRC_W1 = 0, SRC_D1, SRC_H4, SRC_H1, SRC_M15,           // swing (cấu trúc)
   SRC_PWEEK, SRC_PDAY, SRC_PCLOSE, SRC_DOPEN,             // mức then chốt
   SRC_RMAJOR, SRC_RMINOR                                  // số tròn
  };
string SRC_NAME[] = {"W1","D1","H4","H1","M15","PrevWeek","PrevDay","PrevClose","DayOpen","Round","RoundMinor"};

//====================== INPUTS ======================================
input group "=== Swing đa khung (số nến nhìn lại / số nến mỗi bên fractal) ==="
input int    InpW1Lookback   = 52;    // W1: số nến nhìn lại
input int    InpW1Strength   = 2;     // W1: số nến mỗi bên
input int    InpD1Lookback   = 120;   // D1: số nến nhìn lại
input int    InpD1Strength   = 2;     // D1: số nến mỗi bên
input int    InpH4Lookback   = 180;   // H4: số nến nhìn lại
input int    InpH4Strength   = 3;     // H4: số nến mỗi bên
input int    InpH1Lookback   = 240;   // H1: số nến nhìn lại
input int    InpH1Strength   = 3;     // H1: số nến mỗi bên
input int    InpM15Lookback  = 384;   // M15: số nến nhìn lại (0 = tắt)
input int    InpM15Strength  = 4;     // M15: số nến mỗi bên
input double InpRoundMajor   = 50.0;  // Số tròn lớn (bước giá, 0 = tắt)
input double InpRoundMinor   = 10.0;  // Số tròn nhỏ (bước giá, 0 = tắt)

input group "=== Điểm: 1. Cấu trúc khung lớn (tối đa 30) ==="
input double InpPtW1   = 30;  // Swing W1
input double InpPtD1   = 28;  // Swing D1
input double InpPtH4   = 22;  // Swing H4
input double InpPtH1   = 15;  // Swing H1
input double InpPtM15  = 7;   // Swing M15

input group "=== Điểm: 2. Mức giá then chốt (tối đa 20) ==="
input double InpPtPWeek   = 20; // Đỉnh/đáy tuần trước
input double InpPtPDay    = 16; // Đỉnh/đáy ngày trước
input double InpPtRMajor  = 12; // Số tròn lớn
input double InpPtPClose  = 8;  // Giá đóng cửa ngày trước
input double InpPtDOpen   = 8;  // Giá mở cửa hôm nay
input double InpPtRMinor  = 4;  // Số tròn nhỏ
input double InpPtKeyExtra= 4;  // Cộng thêm cho mỗi mức then chốt trùng thêm

input group "=== Điểm: 3-7. Hợp lưu / phản ứng / lực bật / độ mới / trừ điểm ==="
input double InpPtConf2      = 7;    // Hợp lưu 2 nguồn
input double InpPtConf3      = 11;   // Hợp lưu 3 nguồn
input double InpPtConf4      = 15;   // Hợp lưu >= 4 nguồn (tối đa 15)
input int    InpReactionBars = 240;  // Số nến H1 xét phản ứng giá
input double InpRejWickPct   = 40;   // Nến H1 bị từ chối: râu >= % biên độ
input double InpPtPerReact   = 4;    // Điểm mỗi lần bị từ chối (tối đa 20)
input int    InpDepBars      = 6;    // Số nến H1 đo lực bật sau phản ứng
input double InpDepFullATR   = 3.0;  // Bật xa >= N x ATR(H1) thì đủ 10 điểm
input double InpPtRecent24h  = 5;    // Phản ứng gần nhất trong 24h
input double InpPtRecent72h  = 3;    // Phản ứng gần nhất trong 72h
input double InpPenPerCross  = 3;    // Trừ điểm mỗi lần H1 đóng xuyên vùng (lần đầu miễn, tối đa 15)

input group "=== Vùng ==="
input double InpMinScore       = 70;   // Chỉ giao dịch vùng có điểm > ngưỡng này
input double InpZoneWidthATR   = 0.30; // Độ rộng vùng = ATR(H1) x hệ số
input double InpZoneMinWidth   = 1.5;  // Độ rộng tối thiểu (USD)
input double InpZoneMaxWidth   = 8.0;  // Độ rộng tối đa (USD)
input double InpMaxDistATR     = 2.0;  // Chỉ xét mức cách giá <= ATR(D1) x hệ số
input int    InpMaxZones       = 10;   // Số vùng tối đa
input bool   InpDrawZones      = true; // Vẽ vùng lên chart
input bool   InpLogZones       = true; // In danh sách vùng & điểm khi cập nhật

input group "=== Tín hiệu nến M5 ==="
input double InpMinWickPct      = 50.0; // Râu tối thiểu (% biên độ nến)
input double InpMinBodyPct      = 10.0; // Thân tối thiểu (% biên độ nến)
input int    InpATRPeriod       = 14;   // Số nến M5 tính độ dài trung bình
input double InpATRMult         = 1.0;  // Nến tín hiệu phải > trung bình x hệ số
input double InpMaxPierce       = 0.5;  // Râu xuyên quá mép vùng tối đa (x độ rộng vùng)
input bool   InpRequireApproach = true; // SELL chỉ khi giá đi lên chạm kháng cự, BUY khi đi xuống chạm hỗ trợ
input int    InpApproachBars    = 6;    // Số nến M5 trước tín hiệu để xác định hướng tiếp cận
input double InpApproachDist    = 0.5;  // Giá phải xuất phát cách mép vùng >= N x độ rộng vùng
input bool   InpAllowSell       = true; // Cho phép Sell
input bool   InpAllowBuy        = true; // Cho phép Buy

input group "=== Chống vào lệnh liên tục khi giằng co ==="
input int    InpChopBars      = 12;  // Xét N nến M5 trước tín hiệu
input int    InpMaxBarsInZone = 3;   // Bỏ qua nếu > N nến trong số đó đã nằm trong vùng
input double InpUnlockDist    = 1.0; // Vùng vừa vào lệnh bị khóa đến khi giá rời xa >= N x độ rộng vùng
input int    InpLockMaxHours  = 24;  // Tự mở khóa sau N giờ

input group "=== Lệnh ==="
input double InpLots          = 0.01;  // Khối lượng cố định
input double InpRiskPercent   = 0.0;   // >0: tính lot theo % rủi ro balance
input double InpEntryPct      = 50.0;  // Vị trí entry trong nến (50 = giữa nến)
input double InpSLBuffer      = 0.0;   // Cộng thêm vào SL (USD)
input double InpTPOffset      = 0.0;   // Kéo TP vào trong (USD)
input int    InpExpiryMinutes = 4;     // Hủy lệnh chờ sau N phút
input double InpMaxSpread     = 0.60;  // Spread tối đa (USD)
input bool   InpOneTradeOnly  = true;  // Chỉ 1 lệnh tại 1 thời điểm
input ulong  InpMagic         = 20261106; // Magic number

input group "=== Lọc tin CPI / NFP / FOMC ==="
input bool   InpUseNews       = true;   // Bật lọc tin
input int    InpNewsBeforeMin = 30;     // Dừng trước tin N phút
input int    InpNewsAfterMin  = 30;     // Dừng sau tin N phút
input string InpNewsKeywords  = "CPI,Nonfarm,FOMC,Fed Interest Rate"; // Từ khóa tên tin (USD, quan trọng cao)
input string InpNewsFile      = "XRS_news.csv"; // File lịch tin cho backtest (MQL5\Files)
input bool   InpNewsCancelPending = true;  // Hủy lệnh chờ khi vào giờ tin
input bool   InpNewsClosePositions = false; // Đóng lệnh đang mở khi vào giờ tin

input group "=== Giờ giao dịch (giờ server) ==="
input bool   InpUseHours  = false; // Bật lọc giờ
input int    InpStartHour = 8;     // Giờ bắt đầu
input int    InpEndHour   = 22;    // Giờ kết thúc

//====================== TYPES / GLOBALS =============================
struct SLevel { double price; int src; };
struct SZone
  {
   double   lo, hi, center, score;
   int      srcMask, reactions, crosses;
   double   maxDep;
   datetime lastReact;
   double   pStruct, pKey, pConf, pReact, pDep, pRec, pPen;
  };
struct SLock  { double center; double width; datetime time; };
struct SNews  { datetime time; string name; };

CTrade   trade;
SLevel   g_levels[];
SZone    g_zones[];
SLock    g_locks[];
SNews    g_news[];
int      g_hATRH1 = INVALID_HANDLE, g_hATRD1 = INVALID_HANDLE;
double   g_zoneWidth = 0, g_maxDist = 0, g_refPrice = 0, g_atrH1 = 0;
datetime g_lastM5Bar = 0, g_lastH1Bar = 0, g_lastDay = 0;
datetime g_newsLoadedAt = 0, g_newsCheckMin = 0;
bool     g_newsBlocked = false;
string   g_newsName = "";
// thống kê
int      g_signals = 0, g_ordersPlaced = 0, g_fills = 0;
int      g_skipApproach = 0, g_skipChop = 0, g_skipLock = 0, g_skipNews = 0;
const string OBJ_PREFIX = "XRS_";

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);

   if(InpATRPeriod < 1 || InpMaxZones < 1 || InpApproachBars < 1 || InpChopBars < 1)
      return(INIT_PARAMETERS_INCORRECT);

   g_hATRH1 = iATR(_Symbol, PERIOD_H1, 14);
   g_hATRD1 = iATR(_Symbol, PERIOD_D1, 14);
   if(g_hATRH1 == INVALID_HANDLE || g_hATRD1 == INVALID_HANDLE)
      return(INIT_FAILED);

   if(InpUseNews)
      LoadNews();
   BuildZones();
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, OBJ_PREFIX);
   if(g_hATRH1 != INVALID_HANDLE) IndicatorRelease(g_hATRH1);
   if(g_hATRD1 != INVALID_HANDLE) IndicatorRelease(g_hATRD1);
   PrintFormat("===== THỐNG KÊ XRS ===== Tín hiệu: %d | Lệnh chờ: %d | Khớp: %d (%.0f%%)",
               g_signals, g_ordersPlaced, g_fills,
               g_ordersPlaced > 0 ? 100.0 * g_fills / g_ordersPlaced : 0.0);
   PrintFormat("Bỏ qua do: sai hướng tiếp cận %d | giằng co %d | vùng đang khóa %d | giờ tin %d",
               g_skipApproach, g_skipChop, g_skipLock, g_skipNews);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   CancelExpiredOrders();

   //--- Lọc tin (kiểm tra mỗi phút)
   if(InpUseNews)
     {
      datetime nowMin = TimeCurrent() / 60 * 60;
      if(nowMin != g_newsCheckMin)
        {
         g_newsCheckMin = nowMin;
         if(!MQLInfoInteger(MQL_TESTER) && TimeCurrent() - g_newsLoadedAt > 6 * 3600)
            LoadNews();
         bool was = g_newsBlocked;
         g_newsBlocked = IsNewsTime(TimeCurrent(), g_newsName);
         if(g_newsBlocked && !was)
           {
            PrintFormat("Tạm dừng giao dịch: tin %s", g_newsName);
            if(InpNewsCancelPending)  DeleteAllPending();
            if(InpNewsClosePositions) CloseAllPositions();
           }
         if(!g_newsBlocked && was)
            Print("Hết thời gian tạm dừng do tin");
        }
     }

   //--- Cập nhật vùng: mỗi nến H1 mới và mỗi ngày mới
   datetime h = iTime(_Symbol, PERIOD_H1, 0);
   datetime d = iTime(_Symbol, PERIOD_D1, 0);
   if(h != g_lastH1Bar || d != g_lastDay)
     {
      g_lastH1Bar = h;
      g_lastDay   = d;
      BuildZones();
     }

   //--- Nến M5 vừa đóng
   datetime m = iTime(_Symbol, PERIOD_M5, 0);
   if(m == 0 || m == g_lastM5Bar)
      return;
   g_lastM5Bar = m;

   int need = MathMax(InpATRPeriod, MathMax(InpApproachBars, InpChopBars)) + 1;
   MqlRates bars[];
   ArraySetAsSeries(bars, true);
   if(CopyRates(_Symbol, PERIOD_M5, 1, need, bars) < need)
      return;

   UpdateLocks(bars[0]);
   CheckSignal(bars);
  }

//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if((ulong)HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != InpMagic) return;
   if(HistoryDealGetInteger(trans.deal, DEAL_ENTRY) == DEAL_ENTRY_IN)
      g_fills++;
  }

//====================== XÂY DỰNG & CHẤM ĐIỂM VÙNG ==================
double GetBuf(int handle)
  {
   double b[];
   if(CopyBuffer(handle, 0, 1, 1, b) != 1) return 0;
   return b[0];
  }

bool IsSwingSrc(int src) { return src <= SRC_M15; }

double SrcPoints(int src)
  {
   switch(src)
     {
      case SRC_W1:     return InpPtW1;
      case SRC_D1:     return InpPtD1;
      case SRC_H4:     return InpPtH4;
      case SRC_H1:     return InpPtH1;
      case SRC_M15:    return InpPtM15;
      case SRC_PWEEK:  return InpPtPWeek;
      case SRC_PDAY:   return InpPtPDay;
      case SRC_PCLOSE: return InpPtPClose;
      case SRC_DOPEN:  return InpPtDOpen;
      case SRC_RMAJOR: return InpPtRMajor;
      case SRC_RMINOR: return InpPtRMinor;
     }
   return 0;
  }

void AddLevel(double price, int src)
  {
   if(price <= 0) return;
   if(MathAbs(price - g_refPrice) > g_maxDist) return;
   int n = ArraySize(g_levels);
   ArrayResize(g_levels, n + 1);
   g_levels[n].price = price;
   g_levels[n].src   = src;
  }

void AddSwings(ENUM_TIMEFRAMES tf, int lookback, int s, int src)
  {
   if(lookback <= 0) return;
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
      if(isHigh) AddLevel(r[i].high, src);
      if(isLow)  AddLevel(r[i].low,  src);
     }
  }

void AddRoundLevels(double step, int src, double skipStep)
  {
   if(step <= 0) return;
   double p = MathFloor((g_refPrice - g_maxDist) / step) * step;
   for(; p <= g_refPrice + g_maxDist; p += step)
     {
      if(skipStep > 0)
        {
         double r = MathMod(p, skipStep);
         if(r < 1e-6 || skipStep - r < 1e-6) continue; // đã là số tròn lớn
        }
      AddLevel(p, src);
     }
  }

//+------------------------------------------------------------------+
//| Chấm điểm 1 vùng (0-100)                                         |
//+------------------------------------------------------------------+
void ScoreZone(SZone &z, const MqlRates &h1[], int n)
  {
   //--- 1. Cấu trúc khung lớn: lấy khung cao nhất có swing tại vùng
   double pS = 0;
   int    nKey = 0;
   double bestKey = 0;
   int    nSrc = 0;
   for(int s = 0; s < SRC_N; s++)
     {
      if((z.srcMask & (1 << s)) == 0) continue;
      nSrc++;
      if(IsSwingSrc(s)) pS = MathMax(pS, SrcPoints(s));
      else { nKey++; bestKey = MathMax(bestKey, SrcPoints(s)); }
     }
   z.pStruct = MathMin(30.0, pS);

   //--- 2. Mức giá then chốt
   z.pKey = (nKey > 0) ? MathMin(20.0, bestKey + InpPtKeyExtra * (nKey - 1)) : 0;

   //--- 3. Hợp lưu
   z.pConf = (nSrc >= 4) ? InpPtConf4 : (nSrc == 3) ? InpPtConf3 : (nSrc == 2) ? InpPtConf2 : 0;
   z.pConf = MathMin(15.0, z.pConf);

   //--- 4-7. Duyệt H1 từ cũ -> mới: phản ứng, lực bật, xuyên vùng
   int    react = 0, flips = 0, lastSide = 0, lastReactIdx = n + 100;
   double maxDep = 0;
   datetime lastT = 0;
   for(int b = n - 1; b >= 0; b--)
     {
      double hi = h1[b].high, lo = h1[b].low, cl = h1[b].close, op = h1[b].open;
      double rg = hi - lo;

      int side = (cl > z.hi) ? 1 : (cl < z.lo ? -1 : 0);
      if(side != 0)
        {
         if(lastSide != 0 && side != lastSide) flips++;
         lastSide = side;
        }
      if(rg <= 0) continue;

      // bị từ chối ở kháng cự: chạm vùng, đóng dưới vùng, râu trên dài
      bool rejDown = (hi >= z.lo && cl < z.lo && (hi - MathMax(op, cl)) >= rg * InpRejWickPct / 100.0);
      // bị từ chối ở hỗ trợ: chạm vùng, đóng trên vùng, râu dưới dài
      bool rejUp   = (lo <= z.hi && cl > z.hi && (MathMin(op, cl) - lo) >= rg * InpRejWickPct / 100.0);
      if(!(rejDown || rejUp) || lastReactIdx - b < 3) continue;

      react++;
      lastReactIdx = b;
      lastT = h1[b].time;
      if(g_atrH1 > 0)
        {
         double ext = rejDown ? lo : hi;
         for(int k = b - 1; k >= MathMax(0, b - InpDepBars); k--)
            ext = rejDown ? MathMin(ext, h1[k].low) : MathMax(ext, h1[k].high);
         double dep = rejDown ? (z.lo - ext) : (ext - z.hi);
         maxDep = MathMax(maxDep, dep / g_atrH1);
        }
     }
   z.reactions = react;
   z.crosses   = flips;
   z.maxDep    = maxDep;
   z.lastReact = lastT;

   z.pReact = MathMin(20.0, InpPtPerReact * react);
   z.pDep   = (InpDepFullATR > 0) ? MathMin(10.0, 10.0 * maxDep / InpDepFullATR) : 0;
   z.pRec   = 0;
   if(lastT > 0)
     {
      double hrs = (double)(TimeCurrent() - lastT) / 3600.0;
      if(hrs <= 24)      z.pRec = MathMin(5.0, InpPtRecent24h);
      else if(hrs <= 72) z.pRec = MathMin(5.0, InpPtRecent72h);
     }
   z.pPen = -MathMin(15.0, InpPenPerCross * MathMax(0, flips - 1));

   z.score = z.pStruct + z.pKey + z.pConf + z.pReact + z.pDep + z.pRec + z.pPen;
   z.score = MathMax(0.0, MathMin(100.0, z.score));
  }

//+------------------------------------------------------------------+
void BuildZones()
  {
   ArrayResize(g_levels, 0);
   ArrayResize(g_zones, 0);

   g_atrH1 = GetBuf(g_hATRH1);
   double atrD1 = GetBuf(g_hATRD1);
   if(g_atrH1 <= 0 || atrD1 <= 0) return;
   g_zoneWidth = MathMax(InpZoneMinWidth, MathMin(InpZoneMaxWidth, g_atrH1 * InpZoneWidthATR));
   g_maxDist   = atrD1 * InpMaxDistATR;
   g_refPrice  = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(g_refPrice <= 0) return;

   //--- 1. Thu thập mức giá
   AddSwings(PERIOD_W1,  InpW1Lookback,  InpW1Strength,  SRC_W1);
   AddSwings(PERIOD_D1,  InpD1Lookback,  InpD1Strength,  SRC_D1);
   AddSwings(PERIOD_H4,  InpH4Lookback,  InpH4Strength,  SRC_H4);
   AddSwings(PERIOD_H1,  InpH1Lookback,  InpH1Strength,  SRC_H1);
   AddSwings(PERIOD_M15, InpM15Lookback, InpM15Strength, SRC_M15);
   AddLevel(iHigh (_Symbol, PERIOD_W1, 1), SRC_PWEEK);
   AddLevel(iLow  (_Symbol, PERIOD_W1, 1), SRC_PWEEK);
   AddLevel(iHigh (_Symbol, PERIOD_D1, 1), SRC_PDAY);
   AddLevel(iLow  (_Symbol, PERIOD_D1, 1), SRC_PDAY);
   AddLevel(iClose(_Symbol, PERIOD_D1, 1), SRC_PCLOSE);
   AddLevel(iOpen (_Symbol, PERIOD_D1, 0), SRC_DOPEN);
   AddRoundLevels(InpRoundMajor, SRC_RMAJOR, 0);
   AddRoundLevels(InpRoundMinor, SRC_RMINOR, InpRoundMajor);

   int nlv = ArraySize(g_levels);
   if(nlv == 0) return;

   //--- 2. Sắp xếp theo giá
   for(int i = 1; i < nlv; i++)
     {
      SLevel key = g_levels[i];
      int j = i - 1;
      while(j >= 0 && g_levels[j].price > key.price) { g_levels[j + 1] = g_levels[j]; j--; }
      g_levels[j + 1] = key;
     }

   //--- 3. Dữ liệu H1 để chấm điểm phản ứng
   MqlRates h1[];
   ArraySetAsSeries(h1, true);
   int nH1 = CopyRates(_Symbol, PERIOD_H1, 1, InpReactionBars, h1);
   if(nH1 < 0) nH1 = 0;

   //--- 4. Gom cụm -> chấm điểm -> lọc
   int i0 = 0;
   while(i0 < nlv)
     {
      double wsum = 0, psum = 0;
      int    mask = 0, j = i0;
      while(j < nlv && g_levels[j].price - g_levels[i0].price <= g_zoneWidth)
        {
         double w = MathMax(1.0, SrcPoints(g_levels[j].src));
         psum += g_levels[j].price * w;
         wsum += w;
         mask |= (1 << g_levels[j].src);
         j++;
        }
      SZone z;
      ZeroMemory(z);
      z.center  = psum / wsum;
      z.lo      = z.center - g_zoneWidth / 2.0;
      z.hi      = z.center + g_zoneWidth / 2.0;
      z.srcMask = mask;
      ScoreZone(z, h1, nH1);
      if(z.score > InpMinScore)
        {
         int n = ArraySize(g_zones);
         ArrayResize(g_zones, n + 1);
         g_zones[n] = z;
        }
      i0 = j;
     }

   //--- 5. Sắp xếp theo điểm giảm dần, giữ top N
   int nz = ArraySize(g_zones);
   for(int a = 1; a < nz; a++)
     {
      SZone key = g_zones[a];
      int b = a - 1;
      while(b >= 0 && g_zones[b].score < key.score) { g_zones[b + 1] = g_zones[b]; b--; }
      g_zones[b + 1] = key;
     }
   if(nz > InpMaxZones) ArrayResize(g_zones, InpMaxZones);

   if(InpLogZones && !MQLInfoInteger(MQL_OPTIMIZATION))
     {
      PrintFormat("--- Cập nhật vùng %s: %d vùng > %.0f điểm (độ rộng %.2f) ---",
                  TimeToString(TimeCurrent()), ArraySize(g_zones), InpMinScore, g_zoneWidth);
      for(int i = 0; i < ArraySize(g_zones); i++)
         Print("  ", ZoneDesc(g_zones[i]));
     }
   if(InpDrawZones && !MQLInfoInteger(MQL_OPTIMIZATION))
      DrawZones();
  }

//+------------------------------------------------------------------+
string ZoneDesc(const SZone &z)
  {
   string s = "";
   for(int i = 0; i < SRC_N; i++)
      if((z.srcMask & (1 << i)) != 0)
         s += (s == "" ? "" : "+") + SRC_NAME[i];
   return StringFormat("%.2f-%.2f | %.0f điểm [cấu trúc %.0f, mức %.0f, hợp lưu %.0f, phản ứng %.0f(%d), bật %.0f, mới %.0f, xuyên %.0f(%d)] | %s",
                       z.lo, z.hi, z.score, z.pStruct, z.pKey, z.pConf, z.pReact, z.reactions,
                       z.pDep, z.pRec, z.pPen, z.crosses, s);
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
      ObjectSetString (0, lbl, OBJPROP_TEXT, StringFormat("%.0f", g_zones[i].score));
      ObjectSetInteger(0, lbl, OBJPROP_COLOR, c);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE, 8);
      ObjectSetInteger(0, lbl, OBJPROP_SELECTABLE, false);
     }
   ChartRedraw();
  }

//====================== KHÓA VÙNG (chống giằng co) =================
bool IsLocked(const SZone &z)
  {
   for(int i = 0; i < ArraySize(g_locks); i++)
      if(MathAbs(g_locks[i].center - z.center) < MathMax(g_locks[i].width, g_zoneWidth))
         return true;
   return false;
  }

void AddLock(const SZone &z)
  {
   int n = ArraySize(g_locks);
   ArrayResize(g_locks, n + 1);
   g_locks[n].center = z.center;
   g_locks[n].width  = g_zoneWidth;
   g_locks[n].time   = TimeCurrent();
  }

void UpdateLocks(const MqlRates &bar)
  {
   int n = ArraySize(g_locks), k = 0;
   for(int i = 0; i < n; i++)
     {
      double away = g_locks[i].width / 2.0 + InpUnlockDist * g_locks[i].width;
      bool farAway = MathAbs(bar.close - g_locks[i].center) >= away;
      bool expired = (TimeCurrent() - g_locks[i].time) >= InpLockMaxHours * 3600;
      if(farAway || expired) continue; // mở khóa
      g_locks[k++] = g_locks[i];
     }
   ArrayResize(g_locks, k);
  }

//====================== TÍN HIỆU M5 ================================
void CheckSignal(const MqlRates &m[])
  {
   if(ArraySize(g_zones) == 0) return;
   if(InpUseHours && !InTradingHours()) return;
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
   double appr   = g_zoneWidth * InpApproachDist;

   for(int i = 0; i < ArraySize(g_zones); i++)
     {
      double zlo = g_zones[i].lo, zhi = g_zones[i].hi;
      bool isSell = sellPat && H >= zlo && H <= zhi + pierce && C < zhi && O < zhi;
      bool isBuy  = buyPat  && L <= zhi && L >= zlo - pierce && C > zlo && O > zlo;
      if(!isSell && !isBuy) continue;

      string dir = isSell ? "SELL" : "BUY";
      string tag = StringFormat("%s %s | H=%.2f L=%.2f range=%.2f avg=%.2f | %s",
                                dir, TimeToString(m[0].time), H, L, range, avg, ZoneDesc(g_zones[i]));

      //--- Hướng tiếp cận: SELL khi giá đi lên chạm kháng cự, BUY khi đi xuống chạm hỗ trợ
      if(InpRequireApproach)
        {
         bool ok = false, wrongSide = false;
         for(int k = 1; k <= InpApproachBars; k++)
           {
            if(isSell)
              {
               if(m[k].low <= zlo - appr)  ok = true;          // xuất phát từ dưới vùng
               if(m[k].close > zhi)        wrongSide = true;   // trước đó giá đã ở trên vùng
              }
            else
              {
               if(m[k].high >= zhi + appr) ok = true;          // xuất phát từ trên vùng
               if(m[k].close < zlo)        wrongSide = true;   // trước đó giá đã ở dưới vùng
              }
           }
         if(!ok || wrongSide)
           {
            g_skipApproach++;
            Print("Bỏ qua (sai hướng tiếp cận): ", tag);
            continue;
           }
        }

      //--- Chống giằng co: vùng vừa giao dịch còn khóa / giá đã nằm trong vùng nhiều nến
      if(IsLocked(g_zones[i]))
        {
         g_skipLock++;
         Print("Bỏ qua (vùng vừa giao dịch, giá chưa rời xa): ", tag);
         return;
        }
      int inZone = 0;
      for(int k = 1; k <= InpChopBars; k++)
         if(m[k].high >= zlo && m[k].low <= zhi) inZone++;
      if(inZone > InpMaxBarsInZone)
        {
         g_skipChop++;
         PrintFormat("Bỏ qua (giằng co: %d/%d nến trong vùng): %s", inZone, InpChopBars, tag);
         return;
        }

      //--- Tin tức
      if(InpUseNews && g_newsBlocked)
        {
         g_skipNews++;
         Print("Bỏ qua (giờ tin ", g_newsName, "): ", tag);
         return;
        }

      g_signals++;
      Print("TÍN HIỆU ", tag);
      if(PlaceOrder(!isSell, H, L))
         AddLock(g_zones[i]);
      return;
     }
  }

//====================== LỆNH =======================================
bool PlaceOrder(bool isBuy, double H, double L)
  {
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(ask - bid > InpMaxSpread)
     {
      PrintFormat("Bỏ qua: spread %.2f > %.2f", ask - bid, InpMaxSpread);
      return false;
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
      if(entry >= ask - minDist) { Print("Bỏ qua: giá đã ở dưới/sát entry Buy Limit"); return false; }
      if(entry - sl < minDist || tp - entry < minDist) { Print("Bỏ qua: SL/TP quá gần (stops level)"); return false; }
     }
   else
     {
      if(entry <= bid + minDist) { Print("Bỏ qua: giá đã ở trên/sát entry Sell Limit"); return false; }
      if(sl - entry < minDist || entry - tp < minDist) { Print("Bỏ qua: SL/TP quá gần (stops level)"); return false; }
     }

   double lots = CalcLots(MathAbs(entry - sl));
   if(lots <= 0) return false;

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

   if(ok) g_ordersPlaced++;
   PrintFormat("%s LIMIT lots=%.2f entry=%.2f sl=%.2f tp=%.2f -> %s (%u %s)",
               isBuy ? "BUY" : "SELL", lots, entry, sl, tp,
               ok ? "OK" : "FAIL", trade.ResultRetcode(), trade.ResultRetcodeDescription());
   return ok;
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

void DeleteAllPending()
  {
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t != 0 && OrderGetString(ORDER_SYMBOL) == _Symbol && (ulong)OrderGetInteger(ORDER_MAGIC) == InpMagic)
         trade.OrderDelete(t);
     }
  }

void CloseAllPositions()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t != 0 && PositionGetString(POSITION_SYMBOL) == _Symbol && (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         trade.PositionClose(t);
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

//====================== TIN TỨC ====================================
bool NameMatches(string name)
  {
   string kw[];
   int nk = StringSplit(InpNewsKeywords, ',', kw);
   StringToUpper(name);
   for(int i = 0; i < nk; i++)
     {
      string k = kw[i];
      StringTrimLeft(k);
      StringTrimRight(k);
      StringToUpper(k);
      if(k != "" && StringFind(name, k) >= 0) return true;
     }
   return false;
  }

void AddNews(datetime t, string name)
  {
   int n = ArraySize(g_news);
   ArrayResize(g_news, n + 1);
   g_news[n].time = t;
   g_news[n].name = name;
  }

int LoadNewsFromFile()
  {
   int h = FileOpen(InpNewsFile, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
      h = FileOpen(InpNewsFile, FILE_READ | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE) return -1;
   int cnt = 0;
   while(!FileIsEnding(h))
     {
      string line = FileReadString(h);
      string parts[];
      if(StringSplit(line, ',', parts) < 2) continue;
      datetime t = StringToTime(parts[0]);
      if(t <= 0) continue;
      if(!NameMatches(parts[1])) continue;
      AddNews(t, parts[1]);
      cnt++;
     }
   FileClose(h);
   return cnt;
  }

int LoadNewsFromCalendar()
  {
   MqlCalendarValue vals[];
   datetime now = TimeCurrent();
   int n = CalendarValueHistory(vals, now - 2 * 86400, now + 8 * 86400, "US", "USD");
   if(n <= 0) return -1;
   int cnt = 0;
   for(int i = 0; i < n; i++)
     {
      MqlCalendarEvent ev;
      if(!CalendarEventById(vals[i].event_id, ev)) continue;
      if(ev.importance != CALENDAR_IMPORTANCE_HIGH) continue;
      if(!NameMatches(ev.name)) continue;
      AddNews(vals[i].time, ev.name);
      cnt++;
     }
   return cnt;
  }

void LoadNews()
  {
   ArrayResize(g_news, 0);
   g_newsLoadedAt = TimeCurrent();
   int cnt = -1;
   if(!MQLInfoInteger(MQL_TESTER))
      cnt = LoadNewsFromCalendar();       // chạy thật: lịch kinh tế MT5
   if(cnt < 0)
      cnt = LoadNewsFromFile();           // backtest: file xuất từ script XRS_ExportNews
   if(cnt < 0)
      PrintFormat("CẢNH BÁO: không tải được lịch tin. Backtest cần chạy script XRS_ExportNews để tạo %s", InpNewsFile);
   else
      PrintFormat("Đã tải %d tin CPI/NFP/FOMC", cnt);
  }

bool IsNewsTime(datetime now, string &name)
  {
   for(int i = 0; i < ArraySize(g_news); i++)
     {
      if(now >= g_news[i].time - InpNewsBeforeMin * 60 && now <= g_news[i].time + InpNewsAfterMin * 60)
        {
         name = g_news[i].name + " " + TimeToString(g_news[i].time, TIME_DATE | TIME_MINUTES);
         return true;
        }
     }
   return false;
  }
//+------------------------------------------------------------------+
