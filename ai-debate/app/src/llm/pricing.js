// Bảng giá USD / 1 triệu token. Nguồn & ngày kiểm tra ghi trong docs/API-VERIFICATION.md.
// Có thể ghi đè bằng biến PRICE_OVERRIDES_JSON, ví dụ:
//   {"gpt-6-sol":{"input":2,"cachedInput":0.2,"output":10}}
export const DEFAULT_PRICES = {
  // OpenAI — developers.openai.com/api/docs/models/gpt-6-sol
  'gpt-6-sol': {
    input: 2.0, cachedInput: 0.2, output: 10.0,
    // Prompt > 272K token input: input x2, output x1.5 cho toàn bộ request.
    longContext: { thresholdInputTokens: 272_000, inputMultiplier: 2, outputMultiplier: 1.5 },
  },
  'gpt-6.1-sol': {
    input: 2.0, cachedInput: 0.1, output: 10.0,
    longContext: { thresholdInputTokens: 272_000, inputMultiplier: 2, outputMultiplier: 1.5 },
  },
  // Anthropic — platform.claude.com pricing (cache write 5 phút = 1.25x input)
  'claude-opus-5-5': { input: 4.0, cachedInput: 0.2, cacheWrite: 5.0, output: 20.0 },
  // Các model mà server-side refusal fallback có thể chuyển sang
  'claude-opus-5': { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  'claude-opus-4-8': { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  // Meta — dev.meta.ai/docs/pricing-rate-limits (Standard mode)
  'muse-wonder-1.0': { input: 4.0, cachedInput: 0.2, output: 20.0 },
};

export function buildPriceTable(overridesJson) {
  const table = structuredClone(DEFAULT_PRICES);
  if (overridesJson) {
    let o;
    try {
      o = JSON.parse(overridesJson);
    } catch {
      throw new Error('PRICE_OVERRIDES_JSON không phải JSON hợp lệ.');
    }
    for (const [model, p] of Object.entries(o)) table[model] = { ...(table[model] || {}), ...p };
  }
  return table;
}

// Giá "an toàn" cho model lạ: dùng mức cao nhất trong bảng để không đánh giá thấp chi phí.
function fallbackPrice(table) {
  const vals = Object.values(table);
  return {
    input: Math.max(...vals.map((v) => v.input)),
    cachedInput: Math.max(...vals.map((v) => v.cachedInput ?? v.input)),
    output: Math.max(...vals.map((v) => v.output)),
    unknown: true,
  };
}

export function priceFor(table, model) {
  return table[model] || fallbackPrice(table);
}

/**
 * Tính chi phí thực tế từ usage đã chuẩn hóa.
 * usage = { inputTokens (tổng input, gồm cả phần cached), cachedInputTokens, cacheWriteTokens, outputTokens }
 */
export function computeCost(table, model, usage) {
  const p = priceFor(table, model);
  const input = usage.inputTokens || 0;
  const cached = Math.min(usage.cachedInputTokens || 0, input);
  const cacheWrite = Math.min(usage.cacheWriteTokens || 0, input - cached);
  const fresh = input - cached - cacheWrite;
  let inMul = 1;
  let outMul = 1;
  if (p.longContext && input > p.longContext.thresholdInputTokens) {
    inMul = p.longContext.inputMultiplier;
    outMul = p.longContext.outputMultiplier;
  }
  const cost =
    (fresh * p.input * inMul +
      cached * (p.cachedInput ?? p.input) * inMul +
      cacheWrite * (p.cacheWrite ?? p.input) * inMul +
      (usage.outputTokens || 0) * p.output * outMul) /
    1_000_000;
  return round6(cost);
}

// Ước tính token từ số ký tự. Tiếng Việt có dấu tốn token hơn tiếng Anh nên dùng hệ số bảo thủ.
export function estimateTokens(text) {
  return Math.ceil((text || '').length / 2.5);
}

// Chi phí xấu nhất của một lần gọi (dùng để giữ chỗ ngân sách trước khi gọi).
export function worstCaseCost(table, model, promptChars, maxOutputTokens) {
  return computeCost(table, model, {
    inputTokens: Math.ceil(promptChars / 2.5),
    outputTokens: maxOutputTokens,
  });
}

export const round6 = (n) => Math.round(n * 1e6) / 1e6;
