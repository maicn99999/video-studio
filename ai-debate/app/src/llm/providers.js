// Adapter cho 3 nhà cung cấp. Mỗi adapter: buildRequest() -> {url, headers, body}; parseResponse() -> kết quả chuẩn hóa.
// Schema đã đối chiếu với tài liệu chính thức — xem docs/API-VERIFICATION.md.
import { LlmError } from './http.js';

const trimSlash = (u) => u.replace(/\/+$/, '');

// ---------- OpenAI Responses API (cũng dùng cho Meta Model API, vốn tương thích Responses API) ----------
export function buildResponsesRequest(p, { system, prompt, maxOutputTokens }) {
  const body = {
    model: p.model,
    instructions: system,
    input: [{ role: 'user', content: prompt }],
    max_output_tokens: maxOutputTokens,
    store: false,
  };
  if (p.reasoningEffort) body.reasoning = { effort: p.reasoningEffort };
  return {
    url: `${trimSlash(p.baseUrl)}/responses`,
    headers: { authorization: `Bearer ${p.apiKey}` },
    body,
  };
}

export function parseResponsesResponse(providerLabel, json) {
  if (json.error && json.status === 'failed') {
    throw new LlmError('provider_failed', `${providerLabel}: ${json.error.message || 'phản hồi thất bại'}`);
  }
  let text = '';
  let refusal = '';
  for (const item of json.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c.type === 'output_text' && typeof c.text === 'string') text += c.text;
      if (c.type === 'refusal') refusal += c.refusal || '';
    }
  }
  if (!text && typeof json.output_text === 'string') text = json.output_text;
  if (!text && refusal) throw new LlmError('refusal', `${providerLabel} từ chối trả lời: ${refusal.slice(0, 300)}`);
  const truncated = json.status === 'incomplete';
  if (!text) {
    const reason = json.incomplete_details?.reason;
    throw new LlmError(
      truncated ? 'truncated' : 'empty',
      truncated
        ? `${providerLabel}: hết giới hạn token trước khi trả lời (${reason}). Hãy tăng DEBATE_MAX_OUTPUT_TOKENS/JUDGE_MAX_OUTPUT_TOKENS hoặc giảm reasoning effort.`
        : `${providerLabel}: phản hồi rỗng.`,
    );
  }
  const u = json.usage || {};
  return {
    text,
    model: json.model,
    stopReason: truncated ? `incomplete:${json.incomplete_details?.reason || ''}` : json.status || 'completed',
    truncated,
    usage: {
      inputTokens: u.input_tokens || 0,
      cachedInputTokens: u.input_tokens_details?.cached_tokens || 0,
      cacheWriteTokens: 0,
      outputTokens: u.output_tokens || 0,
      reasoningTokens: u.output_tokens_details?.reasoning_tokens || 0,
    },
  };
}

// ---------- Chat Completions (tùy chọn cho Meta: META_API_STYLE=chat) ----------
export function buildChatRequest(p, { system, prompt, maxOutputTokens }) {
  const body = {
    model: p.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    max_completion_tokens: maxOutputTokens,
  };
  if (p.reasoningEffort) body.reasoning_effort = p.reasoningEffort;
  return { url: `${trimSlash(p.baseUrl)}/chat/completions`, headers: { authorization: `Bearer ${p.apiKey}` }, body };
}

export function parseChatResponse(providerLabel, json) {
  const choice = json.choices?.[0];
  const text = choice?.message?.content || '';
  const truncated = choice?.finish_reason === 'length';
  if (!text) {
    if (choice?.message?.refusal) throw new LlmError('refusal', `${providerLabel} từ chối trả lời: ${choice.message.refusal}`);
    throw new LlmError(truncated ? 'truncated' : 'empty', `${providerLabel}: phản hồi rỗng${truncated ? ' (hết token)' : ''}.`);
  }
  const u = json.usage || {};
  return {
    text,
    model: json.model,
    stopReason: choice.finish_reason,
    truncated,
    usage: {
      inputTokens: u.prompt_tokens || 0,
      cachedInputTokens: u.prompt_tokens_details?.cached_tokens || 0,
      cacheWriteTokens: 0,
      outputTokens: u.completion_tokens || 0,
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens || 0,
    },
  };
}

// ---------- Anthropic Messages API ----------
export function buildAnthropicRequest(p, { system, prompt, maxOutputTokens }) {
  const headers = { 'x-api-key': p.apiKey, 'anthropic-version': p.apiVersion };
  const body = {
    model: p.model,
    max_tokens: maxOutputTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    // Claude Opus 5.5: thinking luôn bật (adaptive); độ sâu điều khiển bằng effort (mặc định model là medium).
    thinking: { type: 'adaptive' },
    output_config: { effort: p.effort },
  };
  if (p.refusalFallback) {
    // Khi bộ phân loại an toàn từ chối, API tự chạy lại trên model dự phòng do Anthropic khuyến nghị.
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }
  return { url: `${trimSlash(p.baseUrl)}/v1/messages`, headers, body };
}

export function parseAnthropicResponse(providerLabel, json) {
  if (json.stop_reason === 'refusal') {
    const cat = json.stop_details?.category ? ` (nhóm: ${json.stop_details.category})` : '';
    throw new LlmError('refusal', `${providerLabel} từ chối trả lời${cat}. Hãy diễn đạt lại vấn đề.`);
  }
  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const truncated = json.stop_reason === 'max_tokens';
  if (!text) {
    throw new LlmError(
      truncated ? 'truncated' : 'empty',
      truncated
        ? `${providerLabel}: hết giới hạn token trước khi trả lời. Hãy tăng DEBATE_MAX_OUTPUT_TOKENS hoặc giảm ANTHROPIC_EFFORT.`
        : `${providerLabel}: phản hồi rỗng.`,
    );
  }
  const u = json.usage || {};
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheWrite = u.cache_creation_input_tokens || 0;
  return {
    text,
    model: json.model,
    stopReason: json.stop_reason,
    truncated,
    usage: {
      inputTokens: (u.input_tokens || 0) + cacheRead + cacheWrite,
      cachedInputTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      outputTokens: u.output_tokens || 0,
      reasoningTokens: 0,
    },
  };
}

export const ADAPTERS = {
  openai: { build: buildResponsesRequest, parse: parseResponsesResponse },
  anthropic: { build: buildAnthropicRequest, parse: parseAnthropicResponse },
  meta: {
    build: (p, a) => (p.apiStyle === 'chat' ? buildChatRequest(p, a) : buildResponsesRequest(p, a)),
    parse: (label, json) => (json.choices ? parseChatResponse(label, json) : parseResponsesResponse(label, json)),
  },
};
