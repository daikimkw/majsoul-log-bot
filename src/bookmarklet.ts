// 雀魂のページ上で実行するブックマークレットのソース。
// __ENDPOINT__ はサーバー側で、__API_KEY__ は配布ページ上で置換される。
const TEMPLATE = `(async function () {
  function fail(msg) { alert("[成績記録] " + msg); }
  try {
    if (typeof app === "undefined" || !app.NetAgent || typeof net === "undefined" || !net.ProtobufManager) {
      return fail("ログイン済みの雀魂 (game.mahjongsoul.com) のページで実行してください");
    }
    var m = location.href.match(/paipu=([^&_]+)/);
    var uuid = m && m[1];
    if (!uuid) {
      var inp = prompt("牌譜のURL（またはUUID）を貼り付けてください");
      if (!inp) return;
      m = inp.match(/paipu=([^&_]+)/) || inp.match(/([0-9]{6}-[0-9a-f]{8}-[0-9a-f-]+)/);
      if (!m) return fail("牌譜UUIDが読み取れませんでした");
      uuid = m[1];
    }
    var ver = "";
    try { ver = GameMgr.Inst.clientVersionString || ""; } catch (e) {}
    try {
      if (!ver && GameMgr.client_version && GameMgr.client_version.version) {
        ver = "web-" + GameMgr.client_version.version.replace(/\\.w$/, "");
      }
    } catch (e) {}
    var res = await new Promise(function (ok, ng) {
      app.NetAgent.sendReq2Lobby("Lobby", "fetchGameRecord", { game_uuid: uuid, client_version_string: ver }, function (err, r) {
        if (err || !r) ng(new Error("fetchGameRecord に失敗しました")); else ok(r);
      });
    });
    if (res.error && res.error.code) return fail("牌譜の取得に失敗しました (code=" + res.error.code + ")");
    var bytes = res.data;
    if ((!bytes || !bytes.length) && res.data_url) {
      bytes = new Uint8Array(await (await fetch(res.data_url)).arrayBuffer());
    }
    if (!bytes || !bytes.length) return fail("牌譜データが空でした");
    var W = net.ProtobufManager.lookupType(".lq.Wrapper");
    function plain(msg) {
      return msg.$type.toObject(msg, { defaults: true, longs: Number, enums: Number, bytes: Array });
    }
    var dw = W.decode(bytes);
    var detail = net.ProtobufManager.lookupType(dw.name).decode(dw.data);
    var raw = detail.actions && detail.actions.length
      ? detail.actions.map(function (a) { return a.result; }).filter(function (r) { return r && r.length; })
      : (detail.records || []);
    var records = raw.map(function (b) {
      var w = W.decode(b);
      return { name: w.name, data: plain(net.ProtobufManager.lookupType(w.name).decode(w.data)) };
    });
    var resp = await fetch("__ENDPOINT__", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "__API_KEY__" },
      body: JSON.stringify({ head: plain(res.head), records: records }),
    });
    var body = await resp.json();
    alert("[成績記録] " + (body.ok ? (body.message || "記録しました") : "エラー: " + body.error));
  } catch (e) {
    fail("エラー: " + e);
  }
})();`;

export function bookmarkletTemplate(endpoint: string): string {
  return TEMPLATE.replace("__ENDPOINT__", endpoint);
}
