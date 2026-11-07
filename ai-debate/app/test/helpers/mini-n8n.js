// Bộ thông dịch tối giản cho đúng các loại node dùng trong workflow AI Debate
// (webhook, if, httpRequest, code, errorTrigger). Dùng để test nhanh trong CI mà không cần Docker.
// Kiểm thử end-to-end với n8n thật nằm ở scripts/e2e.sh.

function evalExpr(expr, ctx) {
  if (typeof expr !== 'string' || !expr.startsWith('=')) return expr;
  const tpl = expr.slice(1);
  const parts = [];
  const re = /\{\{([\s\S]+?)\}\}/g;
  let last = 0;
  let m;
  let onlyExpr = true;
  while ((m = re.exec(tpl))) {
    if (m.index > last) { parts.push(tpl.slice(last, m.index)); onlyExpr = false; }
    // eslint-disable-next-line no-new-func
    const fn = new Function('$json', '$env', '$execution', `return (${m[1]});`);
    parts.push(fn(ctx.$json, ctx.$env, ctx.$execution));
    last = re.lastIndex;
  }
  if (last < tpl.length) { parts.push(tpl.slice(last)); onlyExpr = false; }
  return onlyExpr && parts.length === 1 ? parts[0] : parts.join('');
}

export async function runWorkflow(wf, { triggerItem, env, fetchImpl = fetch, executionId = '1' }) {
  const nodes = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const outputs = {}; // nodeName -> items[]
  const trigger = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook' || n.type === 'n8n-nodes-base.errorTrigger');
  const queue = [{ name: trigger.name, input: [{ json: triggerItem }] }];
  const executed = [];

  const $ = (name) => {
    if (!outputs[name]) throw new Error(`Node "${name}" chưa chạy`);
    return { first: () => outputs[name][0], all: () => outputs[name], last: () => outputs[name].at(-1) };
  };

  while (queue.length) {
    const { name, input } = queue.shift();
    const node = nodes[name];
    if (!node) throw new Error(`Không có node ${name}`);
    executed.push(name);
    let out = [[]];
    const p = node.parameters;
    try {
      switch (node.type) {
        case 'n8n-nodes-base.webhook':
        case 'n8n-nodes-base.errorTrigger':
          out = [input];
          break;
        case 'n8n-nodes-base.if': {
          const t = [];
          const f = [];
          for (const it of input) {
            const ok = p.conditions.conditions.every((c) => evalExpr(c.leftValue, { $json: it.json, $env: env, $execution: { id: executionId } }) === true);
            (ok ? t : f).push(it);
          }
          out = [t, f];
          break;
        }
        case 'n8n-nodes-base.code': {
          // eslint-disable-next-line no-new-func
          const fn = new Function('$input', '$', `return (async () => {\n${p.jsCode}\n})();`);
          const res = await fn({ first: () => input[0], all: () => input, last: () => input.at(-1) }, $);
          out = [res.map((r) => ({ json: r.json }))];
          break;
        }
        case 'n8n-nodes-base.httpRequest': {
          const results = await Promise.all(input.map(async (it) => {
            const ctx = { $json: it.json, $env: env, $execution: { id: executionId } };
            const url = evalExpr(p.url, ctx);
            const headers = { 'content-type': 'application/json' };
            for (const hp of p.headerParameters?.parameters || []) headers[hp.name] = evalExpr(hp.value, ctx);
            const tries = node.retryOnFail ? node.maxTries : 1;
            let lastErr;
            for (let i = 0; i < tries; i++) {
              try {
                const r = await fetchImpl(url, { method: p.method, headers, body: evalExpr(p.jsonBody, ctx) });
                const body = await r.json();
                if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(body)}`);
                return { json: body };
              } catch (e) { lastErr = e; }
            }
            throw lastErr;
          }));
          out = [results];
          break;
        }
        default:
          throw new Error(`mini-n8n không hỗ trợ node ${node.type}`);
      }
    } catch (e) {
      return { ok: false, error: e, failedNode: name, executed, outputs };
    }
    outputs[name] = out[0].length ? out[0] : out.flat();
    const conns = wf.connections[name]?.main || [];
    conns.forEach((targets, idx) => {
      if (!out[idx] || !out[idx].length) return;
      for (const t of targets) queue.push({ name: t.node, input: out[idx] });
    });
  }
  return { ok: true, executed, outputs };
}
