// Express app: giao diện web, API công khai (cần đăng nhập) và API nội bộ cho n8n.
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRoutes, requireLogin, requireInternal } from './auth.js';
import { Gateway } from './llm/gateway.js';
import { missingKeys, validateConfig } from './config.js';
import { periods } from './db/store.js';
import { buildFullMarkdown, printableHtml, renderPdf } from './export/render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export const DEFAULT_CRITERIA = [
  { name: 'Tính khả thi', weight: 25, description: 'Có thực hiện được với nguồn lực và thời gian thực tế không' },
  { name: 'Hiệu quả & tác động', weight: 25, description: 'Mức độ đạt mục tiêu, giá trị mang lại' },
  { name: 'Kiểm soát rủi ro', weight: 20, description: 'Nhận diện và giảm thiểu rủi ro tốt đến đâu' },
  { name: 'Chi phí & nguồn lực', weight: 15, description: 'Chi phí hợp lý, sử dụng nguồn lực hiệu quả' },
  { name: 'Tính bền vững & sáng tạo', weight: 15, description: 'Hiệu quả lâu dài, cách tiếp cận mới' },
];

const LIMITS = { problem: 8000, context: 16000, goals: 4000, constraints: 4000, title: 200 };

export function validateDebateInput(body) {
  const errors = [];
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const input = {
    title: str(body.title),
    problem: str(body.problem),
    context: str(body.context),
    goals: str(body.goals),
    constraints: str(body.constraints),
  };
  if (input.problem.length < 10) errors.push('Vấn đề cần tranh luận phải có ít nhất 10 ký tự.');
  for (const [k, max] of Object.entries(LIMITS)) {
    if (input[k].length > max) errors.push(`Trường "${k}" quá dài (tối đa ${max} ký tự).`);
  }
  let criteria = Array.isArray(body.criteria) ? body.criteria : [];
  criteria = criteria
    .map((c) => ({ name: str(c?.name), weight: Number(c?.weight), description: str(c?.description) }))
    .filter((c) => c.name);
  if (!criteria.length) criteria = DEFAULT_CRITERIA.map((c) => ({ ...c }));
  if (criteria.length > 10) errors.push('Tối đa 10 tiêu chí chấm điểm.');
  for (const c of criteria) {
    if (c.name.length > 100) errors.push(`Tên tiêu chí quá dài: ${c.name.slice(0, 30)}…`);
    if (c.description.length > 300) errors.push(`Mô tả tiêu chí "${c.name}" quá dài.`);
    if (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 100) errors.push(`Trọng số của "${c.name}" phải là số nguyên 1–100.`);
  }
  const names = new Set(criteria.map((c) => c.name.toLowerCase()));
  if (names.size !== criteria.length) errors.push('Tên tiêu chí bị trùng.');
  input.criteria = criteria;
  if (!input.title) input.title = input.problem.slice(0, 90) + (input.problem.length > 90 ? '…' : '');
  return { input, errors };
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export function createApp({ cfg, store, fetchImpl = fetch, logger = console, sleep }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  const gateway = new Gateway({ cfg, store, logger, fetchImpl, sleep });
  app.locals.gateway = gateway;

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
  });

  app.get('/healthz', async (req, res) => {
    try {
      await store.ping();
      res.json({ ok: true, llmMode: cfg.llmMode });
    } catch (e) {
      res.status(503).json({ ok: false, error: e.message });
    }
  });

  // ------------------------------------------------------------- API nội bộ (n8n -> app)
  const internal = express.Router();
  internal.use(express.json({ limit: '10mb' }));
  internal.use(requireInternal(cfg));

  internal.post('/llm', async (req, res) => {
    const b = req.body || {};
    if (!b.sessionId || !b.role || !b.round || !b.prompt) return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'Thiếu sessionId/role/round/prompt' } });
    res.json(await gateway.call(b));
  });

  internal.post('/sessions/:id/start', async (req, res) => {
    const d = await store.getDebate(req.params.id, { withTurns: false });
    if (!d) return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    if (d.status === 'cancelled') return res.json({ cancelled: true });
    await store.updateDebate(d.id, {
      status: 'running', stage: 'round1', started_at: d.started_at || new Date(),
      n8n_execution_id: req.body?.executionId ? String(req.body.executionId) : d.n8n_execution_id,
    });
    const P = cfg.providers;
    res.json({
      id: d.id, title: d.title, input: d.input, cancelled: false,
      participants: {
        A: { label: P[cfg.roles.A].label, model: P[cfg.roles.A].model },
        B: { label: P[cfg.roles.B].label, model: P[cfg.roles.B].model },
        judge: { label: P[cfg.roles.judge].label, model: P[cfg.roles.judge].model },
      },
    });
  });

  internal.post('/sessions/:id/progress', async (req, res) => {
    const d = await store.getDebate(req.params.id, { withTurns: false });
    if (!d) return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    if (!TERMINAL.has(d.status) && req.body?.stage) await store.updateDebate(d.id, { stage: String(req.body.stage).slice(0, 30) });
    res.json({ ok: true, cancelled: d.status === 'cancelled' });
  });

  internal.post('/sessions/:id/complete', async (req, res) => {
    const d = await store.getDebate(req.params.id, { withTurns: false });
    if (!d) return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    if (d.status === 'cancelled') return res.json({ ok: true, ignored: true });
    const { reportMarkdown, judge } = req.body || {};
    if (typeof reportMarkdown !== 'string' || !reportMarkdown.trim()) return res.status(400).json({ error: 'Thiếu reportMarkdown' });
    await store.updateDebate(d.id, {
      status: 'completed', stage: 'done', report_md: reportMarkdown, judge: judge || null, error: null, finished_at: new Date(),
    });
    res.json({ ok: true });
  });

  const failSession = async (d, message, node) => {
    if (!d || TERMINAL.has(d.status)) return false;
    await store.updateDebate(d.id, {
      status: 'failed', error: `${message}${node ? ` (bước: ${node})` : ''}`.slice(0, 2000), finished_at: new Date(),
    });
    return true;
  };

  internal.post('/sessions/:id/fail', async (req, res) => {
    const d = await store.getDebate(req.params.id, { withTurns: false });
    if (!d) return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    res.json({ ok: true, updated: await failSession(d, req.body?.message || 'Lỗi không xác định', req.body?.node) });
  });

  // Error workflow của n8n gọi vào đây khi bất kỳ node nào thất bại.
  internal.post('/n8n-error', async (req, res) => {
    const { executionId, message, node } = req.body || {};
    const d = executionId ? await store.findDebateByExecution(executionId) : null;
    if (!d) return res.json({ ok: true, matched: false });
    res.json({ ok: true, matched: true, updated: await failSession(d, message || 'Workflow n8n thất bại', node) });
  });

  app.use('/internal', internal);

  // ------------------------------------------------------------- API công khai (cần đăng nhập)
  app.use('/api', express.json({ limit: '200kb' }));
  authRoutes(app, cfg);
  const api = express.Router();
  api.use(requireLogin(cfg));

  api.get('/me', (req, res) => res.json({ ok: true }));

  api.get('/config', (req, res) => {
    const P = cfg.providers;
    const { warnings } = validateConfig(cfg);
    res.json({
      llmMode: cfg.llmMode,
      participants: {
        A: { label: P.openai.label, model: P.openai.model },
        B: { label: P.anthropic.label, model: P.anthropic.model },
        judge: { label: P.gemini.label, model: P.gemini.model },
      },
      defaultCriteria: DEFAULT_CRITERIA,
      budgets: cfg.budgets,
      maxOutputTokens: { debate: cfg.llm.debateMaxOutputTokens, judge: cfg.llm.judgeMaxOutputTokens },
      missingKeys: missingKeys(cfg),
      warnings,
    });
  });

  api.get('/debates', async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const status = ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(req.query.status) ? req.query.status : undefined;
    res.json(await store.listDebates({ limit, offset, q: String(req.query.q || '').slice(0, 200), status }));
  });

  api.post('/debates', async (req, res) => {
    const { input, errors } = validateDebateInput(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const missing = missingKeys(cfg);
    if (missing.length) return res.status(400).json({ error: `Chưa cấu hình API key: ${missing.join(', ')}. Xem README mục "Cấu hình API key".` });
    if ((await store.countActive()) >= cfg.maxConcurrentDebates) {
      return res.status(429).json({ error: `Đang có ${cfg.maxConcurrentDebates} phiên chạy. Vui lòng đợi một phiên hoàn tất (MAX_CONCURRENT_DEBATES).` });
    }
    const [day, month] = await Promise.all([store.sumCost(periods.startOfDayUtc()), store.sumCost(periods.startOfMonthUtc())]);
    if (cfg.budgets.perDayUsd > 0 && day >= cfg.budgets.perDayUsd) return res.status(402).json({ error: `Đã hết ngân sách ngày ($${cfg.budgets.perDayUsd}). Hãy đợi sang ngày mới (UTC) hoặc tăng MAX_COST_PER_DAY_USD.` });
    if (cfg.budgets.perMonthUsd > 0 && month >= cfg.budgets.perMonthUsd) return res.status(402).json({ error: `Đã hết ngân sách tháng ($${cfg.budgets.perMonthUsd}).` });

    const id = crypto.randomUUID();
    const { title, ...rest } = input;
    const d = await store.createDebate({ id, title, input: rest });
    try {
      const r = await fetchImpl(cfg.n8nWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': cfg.internalToken },
        body: JSON.stringify({ sessionId: id }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new Error(`n8n trả về HTTP ${r.status}${r.status === 404 ? ' — workflow "AI Debate" chưa được kích hoạt (publish)' : ''}`);
    } catch (e) {
      await store.updateDebate(id, { status: 'failed', error: `Không khởi động được workflow n8n: ${e.message}`, finished_at: new Date() });
      return res.status(502).json({ error: `Không khởi động được workflow n8n: ${e.message}`, id });
    }
    res.status(201).json({ id: d.id });
  });

  api.get('/debates/:id', async (req, res) => {
    const d = await store.getDebate(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    res.json(d);
  });

  api.post('/debates/:id/cancel', async (req, res) => {
    const d = await store.getDebate(req.params.id, { withTurns: false });
    if (!d) return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    if (TERMINAL.has(d.status)) return res.status(409).json({ error: 'Phiên đã kết thúc.' });
    await store.updateDebate(d.id, { status: 'cancelled', error: 'Người dùng đã hủy phiên.', finished_at: new Date() });
    res.json({ ok: true });
  });

  api.delete('/debates/:id', async (req, res) => {
    const d = await store.getDebate(req.params.id, { withTurns: false });
    if (!d) return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    if (!TERMINAL.has(d.status)) return res.status(409).json({ error: 'Hãy hủy phiên trước khi xóa.' });
    await store.deleteDebate(d.id);
    res.json({ ok: true });
  });

  const fileName = (d, ext) => `ai-debate-${new Date(d.created_at).toISOString().slice(0, 10)}-${d.id.slice(0, 8)}.${ext}`;

  api.get('/debates/:id/export.md', async (req, res) => {
    const d = await store.getDebate(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName(d, 'md')}"`);
    res.send(buildFullMarkdown(d));
  });

  api.get('/debates/:id/export.pdf', async (req, res) => {
    const d = await store.getDebate(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    try {
      const pdf = await renderPdf(printableHtml(d), cfg.chromiumPath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName(d, 'pdf')}"`);
      res.send(Buffer.from(pdf));
    } catch (e) {
      logger.error?.('[pdf]', e);
      res.status(500).json({ error: `Không tạo được PDF: ${e.message}. Bạn có thể dùng nút "In" của trình duyệt.` });
    }
  });

  api.get('/usage', async (req, res) => {
    const [today, month, all] = await Promise.all([
      store.usageByModel(periods.startOfDayUtc()),
      store.usageByModel(periods.startOfMonthUtc()),
      store.usageByModel(null),
    ]);
    const total = (rows) => rows.reduce((s, r) => s + Number(r.cost_usd), 0);
    res.json({
      budgets: cfg.budgets,
      today: { total: total(today), byModel: today },
      month: { total: total(month), byModel: month },
      all: { total: total(all), byModel: all },
    });
  });

  app.use('/api', api);

  // ------------------------------------------------------------- Giao diện tĩnh
  app.get('/vendor/marked.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules/marked/lib/marked.umd.js')));
  app.get('/vendor/purify.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules/dompurify/dist/purify.min.js')));
  app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html', maxAge: '1h' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error?.('[app]', err);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON không hợp lệ.' });
    res.status(500).json({ error: 'Lỗi máy chủ. Xem log của container app.' });
  });

  return app;
}

// Đánh dấu thất bại các phiên bị treo (n8n sập, container khởi động lại…)
export async function sweepStale(store, cfg, now = new Date()) {
  const before = new Date(now.getTime() - cfg.sessionTimeoutMin * 60_000);
  const stale = await store.listStale(before);
  for (const d of stale) {
    await store.updateDebate(d.id, {
      status: 'failed', finished_at: now,
      error: `Phiên không có tiến triển trong ${cfg.sessionTimeoutMin} phút (n8n có thể đã dừng). Hãy kiểm tra container n8n rồi chạy lại.`,
    });
  }
  return stale.length;
}
