//+------------------------------------------------------------------+
//|                                            XAU_ReboundScalp.mq5  |
//|  Scalp XAUUSD theo nảy hồi kỹ thuật tại vùng S/R mạnh            |
//|                                                                  |
//|  Logic:                                                          |
//|  1. Xác định vùng S/R từ đỉnh/đáy swing trên khung InpZoneTF     |
//|     (mặc định M5, 288 nến = ~24h). Chỉ giữ vùng có số lần chạm   |
//|     trong khoảng [InpMinTouches, InpMaxTouches].                 |
//|  2. Khi 1 nến M1 vừa đóng chạm vào vùng:                         |
//|     - Kháng cự: râu trên > 50% nến, thân > 10% nến               |
//|     - Hỗ trợ  : râu dưới > 50% nến, thân > 10% nến               |
//|     - Biên độ nến (H-L) > trung bình biên độ 14 nến trước đó     |
//|  3. Đặt lệnh chờ Limit tại giữa nến, SL = đỉnh/đáy, TP = đáy/đỉnh|
//|  4. Sau InpExpiryMinutes phút chưa khớp -> hủy lệnh chờ.         |
//+------------------------------------------------------------------+
#property copyright "XAU Rebound Scalp - research version"
#property version   "1.00"
#property description "Scalp XAU: nến M1 rút chân tại vùng S/R mạnh, lệnh Limit giữa nến, TP/SL ở 2 đầu nến"

#include <Trade\Trade.mqh>

//--- Vùng S/R
input group "=== Vùng hỗ trợ / kháng cự ==="
input ENUM_TIMEFRAMES InpZoneTF          = PERIOD_M5; // Khung để tìm vùng
input int             InpZoneLookback    = 288;       // Số nến nhìn lại (288 nến M5 = 24h)
input int             InpSwingStrength   = 3;         // Số nến mỗi bên để xác định đỉnh/đáy swing
input double          InpZoneWidth       = 1.50;      // Độ rộng vùng (giá, USD)
input int             InpMinTouches      = 2;         // Số lần chạm tối thiểu
input int             InpMaxTouches      = 10;        // Số lần chạm tối đa
input int             InpTouchGapBars    = 3;         // Số nến ở ngoài vùng tối thiểu để tính 1 lần chạm mới
input double          InpMaxPierce       = 1.00;      // Râu được phép xuyên qua mép vùng tối đa (USD)
input bool            InpDrawZones       = true;      // Vẽ vùng lên chart

//--- Tín hiệu
input group "=== Tín hiệu nến M1 ==="
input double          InpMinWickPct      = 50.0;      // Râu tối thiểu (% biên độ nến)
input double          InpMinBodyPct      = 10.0;      // Thân tối thiểu (% biên độ nến)
input int             InpATRPeriod       = 14;        // Số nến tính độ dài trung bình
input double          InpATRMult         = 1.0;       // Nến tín hiệu phải > ATR * hệ số này
input bool            InpAllowSell       = true;      // Cho phép Sell tại kháng cự
input bool            InpAllowBuy        = true;      // Cho phép Buy tại hỗ trợ

//--- Lệnh
input group "=== Lệnh ==="
input double          InpLots            = 0.01;      // Khối lượng cố định
input double          InpRiskPercent     = 0.0;       // >0: tính lot theo % rủi ro balance
input double          InpEntryPct        = 50.0;      // Vị trí entry trong nến (50 = giữa nến)
input double          InpSLBuffer        = 0.0;       // Cộng thêm vào SL (USD), bù spread
input double          InpTPOffset        = 0.0;       // Kéo TP vào trong (USD), giúp dễ khớp TP
input int             InpExpiryMinutes   = 2;         // Hủy lệnh chờ sau N phút
input double          InpMaxSpread       = 0.50;      // Spread tối đa cho phép (USD)
input bool            InpOneTradeOnly    = true;      // Chỉ 1 lệnh (chờ hoặc đang mở) tại 1 thời điểm
input ulong           InpMagic           = 20261106;  // Magic number

//--- Giờ giao dịch
input group "=== Giờ giao dịch (giờ server) ==="
input bool            InpUseHours        = false;     // Bật lọc giờ
input int             InpStartHour       = 8;         // Giờ bắt đầu
input int             InpEndHour         = 22;        // Giờ kết thúc

//+------------------------------------------------------------------+
struct SZone
  {
   double lo;
   double hi;
   int    touches;
  };

CTrade   trade;
SZone    g_zones[];
datetime g_lastM1Bar   = 0;
datetime g_lastZoneBar = 0;
const string OBJ_PREFIX = "XRS_ZONE_";

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);

   if(InpATRPeriod < 1 || InpZoneLookback < 20 || InpSwingStrength < 1)
     {
      Print("Tham số không hợp lệ");
      return(INIT_PARAMETERS_INCORRECT);
     }
   BuildZones();
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, OBJ_PREFIX);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   //--- 1. Hủy lệnh chờ quá hạn (kiểm tra mỗi tick)
   CancelExpiredOrders();

   //--- 2. Cập nhật vùng S/R khi có nến mới trên khung vùng
   datetime zt = iTime(_Symbol, InpZoneTF, 0);
   if(zt != g_lastZoneBar)
     {
      g_lastZoneBar = zt;
      BuildZones();
     }

   //--- 3. Kiểm tra tín hiệu khi nến M1 vừa đóng
   datetime mt = iTime(_Symbol, PERIOD_M1, 0);
   if(mt == 0 || mt == g_lastM1Bar)
      return;
   g_lastM1Bar = mt;
   CheckSignal();
  }

//+------------------------------------------------------------------+
//| Xây dựng vùng S/R                                                |
//+------------------------------------------------------------------+
void BuildZones()
  {
   ArrayResize(g_zones, 0);

   MqlRates r[];
   ArraySetAsSeries(r, true);
   int need = InpZoneLookback;
   // bắt đầu từ shift 1: chỉ dùng nến đã đóng
   int got = CopyRates(_Symbol, InpZoneTF, 1, need, r);
   if(got < InpSwingStrength * 2 + 5)
      return;

   //--- 1. Tìm đỉnh/đáy swing
   double levels[];
   int    nlv = 0;
   int    s   = InpSwingStrength;
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
      if(isHigh) { ArrayResize(levels, nlv + 1); levels[nlv++] = r[i].high; }
      if(isLow)  { ArrayResize(levels, nlv + 1); levels[nlv++] = r[i].low;  }
     }
   if(nlv == 0)
      return;

   //--- 2. Gom cụm các mức gần nhau thành vùng
   ArraySort(levels);
   SZone raw[];
   int   nz = 0;
   int   i0 = 0;
   while(i0 < nlv)
     {
      double sum = levels[i0];
      int    c   = 1;
      int    j   = i0 + 1;
      while(j < nlv && levels[j] - levels[i0] <= InpZoneWidth)
        {
         sum += levels[j];
         c++;
         j++;
        }
      double center = sum / c;
      ArrayResize(raw, nz + 1);
      raw[nz].lo = center - InpZoneWidth / 2.0;
      raw[nz].hi = center + InpZoneWidth / 2.0;
      raw[nz].touches = 0;
      nz++;
      i0 = j;
     }

   //--- 3. Đếm số lần chạm (đi từ nến cũ -> mới)
   for(int z = 0; z < nz; z++)
     {
      int touches = 0;
      int lastIn  = -1000000;
      for(int b = got - 1; b >= 0; b--)
        {
         int pos = got - 1 - b;
         bool inZone = (r[b].high >= raw[z].lo && r[b].low <= raw[z].hi);
         if(inZone)
           {
            if(pos - lastIn > InpTouchGapBars)
               touches++;
            lastIn = pos;
           }
        }
      raw[z].touches = touches;
      if(touches >= InpMinTouches && touches <= InpMaxTouches)
        {
         int n = ArraySize(g_zones);
         ArrayResize(g_zones, n + 1);
         g_zones[n] = raw[z];
        }
     }

   if(InpDrawZones)
      DrawZones(r[got - 1].time);
  }

//+------------------------------------------------------------------+
void DrawZones(datetime fromTime)
  {
   ObjectsDeleteAll(0, OBJ_PREFIX);
   datetime toTime = TimeCurrent() + PeriodSeconds(InpZoneTF) * 12;
   for(int i = 0; i < ArraySize(g_zones); i++)
     {
      string name = OBJ_PREFIX + IntegerToString(i);
      ObjectCreate(0, name, OBJ_RECTANGLE, 0, fromTime, g_zones[i].hi, toTime, g_zones[i].lo);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clrGoldenrod);
      ObjectSetInteger(0, name, OBJPROP_FILL, true);
      ObjectSetInteger(0, name, OBJPROP_BACK, true);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetString(0, name, OBJPROP_TOOLTIP,
                      StringFormat("Vùng %.2f - %.2f | %d lần chạm", g_zones[i].lo, g_zones[i].hi, g_zones[i].touches));
     }
   ChartRedraw();
  }

//+------------------------------------------------------------------+
//| Kiểm tra tín hiệu trên nến M1 vừa đóng                           |
//+------------------------------------------------------------------+
void CheckSignal()
  {
   if(ArraySize(g_zones) == 0)
      return;
   if(InpUseHours && !InTradingHours())
      return;
   if(InpOneTradeOnly && HasOwnOrderOrPosition())
      return;

   MqlRates m[];
   ArraySetAsSeries(m, true);
   if(CopyRates(_Symbol, PERIOD_M1, 1, InpATRPeriod + 1, m) < InpATRPeriod + 1)
      return;

   // m[0] = nến tín hiệu (vừa đóng), m[1..ATRPeriod] = các nến trước đó
   double H = m[0].high, L = m[0].low, O = m[0].open, C = m[0].close;
   double range = H - L;
   if(range <= 0)
      return;

   double avg = 0;
   for(int k = 1; k <= InpATRPeriod; k++)
      avg += m[k].high - m[k].low;
   avg /= InpATRPeriod;
   if(range <= avg * InpATRMult)
      return;

   double body  = MathAbs(C - O);
   double upper = H - MathMax(O, C);
   double lower = MathMin(O, C) - L;
   bool bodyOK  = body > range * InpMinBodyPct / 100.0;

   bool sellPattern = InpAllowSell && bodyOK && upper > range * InpMinWickPct / 100.0;
   bool buyPattern  = InpAllowBuy  && bodyOK && lower > range * InpMinWickPct / 100.0;
   if(!sellPattern && !buyPattern)
      return;

   for(int i = 0; i < ArraySize(g_zones); i++)
     {
      double zlo = g_zones[i].lo, zhi = g_zones[i].hi;

      // Kháng cự: râu trên đâm vào vùng, nến mở & đóng dưới mép trên vùng
      if(sellPattern && H >= zlo && H <= zhi + InpMaxPierce && C < zhi && O < zhi)
        {
         PrintFormat("SELL signal | nến %s H=%.2f L=%.2f range=%.2f avg=%.2f | vùng %.2f-%.2f (%d chạm)",
                     TimeToString(m[0].time), H, L, range, avg, zlo, zhi, g_zones[i].touches);
         PlaceOrder(false, H, L);
         return;
        }
      // Hỗ trợ: râu dưới đâm vào vùng, nến mở & đóng trên mép dưới vùng
      if(buyPattern && L <= zhi && L >= zlo - InpMaxPierce && C > zlo && O > zlo)
        {
         PrintFormat("BUY signal | nến %s H=%.2f L=%.2f range=%.2f avg=%.2f | vùng %.2f-%.2f (%d chạm)",
                     TimeToString(m[0].time), H, L, range, avg, zlo, zhi, g_zones[i].touches);
         PlaceOrder(true, H, L);
         return;
        }
     }
  }

//+------------------------------------------------------------------+
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

   //--- Kiểm tra khoảng cách tối thiểu của sàn
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
   if(lots <= 0)
      return;

   //--- Dùng expiration của sàn nếu hỗ trợ; luôn có thêm hủy thủ công trong OnTick
   ENUM_ORDER_TYPE_TIME ttype = ORDER_TIME_GTC;
   datetime expiry = 0;
   int expMode = (int)SymbolInfoInteger(_Symbol, SYMBOL_EXPIRATION_MODE);
   if((expMode & SYMBOL_EXPIRATION_SPECIFIED) == SYMBOL_EXPIRATION_SPECIFIED)
     {
      ttype  = ORDER_TIME_SPECIFIED;
      expiry = TimeCurrent() + InpExpiryMinutes * 60;
     }

   bool ok;
   if(isBuy)
      ok = trade.BuyLimit(lots, entry, _Symbol, sl, tp, ttype, expiry, "XRS buy");
   else
      ok = trade.SellLimit(lots, entry, _Symbol, sl, tp, ttype, expiry, "XRS sell");

   if(!ok && ttype == ORDER_TIME_SPECIFIED)
     {
      // Một số sàn từ chối expiration ngắn -> thử lại GTC, EA tự hủy
      if(isBuy)
         ok = trade.BuyLimit(lots, entry, _Symbol, sl, tp, ORDER_TIME_GTC, 0, "XRS buy");
      else
         ok = trade.SellLimit(lots, entry, _Symbol, sl, tp, ORDER_TIME_GTC, 0, "XRS sell");
     }

   PrintFormat("%s LIMIT %s lots=%.2f entry=%.2f sl=%.2f tp=%.2f -> %s (%u %s)",
               isBuy ? "BUY" : "SELL", _Symbol, lots, entry, sl, tp,
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
        {
         if(trade.OrderDelete(ticket))
            PrintFormat("Hủy lệnh chờ #%I64u sau %d phút không khớp", ticket, InpExpiryMinutes);
        }
     }
  }

//+------------------------------------------------------------------+
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

//+------------------------------------------------------------------+
double CalcLots(double slDist)
  {
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step    = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double lots    = InpLots;

   if(InpRiskPercent > 0 && slDist > 0)
     {
      double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
      double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(tickVal > 0 && tickSize > 0)
        {
         double riskMoney   = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPercent / 100.0;
         double lossPerLot  = slDist / tickSize * tickVal;
         lots = riskMoney / lossPerLot;
        }
     }
   if(step > 0)
      lots = MathFloor(lots / step) * step;
   lots = MathMax(minLot, MathMin(maxLot, lots));
   return NormalizeDouble(lots, 2);
  }

//+------------------------------------------------------------------+
double NormPrice(double p)
  {
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(ts <= 0) return NormalizeDouble(p, _Digits);
   return NormalizeDouble(MathRound(p / ts) * ts, _Digits);
  }

//+------------------------------------------------------------------+
bool InTradingHours()
  {
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   if(InpStartHour <= InpEndHour)
      return (dt.hour >= InpStartHour && dt.hour < InpEndHour);
   return (dt.hour >= InpStartHour || dt.hour < InpEndHour); // qua nửa đêm
  }
//+------------------------------------------------------------------+
