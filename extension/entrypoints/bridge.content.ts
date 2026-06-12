// ISOLATED worldで動き、MAIN world (majsoul.content.ts) から渡された牌譜JSONを
// 拡張の設定 (chrome.storage) に従って成績記録サーバーへPOSTする。
export default defineContentScript({
  matches: ["https://game.mahjongsoul.com/*"],
  runAt: "document_start",
  main() {
    window.addEventListener("message", (ev) => {
      if (ev.source !== window || ev.origin !== location.origin) return;
      if (!ev.data || ev.data.type !== PAIPU_MESSAGE) return;
      void upload(ev.data.payload);
    });
  },
});

function toast(msg: string, isError: boolean): void {
  const el = document.createElement("div");
  el.textContent = `[成績記録] ${msg}`;
  el.style.cssText =
    "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    "padding:8px 16px;border-radius:6px;font-size:14px;color:#fff;pointer-events:none;" +
    `font-family:sans-serif;opacity:0.95;background:${isError ? "#c0392b" : "#27ae60"}`;
  (document.body || document.documentElement).appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

async function upload(payload: unknown): Promise<void> {
  const { endpoint, apiKey } = await browser.storage.sync.get(["endpoint", "apiKey"]);
  if (!endpoint || !apiKey) {
    toast("拡張機能のアイコンからサーバーURLとAPIキーを設定してください", true);
    return;
  }
  try {
    const res = await fetch(`${String(endpoint).replace(/\/+$/, "")}/api/games`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": String(apiKey) },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as { ok: boolean; message?: string; error?: string };
    if (body.ok) toast(body.message || "記録しました", false);
    else toast(body.error || `エラー (${res.status})`, true);
  } catch {
    toast("送信に失敗しました", true);
  }
}
