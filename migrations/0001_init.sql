-- 対局
CREATE TABLE games (
  uuid TEXT PRIMARY KEY,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  mode INTEGER NOT NULL, -- 1=四人東, 2=四人南
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- プレイヤー（nicknameは最新のものを保持）
CREATE TABLE players (
  account_id INTEGER PRIMARY KEY,
  nickname TEXT NOT NULL
);

-- 対局ごとのプレイヤー成績
CREATE TABLE game_results (
  game_uuid TEXT NOT NULL REFERENCES games(uuid) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES players(account_id),
  seat INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  raw_score INTEGER NOT NULL,        -- 素点
  point REAL NOT NULL,               -- Mリーグ式ポイント
  kyoku_count INTEGER NOT NULL,
  win_count INTEGER NOT NULL,
  tsumo_count INTEGER NOT NULL,
  deal_in_count INTEGER NOT NULL,
  riichi_count INTEGER NOT NULL,
  fuuro_count INTEGER NOT NULL,
  win_point_sum INTEGER NOT NULL,
  deal_in_point_sum INTEGER NOT NULL,
  PRIMARY KEY (game_uuid, seat)
);

CREATE INDEX idx_game_results_account ON game_results(account_id);
CREATE INDEX idx_games_start_time ON games(start_time);
