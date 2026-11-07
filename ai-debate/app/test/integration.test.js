// Kiểm thử tích hợp: app thật (HTTP) + gateway + MOCK LLM server + workflow JSON thật (chạy bằng mini-n8n).
// LƯU Ý: đây là mock — KHÔNG gọi API OpenAI/Anthropic/Meta thật.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startStack, sampleInput, resetMock, mockStats, closeMock } from './helpers/setup.js';

let S;
before(async () => { S = await startStack(); });
after(async () => { await S.close(); await closeMock(); });

async function runDebate(stack, input) {
  const r = await stack.call('/api/debates', { method: 'POST', body: input });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const result = await stack.runs.at(-1);
  const d = (await stack.call(`/api/debates/${r.body.id}`)).body;
  return { id: r.body.id, d, result };
}

test('luồng đầy đủ: 3 vòng + trọng tài + báo cáo, token & chi phí được ghi nhận', async () => {
  await resetMock();
  const { d, result } = await runDebate(S, sampleInput());
  assert.ok(result.ok, result.error?.message);
  assert.equal(d.status, 'completed', d.error);
  assert.equal(d.stage, 'done');
  // 7 lượt gọi: 3 vòng × 2 + trọng tài
  const ok = d.turns.filter((t) => t.status === 'ok');
  assert.equal(ok.length, 7);
  for (const [round, role, model] of [[1, 'A', 'gpt-6-sol'], [1, 'B', 'claude-opus-5-5'], [2, 'A', 'gpt-6-sol'], [2, 'B', 'claude-opus-5-5'], [3, 'A', 'gpt-6-sol'], [3, 'B', 'claude-opus-5-5'], [4, 'judge', 'muse-wonder-1.0']]) {
    const t = ok.find((x) => x.round === round && x.role === role);
    assert.ok(t, `thiếu lượt ${round}/${role}`);
    assert.equal(t.model, model);
    assert.ok(t.input_tokens > 0 && t.output_tokens > 0 && t.cost_usd > 0);
  }
  assert.ok(d.total_cost_usd > 0);
  // Báo cáo tiếng Việt đủ các mục
  for (const h of ['Tóm tắt điều hành', 'Bảng điểm theo tiêu chí', 'Bảng so sánh', 'Lập luận của trọng tài', 'Giải pháp khuyến nghị', 'Bất đồng chưa được giải quyết', 'Rủi ro', 'Kế hoạch hành động', 'Token & chi phí API']) {
    assert.ok(d.report_md.includes(h), `báo cáo thiếu mục "${h}"`);
  }
  assert.equal(d.judge.decision, 'COMBINE');
  assert.equal(d.judge.valid, true);
  assert.ok(d.judge.weighted.A > 0 && d.judge.weighted.B > 0);
  // Mock xác nhận request đúng endpoint
  const st = await mockStats();
  assert.equal(st.byEndpoint['/openai/v1/responses'], 3);
  assert.equal(st.byEndpoint['/anthropic/v1/messages'], 3);
  assert.equal(st.byEndpoint['/meta/v1/responses'], 1);
});

test('Vòng 1 độc lập: prompt của mỗi bên không chứa phương án đối phương; Vòng 2 có', async () => {
  const seen = [];
  const orig = S.app.locals.gateway.call.bind(S.app.locals.gateway);
  S.app.locals.gateway.call = async (req) => { seen.push(req); return orig(req); };
  try {
    await runDebate(S, sampleInput('kiểm tra độc lập'));
  } finally {
    S.app.locals.gateway.call = orig;
  }
  const r1 = seen.filter((r) => r.round === 1);
  assert.equal(r1.length, 2);
  for (const r of r1) assert.ok(!/ĐỐI PHƯƠNG/.test(r.prompt) && !/\[MOCK\]/.test(r.prompt));
  const r2 = seen.filter((r) => r.round === 2);
  for (const r of r2) assert.match(r.prompt, /PHƯƠNG ÁN VÒNG 1 CỦA ĐỐI PHƯƠNG/);
  const judge = seen.find((r) => r.round === 4);
  // Trọng tài chấm "mù": không thấy tên model
  assert.ok(!/GPT|Claude|gpt-6|claude-opus/i.test(judge.prompt.replace(/\[MOCK\][^\n]*/g, '')), 'prompt trọng tài lộ danh tính');
});

test('rate limit 429 + lỗi 500: gateway retry và vẫn hoàn tất, số lần thử được ghi nhận', async () => {
  await resetMock();
  const { d } = await runDebate(S, sampleInput('[mock:429] [mock:500]'));
  assert.equal(d.status, 'completed', d.error);
  assert.ok(d.turns.every((t) => t.attempts >= 2), 'mỗi lượt phải retry ít nhất 1 lần');
  const st = await mockStats();
  assert.ok(st.statuses['429'] >= 7);
});

test('timeout: request treo bị cắt và retry thành công', async () => {
  const s2 = await startStack({ LLM_TIMEOUT_MS: '400' });
  try {
    await resetMock();
    const { d } = await runDebate(s2, sampleInput('[mock:timeout]'));
    assert.equal(d.status, 'completed', d.error);
    assert.ok(d.turns.filter((t) => t.round === 1).every((t) => t.attempts >= 2));
  } finally { await s2.close(); }
});

test('JSON trọng tài hỏng -> nhánh "sửa JSON" chạy và báo cáo vẫn đầy đủ', async () => {
  const { d, result } = await runDebate(S, sampleInput('[mock:badjson]'));
  assert.equal(d.status, 'completed', d.error);
  assert.ok(result.executed.includes('Trọng tài: Muse sửa JSON'));
  assert.ok(d.turns.some((t) => t.round === 5 && t.role === 'judge' && t.status === 'ok'));
  assert.equal(d.judge.valid, true);
  assert.match(d.report_md, /4b/);
});

test('JSON trọng tài hỏng cả 2 lần -> báo cáo có cảnh báo + phán quyết gốc', async () => {
  const { d } = await runDebate(S, sampleInput('[mock:badjson2]'));
  assert.equal(d.status, 'completed', d.error);
  assert.equal(d.judge.valid, false);
  assert.match(d.report_md, /Cảnh báo/);
  assert.match(d.report_md, /Phán quyết gốc của trọng tài/);
});

test('API key sai (401) -> phiên thất bại với thông báo tiếng Việt qua Error Workflow', async () => {
  const { d, result } = await runDebate(S, sampleInput('[mock:401]'));
  assert.equal(result.ok, false);
  assert.equal(result.failedNode, 'Vòng 1: Kiểm tra kết quả');
  assert.equal(d.status, 'failed');
  assert.match(d.error, /API key của GPT-6 Sol không hợp lệ/);
  assert.match(d.error, /Vòng 1/);
  // Lượt lỗi không retry
  assert.equal(d.turns.find((t) => t.role === 'A').attempts, 1);
});

test('Claude từ chối (refusal) -> phiên thất bại, thông báo rõ ràng', async () => {
  const { d } = await runDebate(S, sampleInput('[mock:refusal]'));
  assert.equal(d.status, 'failed');
  assert.match(d.error, /Claude Opus 5\.5 từ chối/);
});

test('giới hạn chi phí phiên: dừng trước khi gọi API vượt ngân sách', async () => {
  const s2 = await startStack({ MAX_COST_PER_SESSION_USD: '0.5' });
  try {
    await resetMock();
    const { d } = await runDebate(s2, sampleInput());
    assert.equal(d.status, 'failed');
    assert.match(d.error, /Vượt giới hạn chi phí phiên/);
    assert.ok(d.total_cost_usd <= 0.5);
  } finally { await s2.close(); }
});

test('giới hạn chi phí ngày: từ chối tạo phiên mới khi đã hết ngân sách', async () => {
  const s2 = await startStack({ MAX_COST_PER_DAY_USD: '0.0001' });
  try {
    const first = await runDebate(s2, sampleInput());
    assert.equal(first.d.status, 'failed'); // lượt đầu đã vượt ngân sách ngày
    await s2.store.upsertTurn({ debate_id: first.id, call_key: 'x', round: 1, role: 'A', stage: 'analysis', provider: 'openai', model: 'gpt-6-sol', status: 'ok', cost_usd: 1 });
    const r = await s2.call('/api/debates', { method: 'POST', body: sampleInput() });
    assert.equal(r.status, 402);
    assert.match(r.body.error, /ngân sách ngày/);
  } finally { await s2.close(); }
});

test('idempotency: n8n gọi lại cùng lượt không gọi API lần 2', async () => {
  await resetMock();
  const { id } = await runDebate(S, sampleInput());
  const llmCalls = (s) => Object.entries(s.byEndpoint).filter(([k]) => !k.startsWith('/__mock')).reduce((a, [, v]) => a + v, 0);
  const before = llmCalls(await mockStats());
  const r = await fetch(`${S.url}/internal/llm`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': S.cfg.internalToken },
    body: JSON.stringify({ sessionId: id, round: 1, role: 'A', stage: 'analysis', system: 's', prompt: 'p' }),
  }).then((x) => x.json());
  assert.equal(r.ok, true);
  assert.equal(r.cached, true);
  assert.equal(llmCalls(await mockStats()), before);
});

test('hủy phiên: gateway từ chối lượt tiếp theo', async () => {
  const c = await S.call('/api/debates', { method: 'POST', body: sampleInput('[mock:slow]') });
  await new Promise((r) => setTimeout(r, 300));
  const x = await S.call(`/api/debates/${c.body.id}/cancel`, { method: 'POST' });
  assert.equal(x.status, 200);
  await S.runs.at(-1);
  const d = (await S.call(`/api/debates/${c.body.id}`)).body;
  assert.equal(d.status, 'cancelled');
  assert.ok(!d.turns.some((t) => t.round >= 2 && t.status === 'ok'));
});

test('thiếu API key -> không cho tạo phiên', async () => {
  const s2 = await startStack({ META_API_KEY: '' });
  try {
    const r = await s2.call('/api/debates', { method: 'POST', body: sampleInput() });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /META_API_KEY/);
  } finally { await s2.close(); }
});

test('n8n không chạy -> phiên thất bại với hướng dẫn', async () => {
  const s2 = await startStack({ N8N_WEBHOOK_URL: 'http://127.0.0.1:9/webhook/ai-debate' });
  try {
    const r = await s2.call('/api/debates', { method: 'POST', body: sampleInput() });
    assert.equal(r.status, 502);
    const d = (await s2.call(`/api/debates/${r.body.id}`)).body;
    assert.equal(d.status, 'failed');
    assert.match(d.error, /n8n/);
  } finally { await s2.close(); }
});

test('lịch sử, tìm kiếm, xuất Markdown, chi phí, xóa', async () => {
  const { id } = await runDebate(S, sampleInput('tìm-kiếm-đặc-biệt'));
  const list = (await S.call('/api/debates?q=tìm-kiếm-đặc-biệt')).body;
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, id);
  assert.equal(list.items[0].decision, 'COMBINE');
  const md = await S.call(`/api/debates/${id}/export.md`);
  assert.equal(md.status, 200);
  assert.match(md.headers.get('content-disposition'), /attachment; filename="ai-debate-.*\.md"/);
  const text = md.body.toString('utf8');
  assert.match(text, /# Phụ lục B — Toàn văn tranh luận/);
  assert.match(text, /Vòng 2 — Phản biện chéo/);
  const usage = (await S.call('/api/usage')).body;
  assert.ok(usage.today.total > 0);
  assert.deepEqual(new Set(usage.all.byModel.map((r) => r.model)), new Set(['gpt-6-sol', 'claude-opus-5-5', 'muse-wonder-1.0']));
  assert.equal((await S.call(`/api/debates/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await S.call(`/api/debates/${id}`)).status, 404);
});

test('xuất PDF (cần Chromium)', async (t) => {
  const chromium = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
  if (!chromium) return t.skip('không có Chromium trên máy này');
  const s2 = await startStack({ CHROMIUM_PATH: chromium });
  try {
    const { id } = await runDebate(s2, sampleInput());
    const pdf = await s2.call(`/api/debates/${id}/export.pdf`);
    assert.equal(pdf.status, 200, pdf.body.toString());
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.body.length > 20_000);
  } finally { await s2.close(); }
});

test('bảo mật: cần đăng nhập, CSRF header, internal token; header bảo mật', async () => {
  assert.equal((await fetch(`${S.url}/api/debates`)).status, 401);
  const noCsrf = await fetch(`${S.url}/api/debates`, { method: 'POST', headers: { cookie: S.cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noCsrf.status, 403);
  assert.equal((await fetch(`${S.url}/internal/llm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(`${S.url}/internal/llm`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': 'sai' }, body: '{}' })).status, 401);
  const bad = await fetch(`${S.url}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'sai' }) });
  assert.equal(bad.status, 401);
  const home = await fetch(`${S.url}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  // Cấu hình trả về cho UI không bao giờ chứa API key
  const cfg = await S.call('/api/config');
  assert.ok(!JSON.stringify(cfg.body).includes('mock-openai'));
  assert.equal((await fetch(`${S.url}/healthz`)).status, 200);
});

test('webhook sai token: workflow dừng ở bước kiểm tra, không gọi AI', async () => {
  const { runWorkflow } = await import('./helpers/mini-n8n.js');
  const { loadWorkflow } = await import('./helpers/setup.js');
  const r = await runWorkflow(loadWorkflow('ai-debate.json'), {
    triggerItem: { headers: { 'x-internal-token': 'sai' }, body: { sessionId: '00000000-0000-0000-0000-000000000000' } },
    env: { DEBATE_INTERNAL_TOKEN: S.cfg.internalToken, APP_INTERNAL_URL: S.url },
  });
  assert.ok(r.ok);
  assert.deepEqual(r.executed, ['Webhook: Nhận yêu cầu', 'Kiểm tra token']);
});
