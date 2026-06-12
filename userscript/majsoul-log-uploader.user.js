// ==UserScript==
// @name         雀魂 友人戦成績アップローダー
// @namespace    majsoul-log-bot
// @version      1.0.0
// @description  雀魂で牌譜を開いたとき、牌譜データを成績記録サーバーへ自動送信する
// @match        https://game.mahjongsoul.com/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  // ===== 設定（自分の環境に合わせて書き換える） =====
  const ENDPOINT = "https://majsoul-log-bot.YOUR_SUBDOMAIN.workers.dev/api/games";
  const API_KEY = "YOUR_API_KEY";
  // ================================================

  const sent = new Set();

  function toast(msg, isError) {
    const el = document.createElement("div");
    el.textContent = `[成績記録] ${msg}`;
    el.style.cssText =
      "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;" +
      "padding:8px 16px;border-radius:6px;font-size:14px;color:#fff;" +
      `background:${isError ? "#c0392b" : "#27ae60"};opacity:0.95;pointer-events:none;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  function post(payload, uuid) {
    GM_xmlhttpRequest({
      method: "POST",
      url: ENDPOINT,
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      data: JSON.stringify(payload),
      onload: (res) => {
        try {
          const body = JSON.parse(res.responseText);
          if (body.ok) {
            toast(body.message || "記録しました", false);
          } else {
            toast(body.error || `エラー (${res.status})`, true);
          }
        } catch {
          toast(`サーバーエラー (${res.status})`, true);
        }
      },
      onerror: () => toast("送信に失敗しました", true),
    });
    sent.add(uuid);
  }

  // protobufメッセージをデフォルト値込みのプレーンJSONへ変換する
  function toPlain(msg) {
    if (!msg || !msg.$type) return msg;
    return msg.$type.toObject(msg, {
      defaults: true,
      longs: Number,
      enums: Number,
      bytes: Array,
    });
  }

  async function handleRecord(res) {
    try {
      const head = res.head;
      const uuid = head && head.uuid;
      if (!uuid || sent.has(uuid)) return;

      // 牌譜本体: res.data（古い牌譜は data_url からダウンロード）
      let bytes = res.data;
      if ((!bytes || !bytes.length) && res.data_url) {
        const buf = await fetch(res.data_url).then((r) => r.arrayBuffer());
        bytes = new Uint8Array(buf);
      }
      if (!bytes || !bytes.length) return;

      // Wrapper {name, data} → GameDetailRecords
      const wrapperType = net.ProtobufManager.lookupType(".lq.Wrapper");
      const detailWrapper = wrapperType.decode(bytes);
      const detailType = net.ProtobufManager.lookupType(detailWrapper.name);
      const detail = detailType.decode(detailWrapper.data);

      // version >= 210715 は actions[].result、それ以前は records[]
      const rawList =
        detail.actions && detail.actions.length
          ? detail.actions.map((a) => a.result).filter((r) => r && r.length)
          : detail.records || [];

      const records = rawList.map((b) => {
        const w = wrapperType.decode(b);
        const t = net.ProtobufManager.lookupType(w.name);
        return { name: w.name, data: toPlain(t.decode(w.data)) };
      });

      post({ head: toPlain(head), records }, uuid);
    } catch (e) {
      console.error("[成績記録] 牌譜の解析に失敗:", e);
      toast("牌譜の解析に失敗しました（コンソール参照）", true);
    }
  }

  // app.NetAgent.sendReq2Lobby をフックして fetchGameRecord の応答を捕まえる
  function installHook() {
    if (
      typeof app === "undefined" ||
      !app.NetAgent ||
      typeof net === "undefined" ||
      !net.ProtobufManager
    ) {
      setTimeout(installHook, 1000);
      return;
    }
    const original = app.NetAgent.sendReq2Lobby;
    app.NetAgent.sendReq2Lobby = function (service, method, data, callback) {
      if (method === "fetchGameRecord") {
        const wrapped = function (err, res) {
          if (!err && res) handleRecord(res);
          if (callback) callback.apply(this, arguments);
        };
        return original.call(this, service, method, data, wrapped);
      }
      return original.apply(this, arguments);
    };
    console.log("[成績記録] フックを設定しました");
  }

  installHook();
})();
