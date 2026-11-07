// Lập báo cáo cuối cùng bằng tiếng Việt (Markdown) từ phán quyết + toàn bộ diễn biến.
const { state, judge, valid, problems, judgeRaw } = $input.first().json;
const P = state.participants;
const nameA = `Phương án A — ${P.A.label}`;
const nameB = `Phương án B — ${P.B.label}`;
const fmt = (n, d = 1) => (n === null || n === undefined ? '—' : Number(n).toFixed(d));
const usd = (n) => `$${Number(n || 0).toFixed(4)}`;
const int = (n) => Number(n || 0).toLocaleString('vi-VN');
const list = (arr) => (arr && arr.length ? arr.map((x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n') : '- (không có)');
const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

const DECISION_VI = {
  A: `Chọn **${nameA}**`,
  B: `Chọn **${nameB}**`,
  COMBINE: `**Kết hợp** hai phương án A (${P.A.label}) và B (${P.B.label})`,
};

let md = `# Báo cáo tranh luận AI: ${state.title}\n\n`;
md += `> Lập lúc ${now} · Mã phiên \`${state.sessionId}\`\n>\n`;
md += `> Bên A: **${P.A.label}** (\`${P.A.model}\`) · Bên B: **${P.B.label}** (\`${P.B.model}\`) · Trọng tài: **${P.judge.label}** (\`${P.judge.model}\`)\n\n`;

if (!valid) {
  md += `> ⚠️ **Cảnh báo:** phán quyết của trọng tài chưa đầy đủ/đúng định dạng (${(problems || []).join('; ')}). Các mục bị thiếu được để trống; xem phán quyết gốc ở cuối báo cáo.\n\n`;
}

const j = judge || { scores: { A: [], B: [] }, weighted: {}, strengths: {}, weaknesses: {} };

// 1. Tóm tắt điều hành
md += `## 1. Tóm tắt điều hành\n\n`;
md += `| Hạng mục | Kết quả |\n|---|---|\n`;
md += `| Quyết định của trọng tài | ${j.decision ? DECISION_VI[j.decision] : '—'} |\n`;
md += `| Điểm có trọng số — A (${P.A.label}) | **${fmt(j.weighted && j.weighted.A)} / 100** |\n`;
md += `| Điểm có trọng số — B (${P.B.label}) | **${fmt(j.weighted && j.weighted.B)} / 100** |\n`;
md += `| Độ tin cậy của trọng tài | ${j.confidence === null || j.confidence === undefined ? '—' : `${fmt(j.confidence, 0)}%`} |\n\n`;
if (j.summary) md += `${j.summary}\n\n`;

// 2. Bảng điểm
md += `## 2. Bảng điểm theo tiêu chí (thang 0–10)\n\n`;
md += `| Tiêu chí | Trọng số | A | B | Nhận xét về A | Nhận xét về B |\n|---|---:|---:|---:|---|---|\n`;
const crit = state.input.criteria;
crit.forEach((c, i) => {
  const a = (j.scores.A || [])[i] || {};
  const b = (j.scores.B || [])[i] || {};
  md += `| ${mdCell(c.name)} | ${c.weight} | ${fmt(a.score)} | ${fmt(b.score)} | ${mdCell(a.comment)} | ${mdCell(b.comment)} |\n`;
});
md += `| **Điểm có trọng số (/100)** | ${crit.reduce((s, c) => s + c.weight, 0)} | **${fmt(j.weighted && j.weighted.A)}** | **${fmt(j.weighted && j.weighted.B)}** | | |\n\n`;
md += `_Điểm có trọng số = Σ(điểm × trọng số) ÷ Σ trọng số × 10, do hệ thống tự tính từ điểm từng tiêu chí của trọng tài._\n\n`;

// 3. So sánh
md += `## 3. Bảng so sánh hai phương án\n\n`;
if (j.comparison && j.comparison.length) {
  md += `| Khía cạnh | Phương án A | Phương án B | Tốt hơn |\n|---|---|---|---|\n`;
  for (const r of j.comparison) md += `| ${mdCell(r.aspect)} | ${mdCell(r.A)} | ${mdCell(r.B)} | ${mdCell(r.better)} |\n`;
  md += '\n';
} else md += '_Trọng tài không cung cấp bảng so sánh._\n\n';

// 4. Lập luận
md += `## 4. Lập luận của trọng tài\n\n${j.decisionRationale || '_(không có)_'}\n\n`;
md += `### Điểm mạnh / điểm yếu\n\n`;
md += `**A — ${P.A.label}**\n\n_Điểm mạnh:_\n${list(j.strengths && j.strengths.A)}\n\n_Điểm yếu:_\n${list(j.weaknesses && j.weaknesses.A)}\n\n`;
md += `**B — ${P.B.label}**\n\n_Điểm mạnh:_\n${list(j.strengths && j.strengths.B)}\n\n_Điểm yếu:_\n${list(j.weaknesses && j.weaknesses.B)}\n\n`;

// 5. Giải pháp
md += `## 5. Giải pháp khuyến nghị cuối cùng\n\n${j.finalSolution ? String(j.finalSolution).replace(/^(#{1,2})\s/gm, '### ') : '_(không có)_'}\n\n`;

// 6. Bất đồng
md += `## 6. Bất đồng chưa được giải quyết\n\n`;
if (j.unresolvedDisagreements && j.unresolvedDisagreements.length) {
  md += `| Vấn đề | Quan điểm A | Quan điểm B | Nhận định trọng tài | Cách phân xử |\n|---|---|---|---|---|\n`;
  for (const d of j.unresolvedDisagreements) md += `| ${mdCell(d.issue)} | ${mdCell(d.positionA)} | ${mdCell(d.positionB)} | ${mdCell(d.judgeView)} | ${mdCell(d.howToResolve)} |\n`;
  md += '\n';
} else md += '_Trọng tài không ghi nhận bất đồng còn tồn tại._\n\n';

// 7. Rủi ro
md += `## 7. Rủi ro\n\n`;
if (j.risks && j.risks.length) {
  md += `| # | Rủi ro | Mức độ | Khả năng | Biện pháp giảm thiểu |\n|---:|---|---|---|---|\n`;
  j.risks.forEach((r, i) => { md += `| ${i + 1} | ${mdCell(r.risk)} | ${mdCell(r.severity)} | ${mdCell(r.likelihood)} | ${mdCell(r.mitigation)} |\n`; });
  md += '\n';
} else md += '_(không có)_\n\n';

// 8. Kế hoạch
md += `## 8. Kế hoạch hành động\n\n`;
if (j.actionPlan && j.actionPlan.length) {
  md += `| Bước | Hành động | Phụ trách | Thời hạn | Chỉ số thành công |\n|---:|---|---|---|---|\n`;
  j.actionPlan.forEach((a, i) => { md += `| ${mdCell(a.step || i + 1)} | ${mdCell(a.action)} | ${mdCell(a.owner)} | ${mdCell(a.timeline)} | ${mdCell(a.kpi)} |\n`; });
  md += '\n';
} else md += '_(không có)_\n\n';

// 9. Diễn biến
md += `## 9. Diễn biến tranh luận\n\n`;
md += `1. **Vòng 1 — Phân tích độc lập:** ${P.A.label} và ${P.B.label} phân tích riêng, không thấy kết quả của nhau.\n`;
md += `2. **Vòng 2 — Phản biện chéo:** mỗi bên đọc phương án đối phương và phản biện chi tiết.\n`;
md += `3. **Vòng 3 — Hoàn thiện:** mỗi bên tiếp thu/bác bỏ phản biện và chốt phương án cuối.\n`;
md += `4. **Trọng tài:** ${P.judge.label} chấm điểm "mù" (không biết bên nào là model nào) theo ${crit.length} tiêu chí.\n\n`;
md += `_Toàn văn từng vòng có trong Phụ lục khi xuất Markdown/PDF và trong tab "Diễn biến" trên giao diện._\n\n`;

// 10. Chi phí
md += `## 10. Token & chi phí API\n\n`;
md += `| Vòng | Vai trò | Model | Token vào (cache) | Token ra (suy luận) | Số lần thử | Chi phí |\n|---:|---|---|---:|---:|---:|---:|\n`;
const ROLE = { A: `A — ${P.A.label}`, B: `B — ${P.B.label}`, judge: `Trọng tài — ${P.judge.label}` };
let total = 0;
for (const c of state.calls) {
  total += Number(c.costUsd || 0);
  const u = c.usage || {};
  md += `| ${c.round === 5 ? '4b' : c.round} | ${ROLE[c.role] || c.role} | \`${c.model}\` | ${int(u.inputTokens)} (${int(u.cachedInputTokens)}) | ${int(u.outputTokens)} (${int(u.reasoningTokens)}) | ${c.attempts || 1} | ${usd(c.costUsd)} |\n`;
}
md += `| | **Tổng cộng** | | | | | **${usd(total)}** |\n\n`;

md += `---\n\n_Báo cáo do AI tạo ra để hỗ trợ ra quyết định. Hãy kiểm chứng số liệu, giả định và tham khảo chuyên gia trước khi áp dụng cho quyết định quan trọng._\n`;

if (!valid && judgeRaw) md += `\n### Phán quyết gốc của trọng tài\n\n\`\`\`\n${String(judgeRaw).slice(0, 20000)}\n\`\`\`\n`;

return [{ json: { sessionId: state.sessionId, reportMarkdown: md, judge: { ...j, valid, problems, totalCostUsd: Math.round(total * 1e6) / 1e6 } } }];
