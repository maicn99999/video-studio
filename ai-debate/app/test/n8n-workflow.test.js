import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkflow } from './helpers/setup.js';
import { loadCode, N } from '../../n8n/src/build-workflow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Chạy riêng phần thư viện _lib.js để kiểm tra các hàm thuần.
function lib() {
  const code = loadCode('r1_collect.js').split('// ===== r1_collect.js =====')[0];
  // eslint-disable-next-line no-new-func
  return new Function(`${code}; return { clip, extractJson, normalizeJudge, mdCell, problemBlock };`)();
}

test('workflow JSON đã được build từ mã nguồn mới nhất', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '../../n8n/src/build-workflow.mjs'), '--check'], { encoding: 'utf8' });
  assert.match(out, /khớp mã nguồn/);
});

test('cấu trúc workflow hợp lệ: mọi kết nối & tham chiếu $() trỏ tới node có thật', () => {
  for (const f of ['ai-debate.json', 'ai-debate-error.json']) {
    const wf = loadWorkflow(f);
    const names = new Set(wf.nodes.map((n) => n.name));
    assert.equal(names.size, wf.nodes.length, 'tên node trùng');
    assert.equal(new Set(wf.nodes.map((n) => n.id)).size, wf.nodes.length, 'id node trùng');
    for (const [from, c] of Object.entries(wf.connections)) {
      assert.ok(names.has(from), `nguồn ${from}`);
      for (const out of c.main) for (const t of out) assert.ok(names.has(t.node), `đích ${t.node}`);
    }
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
      for (const m of n.parameters.jsCode.matchAll(/\$\('([^']+)'\)/g)) assert.ok(names.has(m[1]), `${n.name} tham chiếu node không tồn tại: ${m[1]}`);
      // Code node không dùng $env (bị chặn trong task runner); chỉ biểu thức HTTP dùng $env.
      assert.ok(!/\$env/.test(n.parameters.jsCode.replace(/\/\/.*$/gm, '')), `${n.name} không được dùng $env`);
    }
  }
  const main = loadWorkflow('ai-debate.json');
  assert.equal(main.settings.errorWorkflow, loadWorkflow('ai-debate-error.json').id);
  // Không có secret nào bị hardcode trong workflow
  const raw = JSON.stringify(main) + JSON.stringify(loadWorkflow('ai-debate-error.json'));
  assert.ok(!/sk-[A-Za-z0-9]{10,}|sk-ant-|Bearer [A-Za-z0-9]/.test(raw), 'workflow chứa thứ giống API key');
  for (const n of main.nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
    assert.match(n.parameters.url, /\$env\.APP_INTERNAL_URL/);
    assert.equal(n.parameters.headerParameters.parameters[0].value, '={{ $env.DEBATE_INTERNAL_TOKEN }}');
    assert.ok(n.retryOnFail && n.maxTries >= 2);
  }
});

test('extractJson chịu được code fence, chữ thừa và dấu phẩy cuối', () => {
  const { extractJson } = lib();
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Đây là kết quả: {"a":[1,2,],} cảm ơn'), { a: [1, 2] });
  assert.equal(extractJson('không có json'), null);
  assert.equal(extractJson('{"a": '), null);
});

test('normalizeJudge tính điểm có trọng số xác định & kẹp điểm 0–10', () => {
  const { normalizeJudge } = lib();
  const criteria = [{ name: 'Khả thi', weight: 30 }, { name: 'Hiệu quả', weight: 70 }];
  const r = normalizeJudge({
    summary: 's', finalSolution: 'f', decision: 'kết hợp',
    scores: { A: [{ criterion: 'khả thi', score: 8 }, { criterion: 'Hiệu quả', score: 6 }], B: [{ criterion: 'Khả thi', score: 12 }, { criterion: 'Hiệu quả', score: '9' }] },
  }, criteria);
  assert.equal(r.valid, true);
  assert.equal(r.judge.decision, 'COMBINE');
  assert.equal(r.judge.weighted.A, 66); // (8*30+6*70)/100*10
  assert.equal(r.judge.weighted.B, 93); // (10*30+9*70)/100*10
  const bad = normalizeJudge({ decision: 'X', scores: {} }, criteria);
  assert.equal(bad.valid, false);
  assert.ok(bad.problems.length >= 3);
});

test('mdCell thoát ký tự | và xuống dòng trong bảng', () => {
  assert.equal(lib().mdCell('a|b\nc'), 'a\\|b<br>c');
});

test('tên node trong build khớp workflow', () => {
  const wf = loadWorkflow('ai-debate.json');
  for (const name of Object.values(N)) assert.ok(wf.nodes.some((n) => n.name === name), name);
});
