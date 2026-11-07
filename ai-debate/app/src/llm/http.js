// HTTP client dùng chung cho các provider: timeout, retry có backoff + jitter,
// tôn trọng header retry-after / retry-after-ms khi bị rate limit.

export class LlmError extends Error {
  constructor(code, message, { status, retryable = false, retryAfterMs, detail } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.detail = detail;
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export function parseRetryAfter(headers, now = Date.now()) {
  const ms = headers.get('retry-after-ms');
  if (ms && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));
  const ra = headers.get('retry-after');
  if (!ra) return undefined;
  if (Number.isFinite(Number(ra))) return Math.max(0, Number(ra) * 1000);
  const date = Date.parse(ra);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function backoffDelay(attempt, { baseMs, maxMs }, random = Math.random) {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  // "full jitter" trong nửa trên để tránh dồn request đồng loạt
  return Math.round(exp / 2 + random() * (exp / 2));
}

function classifyHttpError(provider, status, body) {
  const msg = body?.error?.message || body?.message || (typeof body === 'string' ? body.slice(0, 300) : '');
  const type = body?.error?.type || body?.error?.code || body?.type || '';
  const label = provider;
  if (status === 401) return new LlmError('auth', `API key của ${label} không hợp lệ (401).`, { status, detail: msg });
  if (status === 403) return new LlmError('forbidden', `${label} từ chối quyền truy cập (403): ${msg}`, { status, detail: msg });
  if (status === 404) return new LlmError('not_found', `${label}: không tìm thấy model/endpoint (404): ${msg}`, { status, detail: msg });
  if (status === 402 || /insufficient_quota|billing/i.test(type))
    return new LlmError('billing', `${label}: tài khoản hết hạn mức/thanh toán: ${msg}`, { status, detail: msg });
  if (status === 429) return new LlmError('rate_limited', `${label}: bị giới hạn tốc độ (429).`, { status, retryable: true, detail: msg });
  if (status === 529) return new LlmError('overloaded', `${label}: máy chủ quá tải (529).`, { status, retryable: true, detail: msg });
  if (RETRYABLE_STATUS.has(status)) return new LlmError('server_error', `${label}: lỗi máy chủ (${status}).`, { status, retryable: true, detail: msg });
  return new LlmError('bad_request', `${label}: yêu cầu không hợp lệ (${status}): ${msg}`, { status, detail: msg });
}

/**
 * Gửi POST JSON với retry. Trả về { json, attempts, headers }.
 * opts: { provider, url, headers, body, timeoutMs, maxRetries, backoffBaseMs, backoffMaxMs, deadlineMs, signal, sleep, fetchImpl, onRetry }
 */
export async function postJsonWithRetry(opts) {
  const {
    provider, url, headers, body, timeoutMs, maxRetries, backoffBaseMs, backoffMaxMs,
    deadlineMs = Infinity, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    fetchImpl = fetch, onRetry = () => {}, random = Math.random,
  } = opts;
  const started = Date.now();
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const remaining = deadlineMs - (Date.now() - started);
    if (remaining <= 0) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, remaining));
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = text;
      }
      if (res.ok) {
        if (typeof json !== 'object') throw new LlmError('bad_response', `${provider}: phản hồi không phải JSON.`, { retryable: true });
        return { json, attempts: attempt + 1, headers: res.headers };
      }
      const err = classifyHttpError(provider, res.status, json);
      err.retryAfterMs = parseRetryAfter(res.headers);
      throw err;
    } catch (e) {
      let err = e;
      if (!(e instanceof LlmError)) {
        err = e.name === 'AbortError'
          ? new LlmError('timeout', `${provider}: quá thời gian chờ (${Math.round(Math.min(timeoutMs, remaining) / 1000)} giây).`, { retryable: true })
          : new LlmError('network', `${provider}: lỗi kết nối mạng: ${e.message}`, { retryable: true });
      }
      lastErr = err;
      if (!err.retryable || attempt === maxRetries) throw err;
      let delay = backoffDelay(attempt, { baseMs: backoffBaseMs, maxMs: backoffMaxMs }, random);
      if (err.retryAfterMs !== undefined) delay = Math.max(delay, Math.min(err.retryAfterMs, backoffMaxMs * 2));
      if (Date.now() - started + delay >= deadlineMs) throw err;
      onRetry({ attempt: attempt + 1, delay, error: err });
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new LlmError('deadline', `${provider}: vượt quá tổng thời gian cho phép.`);
}
