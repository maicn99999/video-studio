import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config.js';
import { MemoryStore } from '../../src/db/store.js';
import { createApp } from '../../src/app.js';
import { startMock } from '../../mock/server.js';
import { runWorkflow } from './mini-n8n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WF_DIR = path.join(__dirname, '../../../n8n/workflows');
export const loadWorkflow = (f) => JSON.parse(fs.readFileSync(path.join(WF_DIR, f), 'utf8'));

let mockServer;
export async function mockBase() {
  if (!mockServer) mockServer = await startMock(0);
  return `http://127.0.0.1:${mockServer.address().port}`;
}

export async function resetMock() {
  await fetch(`${await mockBase()}/__mock/reset`, { method: 'POST' });
}
export async function mockStats() {
  return (await fetch(`${await mockBase()}/__mock/stats`)).json();
}

export async function testConfig(overrides = {}) {
  const base = await mockBase();
  return loadConfig({
    APP_PASSWORD: 'test-password-123',
    SESSION_SECRET: 'x'.repeat(40),
    DEBATE_INTERNAL_TOKEN: 'internal-token-abcdefghijklmnop',
    COOKIE_SECURE: 'false',
    STORAGE: 'memory',
    LLM_MODE: 'mock',
    OPENAI_API_KEY: 'mock-openai',
    ANTHROPIC_API_KEY: 'mock-anthropic',
    META_API_KEY: 'mock-meta',
    OPENAI_BASE_URL: `${base}/openai/v1`,
    ANTHROPIC_BASE_URL: `${base}/anthropic`,
    META_BASE_URL: `${base}/meta/v1`,
    LLM_BACKOFF_BASE_MS: '10',
    LLM_BACKOFF_MAX_MS: '50',
    LLM_TIMEOUT_MS: '3000',
    ...overrides,
  });
}

/**
 * Khởi động app thật (HTTP) + giả lập n8n bằng mini-n8n chạy đúng file workflow JSON.
 * Trả về { url, cfg, store, close, cookie, runs }.
 */
export async function startStack(overrides = {}) {
  const cfg = await testConfig(overrides);
  const store = new MemoryStore();
  const runs = [];
  let appUrl;
  const mainWf = loadWorkflow('ai-debate.json');
  const errWf = loadWorkflow('ai-debate-error.json');
  let execSeq = 100;
  const env = { DEBATE_INTERNAL_TOKEN: cfg.internalToken, get APP_INTERNAL_URL() { return appUrl; } };
  // fetch của app: chặn lời gọi webhook n8n và chạy workflow bằng mini-n8n (bất đồng bộ như n8n thật).
  const fetchImpl = async (url, init) => {
    if (String(url) === 'http://n8n:5678/webhook/ai-debate') {
      const executionId = String(++execSeq);
      const headers = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
      const p = runWorkflow(mainWf, { triggerItem: { headers, body: JSON.parse(init.body), params: {}, query: {} }, env, executionId })
        .then(async (r) => {
          if (!r.ok) {
            await runWorkflow(errWf, {
              triggerItem: { execution: { id: executionId, error: { message: r.error.message }, lastNodeExecuted: r.failedNode }, workflow: { id: mainWf.id } },
              env, executionId: `${executionId}-err`,
            });
          }
          return r;
        });
      runs.push(p);
      return new Response(JSON.stringify({ message: 'Workflow was started' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return fetch(url, init);
  };
  const app = createApp({ cfg, store, fetchImpl, logger: { warn() {}, error() {}, log() {} } });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  appUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${appUrl}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: cfg.appPassword }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = async (p, { method = 'GET', body } = {}) => {
    const r = await fetch(`${appUrl}${p}`, {
      method, headers: { cookie, 'x-requested-with': 'aidebate', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return { url: appUrl, cfg, store, runs, cookie, call, app, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
}

export const sampleInput = (extra = '') => ({
  problem: `Công ty bán lẻ 50 cửa hàng muốn giảm 20% hàng tồn kho trong 6 tháng mà không làm giảm doanh thu. ${extra}`,
  context: 'Chuỗi bán lẻ điện máy tại Việt Nam, đang dùng Excel để quản lý tồn kho.',
  goals: 'Giảm 20% tồn kho, giữ doanh thu, tăng vòng quay hàng.',
  constraints: 'Ngân sách 2 tỷ đồng, 3 nhân sự IT.',
  criteria: [
    { name: 'Tính khả thi', weight: 30, description: '' },
    { name: 'Hiệu quả', weight: 40, description: '' },
    { name: 'Rủi ro', weight: 30, description: '' },
  ],
});

export async function closeMock() {
  if (!mockServer) return;
  mockServer.closeAllConnections?.();
  await new Promise((r) => mockServer.close(r));
  mockServer = null;
}
