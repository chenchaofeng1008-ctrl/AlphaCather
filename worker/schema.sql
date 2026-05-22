CREATE TABLE IF NOT EXISTS daily_asset_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  total_asset_amount REAL NOT NULL,
  net_asset_amount REAL,
  cash_amount REAL,
  market_value_amount REAL,
  hkd_to_usd_rate REAL,
  hkd_net_asset_amount REAL,
  hkd_net_asset_usd REAL,
  usd_net_asset_amount REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_key, snapshot_date)
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  broker_trade_id TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market TEXT,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  fee_amount REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_key, broker_trade_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  broker_order_id TEXT NOT NULL,
  order_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market TEXT,
  side TEXT NOT NULL,
  order_status TEXT NOT NULL,
  quantity REAL,
  price REAL,
  currency TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_key, broker_order_id)
);

CREATE TABLE IF NOT EXISTS cash_flows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  broker_flow_id TEXT,
  flow_date TEXT NOT NULL,
  flow_type TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_key, broker_flow_id)
);

CREATE TABLE IF NOT EXISTS position_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market TEXT,
  quantity REAL NOT NULL,
  market_value_amount REAL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_key, snapshot_date, symbol, market)
);

CREATE TABLE IF NOT EXISTS public_performance_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  point_date TEXT NOT NULL,
  return_rate REAL NOT NULL,
  benchmark_nasdaq REAL,
  benchmark_sp500 REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_key, point_date)
);

CREATE TABLE IF NOT EXISTS public_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  allocation_date TEXT NOT NULL,
  allocation_type TEXT NOT NULL,
  label TEXT NOT NULL,
  percentage REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_key, allocation_date, allocation_type, label)
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  sync_type TEXT NOT NULL,
  sync_started_at TEXT NOT NULL,
  sync_finished_at TEXT,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_daily_asset_snapshots_date
  ON daily_asset_snapshots(account_key, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_public_performance_points_date
  ON public_performance_points(account_key, point_date);

CREATE INDEX IF NOT EXISTS idx_public_allocations_date
  ON public_allocations(account_key, allocation_date, allocation_type);
