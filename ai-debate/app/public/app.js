/* AI Debate — giao diện web (JavaScript thuần, không cần build). */
'use strict';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $banner = document.getElementById('banner');
let CONFIG = null;
let pollTimer = null;

// ---------------------------------------------------------------- tiện ích
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // chỉ dùng với HTML đã được DOMPurify làm sạch
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const mdHtml = (md) => window.DOMPurify.sanitize(window.marked.parse(md || '', { gfm: true }));
const usd = (n) => `$${Number(n || 0).toFixed(4)}`;
const int = (n) => Number(n || 0).toLocaleString('vi-VN');
const fmtTime = (d) => (d ? new Date(d).toLocaleString('vi-VN') : '—');
const STATUS_VI = { queued: 'Đang chờ', running: 'Đang chạy', completed: 'Hoàn tất', failed: 'Lỗi', cancelled: 'Đã hủy' };
const DECISION_VI = { A: 'Chọn A (GPT)', B: 'Chọn B (Claude)', COMBINE: 'Kết hợp A + B' };
const ROLE_VI = { A: 'Bên A', B: 'Bên B', judge: 'Trọng tài' };

function toast(msg, ms = 3500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), 'x-requested-with': 'aidebate' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/api/login') {
    location.hash = '#/login';
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error(data?.error || `Lỗi HTTP ${res.status}`), { status: res.status, data });
  return data;
}

async function download(path, fallbackName) {
  try {
    const res = await fetch(path, { credentials: 'same-origin', headers: { 'x-requested-with': 'aidebate' } });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `Lỗi HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  } catch (e) {
    toast(e.message, 6000);
  }
}

function setView(...nodes) {
  $view.replaceChildren(...nodes);
  $view.focus({ preventScroll: true });
}

function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(val));
  } catch { /* chế độ riêng tư: bỏ qua */ }
  return null;
}

// ---------------------------------------------------------------- router
const routes = {
  login: renderLogin,
  new: renderNew,
  history: renderHistory,
  usage: renderUsage,
  help: renderHelp,
  debate: renderDebate,
};

async function router() {
  clearTimeout(pollTimer);
  const [, name = 'new', id] = (location.hash || '#/new').split('/');
  for (const a of $nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.route === name);
  if (name !== 'login' && !CONFIG) {
    try {
      CONFIG = await api('/api/config');
      showBanner();
    } catch (e) {
      // 401: api() đã chuyển sang #/login, sự kiện hashchange sẽ vẽ lại trang.
      if (e.status !== 401) setView(h('div', { class: 'alert error' }, `Không tải được cấu hình: ${e.message}`));
      return;
    }
  }
  $nav.hidden = name === 'login';
  try {
    await (routes[name] || renderNew)(id);
  } catch (e) {
    setView(h('div', { class: 'alert error' }, e.message));
  }
}
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);

function showBanner() {
  const parts = [];
  let mock = false;
  if (CONFIG.llmMode === 'mock') { mock = true; parts.push('CHẾ ĐỘ MOCK: đang dùng máy chủ AI giả lập để chạy thử — kết quả KHÔNG phải từ API thật.'); }
  if (CONFIG.missingKeys?.length) parts.push(`Chưa cấu hình API key: ${CONFIG.missingKeys.join(', ')}.`);
  $banner.hidden = !parts.length;
  $banner.className = `banner${mock ? ' mock' : ''}`;
  $banner.textContent = parts.join(' ');
}

// ---------------------------------------------------------------- Đăng nhập
function renderLogin() {
  const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'alert error hidden' });
  const form = h('form', {
    class: 'card login',
    onsubmit: async (ev) => {
      ev.preventDefault();
      err.classList.add('hidden');
      try {
        await api('/api/login', { method: 'POST', body: { password: pw.value } });
        CONFIG = null;
        location.hash = '#/new';
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
      }
    },
  },
  h('h1', {}, 'Đăng nhập'),
  h('p', { class: 'muted' }, 'Nhập mật khẩu quản trị (biến APP_PASSWORD trong file .env).'),
  h('label', { for: 'pw' }, 'Mật khẩu'), pw, err,
  h('div', { class: 'actions' }, h('button', { class: 'btn primary block', type: 'submit' }, 'Đăng nhập')));
  setView(form);
  pw.focus();
}

// ---------------------------------------------------------------- Phiên mới
function renderNew() {
  const draft = store('aidebate:draft') || {};
  const field = (id, label, opt, hint, tag = 'textarea', extra = {}) => {
    const el = h(tag, { id, name: id, ...(tag === 'input' ? { type: 'text' } : {}), ...extra });
    el.value = draft[id] || '';
    return [h('label', { for: id }, label, opt ? h('span', { class: 'opt' }, ' (tùy chọn)') : null), el, hint ? h('div', { class: 'hint' }, hint) : null];
  };
  const critBox = h('div', { class: 'crit-list' });
  const critTotal = h('div', { class: 'crit-total' });
  const addCrit = (c = { name: '', weight: 10, description: '' }) => {
    const row = h('div', {},
      h('div', { class: 'crit-row' },
        h('input', { type: 'text', 'aria-label': 'Tên tiêu chí', placeholder: 'Tên tiêu chí', value: c.name, class: 'c-name', maxlength: 100 }),
        h('input', { type: 'number', 'aria-label': 'Trọng số', min: 1, max: 100, step: 1, value: c.weight, class: 'c-weight', inputmode: 'numeric' }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Xóa tiêu chí', onclick: () => { row.remove(); updTotal(); } }, '×'),
        h('input', { type: 'text', class: 'desc c-desc', 'aria-label': 'Mô tả tiêu chí', placeholder: 'Mô tả ngắn (tùy chọn)', value: c.description || '', maxlength: 300 })));
    critBox.append(row);
    updTotal();
  };
  const readCrit = () => [...critBox.children].map((r) => ({
    name: r.querySelector('.c-name').value.trim(),
    weight: Number(r.querySelector('.c-weight').value),
    description: r.querySelector('.c-desc').value.trim(),
  })).filter((c) => c.name);
  function updTotal() {
    const total = readCrit().reduce((s, c) => s + (c.weight || 0), 0);
    critTotal.textContent = `${critBox.children.length} tiêu chí · Tổng trọng số: ${total} (không bắt buộc bằng 100 — hệ thống tự quy đổi)`;
  }
  critBox.addEventListener('input', updTotal);
  (draft.criteria?.length ? draft.criteria : CONFIG.defaultCriteria).forEach((c) => addCrit(c));

  const err = h('div', { class: 'alert error hidden', role: 'alert' });
  const submit = h('button', { class: 'btn primary block', type: 'submit' }, '⚖️ Bắt đầu tranh luận');
  const P = CONFIG.participants;
  const form = h('form', {
    class: 'card',
    oninput: () => store('aidebate:draft', collect()),
    onsubmit: async (ev) => {
      ev.preventDefault();
      err.classList.add('hidden');
      submit.disabled = true;
      submit.textContent = 'Đang khởi động…';
      try {
        const r = await api('/api/debates', { method: 'POST', body: collect() });
        store('aidebate:draft', null);
        location.hash = `#/debate/${r.id}`;
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
        err.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } finally {
        submit.disabled = false;
        submit.textContent = '⚖️ Bắt đầu tranh luận';
      }
    },
  },
  h('h1', {}, 'Phiên tranh luận mới'),
  h('p', { class: 'muted small' },
    h('span', { class: 'tag-a' }, `A: ${P.A.label}`), ' vs ', h('span', { class: 'tag-b' }, `B: ${P.B.label}`),
    ' · ', h('span', { class: 'tag-j' }, `Trọng tài: ${P.judge.label}`)),
  ...field('problem', 'Vấn đề cần giải quyết *', false, 'Mô tả rõ vấn đề, càng cụ thể càng tốt (bắt buộc, tối thiểu 10 ký tự).', 'textarea', { required: true, minlength: 10, maxlength: 8000, rows: 5 }),
  ...field('context', 'Bối cảnh', true, 'Ngành, quy mô, hiện trạng, dữ liệu đã có…', 'textarea', { maxlength: 8000 }),
  ...field('goals', 'Mục tiêu', true, 'Kết quả mong muốn, con số mục tiêu, thời hạn…', 'textarea', { maxlength: 4000, rows: 3 }),
  ...field('constraints', 'Ràng buộc', true, 'Ngân sách, nhân sự, pháp lý, thời gian, công nghệ…', 'textarea', { maxlength: 4000, rows: 3 }),
  ...field('title', 'Tiêu đề phiên', true, 'Để trống sẽ tự lấy từ vấn đề.', 'input', { maxlength: 200 }),
  h('label', {}, 'Tiêu chí chấm điểm & trọng số'),
  h('div', { class: 'hint' }, 'Trọng tài chấm mỗi bên 0–10 điểm theo từng tiêu chí; hệ thống tự tính điểm có trọng số (thang 100).'),
  critBox, critTotal,
  h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'btn small', onclick: () => addCrit() }, '+ Thêm tiêu chí'),
    h('button', { type: 'button', class: 'btn small', onclick: () => { critBox.replaceChildren(); CONFIG.defaultCriteria.forEach((c) => addCrit(c)); } }, 'Khôi phục mặc định')),
  h('div', { class: 'alert info small' },
    `Ngân sách: tối đa ${usd(CONFIG.budgets.perSessionUsd)}/phiên · ${usd(CONFIG.budgets.perDayUsd)}/ngày · ${usd(CONFIG.budgets.perMonthUsd)}/tháng. `,
    'Một phiên gồm 7 lượt gọi AI (3 vòng × 2 bên + trọng tài), thường mất 5–20 phút. Bạn có thể đóng trang và quay lại xem ở mục Lịch sử.'),
  err,
  h('div', { class: 'actions' }, submit));

  function collect() {
    const v = (id) => form.querySelector(`#${id}`).value;
    return { problem: v('problem'), context: v('context'), goals: v('goals'), constraints: v('constraints'), title: v('title'), criteria: readCrit() };
  }
  setView(form);
}

// ---------------------------------------------------------------- Chi tiết phiên
const STEP_DEFS = [
  { key: 'round1', round: 1, title: 'Vòng 1', sub: 'Phân tích độc lập' },
  { key: 'round2', round: 2, title: 'Vòng 2', sub: 'Phản biện chéo' },
  { key: 'round3', round: 3, title: 'Vòng 3', sub: 'Hoàn thiện phương án' },
  { key: 'judging', round: 4, title: 'Trọng tài', sub: 'Gemini chấm điểm' },
  { key: 'done', round: 6, title: 'Báo cáo', sub: 'Tổng hợp tiếng Việt' },
];
const STAGE_ORDER = ['queued', 'round1', 'round2', 'round3', 'judging', 'reporting', 'done'];

function stepState(d, def) {
  const turns = d.turns.filter((t) => (def.round === 4 ? t.round >= 4 : t.round === def.round));
  if (def.key === 'done') {
    if (d.status === 'completed') return 'done';
    if (d.status === 'failed' && STAGE_ORDER.indexOf(d.stage) >= 4 && d.turns.some((t) => t.round >= 4 && t.status === 'ok')) return 'error';
    return 'pending';
  }
  if (turns.some((t) => t.status === 'error') && d.status === 'failed') return 'error';
  if (turns.some((t) => t.status === 'running')) return 'running';
  const need = def.round === 4 ? 1 : 2;
  if (turns.filter((t) => t.status === 'ok').length >= need) return 'done';
  if (d.status === 'running' && d.stage === def.key) return 'running';
  return 'pending';
}

function turnChip(t, P) {
  const name = t.role === 'judge' ? P.judge.label : P[t.role].label;
  const st = t.status === 'ok' ? `✓ ${int(t.output_tokens)} token · ${usd(t.cost_usd)}${t.attempts > 1 ? ` · ${t.attempts} lần thử` : ''}`
    : t.status === 'running' ? (t.error ? `⟳ ${t.error}` : '⟳ đang xử lý…') : `✗ ${t.error || 'lỗi'}`;
  return h('span', { class: `chip ${t.status}` }, h('b', {}, `${ROLE_VI[t.role]} · ${name}: `), st);
}

async function renderDebate(id) {
  let d;
  try {
    d = await api(`/api/debates/${encodeURIComponent(id)}`);
  } catch (e) {
    return setView(h('div', { class: 'alert error' }, e.message), h('a', { href: '#/history' }, '← Về lịch sử'));
  }
  const P = CONFIG.participants;
  const active = d.status === 'queued' || d.status === 'running';
  const prevTab = renderDebate.tab?.[id] || (d.status === 'completed' ? 'report' : 'rounds');

  const head = h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: `badge ${d.status}` }, STATUS_VI[d.status] || d.status),
      d.judge?.decision ? h('span', { class: 'badge' }, ` ${DECISION_VI[d.judge.decision] || d.judge.decision}`) : null),
    h('h1', {}, d.title),
    h('div', { class: 'muted small' }, `Tạo: ${fmtTime(d.created_at)} · Kết thúc: ${fmtTime(d.finished_at)} · Chi phí: ${usd(d.total_cost_usd)}`),
    d.error ? h('div', { class: `alert ${d.status === 'cancelled' ? 'warn' : 'error'}` }, d.error) : null,
    h('div', { class: 'actions no-print' },
      active ? h('button', { class: 'btn danger small', onclick: async () => {
        if (!confirm('Hủy phiên này? Các lượt AI đang chạy vẫn có thể bị tính phí.')) return;
        try { await api(`/api/debates/${d.id}/cancel`, { method: 'POST' }); toast('Đã hủy phiên.'); router(); } catch (e) { toast(e.message); }
      } }, 'Hủy phiên') : null,
      h('button', { class: 'btn small', onclick: () => download(`/api/debates/${d.id}/export.md`, 'bao-cao.md') }, '⬇ Markdown'),
      h('button', { class: 'btn small', onclick: () => { toast('Đang tạo PDF…'); download(`/api/debates/${d.id}/export.pdf`, 'bao-cao.pdf'); } }, '⬇ PDF'),
      h('button', { class: 'btn small', onclick: () => window.print() }, '🖨 In'),
      h('button', { class: 'btn small', onclick: () => {
        store('aidebate:draft', { ...d.input, title: `${d.title} (lần 2)` });
        location.hash = '#/new';
      } }, '⧉ Nhân bản'),
      !active ? h('button', { class: 'btn danger small', onclick: async () => {
        if (!confirm('Xóa vĩnh viễn phiên này khỏi lịch sử?')) return;
        try { await api(`/api/debates/${d.id}`, { method: 'DELETE' }); toast('Đã xóa.'); location.hash = '#/history'; } catch (e) { toast(e.message); }
      } }, 'Xóa') : null));

  const steps = h('ol', { class: 'steps', 'aria-label': 'Tiến trình' }, STEP_DEFS.map((def, i) => {
    const st = stepState(d, def);
    const turns = d.turns.filter((t) => (def.round === 4 ? t.round >= 4 : t.round === def.round));
    return h('li', { class: `step ${st}` },
      h('span', { class: 'dot', 'aria-hidden': 'true' }, st === 'done' ? '✓' : st === 'error' ? '!' : String(i + 1)),
      h('div', {}, h('div', { class: 'title' }, def.title), h('div', { class: 'muted small' }, def.sub),
        turns.length ? h('div', { class: 'chips' }, turns.map((t) => turnChip(t, P))) : null));
  }));

  const panels = {
    report: () => d.report_md ? h('article', { class: 'card md', html: mdHtml(d.report_md) })
      : h('div', { class: 'alert info' }, active ? 'Báo cáo sẽ xuất hiện khi trọng tài chấm xong.' : 'Phiên không có báo cáo.'),
    rounds: () => renderRounds(d, P),
    input: () => renderInput(d),
    cost: () => renderCost(d, P),
  };
  const tabNames = { report: 'Báo cáo', rounds: 'Diễn biến', input: 'Đầu vào', cost: 'Token & chi phí' };
  const panel = h('div', { class: 'tabpanel', role: 'tabpanel' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, Object.entries(tabNames).map(([k, label]) =>
    h('button', { role: 'tab', 'aria-selected': String(k === prevTab), onclick: (ev) => {
      for (const b of tabs.children) b.setAttribute('aria-selected', String(b === ev.currentTarget));
      (renderDebate.tab ||= {})[id] = k;
      panel.replaceChildren(panels[k]());
    } }, label)));
  panel.append(panels[prevTab]());

  // Giữ vị trí cuộn khi tự làm mới
  const y = window.scrollY;
  const same = renderDebate.lastId === id;
  // Khi phiên đã kết thúc: thu gọn tiến trình để báo cáo hiện lên ngay (đặc biệt trên điện thoại).
  const doneSteps = STEP_DEFS.filter((def) => stepState(d, def) === 'done').length;
  const progress = h('details', { class: 'card progress', open: active || d.status === 'failed' },
    h('summary', {}, h('h2', { class: 'inline' }, 'Tiến trình'), h('span', { class: 'muted small' }, ` · ${doneSteps}/${STEP_DEFS.length} bước`)), steps);
  setView(head, progress, tabs, panel);
  if (same) window.scrollTo(0, y);
  renderDebate.lastId = id;

  if (active) pollTimer = setTimeout(() => { if (location.hash === `#/debate/${id}`) renderDebate(id); }, 3000);
}

function renderRounds(d, P) {
  const ok = d.turns.filter((t) => t.status === 'ok');
  const titles = { 1: 'Vòng 1 — Phân tích độc lập', 2: 'Vòng 2 — Phản biện chéo', 3: 'Vòng 3 — Hoàn thiện phương án' };
  const wrap = h('div', {});
  for (const r of [1, 2, 3]) {
    const rt = ok.filter((t) => t.round === r);
    if (!rt.length) continue;
    wrap.append(h('section', { class: 'round' }, h('h2', {}, titles[r]),
      h('div', { class: 'duo' }, ['A', 'B'].map((side) => {
        const t = rt.find((x) => x.role === side);
        return h('div', { class: `side ${side}` },
          h('header', {}, h('span', {}, `${ROLE_VI[side]} — ${P[side].label}`), t ? h('span', { class: 'small' }, `${int(t.output_tokens)} token · ${usd(t.cost_usd)}`) : null),
          t ? h('div', { class: 'md', html: mdHtml(t.content) }) : h('p', { class: 'muted md' }, 'Chưa có.'));
      }))));
  }
  const judge = ok.filter((t) => t.role === 'judge').at(-1);
  if (judge) {
    wrap.append(h('section', { class: 'round' }, h('h2', {}, 'Trọng tài — phản hồi gốc (JSON)'),
      h('details', { class: 'side judge' }, h('summary', { class: 'small' }, `  ${P.judge.label} · ${int(judge.output_tokens)} token · ${usd(judge.cost_usd)}`),
        h('pre', { class: 'md' }, judge.content))));
  }
  if (!wrap.children.length) wrap.append(h('div', { class: 'alert info' }, 'Chưa có lượt nào hoàn tất. Trang tự cập nhật mỗi 3 giây.'));
  return wrap;
}

function renderInput(d) {
  const i = d.input || {};
  const blk = (t, v) => (v ? [h('h2', {}, t), h('p', { class: 'md' }, v)] : []);
  return h('div', { class: 'card' }, ...blk('Vấn đề', i.problem), ...blk('Bối cảnh', i.context), ...blk('Mục tiêu', i.goals), ...blk('Ràng buộc', i.constraints),
    h('h2', {}, 'Tiêu chí chấm điểm'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, 'Tiêu chí'), h('th', { class: 'num' }, 'Trọng số'), h('th', {}, 'Mô tả'))),
      h('tbody', {}, (i.criteria || []).map((c) => h('tr', {}, h('td', {}, c.name), h('td', { class: 'num' }, c.weight), h('td', {}, c.description || '')))))));
}

function renderCost(d, P) {
  const rows = d.turns.map((t) => h('tr', {},
    h('td', {}, t.round >= 4 ? (t.round === 5 ? 'TT (sửa)' : 'Trọng tài') : `V${t.round}`),
    h('td', {}, `${ROLE_VI[t.role]} · ${t.role === 'judge' ? P.judge.label : P[t.role].label}`),
    h('td', {}, t.model),
    h('td', {}, t.status === 'ok' ? '✓' : t.status === 'running' ? '⟳' : '✗'),
    h('td', { class: 'num' }, int(t.input_tokens)), h('td', { class: 'num' }, int(t.cached_input_tokens)),
    h('td', { class: 'num' }, int(t.output_tokens)), h('td', { class: 'num' }, int(t.reasoning_tokens)),
    h('td', { class: 'num' }, t.attempts || 0), h('td', { class: 'num' }, t.latency_ms ? `${(t.latency_ms / 1000).toFixed(1)}s` : '—'),
    h('td', { class: 'num' }, usd(t.cost_usd))));
  return h('div', { class: 'card' },
    h('p', { class: 'muted small' }, 'Chi phí ước tính theo bảng giá trong cấu hình (USD / 1 triệu token). Token suy luận đã nằm trong token ra.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['Vòng', 'Vai trò', 'Model', '', 'Vào', 'Cache', 'Ra', 'Suy luận', 'Thử', 'Thời gian', 'Chi phí'].map((x, i) => h('th', { class: i >= 4 ? 'num' : null }, x)))),
      h('tbody', {}, rows),
      h('tfoot', {}, h('tr', {}, h('th', { colspan: 10 }, 'Tổng'), h('th', { class: 'num' }, usd(d.total_cost_usd)))))));
}

// ---------------------------------------------------------------- Lịch sử
async function renderHistory() {
  const saved = store('aidebate:histfilter') || {};
  const q = h('input', { type: 'search', placeholder: 'Tìm theo tiêu đề / nội dung…', 'aria-label': 'Tìm kiếm', value: saved.q || '' });
  const st = h('select', { 'aria-label': 'Lọc trạng thái' },
    h('option', { value: '' }, 'Tất cả'), ...Object.entries(STATUS_VI).map(([k, v]) => h('option', { value: k }, v)));
  st.value = saved.status || '';
  const list = h('div', { class: 'list' });
  const more = h('button', { class: 'btn block hidden', onclick: () => load(false) }, 'Tải thêm');
  let offset = 0;
  async function load(reset = true) {
    if (reset) { offset = 0; list.replaceChildren(); }
    store('aidebate:histfilter', { q: q.value, status: st.value });
    const params = new URLSearchParams({ limit: 20, offset, q: q.value, status: st.value });
    const r = await api(`/api/debates?${params}`);
    if (!r.items.length && reset) list.append(h('div', { class: 'alert info' }, 'Chưa có phiên nào. ', h('a', { href: '#/new' }, 'Tạo phiên mới →')));
    for (const d of r.items) {
      list.append(h('a', { class: 'item', href: `#/debate/${d.id}` }, h('div', { class: 'card' },
        h('div', { class: 'row' }, h('span', { class: 'ttl' }, d.title), h('span', { class: `badge ${d.status}` }, STATUS_VI[d.status])),
        h('div', { class: 'muted small' }, `${fmtTime(d.created_at)} · ${usd(d.total_cost_usd)}${d.decision ? ` · ${DECISION_VI[d.decision] || d.decision}` : ''}`))));
    }
    offset += r.items.length;
    more.classList.toggle('hidden', offset >= r.total);
  }
  let t;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load(), 350); });
  st.addEventListener('change', () => load());
  setView(h('h1', {}, 'Lịch sử phiên tranh luận'), h('div', { class: 'filters' }, q, st), list, more);
  await load();
}

// ---------------------------------------------------------------- Chi phí
async function renderUsage() {
  const u = await api('/api/usage');
  const stat = (title, val, limit) => {
    const pct = limit > 0 ? Math.min(100, (val / limit) * 100) : 0;
    const bar = h('div', { class: `bar${pct > 80 ? ' hot' : ''}` }, h('span', {}));
    bar.firstChild.style.width = `${pct}%`;
    return h('div', { class: 'card stat' }, h('div', { class: 'muted small' }, title), h('div', { class: 'v' }, usd(val)),
      limit > 0 ? [h('div', { class: 'muted small' }, `Giới hạn ${usd(limit)} · đã dùng ${pct.toFixed(1)}%`), bar] : h('div', { class: 'muted small' }, 'Không giới hạn'));
  };
  const table = (rows) => h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, ['Nhà cung cấp', 'Model', 'Lượt', 'Token vào', 'Cache', 'Token ra', 'Suy luận', 'Chi phí'].map((x, i) => h('th', { class: i >= 2 ? 'num' : null }, x)))),
    h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, h('td', {}, r.provider), h('td', {}, r.model), h('td', { class: 'num' }, r.calls),
      h('td', { class: 'num' }, int(r.input_tokens)), h('td', { class: 'num' }, int(r.cached_input_tokens)), h('td', { class: 'num' }, int(r.output_tokens)),
      h('td', { class: 'num' }, int(r.reasoning_tokens)), h('td', { class: 'num' }, usd(r.cost_usd))))
      : h('tr', {}, h('td', { colspan: 8, class: 'muted' }, 'Chưa có dữ liệu.')))));
  setView(
    h('h1', {}, 'Token & chi phí API'),
    h('div', { class: 'stats' }, stat('Hôm nay (UTC)', u.today.total, u.budgets.perDayUsd), stat('Tháng này (UTC)', u.month.total, u.budgets.perMonthUsd), stat('Tổng cộng', u.all.total, 0)),
    h('div', { class: 'card' }, h('h2', {}, 'Theo model — tháng này'), table(u.month.byModel)),
    h('div', { class: 'card' }, h('h2', {}, 'Theo model — toàn bộ'), table(u.all.byModel)),
    h('p', { class: 'muted small' }, `Giới hạn mỗi phiên: ${usd(u.budgets.perSessionUsd)}. Số liệu là ước tính theo bảng giá cấu hình; hóa đơn chính thức xem trên trang billing của OpenAI, Anthropic và Google.`));
}

// ---------------------------------------------------------------- Hướng dẫn
function renderHelp() {
  const md = `# Hướng dẫn sử dụng nhanh

1. **Tạo phiên mới:** vào *Phiên mới*, nhập **Vấn đề** (bắt buộc), thêm *Bối cảnh*, *Mục tiêu*, *Ràng buộc* nếu có. Điều chỉnh **tiêu chí chấm điểm** và trọng số, rồi bấm **Bắt đầu tranh luận**.
2. **Theo dõi:** trang phiên hiển thị 5 bước. Trang tự cập nhật mỗi 3 giây. Bạn có thể đóng trang — hệ thống vẫn chạy trên máy chủ.
3. **Xem kết quả:** tab *Báo cáo* có bảng điểm, so sánh, lập luận, rủi ro, kế hoạch hành động. Tab *Diễn biến* có toàn văn 3 vòng tranh luận.
4. **Xuất file:** bấm **⬇ Markdown** hoặc **⬇ PDF**. Nút **🖨 In** dùng chức năng in của trình duyệt.
5. **Lịch sử:** mục *Lịch sử* lưu mọi phiên; tìm kiếm theo từ khóa; **⧉ Nhân bản** để chạy lại với đầu vào cũ.
6. **Chi phí:** mục *Chi phí* cho biết số token và tiền đã dùng theo ngày/tháng, so với giới hạn.

## Quy trình tranh luận
- **Vòng 1:** ${CONFIG.participants.A.label} (A) và ${CONFIG.participants.B.label} (B) phân tích **độc lập**.
- **Vòng 2:** mỗi bên đọc phương án đối phương và **phản biện**.
- **Vòng 3:** mỗi bên **hoàn thiện** phương án.
- **Trọng tài:** ${CONFIG.participants.judge.label} chấm điểm **mù** (không biết bên nào là model nào), chọn A, B hoặc kết hợp, và nêu bất đồng chưa giải quyết.

## Mẹo để có kết quả tốt
- Nêu số liệu thực tế (ngân sách, nhân sự, thời hạn) ở *Ràng buộc*.
- Đặt tiêu chí phản ánh điều bạn thực sự quan tâm; trọng số cao = quan trọng hơn.
- Báo cáo do AI tạo — hãy kiểm chứng trước khi ra quyết định quan trọng.

## Khi gặp lỗi
- *"Chưa cấu hình API key"*: thêm key vào file \`.env\` trên máy chủ, chạy \`docker compose up -d\`.
- *"Vượt giới hạn chi phí"*: đợi sang ngày mới hoặc tăng \`MAX_COST_PER_DAY_USD\` trong \`.env\`.
- *"Không khởi động được workflow n8n"*: kiểm tra container n8n (\`docker compose ps\`).
Chi tiết xem README trong thư mục dự án.`;
  setView(h('article', { class: 'card md', html: mdHtml(md) }));
}
