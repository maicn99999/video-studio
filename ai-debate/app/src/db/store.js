// Hai cách lưu trữ có cùng giao diện: Postgres (production) và bộ nhớ (test / chạy thử nhanh).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TURN_NUM_FIELDS = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_tokens', 'attempts', 'latency_ms'];

function normTurn(t) {
  const o = { ...t, cost_usd: Number(t.cost_usd || 0) };
  for (const f of TURN_NUM_FIELDS) if (o[f] !== null && o[f] !== undefined) o[f] = Number(o[f]);
  return o;
}

function startOfDayUtc(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function startOfMonthUtc(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
export const periods = { startOfDayUtc, startOfMonthUtc };

// ------------------------------------------------------------------ Memory
export class MemoryStore {
  constructor() {
    this.debates = new Map();
    this.turns = [];
    this.seq = 0;
  }
  async init() {}
  async close() {}
  async ping() { return true; }

  async createDebate({ id, title, input }) {
    const now = new Date();
    const d = { id, title, input, status: 'queued', stage: 'queued', error: null, report_md: null, judge: null,
      n8n_execution_id: null, created_at: now, started_at: null, finished_at: null, updated_at: now };
    this.debates.set(id, d);
    return { ...d };
  }
  async getDebate(id, { withTurns = true } = {}) {
    const d = this.debates.get(id);
    if (!d) return null;
    const out = { ...d, total_cost_usd: this._debateCost(id) };
    if (withTurns) out.turns = this.turns.filter((t) => t.debate_id === id).sort((a, b) => a.id - b.id).map(normTurn);
    return out;
  }
  _debateCost(id) {
    return this.turns.filter((t) => t.debate_id === id).reduce((s, t) => s + Number(t.cost_usd || 0), 0);
  }
  async listDebates({ limit = 20, offset = 0, q = '', status } = {}) {
    let arr = [...this.debates.values()];
    if (q) {
      const s = q.toLowerCase();
      arr = arr.filter((d) => d.title.toLowerCase().includes(s) || JSON.stringify(d.input).toLowerCase().includes(s));
    }
    if (status) arr = arr.filter((d) => d.status === status);
    arr.sort((a, b) => b.created_at - a.created_at);
    return {
      total: arr.length,
      items: arr.slice(offset, offset + limit).map((d) => ({
        id: d.id, title: d.title, status: d.status, stage: d.stage, created_at: d.created_at, finished_at: d.finished_at,
        decision: d.judge?.decision ?? null, total_cost_usd: this._debateCost(d.id),
      })),
    };
  }
  async updateDebate(id, patch) {
    const d = this.debates.get(id);
    if (!d) return null;
    Object.assign(d, patch, { updated_at: new Date() });
    return { ...d };
  }
  async deleteDebate(id) {
    this.turns = this.turns.filter((t) => t.debate_id !== id);
    return this.debates.delete(id);
  }
  async findDebateByExecution(execId) {
    return [...this.debates.values()].find((d) => d.n8n_execution_id === String(execId)) || null;
  }
  async countActive() {
    return [...this.debates.values()].filter((d) => d.status === 'queued' || d.status === 'running').length;
  }
  async listStale(before) {
    return [...this.debates.values()].filter((d) => (d.status === 'queued' || d.status === 'running') && d.updated_at < before);
  }
  async getTurn(debateId, callKey) {
    const t = this.turns.find((x) => x.debate_id === debateId && x.call_key === callKey);
    return t ? normTurn(t) : null;
  }
  async upsertTurn(t) {
    const i = this.turns.findIndex((x) => x.debate_id === t.debate_id && x.call_key === t.call_key);
    if (i >= 0) {
      this.turns[i] = { ...this.turns[i], ...t };
      return normTurn(this.turns[i]);
    }
    const row = { id: ++this.seq, created_at: new Date(), finished_at: null, content: null, error: null,
      input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cost_usd: 0, attempts: 0, ...t };
    this.turns.push(row);
    return normTurn(row);
  }
  async updateTurn(debateId, callKey, patch) {
    const t = this.turns.find((x) => x.debate_id === debateId && x.call_key === callKey);
    if (!t) return null;
    Object.assign(t, patch);
    return normTurn(t);
  }
  async sumCost(since) {
    return this.turns.filter((t) => !since || t.created_at >= since).reduce((s, t) => s + Number(t.cost_usd || 0), 0);
  }
  async debateCost(id) { return this._debateCost(id); }
  async usageByModel(since) {
    const map = new Map();
    for (const t of this.turns) {
      if (since && t.created_at < since) continue;
      const k = `${t.provider}|${t.model}`;
      const r = map.get(k) || { provider: t.provider, model: t.model, calls: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cost_usd: 0 };
      r.calls += 1;
      r.input_tokens += t.input_tokens || 0;
      r.cached_input_tokens += t.cached_input_tokens || 0;
      r.output_tokens += t.output_tokens || 0;
      r.reasoning_tokens += t.reasoning_tokens || 0;
      r.cost_usd += Number(t.cost_usd || 0);
      map.set(k, r);
    }
    return [...map.values()];
  }
}

// ------------------------------------------------------------------ Postgres
export class PgStore {
  constructor(databaseUrl) {
    this.databaseUrl = databaseUrl;
  }
  async init() {
    const { default: pg } = await import('pg');
    // NUMERIC -> number
    pg.types.setTypeParser(1700, (v) => Number(v));
    pg.types.setTypeParser(20, (v) => Number(v));
    this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: 10 });
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    // Chờ Postgres sẵn sàng (khi docker compose vừa khởi động)
    for (let i = 0; ; i++) {
      try {
        await this.pool.query(sql);
        break;
      } catch (e) {
        if (i >= 30) throw e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  async close() { await this.pool?.end(); }
  async ping() { await this.pool.query('SELECT 1'); return true; }
  q(text, params) { return this.pool.query(text, params); }

  async createDebate({ id, title, input }) {
    const { rows } = await this.q('INSERT INTO debates (id, title, input) VALUES ($1,$2,$3) RETURNING *', [id, title, input]);
    return rows[0];
  }
  async getDebate(id, { withTurns = true } = {}) {
    const { rows } = await this.q(
      `SELECT d.*, COALESCE((SELECT SUM(cost_usd) FROM turns t WHERE t.debate_id = d.id), 0) AS total_cost_usd
       FROM debates d WHERE d.id = $1`, [id]);
    if (!rows[0]) return null;
    const d = rows[0];
    if (withTurns) {
      const t = await this.q('SELECT * FROM turns WHERE debate_id = $1 ORDER BY id', [id]);
      d.turns = t.rows.map(normTurn);
    }
    return d;
  }
  async listDebates({ limit = 20, offset = 0, q = '', status } = {}) {
    const where = [];
    const params = [];
    if (q) { params.push(`%${q}%`); where.push(`(d.title ILIKE $${params.length} OR d.input::text ILIKE $${params.length})`); }
    if (status) { params.push(status); where.push(`d.status = $${params.length}`); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await this.q(`SELECT COUNT(*)::int AS n FROM debates d ${w}`, params)).rows[0].n;
    params.push(limit, offset);
    const { rows } = await this.q(
      `SELECT d.id, d.title, d.status, d.stage, d.created_at, d.finished_at, d.judge->>'decision' AS decision,
              COALESCE((SELECT SUM(cost_usd) FROM turns t WHERE t.debate_id = d.id), 0) AS total_cost_usd
       FROM debates d ${w} ORDER BY d.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { total, items: rows };
  }
  async updateDebate(id, patch) {
    const keys = Object.keys(patch);
    if (!keys.length) return this.getDebate(id, { withTurns: false });
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    const { rows } = await this.q(
      `UPDATE debates SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...keys.map((k) => patch[k])]);
    return rows[0] || null;
  }
  async deleteDebate(id) {
    const r = await this.q('DELETE FROM debates WHERE id = $1', [id]);
    return r.rowCount > 0;
  }
  async findDebateByExecution(execId) {
    const { rows } = await this.q('SELECT * FROM debates WHERE n8n_execution_id = $1', [String(execId)]);
    return rows[0] || null;
  }
  async countActive() {
    const { rows } = await this.q(`SELECT COUNT(*)::int AS n FROM debates WHERE status IN ('queued','running')`);
    return rows[0].n;
  }
  async listStale(before) {
    const { rows } = await this.q(`SELECT * FROM debates WHERE status IN ('queued','running') AND updated_at < $1`, [before]);
    return rows;
  }
  async getTurn(debateId, callKey) {
    const { rows } = await this.q('SELECT * FROM turns WHERE debate_id = $1 AND call_key = $2', [debateId, callKey]);
    return rows[0] ? normTurn(rows[0]) : null;
  }
  async upsertTurn(t) {
    const cols = Object.keys(t);
    const vals = cols.map((c) => t[c]);
    const updates = cols.filter((c) => c !== 'debate_id' && c !== 'call_key').map((c) => `${c} = EXCLUDED.${c}`);
    const { rows } = await this.q(
      `INSERT INTO turns (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})
       ON CONFLICT (debate_id, call_key) DO UPDATE SET ${updates.join(', ')} RETURNING *`, vals);
    return normTurn(rows[0]);
  }
  async updateTurn(debateId, callKey, patch) {
    const keys = Object.keys(patch);
    const sets = keys.map((k, i) => `${k} = $${i + 3}`);
    const { rows } = await this.q(
      `UPDATE turns SET ${sets.join(', ')} WHERE debate_id = $1 AND call_key = $2 RETURNING *`,
      [debateId, callKey, ...keys.map((k) => patch[k])]);
    return rows[0] ? normTurn(rows[0]) : null;
  }
  async sumCost(since) {
    const { rows } = since
      ? await this.q('SELECT COALESCE(SUM(cost_usd),0) AS s FROM turns WHERE created_at >= $1', [since])
      : await this.q('SELECT COALESCE(SUM(cost_usd),0) AS s FROM turns');
    return Number(rows[0].s);
  }
  async debateCost(id) {
    const { rows } = await this.q('SELECT COALESCE(SUM(cost_usd),0) AS s FROM turns WHERE debate_id = $1', [id]);
    return Number(rows[0].s);
  }
  async usageByModel(since) {
    const { rows } = await this.q(
      `SELECT provider, model, COUNT(*)::int AS calls, SUM(input_tokens)::bigint AS input_tokens,
              SUM(cached_input_tokens)::bigint AS cached_input_tokens, SUM(output_tokens)::bigint AS output_tokens,
              SUM(reasoning_tokens)::bigint AS reasoning_tokens, COALESCE(SUM(cost_usd),0) AS cost_usd
       FROM turns ${since ? 'WHERE created_at >= $1' : ''} GROUP BY provider, model ORDER BY provider, model`,
      since ? [since] : []);
    return rows;
  }
}

export function createStore(cfg) {
  return cfg.storage === 'memory' ? new MemoryStore() : new PgStore(cfg.databaseUrl);
}
