// Kiểm thử end-to-end trên stack Docker thật: Postgres + n8n (workflow import thật) + app + MOCK LLM.
// Chạy qua: ./scripts/e2e.sh   (KHÔNG gọi API thật của OpenAI/Anthropic/Meta)
import assert from 'node:assert/strict';

const BASE = process.env.E2E_APP_URL || 'http://127.0.0.1:3000';
const PASSWORD = process.env.E2E_PASSWORD;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(url, label, timeoutMs = 240_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* chưa sẵn sàng */ }
    await sleep(2000);
  }
  throw new Error(`${label} không sẵn sàng sau ${timeoutMs / 1000}s`);
}

let cookie;
async function call(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), 'x-requested-with': 'aidebate', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}

const input = (tag = '') => ({
  problem: `Một quán cà phê nhỏ muốn tăng 30% doanh thu trong 3 tháng. ${tag}`,
  context: 'Quán 40 chỗ ngồi tại Đà Nẵng, khách chủ yếu là sinh viên.',
  goals: 'Tăng doanh thu 30%, giữ biên lợi nhuận.',
  constraints: 'Ngân sách marketing 20 triệu đồng/tháng.',
  criteria: [{ name: 'Tính khả thi', weight: 40 }, { name: 'Hiệu quả', weight: 40 }, { name: 'Chi phí', weight: 20 }],
});

async function runDebate(tag, { expect = 'completed', timeoutMs = 180_000 } = {}) {
  const c = await call('/api/debates', { method: 'POST', body: input(tag) });
  assert.equal(c.status, 201, `tạo phiên thất bại: ${JSON.stringify(c.body)}`);
  const end = Date.now() + timeoutMs;
  let d;
  const seen = new Set();
  while (Date.now() < end) {
    d = (await call(`/api/debates/${c.body.id}`)).body;
    seen.add(d.stage);
    if (!['queued', 'running'].includes(d.status)) break;
    await sleep(1500);
  }
  assert.equal(d.status, expect, `phiên "${tag}" kết thúc với trạng thái ${d.status}: ${d.error}`);
  return { d, seen };
}

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(`✔ ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push(`✖ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
  console.log(results.at(-1));
}

await waitHealthy(`${BASE}/healthz`, 'app');
const login = await call('/api/login', { method: 'POST', body: { password: PASSWORD } });
assert.equal(login.status, 200, 'đăng nhập thất bại');
// Chờ n8n import + publish workflow xong (webhook sẵn sàng)
await sleep(Number(process.env.E2E_N8N_WARMUP_MS || 5000));

await step('luồng đầy đủ qua n8n thật: 3 vòng + trọng tài + báo cáo', async () => {
  const { d, seen } = await runDebate('');
  assert.equal(d.turns.filter((t) => t.status === 'ok').length, 7);
  assert.ok(d.n8n_execution_id, 'thiếu n8n_execution_id');
  assert.ok(d.report_md.includes('## 2. Bảng điểm theo tiêu chí'));
  assert.ok(d.report_md.includes('## 8. Kế hoạch hành động'));
  assert.equal(d.judge.decision, 'COMBINE');
  assert.ok(d.total_cost_usd > 0);
  console.log(`   các trạng thái quan sát được: ${[...seen].join(' → ')}`);
});

await step('rate limit 429 + 500 -> retry thành công', async () => {
  const { d } = await runDebate('[mock:429] [mock:500]');
  assert.ok(d.turns.every((t) => t.attempts >= 2));
});

await step('JSON trọng tài hỏng -> nhánh sửa JSON trong n8n', async () => {
  const { d } = await runDebate('[mock:badjson]');
  assert.ok(d.turns.some((t) => t.round === 5 && t.status === 'ok'));
  assert.equal(d.judge.valid, true);
});

await step('API key sai -> Error Workflow n8n báo lỗi về app', async () => {
  const { d } = await runDebate('[mock:401]', { expect: 'failed' });
  assert.match(d.error, /API key của GPT-6 Sol không hợp lệ/);
});

await step('xuất Markdown & PDF, lịch sử, chi phí', async () => {
  const list = (await call('/api/debates?limit=50')).body;
  assert.ok(list.total >= 4);
  const id = list.items.find((x) => x.status === 'completed').id;
  const md = await call(`/api/debates/${id}/export.md`);
  assert.equal(md.status, 200);
  assert.match(md.body.toString(), /Phụ lục B — Toàn văn tranh luận/);
  const pdf = await call(`/api/debates/${id}/export.pdf`);
  if (process.env.E2E_EXPECT_PDF === 'false') {
    assert.equal(pdf.status, 500); // image build không có Chromium
  } else {
    assert.equal(pdf.status, 200, pdf.body.toString().slice(0, 300));
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
  }
  const usage = (await call('/api/usage')).body;
  assert.ok(usage.today.total > 0);
});

await step('API nội bộ bị chặn khi thiếu token', async () => {
  const r = await fetch(`${BASE}/internal/llm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 401);
});

console.log(`\n${results.filter((r) => r.startsWith('✔')).length}/${results.length} bước E2E đạt (MOCK API — không phải API thật).`);
