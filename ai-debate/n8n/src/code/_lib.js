// ===== Thư viện dùng chung (được chèn vào đầu mỗi Code node khi build workflow) =====
const MAX_TEXT_CHARS = 24000; // giới hạn độ dài mỗi văn bản đưa vào prompt (kiểm soát chi phí)

function clip(text, max = MAX_TEXT_CHARS) {
  const t = String(text || '').trim();
  return t.length > max ? t.slice(0, max) + '\n\n[…đã cắt bớt do quá dài…]' : t;
}

function problemBlock(input) {
  let s = `### VẤN ĐỀ CẦN GIẢI QUYẾT\n${clip(input.problem, 8000)}\n`;
  if (input.context) s += `\n### BỐI CẢNH\n${clip(input.context, 16000)}\n`;
  if (input.goals) s += `\n### MỤC TIÊU\n${clip(input.goals, 4000)}\n`;
  if (input.constraints) s += `\n### RÀNG BUỘC\n${clip(input.constraints, 4000)}\n`;
  s += `\n### TIÊU CHÍ ĐÁNH GIÁ (trọng số)\n`;
  for (const c of input.criteria || []) s += `- ${c.name} (${c.weight})${c.description ? `: ${c.description}` : ''}\n`;
  return s;
}

function debaterSystem(side, label) {
  return [
    `Bạn là ${label}, đóng vai "Bên ${side}" trong một cuộc tranh luận có cấu trúc giữa hai AI nhằm tìm ra giải pháp tốt nhất cho một vấn đề thực tế.`,
    'Quy tắc:',
    '- Luôn viết bằng tiếng Việt chuẩn, rõ ràng, dùng Markdown (tiêu đề ##, gạch đầu dòng, bảng khi phù hợp).',
    '- Lập luận dựa trên logic và bằng chứng; nêu rõ giả định. Không bịa số liệu, nguồn hay trích dẫn; nếu là ước tính, ghi rõ "ước tính".',
    '- Thẳng thắn nhưng tôn trọng; công nhận điểm đúng của đối phương, chỉ ra điểm sai bằng lý lẽ cụ thể.',
    '- Đề xuất phải khả thi, có bước hành động cụ thể, phù hợp ràng buộc người dùng đưa ra.',
    '- Viết súc tích: tối đa khoảng 1.200 từ.',
  ].join('\n');
}

function llmRequest(state, { round, role, stage, system, prompt }) {
  return { request: { sessionId: state.sessionId, round, role, stage, system, prompt } };
}

// Kiểm tra kết quả từ gateway; ném lỗi tiếng Việt để Error Workflow báo về ứng dụng.
function assertOk(results, stageLabel) {
  for (const r of results) {
    if (!r || r.ok !== true) {
      const msg = (r && r.error && (r.error.message || r.error)) || 'Không nhận được phản hồi từ gateway';
      throw new Error(`${stageLabel}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
  }
  return results;
}

function byRole(results) {
  const out = {};
  for (const r of results) out[r.role] = r;
  return out;
}

function callSummary(r) {
  return { round: r.round, role: r.role, model: r.model, provider: r.provider, usage: r.usage, costUsd: r.costUsd, attempts: r.attempts, latencyMs: r.latencyMs };
}

const OTHER = { A: 'B', B: 'A' };

// Trích JSON từ văn bản trả về của trọng tài (chịu được ```json fences, chữ thừa, dấu phẩy cuối).
function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  s = s.slice(start, end + 1);
  const attempts = [s, s.replace(/,\s*([}\]])/g, '$1')];
  for (const a of attempts) {
    try {
      const v = JSON.parse(a);
      if (v && typeof v === 'object') return v;
    } catch (e) { /* thử cách khác */ }
  }
  return null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Chuẩn hóa phán quyết & tính điểm có trọng số (0–100) một cách xác định, không phụ thuộc LLM.
function normalizeJudge(j, criteria) {
  const problems = [];
  if (!j || typeof j !== 'object') return { valid: false, problems: ['Không phải JSON object'] };
  const scores = { A: [], B: [] };
  for (const side of ['A', 'B']) {
    const arr = (j.scores && Array.isArray(j.scores[side])) ? j.scores[side] : [];
    for (const c of criteria) {
      const found = arr.find((x) => x && String(x.criterion || '').trim().toLowerCase() === c.name.toLowerCase())
        || arr[criteria.indexOf(c)];
      let s = found ? num(found.score) : null;
      if (s === null) problems.push(`Thiếu điểm "${c.name}" cho Bên ${side}`);
      else s = Math.max(0, Math.min(10, s));
      scores[side].push({ criterion: c.name, weight: c.weight, score: s, comment: found ? String(found.comment || '') : '' });
    }
  }
  const totalWeight = criteria.reduce((a, c) => a + c.weight, 0) || 1;
  const weighted = {};
  for (const side of ['A', 'B']) {
    weighted[side] = Math.round((scores[side].reduce((a, x) => a + (x.score || 0) * x.weight, 0) / totalWeight) * 10 * 10) / 10;
  }
  let decision = String(j.decision || '').toUpperCase().trim();
  if (['COMBINE', 'KET_HOP', 'KẾT HỢP', 'HYBRID'].includes(decision)) decision = 'COMBINE';
  if (!['A', 'B', 'COMBINE'].includes(decision)) { problems.push('decision phải là A, B hoặc COMBINE'); decision = null; }
  const arr = (v) => (Array.isArray(v) ? v : []);
  const out = {
    summary: String(j.summary || ''),
    scores, weighted,
    decision,
    decisionRationale: String(j.decisionRationale || ''),
    finalSolution: String(j.finalSolution || ''),
    comparison: arr(j.comparison),
    strengths: { A: arr(j.strengths && j.strengths.A), B: arr(j.strengths && j.strengths.B) },
    weaknesses: { A: arr(j.weaknesses && j.weaknesses.A), B: arr(j.weaknesses && j.weaknesses.B) },
    unresolvedDisagreements: arr(j.unresolvedDisagreements),
    risks: arr(j.risks),
    actionPlan: arr(j.actionPlan),
    confidence: num(j.confidence),
  };
  if (!out.summary) problems.push('Thiếu summary');
  if (!out.finalSolution) problems.push('Thiếu finalSolution');
  return { valid: problems.length === 0 && decision !== null, problems, judge: out };
}

const JUDGE_SCHEMA_HINT = `{
  "summary": "Tóm tắt 3-5 câu về cuộc tranh luận và kết luận",
  "scores": {
    "A": [ { "criterion": "<tên tiêu chí y nguyên>", "score": 0-10, "comment": "lý do chấm" } ],
    "B": [ { "criterion": "<tên tiêu chí y nguyên>", "score": 0-10, "comment": "lý do chấm" } ]
  },
  "decision": "A" | "B" | "COMBINE",
  "decisionRationale": "Vì sao chọn/kết hợp như vậy",
  "finalSolution": "Giải pháp cuối cùng được khuyến nghị (Markdown, chi tiết, có các bước)",
  "comparison": [ { "aspect": "Khía cạnh so sánh", "A": "…", "B": "…", "better": "A|B|Ngang nhau" } ],
  "strengths": { "A": ["…"], "B": ["…"] },
  "weaknesses": { "A": ["…"], "B": ["…"] },
  "unresolvedDisagreements": [ { "issue": "…", "positionA": "…", "positionB": "…", "judgeView": "…", "howToResolve": "Cần dữ liệu/thử nghiệm gì để phân xử" } ],
  "risks": [ { "risk": "…", "severity": "Cao|Trung bình|Thấp", "likelihood": "Cao|Trung bình|Thấp", "mitigation": "…" } ],
  "actionPlan": [ { "step": 1, "action": "…", "owner": "…", "timeline": "…", "kpi": "…" } ],
  "confidence": 0-100
}`;

function mdCell(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n+/g, '<br>');
}
// ===== Hết thư viện =====
