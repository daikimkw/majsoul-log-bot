import type { FC, PropsWithChildren } from "hono/jsx";
import type { GameListRow, GameResultRow, PlayerStatsRow, PointHistoryRow } from "./db";

const MODE_NAMES: Record<number, string> = { 1: "四人東", 2: "四人南", 11: "三人東", 12: "三人南" };

const fmtDate = (unix: number) =>
  new Date(unix * 1000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

const fmtDateShort = (unix: number) =>
  new Date(unix * 1000).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "-");

const fmtPoint = (p: number) => (p > 0 ? `+${p.toFixed(1)}` : p.toFixed(1));

const CSS = `
:root { color-scheme: light dark; }
body { font-family: "Hiragino Sans", "Noto Sans JP", sans-serif; max-width: 1080px; margin: 0 auto; padding: 16px; }
h1 a { color: inherit; text-decoration: none; }
nav { margin-bottom: 24px; }
nav a { margin-right: 16px; }
table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
th, td { border: 1px solid #8884; padding: 6px 10px; text-align: right; white-space: nowrap; }
th:first-child, td:first-child { text-align: left; }
thead { background: #8882; }
.pos { color: #1a7f37; } .neg { color: #cf222e; }
.muted { color: #888; font-size: 0.85em; }
.bookmarklet { display: inline-block; padding: 8px 16px; border: 1px solid #888; border-radius: 6px; background: #8881; font-weight: bold; }
input[type="password"] { padding: 6px 8px; font-size: 14px; width: 280px; }
ol li { margin-bottom: 8px; }
.matrix-wrap { overflow-x: auto; margin-bottom: 24px; }
.matrix { margin: 0; white-space: nowrap; }
.matrix th:first-child, .matrix td:first-child { position: sticky; left: 0; text-align: left; }
.matrix tbody td:first-child, .matrix tfoot td:first-child { background: Canvas; }
.matrix thead th:first-child { background: Canvas; }
.matrix tfoot td { border-top: 2px solid #8886; font-weight: bold; }
.matrix .win { font-weight: bold; }
`;

export const Layout: FC<PropsWithChildren<{ title?: string }>> = ({ title, children }) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title ? `${title} | 雀魂友人戦成績` : "雀魂友人戦成績"}</title>
      <style>{CSS}</style>
    </head>
    <body>
      <h1>
        <a href="/">雀魂友人戦成績</a>
      </h1>
      <nav>
        <a href="/">総合成績</a>
        <a href="/games">対局一覧</a>
        {" | "}
        <a href="/sanma">総合成績(三麻)</a>
        <a href="/sanma/games">対局一覧(三麻)</a>
        {" | "}
        <a href="/setup">記録のやり方</a>
      </nav>
      {children}
    </body>
  </html>
);

const PointCell: FC<{ point: number }> = ({ point }) => (
  <td class={point > 0 ? "pos" : point < 0 ? "neg" : ""}>{fmtPoint(point)}</td>
);

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d"];

const PointChart: FC<{ history: PointHistoryRow[] }> = ({ history }) => {
  const gameIds: string[] = [];
  for (const row of history) {
    if (gameIds[gameIds.length - 1] !== row.uuid) gameIds.push(row.uuid);
  }
  if (gameIds.length === 0) return null;
  const gameIndex = new Map(gameIds.map((id, i) => [id, i]));

  // プレイヤーごとに累計ポイント系列を作る（不参加の対局は横ばい）
  const byPlayer = new Map<number, { name: string; deltas: Map<number, number> }>();
  for (const row of history) {
    let p = byPlayer.get(row.account_id);
    if (!p) {
      p = { name: row.nickname, deltas: new Map() };
      byPlayer.set(row.account_id, p);
    }
    const i = gameIndex.get(row.uuid)!;
    p.deltas.set(i, (p.deltas.get(i) ?? 0) + row.point);
  }
  let colorIdx = 0;
  const series = [...byPlayer.entries()].map(([accountId, p]) => {
    const ys = [0];
    let cum = 0;
    for (let i = 0; i < gameIds.length; i++) {
      cum += p.deltas.get(i) ?? 0;
      ys.push(Math.round(cum * 10) / 10);
    }
    const color =
      accountId < 0 ? ["#888888", "#aaaaaa", "#666666"][-accountId - 1] || "#999999" : PALETTE[colorIdx++ % PALETTE.length];
    return { name: p.name, color, ys, total: ys[ys.length - 1] };
  });
  series.sort((a, b) => b.total - a.total);

  const W = 800;
  const H = 300;
  const PAD = { l: 56, r: 16, t: 12, b: 28 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const allY = series.flatMap((s) => s.ys);
  const yMax = Math.max(10, ...allY);
  const yMin = Math.min(-10, ...allY);
  const x = (i: number) => PAD.l + (gameIds.length === 0 ? 0 : (i / gameIds.length) * innerW);
  const y = (v: number) => PAD.t + ((yMax - v) / (yMax - yMin)) * innerH;

  const step = Math.max(10, Math.ceil((yMax - yMin) / 6 / 10) * 10);
  const ticks: number[] = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) ticks.push(v);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style="width:100%;max-width:1080px;font-size:11px">
        {ticks.map((v) => (
          <g>
            <line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} stroke={v === 0 ? "#888" : "#8883"} stroke-width={v === 0 ? 1.5 : 1} />
            <text x={PAD.l - 6} y={y(v) + 4} text-anchor="end" fill="#888">{v}</text>
          </g>
        ))}
        <text x={PAD.l} y={H - 8} fill="#888">0戦</text>
        <text x={W - PAD.r} y={H - 8} text-anchor="end" fill="#888">{gameIds.length}戦</text>
        {series.map((s) => (
          <polyline
            points={s.ys.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={s.color}
            stroke-width="2"
          />
        ))}
      </svg>
      <p>
        {series.map((s) => (
          <span style="margin-right:16px;white-space:nowrap">
            <span style={`display:inline-block;width:10px;height:10px;background:${s.color};margin-right:4px`} />
            {s.name} ({s.total > 0 ? "+" : ""}{s.total.toFixed(1)})
          </span>
        ))}
      </p>
    </div>
  );
};

export const StatsPage: FC<{
  stats: PlayerStatsRow[];
  history: PointHistoryRow[];
  sanma?: boolean;
}> = ({ stats, history, sanma }) => {
  const returnPoint = sanma ? 40000 : 30000;
  return (
  <Layout title={sanma ? "総合成績(三人麻雀)" : undefined}>
    <h2>{sanma ? "総合成績（三人麻雀）" : "総合成績"}</h2>
    {stats.length === 0 ? (
      <p>まだ対局が記録されていません。</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>プレイヤー</th>
            <th>試合</th>
            <th>ポイント</th>
            <th>素点pt</th>
            <th>平均素点</th>
            <th>平均順位</th>
            <th>1着</th>
            <th>2着</th>
            <th>3着</th>
            {!sanma && <th>4着</th>}
            <th>和了率</th>
            <th>放銃率</th>
            <th>立直率</th>
            <th>黙聴率</th>
            <th>副露率</th>
            <th>平均和了点</th>
            <th>平均放銃点</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr>
              <td>{s.nickname}</td>
              <td>{s.game_count}</td>
              <PointCell point={s.total_point} />
              <PointCell point={Math.round(((s.raw_score_sum - returnPoint * s.game_count) / 1000) * 10) / 10} />
              <td>{Math.round(s.raw_score_sum / s.game_count).toLocaleString()}</td>
              <td>{s.avg_rank.toFixed(2)}</td>
              <td>{s.rank1}</td>
              <td>{s.rank2}</td>
              <td>{s.rank3}</td>
              {!sanma && <td>{s.rank4}</td>}
              <td>{pct(s.win_count, s.kyoku_count)}</td>
              <td>{pct(s.deal_in_count, s.kyoku_count)}</td>
              <td>{pct(s.riichi_count, s.kyoku_count)}</td>
              <td>{pct(s.dama_count, s.kyoku_count)}</td>
              <td>{pct(s.fuuro_count, s.kyoku_count)}</td>
              <td>{s.win_count > 0 ? Math.round(s.win_point_sum / s.win_count) : "-"}</td>
              <td>{s.deal_in_count > 0 ? Math.round(s.deal_in_point_sum / s.deal_in_count) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    {stats.length > 0 && (
      <>
        <h2>ポイント推移</h2>
        <PointChart history={history} />
      </>
    )}
    <p class="muted">
      {sanma ? (
        <>
          ポイントは三人麻雀ルール（ウマ30-0-▲30・オカは返し点から自動計算、同点は順位点を等分）。
          素点ptは順位点を除いた素点部分の累計（(素点−40,000)÷1,000の合計）。
        </>
      ) : (
        <>
          ポイントはMリーグ式（25,000点持ち30,000点返し・ウマ30-10・オカ20、同点は順位点を等分）。
          素点ptは順位点（ウマ・オカ）を除いた素点部分の累計（(素点−30,000)÷1,000の合計）。
        </>
      )}
      和了率などの分母は局数です。CPUはキャラ単位で対局をまたいで合算されます（同名キャラは同一個体として扱います）。
    </p>
  </Layout>
  );
};

export const GamesPage: FC<{ games: GameListRow[]; sanma?: boolean }> = ({ games, sanma }) => {
  const byUuid = new Map<string, GameListRow[]>();
  for (const g of games) {
    const list = byUuid.get(g.uuid) ?? [];
    list.push(g);
    byUuid.set(g.uuid, list);
  }
  // 列＝プレイヤー。合計ポイント降順で並べる
  const totals = new Map<number, { name: string; total: number }>();
  for (const g of games) {
    const t = totals.get(g.account_id) ?? { name: g.nickname, total: 0 };
    t.total += g.point;
    t.name = g.nickname;
    totals.set(g.account_id, t);
  }
  const cols = [...totals.entries()]
    .map(([accountId, t]) => ({ accountId, name: t.name, total: Math.round(t.total * 10) / 10 }))
    .sort((a, b) => b.total - a.total);
  const cls = (p: number) => (p > 0 ? "pos" : p < 0 ? "neg" : "");
  return (
    <Layout title={sanma ? "対局一覧(三人麻雀)" : "対局一覧"}>
      <h2>{sanma ? "対局一覧（三人麻雀）" : "対局一覧"}</h2>
      {byUuid.size === 0 ? (
        <p>まだ対局が記録されていません。</p>
      ) : (
        <div class="matrix-wrap">
          <table class="matrix">
            <thead>
              <tr>
                <th>日時</th>
                {cols.map((c) => (
                  <th>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...byUuid.entries()].map(([uuid, rows]) => {
                const byAccount = new Map(rows.map((r) => [r.account_id, r]));
                return (
                  <tr>
                    <td>
                      <a href={`/games/${uuid}`}>{fmtDateShort(rows[0].start_time)}</a>
                      <span class="muted">{" "}{MODE_NAMES[rows[0].mode] ?? rows[0].mode}</span>
                    </td>
                    {cols.map((c) => {
                      const r = byAccount.get(c.accountId);
                      if (!r) return <td class="muted">-</td>;
                      return (
                        <td class={`${cls(r.point)}${r.rank === 1 ? " win" : ""}`}>
                          <span class="muted">{r.rank}位</span> {fmtPoint(r.point)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>合計</td>
                {cols.map((c) => (
                  <td class={cls(c.total)}>{fmtPoint(c.total)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Layout>
  );
};

export const SetupPage: FC = () => {
  const script = `
var link = document.getElementById("install");
var input = document.getElementById("key");
function update() {
  link.href = "/uploader.user.js?key=" + encodeURIComponent(input.value || "YOUR_API_KEY");
}
input.addEventListener("input", update);
update();
`;
  return (
    <Layout title="記録のやり方">
      <h2>記録のやり方</h2>
      <p>
        ブラウザ版の雀魂で牌譜を開くと、ユーザースクリプトが対局データを自動でこのサーバーへ送信します。
        メンバーの誰か1人が以下のセットアップをすればOKです。
      </p>
      <h3>初回セットアップ（Chrome拡張）</h3>
      <ol>
        <li>
          <a class="bookmarklet" href="/majsoul-log-extension.zip">
            拡張機能をダウンロード
          </a>
          {" "}→ zipを展開する
        </li>
        <li>
          chrome://extensions を開き、右上の「デベロッパーモード」をON →
          「パッケージ化されていない拡張機能を読み込む」で展開したフォルダを選択
        </li>
        <li>
          ツールバーの拡張アイコンをクリックし、サーバーURL（このサイトのURL）と
          APIキー（管理者から教えてもらったもの）を入力して保存
        </li>
      </ol>
      <h3>毎回の操作</h3>
      <ol>
        <li>ブラウザ版の雀魂 (game.mahjongsoul.com) にログインする</li>
        <li>記録したい牌譜を開く（記録画面から / 共有URLを開く、どちらでもOK）</li>
        <li>画面上部に「記録しました」と緑の表示が出たら完了。このサイトに反映される</li>
      </ol>
      <p class="muted">
        対象は友人戦の4人麻雀のみで、それ以外を開いた場合はエラー表示になります。
        同じ牌譜を何度開いても二重記録はされません。
      </p>
      <h3>代替: Tampermonkey版</h3>
      <p>
        Tampermonkeyを使っている場合はユーザースクリプト版もあります。 APIキーを入力:{" "}
        <input id="key" type="password" placeholder="APIキー" />{" "}
        <a id="install" href="/uploader.user.js?key=YOUR_API_KEY">
          ユーザースクリプトをインストール
        </a>
      </p>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
};

export const GamePage: FC<{ rows: GameResultRow[]; error?: string }> = ({ rows, error }) => (
  <Layout title="対局詳細">
    <h2>対局詳細</h2>
    <p>
      {fmtDate(rows[0].start_time)} / {MODE_NAMES[rows[0].mode] ?? rows[0].mode}
      <br />
      <span class="muted">{rows[0].uuid}</span>
      {" "}
      <a href={`https://game.mahjongsoul.com/?paipu=${rows[0].uuid}`} target="_blank" rel="noreferrer">
        牌譜を開く
      </a>
    </p>
    <table>
      <thead>
        <tr>
          <th>順位</th>
          <th>プレイヤー</th>
          <th>素点</th>
          <th>ポイント</th>
          <th>和了</th>
          <th>ツモ</th>
          <th>放銃</th>
          <th>立直</th>
          <th>黙聴</th>
          <th>副露</th>
          <th>和了点計</th>
          <th>放銃点計</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr>
            <td>{r.rank}</td>
            <td>{r.nickname}</td>
            <td>{r.raw_score.toLocaleString()}</td>
            <PointCell point={r.point} />
            <td>{r.win_count}</td>
            <td>{r.tsumo_count}</td>
            <td>{r.deal_in_count}</td>
            <td>{r.riichi_count}</td>
            <td>{r.dama_count}</td>
            <td>{r.fuuro_count}</td>
            <td>{r.win_point_sum.toLocaleString()}</td>
            <td>{r.deal_in_point_sum.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <p class="muted">全{rows[0].kyoku_count}局</p>
    <details>
      <summary class="muted">この対局を削除する</summary>
      <form
        method="post"
        action={`/games/${rows[0].uuid}/delete`}
        onsubmit="return confirm('この対局を削除します。よろしいですか？')"
      >
        <input type="password" name="key" placeholder="APIキー" required />{" "}
        <button type="submit">削除</button>
        {error && <span style="color:#cf222e;margin-left:8px">{error}</span>}
      </form>
    </details>
  </Layout>
);
