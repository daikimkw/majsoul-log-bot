// 雀魂の牌譜JSON（ユーザースクリプトがprotobufをデコードしてPOSTしたもの）を
// 解析して対局成績を抽出する。
// フィールド名はprotobufのデコード設定によりsnake_case/camelCaseの両方があり得るため
// 両対応で読み取る。

export class PaipuError extends Error {}

export interface PaipuInput {
  head: Record<string, unknown>;
  records: { name: string; data: Record<string, unknown> }[];
}

export interface SeatResult {
  seat: number;
  rank: number;
  rawScore: number;
  point: number;
  kyokuCount: number;
  winCount: number;
  tsumoCount: number;
  dealInCount: number;
  riichiCount: number;
  fuuroCount: number;
  winPointSum: number;
  dealInPointSum: number;
}

export interface ParsedGame {
  uuid: string;
  startTime: number;
  endTime: number | null;
  mode: number;
  players: { accountId: number; seat: number; nickname: string }[];
  results: SeatResult[];
}

// Mリーグ式: オカ20 + ウマ30-10 → +50 / +10 / -10 / -30
const PLACEMENT_POINTS = [50, 10, -10, -30];

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function field<T>(obj: unknown, key: string): T | undefined {
  if (obj == null || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  const v = o[key] ?? o[snakeToCamel(key)];
  return v as T | undefined;
}

function numField(obj: unknown, key: string, def = 0): number {
  const v = field<unknown>(obj, key);
  if (v == null) return def;
  return Number(v);
}

export function parsePaipu(input: PaipuInput): ParsedGame {
  const head = input.head;
  if (!head || !Array.isArray(input.records)) {
    throw new PaipuError("head または records がありません");
  }

  const uuid = field<string>(head, "uuid");
  if (!uuid) throw new PaipuError("対局UUIDがありません");

  const config = field<unknown>(head, "config");
  const category = numField(config, "category");
  if (category !== 1) throw new PaipuError("友人戦ではありません");

  const mode = numField(field<unknown>(config, "mode"), "mode");
  if (mode !== 1 && mode !== 2) throw new PaipuError("4人麻雀（東風/半荘）ではありません");

  const startTime = numField(head, "start_time");
  const endTime = numField(head, "end_time") || null;

  const accounts = field<unknown[]>(head, "accounts") ?? [];
  const players = accounts.map((a) => ({
    accountId: numField(a, "account_id"),
    seat: numField(a, "seat"),
    nickname: field<string>(a, "nickname") ?? "?",
  }));
  if (players.length === 0) throw new PaipuError("プレイヤー情報がありません");

  const stats = computeKyokuStats(input.records);
  const finals = computeFinalResults(head);

  // アカウントのない席はCPU。席順にCPU1, CPU2…（account_id=-1, -2…）として記録し、
  // 対局をまたいでも同じ番号同士で合算する
  const humanSeats = new Set(players.map((p) => p.seat));
  let cpuIndex = 0;
  for (const f of [...finals].sort((a, b) => a.seat - b.seat)) {
    if (!humanSeats.has(f.seat)) {
      cpuIndex++;
      players.push({ accountId: -cpuIndex, seat: f.seat, nickname: `CPU${cpuIndex}` });
    }
  }
  const results: SeatResult[] = finals.map((f) => ({ ...f, ...stats[f.seat] }));

  return { uuid, startTime, endTime, mode, players, results };
}

interface KyokuStats {
  kyokuCount: number;
  winCount: number;
  tsumoCount: number;
  dealInCount: number;
  riichiCount: number;
  fuuroCount: number;
  winPointSum: number;
  dealInPointSum: number;
}

function computeKyokuStats(records: PaipuInput["records"]): KyokuStats[] {
  const stats: KyokuStats[] = Array.from({ length: 4 }, () => ({
    kyokuCount: 0,
    winCount: 0,
    tsumoCount: 0,
    dealInCount: 0,
    riichiCount: 0,
    fuuroCount: 0,
    winPointSum: 0,
    dealInPointSum: 0,
  }));

  // 直近の打牌者（槍槓時はカンした者）。ロン和了の放銃者特定に使う
  let ldseat = -1;
  let riichiDone = [false, false, false, false];
  let fuuroDone = [false, false, false, false];

  for (const rec of records) {
    const name = rec.name.replace(/^\.?lq\./, "");
    const d = rec.data;
    switch (name) {
      case "RecordNewRound": {
        for (const s of stats) s.kyokuCount++;
        ldseat = -1;
        riichiDone = [false, false, false, false];
        fuuroDone = [false, false, false, false];
        break;
      }
      case "RecordDiscardTile": {
        const seat = numField(d, "seat");
        ldseat = seat;
        const isLiqi = field<boolean>(d, "is_liqi") || field<boolean>(d, "is_wliqi");
        if (isLiqi && !riichiDone[seat]) {
          riichiDone[seat] = true;
          stats[seat].riichiCount++;
        }
        break;
      }
      case "RecordChiPengGang": {
        // type: 0=チー, 1=ポン, 2=明カン
        const seat = numField(d, "seat");
        if (!fuuroDone[seat]) {
          fuuroDone[seat] = true;
          stats[seat].fuuroCount++;
        }
        break;
      }
      case "RecordAnGangAddGang": {
        // 槍槓ロンに備えて直近行動者を更新（暗槓への国士ロン含む）
        ldseat = numField(d, "seat");
        break;
      }
      case "RecordHule": {
        const hules = field<unknown[]>(d, "hules") ?? [];
        const delta = (field<unknown[]>(d, "delta_scores") ?? []).map(Number);
        let ron = false;
        for (const h of hules) {
          const seat = numField(h, "seat");
          const zimo = field<boolean>(h, "zimo") === true;
          stats[seat].winCount++;
          if (zimo) stats[seat].tsumoCount++;
          else ron = true;
          stats[seat].winPointSum += delta[seat] ?? 0;
        }
        if (ron && ldseat >= 0) {
          stats[ldseat].dealInCount++;
          stats[ldseat].dealInPointSum += -(delta[ldseat] ?? 0);
        }
        break;
      }
      default:
        break;
    }
  }
  return stats;
}

function computeFinalResults(
  head: Record<string, unknown>,
): { seat: number; rank: number; rawScore: number; point: number }[] {
  const resultPlayers = field<unknown[]>(field<unknown>(head, "result"), "players") ?? [];
  if (resultPlayers.length === 0) throw new PaipuError("最終結果がありません");

  const entries = resultPlayers.map((p) => ({
    seat: numField(p, "seat"),
    rawScore: numField(p, "part_point_1"),
  }));
  // 素点降順、同点は起家に近い席順
  entries.sort((a, b) => b.rawScore - a.rawScore || a.seat - b.seat);

  const out: { seat: number; rank: number; rawScore: number; point: number }[] = [];
  let i = 0;
  while (i < entries.length) {
    let j = i;
    while (j + 1 < entries.length && entries[j + 1].rawScore === entries[i].rawScore) j++;
    // 同点グループは順位点を等分し、同順位とする
    const shared =
      PLACEMENT_POINTS.slice(i, j + 1).reduce((a, b) => a + b, 0) / (j - i + 1);
    for (let k = i; k <= j; k++) {
      const e = entries[k];
      out.push({
        seat: e.seat,
        rank: i + 1,
        rawScore: e.rawScore,
        point: Math.round(((e.rawScore - 30000) / 1000 + shared) * 10) / 10,
      });
    }
    i = j + 1;
  }
  return out;
}
