import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "雀魂 友人戦成績アップローダー",
    description: "雀魂で牌譜を開くと、対局データを成績記録サーバーへ自動送信する",
    permissions: ["storage"],
  },
});
