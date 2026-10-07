/** ローカルHTTPSサーバーと実際の拡張を使うE2E設定。失敗時だけ調査用トレースを残す。 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  // ブラウザとサーバーを複数同時に立ち上げず、各ケースを順番に検証する。
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
