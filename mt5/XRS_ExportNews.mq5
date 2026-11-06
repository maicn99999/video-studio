//+------------------------------------------------------------------+
//|                                              XRS_ExportNews.mq5  |
//|  Script: xuất lịch tin CPI / NFP / FOMC từ lịch kinh tế MT5 ra   |
//|  file MQL5\Files\XRS_news.csv để EA XAU_ReboundScalp dùng khi    |
//|  backtest (lịch kinh tế không hoạt động trong Strategy Tester).  |
//|  Chạy script này trên chart bất kỳ của tài khoản đang kết nối.   |
//+------------------------------------------------------------------+
#property copyright "XAU Rebound Scalp - research version"
#property version   "1.00"
#property script_show_inputs

input datetime InpFrom     = D'2022.01.01';                         // Từ ngày
input datetime InpTo       = D'2027.12.31';                         // Đến ngày
input string   InpKeywords = "CPI,Nonfarm,FOMC,Fed Interest Rate";  // Từ khóa tên tin
input string   InpFile     = "XRS_news.csv";                        // Tên file

bool NameMatches(string name, const string &kw[])
  {
   StringToUpper(name);
   for(int i = 0; i < ArraySize(kw); i++)
      if(kw[i] != "" && StringFind(name, kw[i]) >= 0)
         return true;
   return false;
  }

void OnStart()
  {
   string kw[];
   int nk = StringSplit(InpKeywords, ',', kw);
   for(int i = 0; i < nk; i++)
     {
      StringTrimLeft(kw[i]);
      StringTrimRight(kw[i]);
      StringToUpper(kw[i]);
     }

   MqlCalendarValue vals[];
   int n = CalendarValueHistory(vals, InpFrom, InpTo, "US", "USD");
   if(n <= 0)
     {
      PrintFormat("Không lấy được lịch kinh tế (lỗi %d). Kiểm tra kết nối tài khoản.", GetLastError());
      return;
     }

   int h = FileOpen(InpFile, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
     {
      PrintFormat("Không tạo được file %s (lỗi %d)", InpFile, GetLastError());
      return;
     }

   int cnt = 0;
   for(int i = 0; i < n; i++)
     {
      MqlCalendarEvent ev;
      if(!CalendarEventById(vals[i].event_id, ev)) continue;
      if(ev.importance != CALENDAR_IMPORTANCE_HIGH) continue;
      if(!NameMatches(ev.name, kw)) continue;
      string name = ev.name;
      StringReplace(name, ",", " ");
      FileWriteString(h, TimeToString(vals[i].time, TIME_DATE | TIME_MINUTES) + "," + name + "\r\n");
      cnt++;
     }
   FileClose(h);
   PrintFormat("Đã xuất %d tin vào %s\\MQL5\\Files\\%s (giờ server)",
               cnt, TerminalInfoString(TERMINAL_DATA_PATH), InpFile);
  }
//+------------------------------------------------------------------+
