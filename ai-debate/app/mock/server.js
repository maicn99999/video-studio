// MOCK LLM SERVER — chỉ dùng để chạy thử/kiểm thử khi chưa có API key thật.
// Mô phỏng: OpenAI Responses API, Anthropic Messages API, Meta Model API (Responses + Chat Completions).
// Kiểm tra header/schema giống API thật để phát hiện lỗi định dạng request của gateway.
//
// Chèn lỗi bằng cách đặt "thẻ" trong nội dung vấn đề:
//   [mock:429]      lần gọi đầu mỗi lượt trả 429 kèm retry-after: 1
//   [mock:500]      lần gọi đầu mỗi lượt trả 500
//   [mock:529]      Anthropic trả 529 overloaded ở lần đầu
//   [mock:timeout]  lần gọi đầu bị treo (để kiểm tra timeout)
//   [mock:badjson]  trọng tài trả JSON hỏng ở lần đầu (kiểm tra nhánh sửa JSON)
//   [mock:badjson2] trọng tài luôn trả JSON hỏng
//   [mock:refusal]  Claude từ chối (stop_reason=refusal)
//   [mock:401]      OpenAI trả 401 (key sai)
//   [mock:slow]     mỗi phản hồi chậm 2 giây
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 4010);
const BASE_DELAY = Number(process.env.MOCK_DELAY_MS || 200);
const attempts = new Map();
const stats = { requests: 0, byEndpoint: {}, statuses: {} };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = (s) => Math.ceil(String(s || '').length / 3);

function send(res, status, body, headers = {}) {
  stats.statuses[status] = (stats.statuses[status] || 0) + 1;
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); }
    });
  });
}

function criteriaFrom(prompt) {
  const out = [];
  const re = /^\d+\. "([^"]+)" — trọng số (\d+)/gm;
  let m;
  while ((m = re.exec(prompt))) out.push(m[1]);
  // Prompt sửa JSON liệt kê tiêu chí dạng: Tên tiêu chí chính xác: "a", "b".
  const exact = prompt.match(/Tên tiêu chí chính xác: (.+)\./);
  if (!out.length && exact) for (const x of exact[1].matchAll(/"([^"]+)"/g)) out.push(x[1]);
  return out.length ? out : ['Tính khả thi'];
}

function debaterText(round, side, provider) {
  const who = provider === 'openai' ? 'GPT (mock)' : 'Claude (mock)';
  if (round === 1) {
    return `## 1. Tóm tắt phương án\n[MOCK] ${who} — Bên ${side} đề xuất triển khai theo 3 giai đoạn, ưu tiên thử nghiệm nhỏ trước khi mở rộng.\n\n## 2. Phân tích vấn đề & nguyên nhân gốc\n- Nguyên nhân 1: thiếu dữ liệu đo lường.\n- Nguyên nhân 2: quy trình chưa chuẩn hóa.\n\n## 3. Giải pháp đề xuất\n1. Khảo sát hiện trạng (2 tuần).\n2. Thí điểm (1 tháng).\n3. Mở rộng (3 tháng).\n\n## 4. Lập luận & bằng chứng\nCách tiếp cận lặp giảm rủi ro (ước tính).\n\n## 5. Giả định chính\n- Có ngân sách tối thiểu.\n\n## 6. Rủi ro & cách giảm thiểu\n| Rủi ro | Giảm thiểu |\n|---|---|\n| Chậm tiến độ | Mốc kiểm tra hằng tuần |\n\n## 7. Chi phí / nguồn lực ước tính\nKhoảng 2 nhân sự (ước tính).\n\n## 8. KPI\n- Tỷ lệ hoàn thành mốc ≥ 90%.`;
  }
  if (round === 2) {
    return `## 1. Điểm mạnh của phương án đối phương\n[MOCK] ${who} công nhận lộ trình rõ ràng.\n\n## 2. Điểm yếu\n- Thiếu ước tính chi phí chi tiết.\n\n## 3. Rủi ro bị bỏ sót\n- Rủi ro nhân sự nghỉ việc.\n\n## 4. Câu hỏi chất vấn\n1. Ngân sách dự phòng là bao nhiêu?\n\n## 5. Điểm đồng thuận\n- Cần thí điểm trước.\n\n## 6. Điều chỉnh dự kiến\n- Bổ sung kế hoạch nhân sự.`;
  }
  return `## 1. Thay đổi so với Vòng 1\n[MOCK] ${who} bổ sung ngân sách dự phòng 15%.\n\n## 2. Phản hồi phản biện\n- Chấp nhận: cần kế hoạch nhân sự.\n\n## 3. Phương án cuối cùng\n1. Khảo sát. 2. Thí điểm. 3. Mở rộng.\n\n## 4. Rủi ro còn lại\n- Thay đổi thị trường.\n\n## 5. Kế hoạch hành động\n| Bước | Việc | Thời hạn | KPI |\n|---|---|---|---|\n| 1 | Khảo sát | 2 tuần | Báo cáo hiện trạng |\n\n## 6. Bất đồng còn lại\n- Tốc độ mở rộng.`;
}

function judgeJson(prompt) {
  const crit = criteriaFrom(prompt);
  return {
    summary: '[MOCK] Hai bên đều đề xuất lộ trình thí điểm; Bên B xử lý phản biện tốt hơn một chút.',
    scores: {
      A: crit.map((c, i) => ({ criterion: c, score: 7 + (i % 2) * 0.5, comment: `A ổn ở "${c}"` })),
      B: crit.map((c, i) => ({ criterion: c, score: 7.5 + (i % 3) * 0.5, comment: `B tốt ở "${c}"` })),
    },
    decision: 'COMBINE',
    decisionRationale: 'Kết hợp lộ trình của A với kế hoạch rủi ro của B (mock).',
    finalSolution: '1. Khảo sát hiện trạng.\n2. Thí điểm có ngân sách dự phòng 15%.\n3. Mở rộng theo dữ liệu.',
    comparison: [
      { aspect: 'Lộ trình', A: 'Rõ ràng', B: 'Rõ ràng', better: 'Ngang nhau' },
      { aspect: 'Quản trị rủi ro', A: 'Cơ bản', B: 'Chi tiết hơn', better: 'B' },
    ],
    strengths: { A: ['Đơn giản, dễ làm'], B: ['Quản trị rủi ro tốt'] },
    weaknesses: { A: ['Thiếu chi phí chi tiết'], B: ['Hơi phức tạp'] },
    unresolvedDisagreements: [{ issue: 'Tốc độ mở rộng', positionA: 'Nhanh', positionB: 'Thận trọng', judgeView: 'Chưa đủ dữ liệu', howToResolve: 'Đo kết quả thí điểm 1 tháng' }],
    risks: [{ risk: 'Chậm tiến độ', severity: 'Trung bình', likelihood: 'Trung bình', mitigation: 'Mốc kiểm tra hằng tuần' }],
    actionPlan: [
      { step: 1, action: 'Khảo sát hiện trạng', owner: 'Trưởng dự án', timeline: 'Tuần 1–2', kpi: 'Báo cáo hiện trạng' },
      { step: 2, action: 'Thí điểm', owner: 'Nhóm vận hành', timeline: 'Tháng 1', kpi: '≥ 90% mốc đạt' },
    ],
    confidence: 72,
  };
}

function generate(provider, system, prompt) {
  const all = `${system}\n${prompt}`;
  if (/chuẩn hóa dữ liệu/.test(system)) {
    if (all.includes('[mock:badjson2]')) return 'Xin lỗi, đây vẫn không phải JSON.';
    return JSON.stringify(judgeJson(prompt));
  }
  if (/YÊU CẦU CHẤM ĐIỂM/.test(prompt)) {
    // Giữ thẻ trong văn bản hỏng để prompt "sửa JSON" cũng mang thẻ đó.
    if (all.includes('[mock:badjson2]')) return 'Phán quyết [mock:badjson2]: B tốt hơn. { "summary": "thiếu dấu đóng"';
    if (all.includes('[mock:badjson]')) return 'Phán quyết: B tốt hơn. { "summary": "thiếu dấu đóng"';
    return JSON.stringify(judgeJson(prompt), null, 1);
  }
  const round = /VÒNG 3/.test(prompt) ? 3 : /VÒNG 2/.test(prompt) ? 2 : 1;
  const side = /"Bên B"/.test(system) ? 'B' : 'A';
  return debaterText(round, side, provider);
}

function bearer(req) {
  const a = req.headers.authorization || '';
  return a.startsWith('Bearer ') ? a.slice(7) : '';
}

async function faults(res, key, all, provider) {
  const n = (attempts.get(key) || 0) + 1;
  attempts.set(key, n);
  if (all.includes('[mock:slow]')) await sleep(2000);
  else await sleep(BASE_DELAY);
  if (n === 1 && all.includes('[mock:429]')) { send(res, 429, { error: { type: 'rate_limit_error', message: 'mock rate limit' } }, { 'retry-after': '1' }); return true; }
  if (n === 1 && all.includes('[mock:500]')) { send(res, 500, { error: { type: 'api_error', message: 'mock server error' } }); return true; }
  if (n === 1 && all.includes('[mock:529]') && provider === 'anthropic') { send(res, 529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }); return true; }
  if (n === 1 && all.includes('[mock:timeout]')) { await sleep(Number(process.env.MOCK_TIMEOUT_HANG_MS || 8000)); send(res, 504, { error: { message: 'late' } }); return true; }
  if (all.includes('[mock:401]') && provider === 'openai') { send(res, 401, { error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key provided' } }); return true; }
  return false;
}

function responsesShape(model, text, inTok) {
  const reasoning = 120;
  return {
    id: `resp_${crypto.randomUUID()}`, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model,
    output: [
      { type: 'reasoning', id: `rs_${crypto.randomUUID()}`, summary: [] },
      { type: 'message', id: `msg_${crypto.randomUUID()}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] },
    ],
    usage: {
      input_tokens: inTok, input_tokens_details: { cached_tokens: 0 },
      output_tokens: tok(text) + reasoning, output_tokens_details: { reasoning_tokens: reasoning },
      total_tokens: inTok + tok(text) + reasoning,
    },
  };
}

async function handleResponses(req, res, provider) {
  if (!bearer(req)) return send(res, 401, { error: { message: 'Missing bearer token' } });
  const b = await readBody(req);
  const errs = [];
  if (typeof b.model !== 'string') errs.push('model');
  if (!Array.isArray(b.input) && typeof b.input !== 'string') errs.push('input');
  if (b.max_output_tokens !== undefined && !Number.isInteger(b.max_output_tokens)) errs.push('max_output_tokens');
  if (b.reasoning && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(b.reasoning.effort)) errs.push('reasoning.effort');
  if ('max_tokens' in b) errs.push('max_tokens (Responses API dùng max_output_tokens)');
  if (errs.length) return send(res, 400, { error: { type: 'invalid_request_error', message: `Invalid params: ${errs.join(', ')}` } });
  const prompt = Array.isArray(b.input) ? b.input.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n') : b.input;
  const system = b.instructions || '';
  const key = `${provider}:${crypto.createHash('sha1').update(JSON.stringify(b)).digest('hex')}`;
  if (await faults(res, key, system + prompt, provider)) return;
  const text = generate(provider, system, prompt);
  send(res, 200, responsesShape(b.model, text, tok(system + prompt)));
}

async function handleChat(req, res, provider) {
  if (!bearer(req)) return send(res, 401, { error: { message: 'Missing bearer token' } });
  const b = await readBody(req);
  if (!Array.isArray(b.messages) || typeof b.model !== 'string') return send(res, 400, { error: { message: 'model/messages required' } });
  const system = b.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const prompt = b.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  const key = `${provider}chat:${crypto.createHash('sha1').update(JSON.stringify(b)).digest('hex')}`;
  if (await faults(res, key, system + prompt, provider)) return;
  const text = generate(provider, system, prompt);
  send(res, 200, {
    id: `chatcmpl-${crypto.randomUUID()}`, object: 'chat.completion', model: b.model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: tok(system + prompt), completion_tokens: tok(text), total_tokens: tok(system + prompt) + tok(text) },
  });
}

async function handleAnthropic(req, res) {
  if (!req.headers['x-api-key']) return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'x-api-key header is required' } });
  if (!req.headers['anthropic-version']) return send(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'anthropic-version header is required' } });
  const b = await readBody(req);
  const errs = [];
  if (typeof b.model !== 'string') errs.push('model: required');
  if (!Number.isInteger(b.max_tokens)) errs.push('max_tokens: required integer');
  if (!Array.isArray(b.messages) || !b.messages.length) errs.push('messages: required');
  if (req.headers['anthropic-version'] === '2026-10-21' && ['temperature', 'top_p', 'top_k'].some((k) => k in b)) errs.push('temperature/top_p/top_k không còn được hỗ trợ ở 2026-10-21');
  if (/^claude-opus-5-5/.test(b.model) && b.thinking && b.thinking.type !== 'adaptive') errs.push('thinking.type: Opus 5.5 chỉ chấp nhận adaptive');
  if (b.output_config?.effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(b.output_config.effort)) errs.push('output_config.effort');
  if (b.fallbacks !== undefined) {
    const beta = String(req.headers['anthropic-beta'] || '');
    if (b.fallbacks === 'default' && !beta.includes('server-side-fallback-2026-07-01')) errs.push('fallbacks "default" cần anthropic-beta: server-side-fallback-2026-07-01');
  }
  if (b.messages?.at?.(-1)?.role === 'assistant') errs.push('prefill không được hỗ trợ');
  if (errs.length) return send(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: errs.join('; ') } });
  const prompt = b.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const system = typeof b.system === 'string' ? b.system : JSON.stringify(b.system || '');
  const key = `anthropic:${crypto.createHash('sha1').update(JSON.stringify(b)).digest('hex')}`;
  if (await faults(res, key, system + prompt, 'anthropic')) return;
  if ((system + prompt).includes('[mock:refusal]')) {
    return send(res, 200, { id: `msg_${crypto.randomUUID()}`, type: 'message', role: 'assistant', model: b.model, content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'mock' }, usage: { input_tokens: tok(prompt), output_tokens: 0 } });
  }
  const text = generate('anthropic', system, prompt);
  send(res, 200, {
    id: `msg_${crypto.randomUUID()}`, type: 'message', role: 'assistant', model: b.model,
    content: [{ type: 'thinking', thinking: '', signature: 'mock' }, { type: 'text', text }],
    stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
    usage: { input_tokens: tok(system + prompt), cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: tok(text) + 80 },
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    stats.requests++;
    stats.byEndpoint[url] = (stats.byEndpoint[url] || 0) + 1;
    if (req.method === 'GET' && url === '/healthz') return send(res, 200, { ok: true, mock: true });
    if (req.method === 'GET' && url === '/__mock/stats') return send(res, 200, stats);
    if (req.method === 'POST' && url === '/__mock/reset') { attempts.clear(); stats.requests = 0; stats.byEndpoint = {}; stats.statuses = {}; return send(res, 200, { ok: true }); }
    if (req.method !== 'POST') return send(res, 405, { error: { message: 'method not allowed' } });
    if (url === '/openai/v1/responses') return await handleResponses(req, res, 'openai');
    if (url === '/meta/v1/responses') return await handleResponses(req, res, 'meta');
    if (url === '/meta/v1/chat/completions') return await handleChat(req, res, 'meta');
    if (url === '/anthropic/v1/messages') return await handleAnthropic(req, res);
    send(res, 404, { error: { message: `unknown endpoint ${url}` } });
  } catch (e) {
    send(res, 400, { error: { message: `bad request: ${e.message}` } });
  }
});

export function startMock(port = PORT) {
  return new Promise((resolve) => {
    const s = server.listen(port, () => resolve(s));
  });
}

if (process.argv[1] && process.argv[1].endsWith('mock/server.js')) {
  startMock().then(() => console.log(`[MOCK] LLM mock server tại cổng ${PORT} — KHÔNG phải API thật`));
}
