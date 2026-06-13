import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteGame, fetchGame, fetchGames, fetchPlayerStats, fetchPointHistory, fetchSeasons, saveGame } from "./db";
import { PaipuError, parsePaipu, type PaipuInput } from "./parser";
import { userscriptSource } from "./userscript";
import { GamePage, GamesPage, SetupPage, StatsPage } from "./views";

type Env = {
  Bindings: {
    DB: D1Database;
    API_KEY: string;
  };
};

const YONMA = [1, 2];
const SANMA = [11, 12];

const jstYear = () => new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();

// ?season を解釈。未指定/不正なら最新シーズン、データが無ければ現在のJST年。
function resolveSeason(query: string | undefined, seasons: number[]): number {
  const q = query ? Number(query) : NaN;
  if (Number.isFinite(q) && seasons.includes(q)) return q;
  return seasons[0] ?? jstYear();
}

const app = new Hono<Env>();

app.use("/api/*", cors({ origin: "*", allowHeaders: ["content-type", "x-api-key"] }));

app.post("/api/games", async (c) => {
  if (c.req.header("x-api-key") !== c.env.API_KEY) {
    return c.json({ ok: false, error: "APIキーが不正です" }, 401);
  }
  let body: PaipuInput;
  try {
    body = await c.req.json<PaipuInput>();
  } catch {
    return c.json({ ok: false, error: "JSONが不正です" }, 400);
  }
  try {
    const game = parsePaipu(body);
    const saved = await saveGame(c.env.DB, game);
    return c.json({ ok: true, uuid: game.uuid, saved, message: saved ? "記録しました" : "記録済みの対局です" });
  } catch (e) {
    if (e instanceof PaipuError) {
      return c.json({ ok: false, error: e.message }, 422);
    }
    throw e;
  }
});

app.get("/", async (c) => {
  const seasons = await fetchSeasons(c.env.DB, YONMA);
  const season = resolveSeason(c.req.query("season"), seasons);
  const [stats, history] = await Promise.all([
    fetchPlayerStats(c.env.DB, YONMA, season),
    fetchPointHistory(c.env.DB, YONMA, season),
  ]);
  return c.html(
    <StatsPage stats={stats} history={history} seasons={seasons} season={season} basePath="/" />,
  );
});

app.get("/sanma", async (c) => {
  const seasons = await fetchSeasons(c.env.DB, SANMA);
  const season = resolveSeason(c.req.query("season"), seasons);
  const [stats, history] = await Promise.all([
    fetchPlayerStats(c.env.DB, SANMA, season),
    fetchPointHistory(c.env.DB, SANMA, season),
  ]);
  return c.html(
    <StatsPage stats={stats} history={history} seasons={seasons} season={season} basePath="/sanma" sanma />,
  );
});

app.get("/sanma/games", async (c) => {
  const seasons = await fetchSeasons(c.env.DB, SANMA);
  const season = resolveSeason(c.req.query("season"), seasons);
  const games = await fetchGames(c.env.DB, SANMA, season);
  return c.html(
    <GamesPage games={games} seasons={seasons} season={season} basePath="/sanma/games" sanma />,
  );
});

app.get("/setup", (c) => c.html(<SetupPage />));

app.get("/uploader.user.js", (c) => {
  const endpoint = new URL(c.req.url).origin + "/api/games";
  const key = c.req.query("key") || "YOUR_API_KEY";
  return c.text(userscriptSource(endpoint, key), 200, {
    "content-type": "text/javascript; charset=utf-8",
  });
});

app.get("/games", async (c) => {
  const seasons = await fetchSeasons(c.env.DB, YONMA);
  const season = resolveSeason(c.req.query("season"), seasons);
  const games = await fetchGames(c.env.DB, YONMA, season);
  return c.html(<GamesPage games={games} seasons={seasons} season={season} basePath="/games" />);
});

app.post("/games/:uuid/delete", async (c) => {
  const uuid = c.req.param("uuid");
  const body = await c.req.parseBody();
  if (body.key !== c.env.API_KEY) {
    const rows = await fetchGame(c.env.DB, uuid);
    if (rows.length === 0) return c.notFound();
    return c.html(<GamePage rows={rows} error="APIキーが不正です" />, 401);
  }
  await deleteGame(c.env.DB, uuid);
  return c.redirect("/games");
});

app.get("/games/:uuid", async (c) => {
  const rows = await fetchGame(c.env.DB, c.req.param("uuid"));
  if (rows.length === 0) return c.notFound();
  return c.html(<GamePage rows={rows} />);
});

export default app;
