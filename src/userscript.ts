// Tampermonkey用ユーザースクリプト。
// 雀魂の新クライアント(Unity WebGL)はJS内部APIを公開しないため、
// ページ読み込み前に window.WebSocket をフックし、牌譜閲覧時にクライアント自身が
// 受信する fetchGameRecord レスポンスを複製してサーバーへ送る。
// protobufのデコードには雀魂が配信する liqi.json と protobufjs を使う。
const TEMPLATE = `// ==UserScript==
// @name         雀魂 友人戦成績アップローダー
// @namespace    majsoul-log-bot
// @version      2.0.0
// @description  雀魂で牌譜を開くと、対局データを成績記録サーバーへ自動送信する
// @match        https://game.mahjongsoul.com/*
// @require      https://cdn.jsdelivr.net/npm/protobufjs@7.4.0/dist/protobuf.min.js
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  var ENDPOINT = "__ENDPOINT__";
  var API_KEY = "__API_KEY__";
  var FETCH_RECORD = ".lq.Lobby.fetchGameRecord";
  var PB_OPTS = { defaults: true, longs: Number, enums: Number, bytes: Array };

  var sent = {};
  var rootPromise = null;

  function toast(msg, isError) {
    try {
      var el = document.createElement("div");
      el.textContent = "[成績記録] " + msg;
      el.style.cssText =
        "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
        "padding:8px 16px;border-radius:6px;font-size:14px;color:#fff;pointer-events:none;" +
        "font-family:sans-serif;opacity:0.95;background:" + (isError ? "#c0392b" : "#27ae60");
      (document.body || document.documentElement).appendChild(el);
      setTimeout(function () { el.remove(); }, 6000);
    } catch (e) {}
  }

  // 雀魂が配信する liqi.json から protobuf 定義をロード（バージョンごとにprefixをキャッシュ）
  function loadRoot() {
    if (!rootPromise) {
      rootPromise = (async function () {
        var origin = location.origin;
        var ver = (await (await fetch(origin + "/version.json")).json()).version;
        var cacheKey = "mlb_liqi_prefix_" + ver;
        var prefix = localStorage.getItem(cacheKey);
        if (!prefix) {
          var resver = await (await fetch(origin + "/resversion" + ver + ".json")).json();
          prefix = resver.res["res/proto/liqi.json"].prefix;
          localStorage.setItem(cacheKey, prefix);
        }
        var liqi = await (await fetch(origin + "/" + prefix + "/res/proto/liqi.json")).json();
        return protobuf.Root.fromJSON(liqi);
      })();
      rootPromise.catch(function () { rootPromise = null; });
    }
    return rootPromise;
  }

  function fetchBinary(url) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: "GET",
        url: url,
        responseType: "arraybuffer",
        onload: function (r) { resolve(new Uint8Array(r.response)); },
        onerror: reject,
      });
    });
  }

  function post(payload, uuid) {
    GM_xmlhttpRequest({
      method: "POST",
      url: ENDPOINT,
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      data: JSON.stringify(payload),
      onload: function (res) {
        try {
          var body = JSON.parse(res.responseText);
          if (body.ok) {
            toast(body.message || "記録しました", false);
            sent[uuid] = true;
          } else {
            toast(body.error || "エラー (" + res.status + ")", true);
          }
        } catch (e) {
          toast("サーバーエラー (" + res.status + ")", true);
        }
      },
      onerror: function () { toast("送信に失敗しました", true); },
    });
  }

  // fetchGameRecord のレスポンス（Wrapper部分）を解析して送信
  async function handleRecordResponse(wrapperBytes) {
    try {
      var root = await loadRoot();
      var Wrapper = root.lookupType(".lq.Wrapper");
      var Res = root.lookupType(".lq.ResGameRecord");
      var res = Res.decode(Wrapper.decode(wrapperBytes).data);
      if (res.error && res.error.code) return;
      var uuid = res.head && res.head.uuid;
      if (!uuid || sent[uuid]) return;

      var data = res.data;
      if ((!data || !data.length) && res.data_url) {
        data = await fetchBinary(res.data_url);
      }
      if (!data || !data.length) return;

      var dw = Wrapper.decode(data);
      var DetailType = root.lookupType(dw.name);
      var detail = DetailType.decode(dw.data);
      var raw = detail.actions && detail.actions.length
        ? detail.actions.map(function (a) { return a.result; }).filter(function (r) { return r && r.length; })
        : (detail.records || []);
      var records = raw.map(function (b) {
        var w = Wrapper.decode(b);
        var T = root.lookupType(w.name);
        return { name: w.name, data: T.toObject(T.decode(w.data), PB_OPTS) };
      });
      var HeadType = root.lookupType(".lq.RecordGame");
      post({ head: HeadType.toObject(res.head, PB_OPTS), records: records }, uuid);
    } catch (e) {
      console.error("[成績記録] 牌譜の解析に失敗:", e);
      toast("牌譜の解析に失敗しました（コンソール参照）", true);
    }
  }

  function toU8(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }

  // Wrapperの先頭フィールド(name)だけを手動でデコードする
  function readWrapperName(u8) {
    if (u8[0] !== 0x0a) return null;
    var len = 0, shift = 0, i = 1;
    while (i < u8.length) {
      var b = u8[i++];
      len |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    return new TextDecoder().decode(u8.subarray(i, i + len));
  }

  // フレーム形式: [type(1=notify,2=req,3=res), index_lo, index_hi, Wrapper...]
  function hookSocket(ws) {
    var reqNames = {};
    var origSend = ws.send;
    ws.send = function (data) {
      try {
        var u8 = toU8(data);
        if (u8 && u8.length > 3 && u8[0] === 2) {
          var name = readWrapperName(u8.subarray(3));
          if (name) reqNames[u8[1] | (u8[2] << 8)] = name;
        }
      } catch (e) {}
      return origSend.apply(this, arguments);
    };
    ws.addEventListener("message", function (ev) {
      function onFrame(u8) {
        if (!u8 || u8.length < 4 || u8[0] !== 3) return;
        var idx = u8[1] | (u8[2] << 8);
        var name = reqNames[idx];
        delete reqNames[idx];
        if (name === FETCH_RECORD) handleRecordResponse(u8.subarray(3));
      }
      try {
        var d = ev.data;
        if (d instanceof ArrayBuffer) onFrame(new Uint8Array(d));
        else if (typeof Blob !== "undefined" && d instanceof Blob) {
          d.arrayBuffer().then(function (b) { onFrame(new Uint8Array(b)); });
        }
      } catch (e) {}
    });
  }

  var RealWS = unsafeWindow.WebSocket;
  function HookedWS(url, protocols) {
    var ws = protocols !== undefined ? new RealWS(url, protocols) : new RealWS(url);
    try { hookSocket(ws); } catch (e) {}
    return ws;
  }
  HookedWS.prototype = RealWS.prototype;
  ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function (k) { HookedWS[k] = RealWS[k]; });
  unsafeWindow.WebSocket = HookedWS;
  console.log("[成績記録] WebSocketフックを設定しました");
})();
`;

export function userscriptSource(endpoint: string, apiKey: string): string {
  return TEMPLATE.replace("__ENDPOINT__", endpoint).replace("__API_KEY__", apiKey);
}
