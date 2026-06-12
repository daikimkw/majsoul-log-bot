import { describe, expect, it } from "vitest";
import { MIN_START_TIME, PaipuError, parsePaipu, type PaipuInput } from "../src/parser";

const START = MIN_START_TIME + 3600;

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

    // seat0: 放銃1回（直前の打牌者）、ツモ和了1回
    expect(bySeat.get(0)!.dealInCount).toBe(1);
    expect(bySeat.get(0)!.dealInPointSum).toBe(8000);
    expect(bySeat.get(0)!.winCount).toBe(1);
    expect(bySeat.get(0)!.tsumoCount).toBe(1);

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
    expect(game.results).toHaveLength(1);
    expect(game.results[0].riichiCount).toBe(1);
    expect(game.results[0].dealInCount).toBe(1);
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

  it("三人麻雀は拒否する", () => {
    const head = makeHead({ config: { category: 1, mode: { mode: 12 } } });
    expect(() => parsePaipu({ head, records })).toThrow(/4人麻雀/);
  });

  it("2026-06-13より前の対局は拒否する", () => {
    const head = makeHead({ start_time: MIN_START_TIME - 1 });
    expect(() => parsePaipu({ head, records })).toThrow(/期間/);
  });
});
