import { expect, it } from "vitest";
import { GamesPage } from "../src/views";
import type { GameListRow } from "../src/db";
it("renders matrix rank", () => {
  const games: GameListRow[] = [
    { uuid:"u1", start_time:1781317432, mode:2, account_id:-200001, nickname:"一姫", rank:1, raw_score:39500, point:29.5 },
    { uuid:"u1", start_time:1781317432, mode:2, account_id:102, nickname:"きちくりす", rank:4, raw_score:8500, point:-31.5 },
  ];
  const html = (GamesPage as any)({ games }).toString();
  console.log(html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>")+8));
});
