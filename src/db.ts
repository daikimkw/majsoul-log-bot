import type { ParsedGame } from "./parser";

export interface PlayerStatsRow {
  account_id: number;
  nickname: string;
  game_count: number;
  total_point: number;
  raw_score_sum: number;
  avg_rank: number;
  rank1: number;
  rank2: number;
  rank3: number;
  rank4: number;
  kyoku_count: number;
  win_count: number;
  tsumo_count: number;
  deal_in_count: number;
  riichi_count: number;
  fuuro_count: number;
  dama_count: number;
  win_point_sum: number;
  deal_in_point_sum: number;
}

export interface GameListRow {
  uuid: string;
  start_time: number;
  mode: number;
  nickname: string;
  account_id: number;
  rank: number;
  raw_score: number;
  point: number;
}

export interface GameResultRow {
  uuid: string;
  start_time: number;
  end_time: number | null;
  mode: number;
  seat: number;
  nickname: string;
  account_id: number;
  rank: number;
  raw_score: number;
  point: number;
  kyoku_count: number;
  win_count: number;
  tsumo_count: number;
  deal_in_count: number;
  riichi_count: number;
  fuuro_count: number;
  dama_count: number;
  win_point_sum: number;
  deal_in_point_sum: number;
}

export async function saveGame(db: D1Database, game: ParsedGame): Promise<boolean> {
  const exists = await db
    .prepare("SELECT uuid FROM games WHERE uuid = ?")
    .bind(game.uuid)
    .first();
  if (exists) return false;

  const seatToPlayer = new Map(game.players.map((p) => [p.seat, p]));
  const stmts: D1PreparedStatement[] = [
    db.prepare("INSERT INTO games (uuid, start_time, end_time, mode) VALUES (?, ?, ?, ?)")
      .bind(game.uuid, game.startTime, game.endTime, game.mode),
    ...game.players.map((p) =>
      db.prepare(
        "INSERT INTO players (account_id, nickname) VALUES (?, ?) " +
        "ON CONFLICT(account_id) DO UPDATE SET nickname = excluded.nickname",
      ).bind(p.accountId, p.nickname),
    ),
    ...game.results.map((r) =>
      db.prepare(
        `INSERT INTO game_results (
          game_uuid, account_id, seat, rank, raw_score, point,
          kyoku_count, win_count, tsumo_count, deal_in_count,
          riichi_count, fuuro_count, dama_count, win_point_sum, deal_in_point_sum
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        game.uuid, seatToPlayer.get(r.seat)!.accountId, r.seat, r.rank, r.rawScore, r.point,
        r.kyokuCount, r.winCount, r.tsumoCount, r.dealInCount,
        r.riichiCount, r.fuuroCount, r.damaCount, r.winPointSum, r.dealInPointSum,
      ),
    ),
  ];
  await db.batch(stmts);
  return true;
}

export interface PointHistoryRow {
  uuid: string;
  start_time: number;
  account_id: number;
  nickname: string;
  point: number;
}

export async function fetchPointHistory(db: D1Database): Promise<PointHistoryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT g.uuid, g.start_time, r.account_id, p.nickname, r.point
      FROM games g
      JOIN game_results r ON r.game_uuid = g.uuid
      JOIN players p ON p.account_id = r.account_id
      ORDER BY g.start_time ASC, g.uuid ASC`,
    )
    .all<PointHistoryRow>();
  return results;
}

export async function deleteGame(db: D1Database, uuid: string): Promise<boolean> {
  const results = await db.batch([
    db.prepare("DELETE FROM game_results WHERE game_uuid = ?").bind(uuid),
    db.prepare("DELETE FROM games WHERE uuid = ?").bind(uuid),
  ]);
  return (results[1].meta.changes ?? 0) > 0;
}

export async function fetchPlayerStats(db: D1Database): Promise<PlayerStatsRow[]> {
  const { results } = await db
    .prepare(
      `SELECT
        p.account_id, p.nickname,
        COUNT(*) AS game_count,
        ROUND(SUM(r.point), 1) AS total_point,
        SUM(r.raw_score) AS raw_score_sum,
        ROUND(AVG(r.rank), 2) AS avg_rank,
        SUM(r.rank = 1) AS rank1,
        SUM(r.rank = 2) AS rank2,
        SUM(r.rank = 3) AS rank3,
        SUM(r.rank = 4) AS rank4,
        SUM(r.kyoku_count) AS kyoku_count,
        SUM(r.win_count) AS win_count,
        SUM(r.tsumo_count) AS tsumo_count,
        SUM(r.deal_in_count) AS deal_in_count,
        SUM(r.riichi_count) AS riichi_count,
        SUM(r.fuuro_count) AS fuuro_count,
        SUM(r.dama_count) AS dama_count,
        SUM(r.win_point_sum) AS win_point_sum,
        SUM(r.deal_in_point_sum) AS deal_in_point_sum
      FROM game_results r
      JOIN players p ON p.account_id = r.account_id
      GROUP BY p.account_id
      ORDER BY total_point DESC`,
    )
    .all<PlayerStatsRow>();
  return results;
}

export async function fetchGames(db: D1Database, limit = 100): Promise<GameListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT g.uuid, g.start_time, g.mode,
        p.nickname, r.account_id, r.rank, r.raw_score, r.point
      FROM games g
      JOIN game_results r ON r.game_uuid = g.uuid
      JOIN players p ON p.account_id = r.account_id
      WHERE g.uuid IN (SELECT uuid FROM games ORDER BY start_time DESC LIMIT ?)
      ORDER BY g.start_time DESC, r.rank ASC`,
    )
    .bind(limit)
    .all<GameListRow>();
  return results;
}

export async function fetchGame(db: D1Database, uuid: string): Promise<GameResultRow[]> {
  const { results } = await db
    .prepare(
      `SELECT g.uuid, g.start_time, g.end_time, g.mode,
        r.seat, p.nickname, r.account_id, r.rank, r.raw_score, r.point,
        r.kyoku_count, r.win_count, r.tsumo_count, r.deal_in_count,
        r.riichi_count, r.fuuro_count, r.dama_count, r.win_point_sum, r.deal_in_point_sum
      FROM games g
      JOIN game_results r ON r.game_uuid = g.uuid
      JOIN players p ON p.account_id = r.account_id
      WHERE g.uuid = ?
      ORDER BY r.rank ASC`,
    )
    .bind(uuid)
    .all<GameResultRow>();
  return results;
}
