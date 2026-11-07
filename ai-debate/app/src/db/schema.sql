-- Lược đồ CSDL của ứng dụng AI Debate (tự chạy khi khởi động, idempotent)
CREATE TABLE IF NOT EXISTS debates (
  id               UUID PRIMARY KEY,
  title            TEXT NOT NULL,
  input            JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued',   -- queued | running | completed | failed | cancelled
  stage            TEXT NOT NULL DEFAULT 'queued',   -- queued | round1 | round2 | round3 | judging | reporting | done
  error            TEXT,
  report_md        TEXT,
  judge            JSONB,
  n8n_execution_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS debates_created_idx ON debates (created_at DESC);
CREATE INDEX IF NOT EXISTS debates_status_idx ON debates (status);
CREATE INDEX IF NOT EXISTS debates_exec_idx ON debates (n8n_execution_id);

CREATE TABLE IF NOT EXISTS turns (
  id                  BIGSERIAL PRIMARY KEY,
  debate_id           UUID NOT NULL REFERENCES debates(id) ON DELETE CASCADE,
  call_key            TEXT NOT NULL,
  round               INT NOT NULL,
  role                TEXT NOT NULL,               -- A | B | judge
  stage               TEXT NOT NULL,               -- analysis | critique | refine | judge
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  status              TEXT NOT NULL,               -- running | ok | error
  content             TEXT,
  input_tokens        INT NOT NULL DEFAULT 0,
  cached_input_tokens INT NOT NULL DEFAULT 0,
  output_tokens       INT NOT NULL DEFAULT 0,
  reasoning_tokens    INT NOT NULL DEFAULT 0,
  cost_usd            NUMERIC(12,6) NOT NULL DEFAULT 0,
  attempts            INT NOT NULL DEFAULT 0,
  latency_ms          INT,
  stop_reason         TEXT,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  UNIQUE (debate_id, call_key)
);
CREATE INDEX IF NOT EXISTS turns_created_idx ON turns (created_at);
