CREATE TABLE cashier_scan_sessions (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id),
  cashier_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE TABLE cashier_scan_uses (
  scan_session_id TEXT PRIMARY KEY REFERENCES cashier_scan_sessions(id),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cashier_scan_sessions_actor ON cashier_scan_sessions(cashier_id, expires_at);

ALTER TABLE students ADD COLUMN education_level TEXT NOT NULL DEFAULT 'MTsN';
