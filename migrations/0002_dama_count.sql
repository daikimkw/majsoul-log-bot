-- 黙聴（副露なし・立直なし）での和了回数
ALTER TABLE game_results ADD COLUMN dama_count INTEGER NOT NULL DEFAULT 0;
