// LLM Gateway: nơi DUY NHẤT giữ API key và gọi tới OpenAI / Anthropic / Meta.
// n8n gọi vào đây qua mạng nội bộ Docker. Gateway lo: giới hạn chi phí, giới hạn đồng thời,
// retry/timeout/rate limit, idempotency (n8n retry không bị tính tiền 2 lần) và ghi nhận token/chi phí.
import { ADAPTERS } from './providers.js';
import { LlmError, postJsonWithRetry } from './http.js';
import { buildPriceTable, computeCost, worstCaseCost, round6 } from './pricing.js';
import { periods } from '../db/store.js';

export class Semaphore {
  constructor(max) { this.max = max; this.active = 0; this.queue = []; }
  async acquire() {
    if (this.active < this.max) { this.active++; return; }
    await new Promise((r) => this.queue.push(r));
    this.active++;
  }
  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const STAGE_BY_ROUND = { 1: 'round1', 2: 'round2', 3: 'round3', 4: 'judging' };

export class Gateway {
  constructor({ cfg, store, logger = console, fetchImpl, sleep }) {
    this.cfg = cfg;
    this.store = store;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.prices = buildPriceTable(cfg.priceOverrides);
    this.semaphores = Object.fromEntries(Object.keys(cfg.providers).map((k) => [k, new Semaphore(cfg.llm.maxConcurrencyPerProvider)]));
    this.reservations = new Map(); // reservationId -> { debateId, amount }
    this.inflight = new Map(); // `${debateId}:${callKey}` -> Promise (chống gọi trùng đồng thời)
    this.resSeq = 0;
  }

  reserved(debateId) {
    let s = 0;
    for (const r of this.reservations.values()) if (!debateId || r.debateId === debateId) s += r.amount;
    return s;
  }

  /** Kiểm tra 3 tầng ngân sách. Ném LlmError('budget_exceeded') nếu vượt. */
  async checkBudget(debateId, estimate) {
    const b = this.cfg.budgets;
    const [sessionSpent, daySpent, monthSpent] = await Promise.all([
      this.store.debateCost(debateId),
      this.store.sumCost(periods.startOfDayUtc()),
      this.store.sumCost(periods.startOfMonthUtc()),
    ]);
    const resAll = this.reserved();
    const checks = [
      ['phiên', sessionSpent + this.reserved(debateId), b.perSessionUsd, 'MAX_COST_PER_SESSION_USD'],
      ['ngày', daySpent + resAll, b.perDayUsd, 'MAX_COST_PER_DAY_USD'],
      ['tháng', monthSpent + resAll, b.perMonthUsd, 'MAX_COST_PER_MONTH_USD'],
    ];
    for (const [label, spent, limit, envName] of checks) {
      if (limit > 0 && spent + estimate > limit) {
        throw new LlmError('budget_exceeded',
          `Vượt giới hạn chi phí ${label}: đã dùng/giữ chỗ $${spent.toFixed(4)} + ước tính lần gọi này $${estimate.toFixed(4)} > giới hạn $${limit} (${envName}).`);
      }
    }
  }

  /**
   * req: { sessionId, round, role, stage, system, prompt, maxOutputTokens? }
   * Trả về { ok:true, ... } hoặc { ok:false, error:{code,message,retryable} } — luôn là HTTP 200 để n8n tự xử lý.
   */
  async call(req) {
    const callKey = `r${req.round}-${req.role}`;
    const key = `${req.sessionId}:${callKey}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = this._call(req, callKey).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async _call(req, callKey) {
    const { sessionId, round, role, stage, system, prompt } = req;
    const providerId = this.cfg.roles[role];
    if (!providerId) return fail('bad_request', `Vai trò không hợp lệ: ${role}`);
    const p = this.cfg.providers[providerId];
    const debate = await this.store.getDebate(sessionId, { withTurns: false });
    if (!debate) return fail('not_found', 'Không tìm thấy phiên tranh luận.');
    if (debate.status === 'cancelled') return fail('cancelled', 'Phiên đã bị hủy bởi người dùng.');

    // Idempotency: nếu lượt này đã thành công (n8n retry node), trả lại kết quả cũ, không gọi API lần nữa.
    const existing = await this.store.getTurn(sessionId, callKey);
    if (existing?.status === 'ok') return { ok: true, cached: true, ...turnToResult(existing, p) };

    if (!p.apiKey) return fail('missing_api_key', `Chưa cấu hình ${p.apiKeyVar} cho ${p.label}. Hãy thêm vào file .env rồi khởi động lại.`);

    const maxOutputTokens = req.maxOutputTokens
      || (role === 'judge' ? this.cfg.llm.judgeMaxOutputTokens : this.cfg.llm.debateMaxOutputTokens);
    const estimate = worstCaseCost(this.prices, p.model, (system || '').length + (prompt || '').length, maxOutputTokens);

    const resId = ++this.resSeq;
    try {
      await this.checkBudget(sessionId, estimate);
    } catch (e) {
      await this._recordError(sessionId, callKey, { round, role, stage, providerId, model: p.model }, e, 0, 0);
      return fail(e.code, e.message);
    }
    this.reservations.set(resId, { debateId: sessionId, amount: estimate });

    await this.store.updateDebate(sessionId, {
      status: 'running', stage: STAGE_BY_ROUND[round] || debate.stage,
      ...(debate.started_at ? {} : { started_at: new Date() }),
    });
    await this.store.upsertTurn({
      debate_id: sessionId, call_key: callKey, round, role, stage, provider: providerId, model: p.model,
      status: 'running', error: null, content: null, attempts: 0, created_at: new Date(),
    });

    const started = Date.now();
    let attempts = 0;
    const sem = this.semaphores[providerId];
    await sem.acquire();
    try {
      const adapter = ADAPTERS[providerId];
      const { url, headers, body } = adapter.build(p, { system, prompt, maxOutputTokens });
      const res = await postJsonWithRetry({
        provider: p.label, url, headers, body,
        timeoutMs: this.cfg.llm.timeoutMs,
        maxRetries: this.cfg.llm.maxRetries,
        backoffBaseMs: this.cfg.llm.backoffBaseMs,
        backoffMaxMs: this.cfg.llm.backoffMaxMs,
        deadlineMs: this.cfg.llm.callDeadlineMs,
        fetchImpl: this.fetchImpl,
        sleep: this.sleep,
        onRetry: ({ attempt, delay, error }) => {
          attempts = attempt;
          this.logger.warn?.(`[gateway] ${p.label} ${sessionId}/${callKey}: ${error.code} — thử lại lần ${attempt} sau ${delay}ms`);
          this.store.updateTurn(sessionId, callKey, { attempts: attempt,
            error: `Đang thử lại (${attempt}): ${error.message}` }).catch(() => {});
        },
      });
      attempts = res.attempts;
      const parsed = adapter.parse(p.label, res.json);
      const model = parsed.model || p.model;
      const cost = computeCost(this.prices, model, parsed.usage);
      const turn = await this.store.updateTurn(sessionId, callKey, {
        status: 'ok', content: parsed.text, model,
        input_tokens: parsed.usage.inputTokens, cached_input_tokens: parsed.usage.cachedInputTokens,
        output_tokens: parsed.usage.outputTokens, reasoning_tokens: parsed.usage.reasoningTokens,
        cost_usd: cost, attempts, latency_ms: Date.now() - started, stop_reason: parsed.stopReason,
        error: null, finished_at: new Date(),
      });
      return { ok: true, cached: false, ...turnToResult(turn, p) };
    } catch (e) {
      const err = e instanceof LlmError ? e : new LlmError('internal', `Lỗi nội bộ gateway: ${e.message}`);
      this.logger.error?.(`[gateway] ${p.label} ${sessionId}/${callKey} thất bại: ${err.code} ${err.message}`);
      await this._recordError(sessionId, callKey, { round, role, stage, providerId, model: p.model }, err, attempts || 1, Date.now() - started);
      return fail(err.code, err.message, err.retryable);
    } finally {
      sem.release();
      this.reservations.delete(resId);
    }
  }

  async _recordError(sessionId, callKey, meta, err, attempts, latency) {
    await this.store.upsertTurn({
      debate_id: sessionId, call_key: callKey, round: meta.round, role: meta.role, stage: meta.stage,
      provider: meta.providerId, model: meta.model, status: 'error', error: err.message,
      attempts, latency_ms: latency, finished_at: new Date(),
    }).catch((e) => this.logger.error?.('[gateway] không ghi được lỗi:', e.message));
  }
}

function fail(code, message, retryable = false) {
  return { ok: false, error: { code, message, retryable } };
}

function turnToResult(t, p) {
  return {
    role: t.role, round: t.round, provider: t.provider, providerLabel: p.label, model: t.model, text: t.content,
    usage: { inputTokens: t.input_tokens, cachedInputTokens: t.cached_input_tokens, outputTokens: t.output_tokens, reasoningTokens: t.reasoning_tokens },
    costUsd: round6(t.cost_usd), attempts: t.attempts, latencyMs: t.latency_ms, stopReason: t.stop_reason,
  };
}
