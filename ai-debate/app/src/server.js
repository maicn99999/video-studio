import { loadConfig, validateConfig } from './config.js';
import { createStore } from './db/store.js';
import { createApp, sweepStale } from './app.js';

const cfg = loadConfig();
const { errors, warnings } = validateConfig(cfg);
for (const w of warnings) console.warn(`[cảnh báo] ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`[lỗi cấu hình] ${e}`);
  console.error('Hãy sửa file .env (xem .env.example) rồi chạy lại.');
  process.exit(1);
}

const store = createStore(cfg);
await store.init();
const app = createApp({ cfg, store });
const server = app.listen(cfg.port, () => {
  console.log(`AI Debate app chạy tại cổng ${cfg.port} (chế độ LLM: ${cfg.llmMode}, lưu trữ: ${cfg.storage})`);
});
// Request LLM có thể kéo dài nhiều phút — không để Node cắt kết nối n8n -> gateway.
server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

const timer = setInterval(() => {
  sweepStale(store, cfg).then((n) => n && console.warn(`[watchdog] đánh dấu ${n} phiên treo là thất bại`)).catch((e) => console.error('[watchdog]', e.message));
}, 60_000);

const shutdown = async (sig) => {
  console.log(`Nhận ${sig}, đang tắt…`);
  clearInterval(timer);
  server.close();
  await store.close().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
