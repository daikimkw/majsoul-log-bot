import type { FC, PropsWithChildren } from "hono/jsx";
import type { GameListRow, GameResultRow, PlayerStatsRow } from "./db";

const MODE_NAMES: Record<number, string> = { 1: "四人東", 2: "四人南" };

const fmtDate = (unix: number) =>
  new Date(unix * 1000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

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
        <a href="/bookmarklet">記録のやり方</a>
      </nav>
      {children}
    </body>
  </html>
);

const PointCell: FC<{ point: number }> = ({ point }) => (
  <td class={point > 0 ? "pos" : point < 0 ? "neg" : ""}>{fmtPoint(point)}</td>
);

export const StatsPage: FC<{ stats: PlayerStatsRow[] }> = ({ stats }) => (
  <Layout>
    <h2>総合成績</h2>
    {stats.length === 0 ? (
      <p>まだ対局が記録されていません。</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>プレイヤー</th>
            <th>試合</th>
            <th>ポイント</th>
            <th>平均順位</th>
            <th>1着</th>
            <th>2着</th>
            <th>3着</th>
            <th>4着</th>
            <th>和了率</th>
            <th>放銃率</th>
            <th>立直率</th>
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
              <td>{s.avg_rank.toFixed(2)}</td>
              <td>{s.rank1}</td>
              <td>{s.rank2}</td>
              <td>{s.rank3}</td>
              <td>{s.rank4}</td>
              <td>{pct(s.win_count, s.kyoku_count)}</td>
              <td>{pct(s.deal_in_count, s.kyoku_count)}</td>
              <td>{pct(s.riichi_count, s.kyoku_count)}</td>
              <td>{pct(s.fuuro_count, s.kyoku_count)}</td>
              <td>{s.win_count > 0 ? Math.round(s.win_point_sum / s.win_count) : "-"}</td>
              <td>{s.deal_in_count > 0 ? Math.round(s.deal_in_point_sum / s.deal_in_count) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    <p class="muted">
      ポイントはMリーグ式（25,000点持ち30,000点返し・ウマ30-10・オカ20、同点は順位点を等分）。
      和了率などの分母は局数です。
    </p>
  </Layout>
);

export const GamesPage: FC<{ games: GameListRow[] }> = ({ games }) => {
  const byUuid = new Map<string, GameListRow[]>();
  for (const g of games) {
    const list = byUuid.get(g.uuid) ?? [];
    list.push(g);
    byUuid.set(g.uuid, list);
  }
  return (
    <Layout title="対局一覧">
      <h2>対局一覧</h2>
      {byUuid.size === 0 ? (
        <p>まだ対局が記録されていません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>日時</th>
              <th>ルール</th>
              <th>結果（順位順）</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...byUuid.entries()].map(([uuid, rows]) => (
              <tr>
                <td>{fmtDate(rows[0].start_time)}</td>
                <td>{MODE_NAMES[rows[0].mode] ?? rows[0].mode}</td>
                <td style="text-align:left">
                  {rows
                    .map((r) => `${r.nickname} ${r.raw_score.toLocaleString()} (${fmtPoint(r.point)})`)
                    .join(" / ")}
                </td>
                <td>
                  <a href={`/games/${uuid}`}>詳細</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
};

export const BookmarkletPage: FC<{ template: string }> = ({ template }) => {
  const script = `
var TEMPLATE = ${JSON.stringify(template)};
var link = document.getElementById("bm");
var input = document.getElementById("key");
function update() {
  link.href = "javascript:" + encodeURIComponent(TEMPLATE.replace("__API_KEY__", input.value || "YOUR_API_KEY"));
}
input.addEventListener("input", update);
update();
`;
  return (
    <Layout title="記録のやり方">
      <h2>記録のやり方</h2>
      <p>
        対局後、牌譜を「記録用ブックマークレット」で送信すると成績に反映されます。
        メンバーの誰か1人が以下のセットアップをすればOKです。
      </p>
      <h3>初回セットアップ</h3>
      <ol>
        <li>
          APIキーを入力:{" "}
          <input id="key" type="password" placeholder="管理者から教えてもらったAPIキー" />
        </li>
        <li>
          このリンクをブックマークバーへドラッグ:{" "}
          <a id="bm" class="bookmarklet" href="#">
            雀魂成績を記録
          </a>
        </li>
      </ol>
      <h3>毎回の操作</h3>
      <ol>
        <li>ブラウザ版の雀魂 (game.mahjongsoul.com) にログインする</li>
        <li>記録したい牌譜を開く（共有された牌譜URLを開くでもOK）</li>
        <li>ブックマークバーの「雀魂成績を記録」をクリック</li>
        <li>「記録しました」と表示されたら完了。このサイトに反映される</li>
      </ol>
      <p class="muted">
        牌譜を開いていない画面でクリックした場合は、牌譜URLの入力を求められます。
        対象は友人戦の4人麻雀（2026/06/13以降）のみで、それ以外はエラーになります。
      </p>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
};

export const GamePage: FC<{ rows: GameResultRow[] }> = ({ rows }) => (
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
            <td>{r.fuuro_count}</td>
            <td>{r.win_point_sum.toLocaleString()}</td>
            <td>{r.deal_in_point_sum.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <p class="muted">全{rows[0].kyoku_count}局</p>
  </Layout>
);
