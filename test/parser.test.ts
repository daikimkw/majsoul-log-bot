import { describe, expect, it } from "vitest";
import { PaipuError, parsePaipu, type PaipuInput } from "../src/parser";

const START = Date.UTC(2026, 5, 13) / 1000;

function makeHead(over: Partial<Record<string, unknown>> = {}) {
  return {
    uuid: "260613-aaaa-bbbb-cccc-dddd",
    start_time: START,
    end_time: START + 3000,
    config: { category: 1, mode: { mode: 2 } },
    accounts: [
      { account_id: 101, seat: 0, nickname: "A" },
      { account_id: 102, seat: 1, nickname: "B" },
      { account_id: 103, seat: 2, nickname: "C" },
      { account_id: 104, seat: 3, nickname: "D" },
    ],
    result: {
      players: [
        { seat: 0, part_point_1: 41000, total_point: 61000 },
        { seat: 1, part_point_1: 28000, total_point: 8000 },
        { seat: 2, part_point_1: 19000, total_point: -21000 },
        { seat: 3, part_point_1: 12000, total_point: -48000 },
      ],
    },
    ...over,
  };
}

// 東1局: seat1がリーチ→seat0がseat1にロン放銃…ではなく seat1 が seat0 からロン
// 東2局: seat2がポン、seat0がツモ和了
const records: PaipuInput["records"] = [
  { name: ".lq.RecordNewRound", data: { chang: 0, ju: 0 } },
  { name: ".lq.RecordDiscardTile", data: { seat: 1, is_liqi: true } },
  { name: ".lq.RecordDiscardTile", data: { seat: 0 } },
  {
    name: ".lq.RecordHule",
    data: {
      hules: [{ seat: 1, zimo: false, point_rong: 8000 }],
      delta_scores: [-8000, 9000, 0, 0],
    },
  },
  { name: ".lq.RecordNewRound", data: { chang: 0, ju: 1 } },
  { name: ".lq.RecordChiPengGang", data: { seat: 2, type: 1 } },
  { name: ".lq.RecordDiscardTile", data: { seat: 3 } },
  {
    name: ".lq.RecordHule",
    data: {
      hules: [{ seat: 0, zimo: true, point_zimo_qin: 0 }],
      delta_scores: [4000, -1000, -1000, -2000],
    },
  },
];

describe("parsePaipu", () => {
  it("基本的な対局を解析できる", () => {
    const game = parsePaipu({ head: makeHead(), records });
    expect(game.uuid).toBe("260613-aaaa-bbbb-cccc-dddd");
    expect(game.players).toHaveLength(4);

    const bySeat = new Map(game.results.map((r) => [r.seat, r]));
    // 順位とMリーグ式ポイント
    expect(bySeat.get(0)!.rank).toBe(1);
    expect(bySeat.get(0)!.point).toBeCloseTo((41000 - 30000) / 1000 + 50);
    expect(bySeat.get(3)!.rank).toBe(4);
    expect(bySeat.get(3)!.point).toBeCloseTo((12000 - 30000) / 1000 - 30);

    // 局数
    expect(bySeat.get(0)!.kyokuCount).toBe(2);

    // seat1: ロン和了1回・立直1回
    expect(bySeat.get(1)!.winCount).toBe(1);
    expect(bySeat.get(1)!.tsumoCount).toBe(0);
    expect(bySeat.get(1)!.riichiCount).toBe(1);
    expect(bySeat.get(1)!.winPointSum).toBe(9000);
    // 立直和了なので黙聴ではない
    expect(bySeat.get(1)!.damaCount).toBe(0);

    // seat0: 放銃1回（直前の打牌者）、ツモ和了1回
    expect(bySeat.get(0)!.dealInCount).toBe(1);
    expect(bySeat.get(0)!.dealInPointSum).toBe(8000);
    expect(bySeat.get(0)!.winCount).toBe(1);
    expect(bySeat.get(0)!.tsumoCount).toBe(1);
    // 副露も立直もせずツモ和了 → 黙聴1回
    expect(bySeat.get(0)!.damaCount).toBe(1);

    // seat2: 副露1回
    expect(bySeat.get(2)!.fuuroCount).toBe(1);
    expect(bySeat.get(2)!.dealInCount).toBe(0);
  });

  it("camelCaseのフィールド名でも解析できる", () => {
    const head = {
      uuid: "260613-camel",
      startTime: START,
      endTime: START + 100,
      config: { category: 1, mode: { mode: 1 } },
      accounts: [{ accountId: 101, seat: 0, nickname: "A" }],
      result: {
        players: [
          { seat: 0, partPoint1: 50000 },
          { seat: 1, partPoint1: 20000 },
          { seat: 2, partPoint1: 20000 },
          { seat: 3, partPoint1: 10000 },
        ],
      },
    };
    const recs: PaipuInput["records"] = [
      { name: ".lq.RecordNewRound", data: {} },
      { name: ".lq.RecordDiscardTile", data: { seat: 0, isLiqi: true } },
      {
        name: ".lq.RecordHule",
        data: { hules: [{ seat: 1, zimo: false }], deltaScores: [-2000, 2000, 0, 0] },
      },
    ];
    const game = parsePaipu({ head, records: recs });
    expect(game.results).toHaveLength(4);
    const seat0 = game.results.find((r) => r.seat === 0)!;
    expect(seat0.riichiCount).toBe(1);
    expect(seat0.dealInCount).toBe(1);
    const seat1 = game.results.find((r) => r.seat === 1)!;
    expect(seat1.winCount).toBe(1);
  });

  it("アカウントのない席はCPU1, CPU2…として記録する", () => {
    const head = makeHead({
      accounts: [
        { account_id: 101, seat: 0, nickname: "A" },
        { account_id: 102, seat: 2, nickname: "B" },
      ],
    });
    const game = parsePaipu({ head, records });
    expect(game.results).toHaveLength(4);
    const cpus = game.players
      .filter((p) => p.accountId < 0)
      .sort((a, b) => a.seat - b.seat);
    expect(cpus).toEqual([
      { accountId: -1, seat: 1, nickname: "CPU1" },
      { accountId: -2, seat: 3, nickname: "CPU2" },
    ]);
  });

  it("robotsがある場合はcharidをキーにキャラ名で記録する", () => {
    const head = makeHead({
      accounts: [
        { account_id: 101, seat: 0, nickname: "A" },
        { account_id: 102, seat: 2, nickname: "B" },
      ],
      robots: [
        { account_id: 1, seat: 1, character: { charid: 200002 } },
        { account_id: 2, seat: 3, character: { charid: 200001 } },
      ],
    });
    const game = parsePaipu({ head, records });
    const cpus = game.players
      .filter((p) => p.accountId < 0)
      .sort((a, b) => a.seat - b.seat);
    // account_id=-charid、表示名はキャラ名。対局をまたいでも同じcharidで合算される
    expect(cpus).toEqual([
      { accountId: -200002, seat: 1, nickname: "二階堂美樹" },
      { accountId: -200001, seat: 3, nickname: "一姫" },
    ]);
  });

  it("同点の場合は順位点を等分する", () => {
    const game = parsePaipu({ head: makeHead(), records });
    const headTied = makeHead({
      result: {
        players: [
          { seat: 0, part_point_1: 30000 },
          { seat: 1, part_point_1: 30000 },
          { seat: 2, part_point_1: 25000 },
          { seat: 3, part_point_1: 15000 },
        ],
      },
    });
    const tied = parsePaipu({ head: headTied, records });
    const bySeat = new Map(tied.results.map((r) => [r.seat, r]));
    // 同点1位2人: (50+10)/2 = 30
    expect(bySeat.get(0)!.rank).toBe(1);
    expect(bySeat.get(1)!.rank).toBe(1);
    expect(bySeat.get(0)!.point).toBeCloseTo(30);
    expect(bySeat.get(1)!.point).toBeCloseTo(30);
    expect(bySeat.get(2)!.rank).toBe(3);
    expect(game.results).toHaveLength(4);
  });

  it("ダブロンで両者の和了と放銃者を正しく数える", () => {
    const recs: PaipuInput["records"] = [
      { name: ".lq.RecordNewRound", data: {} },
      { name: ".lq.RecordDiscardTile", data: { seat: 3 } },
      {
        name: ".lq.RecordHule",
        data: {
          hules: [
            { seat: 0, zimo: false },
            { seat: 1, zimo: false },
          ],
          delta_scores: [8000, 3900, 0, -11900],
        },
      },
    ];
    const game = parsePaipu({ head: makeHead(), records: recs });
    const bySeat = new Map(game.results.map((r) => [r.seat, r]));
    expect(bySeat.get(0)!.winCount).toBe(1);
    expect(bySeat.get(1)!.winCount).toBe(1);
    expect(bySeat.get(3)!.dealInCount).toBe(1);
    expect(bySeat.get(3)!.dealInPointSum).toBe(11900);
  });

  it("槍槓はカンした者を放銃者とする", () => {
    const recs: PaipuInput["records"] = [
      { name: ".lq.RecordNewRound", data: {} },
      { name: ".lq.RecordDiscardTile", data: { seat: 0 } },
      { name: ".lq.RecordAnGangAddGang", data: { seat: 2, type: 2 } },
      {
        name: ".lq.RecordHule",
        data: { hules: [{ seat: 1, zimo: false }], delta_scores: [0, 2000, -2000, 0] },
      },
    ];
    const game = parsePaipu({ head: makeHead(), records: recs });
    const bySeat = new Map(game.results.map((r) => [r.seat, r]));
    expect(bySeat.get(2)!.dealInCount).toBe(1);
    expect(bySeat.get(0)!.dealInCount).toBe(0);
  });

  it("友人戦以外は拒否する", () => {
    const head = makeHead({ config: { category: 2, mode: { mode: 2 } } });
    expect(() => parsePaipu({ head, records })).toThrow(PaipuError);
  });

  it("三人麻雀を受理しウマ30-0-▲30＋オカ自動でポイントを計算する", () => {
    const head = makeHead({
      accounts: [
        { account_id: 101, seat: 0, nickname: "A" },
        { account_id: 102, seat: 1, nickname: "B" },
        { account_id: 103, seat: 2, nickname: "C" },
      ],
      config: {
        category: 1,
        mode: { mode: 12, detail_rule: { init_point: 35000, fandian: 40000 } },
      },
      result: {
        players: [
          { seat: 0, part_point_1: 50000 },
          { seat: 1, part_point_1: 35000 },
          { seat: 2, part_point_1: 20000 },
        ],
      },
    });
    const game = parsePaipu({ head, records });
    expect(game.results).toHaveLength(3);
    const bySeat = new Map(game.results.map((r) => [r.seat, r]));
    // オカ=(40000-35000)*3/1000=15、順位点=[45,0,-30]
    expect(bySeat.get(0)!.rank).toBe(1);
    expect(bySeat.get(0)!.point).toBeCloseTo((50000 - 40000) / 1000 + 45);
    expect(bySeat.get(1)!.point).toBeCloseTo((35000 - 40000) / 1000);
    expect(bySeat.get(2)!.point).toBeCloseTo((20000 - 40000) / 1000 - 30);
    // 合計はゼロサム
    const sum = game.results.reduce((a, r) => a + r.point, 0);
    expect(sum).toBeCloseTo(0);
  });

  it("3人でも4人でもない場合は拒否する", () => {
    const head = makeHead({
      result: { players: [{ seat: 0, part_point_1: 25000 }, { seat: 1, part_point_1: 25000 }] },
    });
    expect(() => parsePaipu({ head, records })).toThrow(PaipuError);
  });

});
