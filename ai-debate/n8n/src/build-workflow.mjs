#!/usr/bin/env node
// Sinh file workflow n8n (JSON import được) từ mã nguồn trong n8n/src/code.
// Chạy:  node n8n/src/build-workflow.mjs          -> ghi n8n/workflows/*.json
//        node n8n/src/build-workflow.mjs --check  -> báo lỗi nếu file JSON chưa được build lại
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODE_DIR = path.join(__dirname, 'code');
const OUT_DIR = path.join(__dirname, '..', 'workflows');

export const MAIN_WORKFLOW_ID = 'aiDebateMainWf01';
export const ERROR_WORKFLOW_ID = 'aiDebateErrorWf1';
export const WEBHOOK_PATH = 'ai-debate';

export const N = {
  webhook: 'Webhook: Nhận yêu cầu',
  token: 'Kiểm tra token',
  start: 'Bắt đầu phiên',
  r1b: 'Vòng 1: Soạn đề bài',
  r1c: 'Vòng 1: GPT & Claude phân tích',
  r1k: 'Vòng 1: Kiểm tra kết quả',
  r2b: 'Vòng 2: Soạn đề bài phản biện',
  r2c: 'Vòng 2: GPT & Claude phản biện',
  r2k: 'Vòng 2: Kiểm tra kết quả',
  r3b: 'Vòng 3: Soạn đề bài hoàn thiện',
  r3c: 'Vòng 3: GPT & Claude hoàn thiện',
  r3k: 'Vòng 3: Kiểm tra kết quả',
  jb: 'Trọng tài: Soạn hồ sơ',
  jc: 'Trọng tài: Gemini đánh giá',
  jp: 'Trọng tài: Đọc phán quyết',
  jif: 'JSON hợp lệ?',
  jrb: 'Trọng tài: Yêu cầu sửa JSON',
  jrc: 'Trọng tài: Gemini sửa JSON',
  jp2: 'Trọng tài: Đọc phán quyết (lần 2)',
  report: 'Lập báo cáo tiếng Việt',
  save: 'Lưu báo cáo',
};

export function loadCode(file) {
  const lib = fs.readFileSync(path.join(CODE_DIR, '_lib.js'), 'utf8');
  const body = fs.readFileSync(path.join(CODE_DIR, file), 'utf8');
  return `// Sinh tự động từ n8n/src/code/${file} — sửa file nguồn rồi chạy "npm run build:workflow".\n${lib}\n// ===== ${file} =====\n${body}`;
}

const uuid = (seed) => {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const INTERNAL_HEADERS = {
  sendHeaders: true,
  headerParameters: { parameters: [{ name: 'x-internal-token', value: '={{ $env.DEBATE_INTERNAL_TOKEN }}' }] },
};

function codeNode(name, file, pos) {
  return {
    id: uuid(name), name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos,
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: loadCode(file) },
  };
}

function httpPost(name, urlExpr, bodyExpr, pos, { timeout = 1_500_000, notes } = {}) {
  return {
    id: uuid(name), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos,
    parameters: {
      method: 'POST', url: urlExpr, ...INTERNAL_HEADERS,
      sendBody: true, specifyBody: 'json', jsonBody: bodyExpr,
      options: { timeout },
    },
    // Retry khi gateway tạm thời không truy cập được. Gateway có idempotency nên không bị tính phí 2 lần.
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    ...(notes ? { notes, notesInFlow: true } : {}),
  };
}

const llmNode = (name, pos, notes) =>
  httpPost(name, '={{ $env.APP_INTERNAL_URL }}/internal/llm', '={{ JSON.stringify($json.request) }}', pos, { notes });

export function buildMainWorkflow() {
  const y = 300;
  const nodes = [
    {
      id: uuid(N.webhook), name: N.webhook, type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: [0, y],
      webhookId: uuid('webhook-ai-debate'),
      parameters: { httpMethod: 'POST', path: WEBHOOK_PATH, responseMode: 'onReceived', options: {} },
      notes: 'Ứng dụng web gọi vào đây (header x-internal-token).', notesInFlow: true,
    },
    {
      id: uuid(N.token), name: N.token, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [220, y],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{
            id: uuid('cond-token'),
            leftValue: "={{ !!$env.DEBATE_INTERNAL_TOKEN && $json.headers['x-internal-token'] === $env.DEBATE_INTERNAL_TOKEN }}",
            rightValue: true,
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          }],
          combinator: 'and',
        },
        options: {},
      },
    },
    httpPost(N.start, "={{ $env.APP_INTERNAL_URL }}/internal/sessions/{{ encodeURIComponent($json.body.sessionId) }}/start",
      '={{ JSON.stringify({ executionId: $execution.id }) }}', [440, y], { timeout: 30_000 }),
    codeNode(N.r1b, 'r1_build.js', [660, y]),
    llmNode(N.r1c, [880, y], 'Gọi song song GPT-6 Sol (A) & Claude Opus 5.5 (B)'),
    codeNode(N.r1k, 'r1_collect.js', [1100, y]),
    codeNode(N.r2b, 'r2_build.js', [1320, y]),
    llmNode(N.r2c, [1540, y], 'Mỗi bên phản biện phương án đối phương'),
    codeNode(N.r2k, 'r2_collect.js', [1760, y]),
    codeNode(N.r3b, 'r3_build.js', [1980, y]),
    llmNode(N.r3c, [2200, y], 'Mỗi bên hoàn thiện phương án'),
    codeNode(N.r3k, 'r3_collect.js', [2420, y]),
    codeNode(N.jb, 'judge_build.js', [2640, y]),
    llmNode(N.jc, [2860, y], 'Gemini chấm điểm "mù" (JSON)'),
    codeNode(N.jp, 'judge_parse.js', [3080, y]),
    {
      id: uuid(N.jif), name: N.jif, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [3300, y],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{
            id: uuid('cond-valid'), leftValue: '={{ $json.valid }}', rightValue: true,
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          }],
          combinator: 'and',
        },
        options: {},
      },
    },
    codeNode(N.jrb, 'judge_repair_build.js', [3520, y + 220]),
    llmNode(N.jrc, [3740, y + 220], 'Chỉ chạy khi JSON phán quyết lỗi'),
    codeNode(N.jp2, 'judge_parse2.js', [3960, y + 220]),
    codeNode(N.report, 'report.js', [4180, y]),
    httpPost(N.save, '={{ $env.APP_INTERNAL_URL }}/internal/sessions/{{ encodeURIComponent($json.sessionId) }}/complete',
      '={{ JSON.stringify({ reportMarkdown: $json.reportMarkdown, judge: $json.judge }) }}', [4400, y], { timeout: 60_000 }),
  ];
  const link = (from, to, outIndex = 0) => ({ from, to, outIndex });
  const links = [
    link(N.webhook, N.token), link(N.token, N.start, 0), link(N.start, N.r1b),
    link(N.r1b, N.r1c), link(N.r1c, N.r1k), link(N.r1k, N.r2b),
    link(N.r2b, N.r2c), link(N.r2c, N.r2k), link(N.r2k, N.r3b),
    link(N.r3b, N.r3c), link(N.r3c, N.r3k), link(N.r3k, N.jb),
    link(N.jb, N.jc), link(N.jc, N.jp), link(N.jp, N.jif),
    link(N.jif, N.report, 0), link(N.jif, N.jrb, 1),
    link(N.jrb, N.jrc), link(N.jrc, N.jp2), link(N.jp2, N.report),
    link(N.report, N.save),
  ];
  const connections = {};
  for (const l of links) {
    const c = (connections[l.from] ||= { main: [] });
    while (c.main.length <= l.outIndex) c.main.push([]);
    c.main[l.outIndex].push({ node: l.to, type: 'main', index: 0 });
  }
  // IF "Kiểm tra token": nhánh false không nối -> dừng im lặng.
  connections[N.token].main[1] ||= [];
  return {
    id: MAIN_WORKFLOW_ID,
    name: 'AI Debate — GPT vs Claude, trọng tài Gemini',
    active: false,
    isArchived: false,
    nodes,
    connections,
    settings: {
      executionOrder: 'v1',
      errorWorkflow: ERROR_WORKFLOW_ID,
      executionTimeout: 3600,
      saveDataErrorExecution: 'all',
      saveDataSuccessExecution: 'all',
      saveExecutionProgress: true,
      saveManualExecutions: true,
      timezone: 'Asia/Ho_Chi_Minh',
      callerPolicy: 'workflowsFromSameOwner',
    },
    pinData: {},
    meta: { templateCredsSetupCompleted: true },
    tags: [],
  };
}

export function buildErrorWorkflow() {
  const trig = 'Khi workflow AI Debate lỗi';
  const notify = 'Báo lỗi về ứng dụng';
  return {
    id: ERROR_WORKFLOW_ID,
    name: 'AI Debate — Xử lý lỗi',
    active: false,
    isArchived: false,
    nodes: [
      { id: uuid(trig), name: trig, type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 300], parameters: {} },
      httpPost(notify, '={{ $env.APP_INTERNAL_URL }}/internal/n8n-error',
        '={{ JSON.stringify({ executionId: $json.execution && $json.execution.id, message: ($json.execution && $json.execution.error && $json.execution.error.message) || "Workflow n8n thất bại", node: $json.execution && $json.execution.lastNodeExecuted }) }}',
        [240, 300], { timeout: 30_000 }),
    ],
    connections: { [trig]: { main: [[{ node: notify, type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' },
    pinData: {},
    meta: { templateCredsSetupCompleted: true },
    tags: [],
  };
}

function main() {
  const check = process.argv.includes('--check');
  const files = {
    'ai-debate.json': buildMainWorkflow(),
    'ai-debate-error.json': buildErrorWorkflow(),
  };
  let stale = false;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [f, wf] of Object.entries(files)) {
    const out = JSON.stringify(wf, null, 2) + '\n';
    const p = path.join(OUT_DIR, f);
    if (check) {
      const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
      if (cur !== out) { console.error(`✗ ${f} chưa được build lại (chạy: npm run build:workflow)`); stale = true; }
      else console.log(`✓ ${f} khớp mã nguồn`);
    } else {
      fs.writeFileSync(p, out);
      console.log(`Đã ghi ${path.relative(process.cwd(), p)}`);
    }
  }
  if (stale) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
