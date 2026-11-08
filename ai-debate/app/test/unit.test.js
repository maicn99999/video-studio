import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPriceTable, computeCost, worstCaseCost } from '../src/llm/pricing.js';
import { pricingModel } from '../src/llm/gateway.js';
import { postJsonWithRetry, parseRetryAfter, backoffDelay, LlmError } from '../src/llm/http.js';
import {
  buildResponsesRequest, parseResponsesResponse, buildAnthropicRequest, parseAnthropicResponse,
  buildGeminiRequest, parseGeminiResponse, ADAPTERS,
} from '../src/llm/providers.js';
import { loadConfig, readEnv, validateConfig } from '../src/config.js';
import { validateDebateInput } from '../src/app.js';
import { sign, verify, LoginLimiter } from '../src/auth.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------- pricing
test('computeCost: GPT-6 Sol có cache input', () => {
  const t = buildPriceTable();
  // 1M input trong đó 200k cached, 100k output
  const c = computeCost(t, 'gpt-6-sol', { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000 });
  // ... vượt ngưỡng 272K nên áp hệ số long-context: input x2, output x1.5
  const expected = (800_000 * 2 * 2 + 200_000 * 0.2 * 2 + 100_000 * 10 * 1.5) / 1e6;
  assert.equal(c, Math.round(expected * 1e6) / 1e6);
});

test('computeCost: dưới ngưỡng long-context, Claude Opus 5.5', () => {
  const t = buildPriceTable();
  assert.equal(computeCost(t, 'gpt-6-sol', { inputTokens: 10_000, outputTokens: 2_000 }), (10_000 * 2 + 2_000 * 10) / 1e6);
  assert.equal(computeCost(t, 'claude-opus-5-5', { inputTokens: 10_000, cachedInputTokens: 4_000, outputTokens: 1_000 }), (6_000 * 4 + 4_000 * 0.2 + 1_000 * 20) / 1e6);
});

test('computeCost: Gemini 4 Argon giá giới thiệu đến 30/11/2026, sau đó $4/$20', () => {
  const t = buildPriceTable();
  const u = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  assert.equal(computeCost(t, 'gemini-4-argon', u, new Date('2026-11-08T00:00:00Z')), 2 + 10);
  assert.equal(computeCost(t, 'gemini-4-argon', u, new Date('2026-12-01T00:00:00Z')), 4 + 20);
  assert.equal(computeCost(t, 'gemini-4-argon', { inputTokens: 1_000_000, cachedInputTokens: 1_000_000 }, new Date('2026-11-08T00:00:00Z')), 0.1);
});

test('pricingModel: snapshot có hậu tố quy về model cấu hình, model fallback giữ nguyên', () => {
  const t = buildPriceTable();
  assert.equal(pricingModel(t, 'gpt-6-sol-2026-04-20', 'gpt-6-sol'), 'gpt-6-sol');
  assert.equal(pricingModel(t, 'claude-opus-4-8', 'claude-opus-5-5'), 'claude-opus-4-8');
  assert.equal(pricingModel(t, undefined, 'gemini-4-argon'), 'gemini-4-argon');
});

test('computeCost: model lạ dùng giá cao nhất (không đánh giá thấp chi phí)', () => {
  const t = buildPriceTable();
  const c = computeCost(t, 'model-chua-biet', { inputTokens: 1_000_000, outputTokens: 0 });
  assert.equal(c, Math.max(...Object.values(t).map((p) => p.input)));
});

test('PRICE_OVERRIDES_JSON ghi đè giá', () => {
  const t = buildPriceTable('{"gpt-6-sol":{"input":1}}');
  assert.equal(t['gpt-6-sol'].input, 1);
  assert.equal(t['gpt-6-sol'].output, 10);
  assert.throws(() => buildPriceTable('{bad'), /PRICE_OVERRIDES_JSON/);
});

test('worstCaseCost dùng max output', () => {
  const t = buildPriceTable();
  assert.equal(worstCaseCost(t, 'claude-opus-5-5', 2500, 16000), computeCost(t, 'claude-opus-5-5', { inputTokens: 1000, outputTokens: 16000 }));
});

// ---------------------------------------------------------------- http retry
const jsonRes = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const baseOpts = { provider: 'X', url: 'http://x', headers: {}, body: {}, timeoutMs: 1000, maxRetries: 3, backoffBaseMs: 10, backoffMaxMs: 100 };

test('retry khi 429 và tôn trọng retry-after', async () => {
  const sleeps = [];
  let n = 0;
  const r = await postJsonWithRetry({
    ...baseOpts,
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => (++n < 3 ? jsonRes(429, { error: { message: 'slow down' } }, { 'retry-after': '0.15' }) : jsonRes(200, { ok: 1 })),
  });
  assert.equal(r.attempts, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps.every((s) => s >= 150), `phải chờ ≥ retry-after: ${sleeps}`);
});

test('không retry lỗi 401 / 400', async () => {
  let n = 0;
  await assert.rejects(postJsonWithRetry({ ...baseOpts, sleep: async () => {}, fetchImpl: async () => { n++; return jsonRes(401, { error: { message: 'bad key' } }); } }),
    (e) => e instanceof LlmError && e.code === 'auth' && !e.retryable);
  assert.equal(n, 1);
  n = 0;
  await assert.rejects(postJsonWithRetry({ ...baseOpts, sleep: async () => {}, fetchImpl: async () => { n++; return jsonRes(400, { error: { message: 'x' } }); } }), /không hợp lệ/);
  assert.equal(n, 1);
});

test('insufficient_quota (429) không retry', async () => {
  let n = 0;
  await assert.rejects(postJsonWithRetry({ ...baseOpts, sleep: async () => {}, fetchImpl: async () => { n++; return jsonRes(429, { error: { code: 'insufficient_quota', message: 'quota' } }); } }),
    (e) => e.code === 'billing');
  assert.equal(n, 1);
});

test('timeout được retry rồi báo lỗi tiếng Việt', async () => {
  let n = 0;
  const hang = (url, init) => new Promise((_, rej) => { n++; init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  await assert.rejects(postJsonWithRetry({ ...baseOpts, timeoutMs: 20, maxRetries: 2, sleep: async () => {}, fetchImpl: hang }),
    (e) => e.code === 'timeout' && /quá thời gian/.test(e.message));
  assert.equal(n, 3);
});

test('529 overloaded và 5xx được retry; hết lượt thì ném lỗi', async () => {
  let n = 0;
  await assert.rejects(postJsonWithRetry({ ...baseOpts, maxRetries: 2, sleep: async () => {}, fetchImpl: async () => { n++; return jsonRes(529, { error: { type: 'overloaded_error' } }); } }),
    (e) => e.code === 'overloaded');
  assert.equal(n, 3);
});

test('deadline tổng chặn retry vô hạn', async () => {
  let n = 0;
  await assert.rejects(postJsonWithRetry({ ...baseOpts, maxRetries: 10, deadlineMs: 50, backoffBaseMs: 40, backoffMaxMs: 40, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), fetchImpl: async () => { n++; return jsonRes(503, {}); } }));
  assert.ok(n < 5);
});

test('parseRetryAfter: giây, ms, ngày', () => {
  const H = (o) => new Headers(o);
  assert.equal(parseRetryAfter(H({ 'retry-after': '2' })), 2000);
  assert.equal(parseRetryAfter(H({ 'retry-after-ms': '150' })), 150);
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(parseRetryAfter(H({ 'retry-after': 'Thu, 01 Jan 2026 00:00:05 GMT' }), now), 5000);
  assert.equal(parseRetryAfter(H({})), undefined);
});

test('backoffDelay tăng theo cấp số nhân và bị chặn trên', () => {
  assert.equal(backoffDelay(0, { baseMs: 1000, maxMs: 60000 }, () => 0), 500);
  assert.equal(backoffDelay(3, { baseMs: 1000, maxMs: 60000 }, () => 1), 8000);
  assert.equal(backoffDelay(20, { baseMs: 1000, maxMs: 60000 }, () => 1), 60000);
});

// ---------------------------------------------------------------- providers
const cfg = loadConfig({ OPENAI_API_KEY: 'k1', ANTHROPIC_API_KEY: 'k2', GEMINI_API_KEY: 'k3' });

test('OpenAI Responses request đúng schema', () => {
  const r = buildResponsesRequest(cfg.providers.openai, { system: 'S', prompt: 'P', maxOutputTokens: 100 });
  assert.equal(r.url, 'https://api.openai.com/v1/responses');
  assert.equal(r.headers.authorization, 'Bearer k1');
  assert.deepEqual(r.body, { model: 'gpt-6-sol', instructions: 'S', input: [{ role: 'user', content: 'P' }], max_output_tokens: 100, store: false, reasoning: { effort: 'high' } });
});

test('Responses: đọc text, usage, reasoning & cached tokens', () => {
  const out = parseResponsesResponse('GPT', {
    status: 'completed', model: 'gpt-6-sol',
    output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'Xin ' }, { type: 'output_text', text: 'chào' }] }],
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 30 } },
  });
  assert.equal(out.text, 'Xin chào');
  assert.deepEqual(out.usage, { inputTokens: 100, cachedInputTokens: 40, cacheWriteTokens: 0, outputTokens: 50, reasoningTokens: 30 });
});

test('Responses: incomplete không có text -> lỗi truncated', () => {
  assert.throws(() => parseResponsesResponse('GPT', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning' }] }),
    (e) => e.code === 'truncated');
  assert.throws(() => parseResponsesResponse('GPT', { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }),
    (e) => e.code === 'refusal');
});

test('Anthropic request: version 2026-10-21, adaptive thinking, effort, fallback mặc định, không có temperature', () => {
  const r = buildAnthropicRequest(cfg.providers.anthropic, { system: 'S', prompt: 'P', maxOutputTokens: 1000 });
  assert.equal(r.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(r.headers['x-api-key'], 'k2');
  assert.equal(r.headers['anthropic-version'], '2026-10-21');
  assert.equal(r.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(r.body.model, 'claude-opus-5-5');
  assert.deepEqual(r.body.thinking, { type: 'adaptive' });
  assert.deepEqual(r.body.output_config, { effort: 'high' });
  assert.equal(r.body.fallbacks, 'default');
  for (const k of ['temperature', 'top_p', 'top_k']) assert.ok(!(k in r.body));
  const noFb = buildAnthropicRequest({ ...cfg.providers.anthropic, refusalFallback: false }, { system: 'S', prompt: 'P', maxOutputTokens: 10 });
  assert.ok(!('fallbacks' in noFb.body) && !noFb.headers['anthropic-beta']);
});

test('Anthropic response: bỏ qua thinking block, cộng cache vào input, refusal -> lỗi', () => {
  const out = parseAnthropicResponse('Claude', {
    model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'OK' }],
    usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 3, output_tokens: 7 },
  });
  assert.equal(out.text, 'OK');
  assert.deepEqual(out.usage, { inputTokens: 18, cachedInputTokens: 5, cacheWriteTokens: 3, outputTokens: 7, reasoningTokens: 0 });
  assert.throws(() => parseAnthropicResponse('Claude', { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }), (e) => e.code === 'refusal' && /cyber/.test(e.message));
  // model thực phục vụ (khi fallback) được giữ lại để tính giá đúng
  assert.equal(parseAnthropicResponse('Claude', { model: 'claude-opus-4-8', stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }], usage: {} }).model, 'claude-opus-4-8');
});

test('Gemini request: generateContent, x-goog-api-key, systemInstruction, thinkingLevel, JSON cho trọng tài', () => {
  const r = ADAPTERS.gemini.build(cfg.providers.gemini, { system: 'S', prompt: 'P', maxOutputTokens: 500, json: true });
  assert.equal(r.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent');
  assert.deepEqual(r.headers, { 'x-goog-api-key': 'k3' });
  assert.deepEqual(r.body, {
    systemInstruction: { parts: [{ text: 'S' }] },
    contents: [{ role: 'user', parts: [{ text: 'P' }] }],
    generationConfig: { maxOutputTokens: 500, thinkingConfig: { thinkingLevel: 'high' }, responseMimeType: 'application/json' },
  });
  assert.ok(!('responseMimeType' in buildGeminiRequest(cfg.providers.gemini, { system: 'S', prompt: 'P', maxOutputTokens: 5 }).body.generationConfig));
});

test('Gemini response: bỏ phần thought, token suy luận tính vào output', () => {
  const out = parseGeminiResponse('Gemini', {
    modelVersion: 'gemini-4-argon',
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'nghĩ…', thought: true }, { text: '{"a":' }, { text: '1}' }] } }],
    usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 20, candidatesTokenCount: 30, thoughtsTokenCount: 70 },
  });
  assert.equal(out.text, '{"a":1}');
  assert.deepEqual(out.usage, { inputTokens: 100, cachedInputTokens: 20, cacheWriteTokens: 0, outputTokens: 100, reasoningTokens: 70 });
  assert.throws(() => parseGeminiResponse('Gemini', { promptFeedback: { blockReason: 'SAFETY' } }), (e) => e.code === 'refusal');
  assert.throws(() => parseGeminiResponse('Gemini', { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }), (e) => e.code === 'refusal');
  assert.throws(() => parseGeminiResponse('Gemini', { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'x', thought: true }] } }] }), (e) => e.code === 'truncated');
  // thiếu thoughtsTokenCount (model bỏ qua suy luận) -> 0
  assert.equal(parseGeminiResponse('Gemini', { candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { candidatesTokenCount: 2 } }).usage.reasoningTokens, 0);
});

// ---------------------------------------------------------------- config & validation
test('readEnv hỗ trợ *_FILE (Docker secrets)', () => {
  const f = path.join(os.tmpdir(), `secret-${process.pid}`);
  fs.writeFileSync(f, 'sk-from-file\n');
  assert.equal(readEnv('OPENAI_API_KEY', undefined, { OPENAI_API_KEY_FILE: f, OPENAI_API_KEY: 'ignored' }), 'sk-from-file');
  fs.unlinkSync(f);
  assert.throws(() => readEnv('X', undefined, { X_FILE: '/khong/ton/tai' }), /secret/);
});

test('validateConfig bắt lỗi secret yếu và cảnh báo thiếu key', () => {
  const { errors, warnings } = validateConfig(loadConfig({ APP_PASSWORD: 'short', STORAGE: 'memory' }));
  assert.ok(errors.some((e) => e.includes('APP_PASSWORD')));
  assert.ok(errors.some((e) => e.includes('SESSION_SECRET')));
  assert.equal(warnings.length, 3);
});

test('mặc định model ID đúng yêu cầu', () => {
  const c = loadConfig({});
  assert.equal(c.providers.openai.model, 'gpt-6-sol');
  assert.equal(c.providers.anthropic.model, 'claude-opus-5-5');
  assert.equal(c.providers.gemini.model, 'gemini-4-argon');
  assert.deepEqual(c.roles, { A: 'openai', B: 'anthropic', judge: 'gemini' });
});

test('validateDebateInput', () => {
  assert.ok(validateDebateInput({ problem: 'ngắn' }).errors.length);
  const ok = validateDebateInput({ problem: 'Một vấn đề đủ dài để tranh luận', criteria: [] });
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.input.criteria.length, 5);
  assert.ok(ok.input.title.startsWith('Một vấn đề'));
  assert.ok(validateDebateInput({ problem: 'Một vấn đề đủ dài', criteria: [{ name: 'X', weight: 0 }] }).errors.length);
  assert.ok(validateDebateInput({ problem: 'Một vấn đề đủ dài', criteria: [{ name: 'X', weight: 5 }, { name: 'x', weight: 5 }] }).errors.length);
  assert.ok(validateDebateInput({ problem: 'a'.repeat(9000) }).errors.length);
});

test('cookie ký HMAC: đúng, sai chữ ký, hết hạn', () => {
  const t = sign('s'.repeat(32), { u: 'owner', exp: Date.now() / 1000 + 60 });
  assert.equal(verify('s'.repeat(32), t).u, 'owner');
  assert.equal(verify('k'.repeat(32), t), null);
  assert.equal(verify('s'.repeat(32), sign('s'.repeat(32), { exp: Date.now() / 1000 - 1 })), null);
  assert.equal(verify('s'.repeat(32), 'rác'), null);
});

test('LoginLimiter khóa sau nhiều lần sai', () => {
  const l = new LoginLimiter({ max: 3 });
  for (let i = 0; i < 3; i++) { assert.ok(l.check('ip')); l.fail('ip'); }
  assert.equal(l.check('ip'), false);
  l.reset('ip');
  assert.ok(l.check('ip'));
});
