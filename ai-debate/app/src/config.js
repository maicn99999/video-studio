// Đọc cấu hình từ biến môi trường. Hỗ trợ hậu tố _FILE (Docker secrets / secret manager):
// nếu đặt OPENAI_API_KEY_FILE=/run/secrets/openai thì giá trị được đọc từ file đó.
import fs from 'node:fs';

export function readEnv(name, fallback = undefined, env = process.env) {
  const fileVar = env[`${name}_FILE`];
  if (fileVar) {
    try {
      return fs.readFileSync(fileVar, 'utf8').trim();
    } catch (err) {
      throw new Error(`Không đọc được file secret ${name}_FILE=${fileVar}: ${err.message}`);
    }
  }
  const v = env[name];
  return v === undefined || v === '' ? fallback : v;
}

const num = (v, d) => {
  if (v === undefined || v === null || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Giá trị số không hợp lệ: ${v}`);
  return n;
};
const bool = (v, d) => (v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

export function loadConfig(env = process.env) {
  const r = (n, d) => readEnv(n, d, env);
  const cfg = {
    port: num(r('PORT'), 3000),
    publicUrl: r('APP_PUBLIC_URL', 'http://localhost:3000'),
    llmMode: r('LLM_MODE', 'live'), // live | mock
    storage: r('STORAGE', 'postgres'), // postgres | memory
    databaseUrl: r('DATABASE_URL'),
    appPassword: r('APP_PASSWORD'),
    sessionSecret: r('SESSION_SECRET'),
    cookieSecure: bool(r('COOKIE_SECURE'), true),
    internalToken: r('DEBATE_INTERNAL_TOKEN'),
    n8nWebhookUrl: r('N8N_WEBHOOK_URL', 'http://n8n:5678/webhook/ai-debate'),
    chromiumPath: r('CHROMIUM_PATH', '/usr/bin/chromium-browser'),
    sessionTimeoutMin: num(r('SESSION_TIMEOUT_MIN'), 60),
    maxConcurrentDebates: num(r('MAX_CONCURRENT_DEBATES'), 2),
    budgets: {
      perSessionUsd: num(r('MAX_COST_PER_SESSION_USD'), 3),
      perDayUsd: num(r('MAX_COST_PER_DAY_USD'), 15),
      perMonthUsd: num(r('MAX_COST_PER_MONTH_USD'), 100),
    },
    llm: {
      timeoutMs: num(r('LLM_TIMEOUT_MS'), 600_000),
      callDeadlineMs: num(r('LLM_CALL_DEADLINE_MS'), 1_200_000),
      maxRetries: num(r('LLM_MAX_RETRIES'), 4),
      backoffBaseMs: num(r('LLM_BACKOFF_BASE_MS'), 2000),
      backoffMaxMs: num(r('LLM_BACKOFF_MAX_MS'), 60_000),
      maxConcurrencyPerProvider: num(r('LLM_MAX_CONCURRENCY_PER_PROVIDER'), 4),
      debateMaxOutputTokens: num(r('DEBATE_MAX_OUTPUT_TOKENS'), 16000),
      judgeMaxOutputTokens: num(r('JUDGE_MAX_OUTPUT_TOKENS'), 20000),
    },
    providers: {
      openai: {
        label: 'GPT-6 Sol',
        apiKey: r('OPENAI_API_KEY'),
        apiKeyVar: 'OPENAI_API_KEY',
        baseUrl: r('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
        model: r('OPENAI_MODEL', 'gpt-6-sol'),
        reasoningEffort: r('OPENAI_REASONING_EFFORT', 'high'),
      },
      anthropic: {
        label: 'Claude Opus 5.5',
        apiKey: r('ANTHROPIC_API_KEY'),
        apiKeyVar: 'ANTHROPIC_API_KEY',
        baseUrl: r('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
        model: r('ANTHROPIC_MODEL', 'claude-opus-5-5'),
        apiVersion: r('ANTHROPIC_VERSION', '2026-10-21'),
        effort: r('ANTHROPIC_EFFORT', 'high'),
        refusalFallback: bool(r('ANTHROPIC_REFUSAL_FALLBACK'), true),
      },
      gemini: {
        label: 'Gemini 4 Argon',
        apiKey: r('GEMINI_API_KEY'),
        apiKeyVar: 'GEMINI_API_KEY',
        baseUrl: r('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
        model: r('GEMINI_MODEL', 'gemini-4-argon'),
        thinkingLevel: r('GEMINI_THINKING_LEVEL', 'high'), // low | medium | high
      },
    },
    // Vai trò cố định: A = GPT, B = Claude, Trọng tài = Gemini.
    roles: { A: 'openai', B: 'anthropic', judge: 'gemini' },
    priceOverrides: r('PRICE_OVERRIDES_JSON'),
  };
  return cfg;
}

export function validateConfig(cfg) {
  const errors = [];
  const warnings = [];
  if (!cfg.appPassword || cfg.appPassword.length < 10) errors.push('APP_PASSWORD phải có ít nhất 10 ký tự.');
  if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) errors.push('SESSION_SECRET phải có ít nhất 32 ký tự.');
  if (!cfg.internalToken || cfg.internalToken.length < 24) errors.push('DEBATE_INTERNAL_TOKEN phải có ít nhất 24 ký tự.');
  if (cfg.storage === 'postgres' && !cfg.databaseUrl) errors.push('Thiếu DATABASE_URL.');
  for (const [id, p] of Object.entries(cfg.providers)) {
    if (!p.apiKey) warnings.push(`Chưa cấu hình ${p.apiKeyVar} (${p.label}) — phiên tranh luận sẽ dừng khi gọi AI này.`);
    else if (id && cfg.llmMode === 'live' && /^mock/i.test(p.apiKey)) warnings.push(`${p.apiKeyVar} đang là khóa mock.`);
  }
  return { errors, warnings };
}

export function missingKeys(cfg) {
  return Object.values(cfg.providers).filter((p) => !p.apiKey).map((p) => p.apiKeyVar);
}
