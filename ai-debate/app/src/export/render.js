// Xuất báo cáo: Markdown đầy đủ (báo cáo + phụ lục toàn văn tranh luận + chi phí) và PDF.
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const ROUND_TITLES = {
  1: 'Vòng 1 — Phân tích độc lập',
  2: 'Vòng 2 — Phản biện chéo',
  3: 'Vòng 3 — Hoàn thiện phương án',
  4: 'Trọng tài — Đánh giá',
};
const ROLE_LABEL = { A: 'Bên A (GPT-6 Sol)', B: 'Bên B (Claude Opus 5.5)', judge: 'Trọng tài (Meta Muse Wonder)' };
const STATUS_VI = { queued: 'Đang chờ', running: 'Đang chạy', completed: 'Hoàn tất', failed: 'Lỗi', cancelled: 'Đã hủy' };

const usd = (n) => `$${Number(n || 0).toFixed(4)}`;
const int = (n) => Number(n || 0).toLocaleString('vi-VN');
const fmtDate = (d) => (d ? new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—');

export function costTableMarkdown(turns) {
  const ok = (turns || []).filter((t) => t.status === 'ok' || Number(t.cost_usd) > 0);
  if (!ok.length) return '_Chưa có lượt gọi AI nào._\n';
  const byRole = {};
  for (const t of ok) {
    const r = (byRole[t.role] ||= { model: t.model, calls: 0, input: 0, cached: 0, output: 0, reasoning: 0, cost: 0 });
    r.calls++; r.input += t.input_tokens; r.cached += t.cached_input_tokens; r.output += t.output_tokens;
    r.reasoning += t.reasoning_tokens; r.cost += Number(t.cost_usd);
  }
  let md = '| AI | Model | Số lượt | Token vào (cache) | Token ra (suy luận) | Chi phí |\n|---|---|---:|---:|---:|---:|\n';
  let total = 0;
  for (const role of ['A', 'B', 'judge']) {
    const r = byRole[role];
    if (!r) continue;
    total += r.cost;
    md += `| ${ROLE_LABEL[role]} | \`${r.model}\` | ${r.calls} | ${int(r.input)} (${int(r.cached)}) | ${int(r.output)} (${int(r.reasoning)}) | ${usd(r.cost)} |\n`;
  }
  md += `| **Tổng** | | | | | **${usd(total)}** |\n`;
  return md;
}

export function buildFullMarkdown(debate) {
  const inp = debate.input || {};
  let md = '';
  if (debate.report_md) {
    md += debate.report_md.trim() + '\n\n';
  } else {
    md += `# ${debate.title}\n\n> Trạng thái: **${STATUS_VI[debate.status] || debate.status}**${debate.error ? ` — ${debate.error}` : ''}\n\n`;
  }
  md += '---\n\n# Phụ lục A — Đầu vào\n\n';
  md += `- **Vấn đề:** ${inp.problem || ''}\n`;
  if (inp.context) md += `- **Bối cảnh:** ${inp.context}\n`;
  if (inp.goals) md += `- **Mục tiêu:** ${inp.goals}\n`;
  if (inp.constraints) md += `- **Ràng buộc:** ${inp.constraints}\n`;
  if (inp.criteria?.length) {
    md += '\n| Tiêu chí chấm điểm | Trọng số |\n|---|---:|\n';
    for (const c of inp.criteria) md += `| ${c.name}${c.description ? ` — ${c.description}` : ''} | ${c.weight} |\n`;
  }
  md += `\n- Tạo lúc: ${fmtDate(debate.created_at)} · Kết thúc: ${fmtDate(debate.finished_at)} · Mã phiên: \`${debate.id}\`\n\n`;

  md += '# Phụ lục B — Toàn văn tranh luận\n\n';
  const turns = (debate.turns || []).filter((t) => t.status === 'ok');
  for (const round of [1, 2, 3, 4]) {
    const rt = turns.filter((t) => t.round === round);
    if (!rt.length) continue;
    md += `## ${ROUND_TITLES[round]}\n\n`;
    for (const t of rt.sort((a, b) => a.role.localeCompare(b.role))) {
      md += `### ${ROLE_LABEL[t.role] || t.role}\n\n`;
      md += t.role === 'judge' ? '```json\n' + t.content.trim() + '\n```\n\n' : demoteHeadings(t.content.trim()) + '\n\n';
    }
  }
  md += '# Phụ lục C — Token & chi phí API\n\n' + costTableMarkdown(debate.turns) + '\n';
  md += '\n_Chi phí tính theo bảng giá cấu hình trong ứng dụng; số liệu chính thức xem trên trang billing của từng nhà cung cấp._\n';
  return md;
}

// Hạ cấp heading của nội dung AI để không phá cấu trúc mục lục báo cáo.
export function demoteHeadings(md) {
  return md.replace(/^(#{1,4})(\s)/gm, (_, h, s) => `${'#'.repeat(Math.min(6, h.length + 3))}${s}`);
}

export function markdownToSafeHtml(md) {
  const raw = marked.parse(md, { gfm: true, breaks: false });
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'img', 'del', 'input']),
    allowedAttributes: { a: ['href', 'title'], th: ['align', 'style'], td: ['align', 'style'], code: ['class'], input: ['type', 'checked', 'disabled'] },
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}

export function printableHtml(debate) {
  const body = markdownToSafeHtml(buildFullMarkdown(debate));
  const title = sanitizeHtml(debate.title, { allowedTags: [], allowedAttributes: {} });
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: "Noto Sans", "DejaVu Sans", Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1b1f24; }
  h1 { font-size: 18pt; border-bottom: 2px solid #2f5bd3; padding-bottom: 4px; page-break-after: avoid; }
  h2 { font-size: 14pt; color: #2f5bd3; page-break-after: avoid; }
  h3 { font-size: 12pt; page-break-after: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; page-break-inside: auto; font-size: 9.5pt; }
  th, td { border: 1px solid #c9d1dc; padding: 4px 6px; vertical-align: top; }
  th { background: #eef2fb; }
  tr { page-break-inside: avoid; }
  pre { white-space: pre-wrap; word-break: break-word; background: #f5f7fa; padding: 8px; font-size: 8.5pt; }
  code { font-family: "DejaVu Sans Mono", monospace; }
  blockquote { border-left: 3px solid #2f5bd3; margin: 8px 0; padding: 4px 10px; color: #444; background: #f6f8ff; }
</style></head><body>${body}</body></html>`;
}

export async function renderPdf(html, chromiumPath) {
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync'],
  });
  try {
    const page = await browser.newPage();
    // Chặn mọi request mạng: tài liệu là HTML tĩnh, không cần tải gì từ ngoài.
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().startsWith('data:') ? r.continue() : r.abort()));
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return await page.pdf({
      format: 'A4', printBackground: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#888">AI Debate · Trang <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
      margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
    });
  } finally {
    await browser.close();
  }
}
