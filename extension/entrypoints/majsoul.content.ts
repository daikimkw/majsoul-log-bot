// ページのMAIN worldで動き、雀魂(Unity WebGL)が使うwindow.WebSocketをフックして
// fetchGameRecordレスポンスを傍受する。デコード結果はpostMessageでISOLATED側
// (bridge.content.ts)へ渡し、サーバー送信はそちらが担う。
import protobuf from "protobufjs/light";

const FETCH_RECORD = ".lq.Lobby.fetchGameRecord";
const PB_OPTS = { defaults: true, longs: Number, enums: Number, bytes: Array } as const;

export default defineContentScript({
  matches: ["https://game.mahjongsoul.com/*"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    installWebSocketHook();
    console.log("[成績記録] WebSocketフックを設定しました");
  },
});

let rootPromise: Promise<protobuf.Root> | null = null;

// 雀魂が配信するliqi.jsonからprotobuf定義をロード（バージョンごとにprefixをキャッシュ）
function loadRoot(): Promise<protobuf.Root> {
  if (!rootPromise) {
    rootPromise = (async () => {
      const origin = location.origin;
      const ver = (await (await fetch(`${origin}/version.json`)).json()).version as string;
      const cacheKey = `mlb_liqi_prefix_${ver}`;
      let prefix = localStorage.getItem(cacheKey);
      if (!prefix) {
        const resver = await (await fetch(`${origin}/resversion${ver}.json`)).json();
        prefix = resver.res["res/proto/liqi.json"].prefix as string;
        localStorage.setItem(cacheKey, prefix);
      }
      const liqi = await (await fetch(`${origin}/${prefix}/res/proto/liqi.json`)).json();
      return protobuf.Root.fromJSON(liqi);
    })();
    rootPromise.catch(() => {
      rootPromise = null;
    });
  }
  return rootPromise;
}

const sent = new Set<string>();

async function handleRecordResponse(wrapperBytes: Uint8Array): Promise<void> {
  try {
    const root = await loadRoot();
    const Wrapper = root.lookupType(".lq.Wrapper");
    const Res = root.lookupType(".lq.ResGameRecord");
    const res = Res.decode((Wrapper.decode(wrapperBytes) as any).data) as any;
    if (res.error && res.error.code) return;
    const uuid: string | undefined = res.head?.uuid;
    if (!uuid || sent.has(uuid)) return;

    let data: Uint8Array | undefined = res.data;
    if ((!data || !data.length) && res.data_url) {
      data = new Uint8Array(await (await fetch(res.data_url)).arrayBuffer());
    }
    if (!data || !data.length) return;

    const dw = Wrapper.decode(data) as any;
    const DetailType = root.lookupType(dw.name);
    const detail = DetailType.decode(dw.data) as any;
    const raw: Uint8Array[] =
      detail.actions && detail.actions.length
        ? detail.actions.map((a: any) => a.result).filter((r: Uint8Array) => r && r.length)
        : detail.records || [];
    const records = raw.map((b) => {
      const w = Wrapper.decode(b) as any;
      const T = root.lookupType(w.name);
      return { name: w.name as string, data: T.toObject(T.decode(w.data), PB_OPTS) };
    });
    const HeadType = root.lookupType(".lq.RecordGame");
    sent.add(uuid);
    window.postMessage(
      {
        type: PAIPU_MESSAGE,
        uuid,
        payload: { head: HeadType.toObject(res.head, PB_OPTS), records },
      },
      location.origin,
    );
  } catch (e) {
    console.error("[成績記録] 牌譜の解析に失敗:", e);
  }
}

function toU8(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

// Wrapperの先頭フィールド(name)だけを手動でデコードする
function readWrapperName(u8: Uint8Array): string | null {
  if (u8[0] !== 0x0a) return null;
  let len = 0;
  let shift = 0;
  let i = 1;
  while (i < u8.length) {
    const b = u8[i++];
    len |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return new TextDecoder().decode(u8.subarray(i, i + len));
}

// フレーム形式: [type(1=notify,2=req,3=res), index_lo, index_hi, Wrapper...]
// レスポンスのWrapper.nameは空なので、リクエストのindex→メソッド名の対応で判別する
function hookSocket(ws: WebSocket): void {
  const reqNames = new Map<number, string>();
  const origSend = ws.send;
  ws.send = function (data: Parameters<WebSocket["send"]>[0]) {
    try {
      const u8 = toU8(data);
      if (u8 && u8.length > 3 && u8[0] === 2) {
        const name = readWrapperName(u8.subarray(3));
        if (name) reqNames.set(u8[1] | (u8[2] << 8), name);
      }
    } catch {}
    return origSend.call(this, data);
  };
  ws.addEventListener("message", (ev) => {
    const onFrame = (u8: Uint8Array) => {
      if (u8.length < 4 || u8[0] !== 3) return;
      const idx = u8[1] | (u8[2] << 8);
      const name = reqNames.get(idx);
      reqNames.delete(idx);
      if (name === FETCH_RECORD) void handleRecordResponse(u8.subarray(3));
    };
    try {
      const d = ev.data;
      if (d instanceof ArrayBuffer) onFrame(new Uint8Array(d));
      else if (d instanceof Blob) void d.arrayBuffer().then((b) => onFrame(new Uint8Array(b)));
    } catch {}
  });
}

function installWebSocketHook(): void {
  const RealWS = window.WebSocket;
  const HookedWS = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const ws = protocols !== undefined ? new RealWS(url, protocols) : new RealWS(url);
    try {
      hookSocket(ws);
    } catch {}
    return ws;
  } as unknown as typeof WebSocket;
  HookedWS.prototype = RealWS.prototype;
  for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"] as const) {
    Object.defineProperty(HookedWS, k, { value: RealWS[k] });
  }
  window.WebSocket = HookedWS;
}
