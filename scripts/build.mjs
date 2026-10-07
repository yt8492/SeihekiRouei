/** 同梱ライブラリを生成し、Manifest・構文を確認してChrome読み込み用のdistを作る。 */
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
// 構文確認・コピーより先に、パーサーとライセンス表記を再生成する。
import "./vendor.mjs";

const root = new URL("../", import.meta.url);
const source = new URL("extension/", root);
const destination = new URL("dist/", root);
const manifest = JSON.parse(await readFile(new URL("manifest.json", source), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Manifest V3 is required");
// 起動に必要なファイルの欠落は、Chromeで読み込む前に検出する。
for (const entry of [manifest.action.default_popup, manifest.background.service_worker, "offscreen.html", "parser-worker.js"]) {
  await readFile(new URL(entry, source));
}
/** 配下のJavaScriptを実行せずに、Nodeの構文チェックだけを行う。 */
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await check(path);
    else if (entry.name.endsWith(".js")) execFileSync(process.execPath, ["--check", path]);
  }
}
await check(source.pathname);
// 古い成果物が混ざらないよう、生成専用のdistを作り直してからコピーする。
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
console.log(`Chrome拡張を生成しました: ${destination.pathname}`);
