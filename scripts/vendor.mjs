/** DOMを使わないHTMLパーサーと依存ライブラリのライセンスを、拡張内のローカルファイルにまとめる。 */
import { build } from "esbuild";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
// Chromeで直接importできるES Moduleを作り、実行時にCDNやNode.jsを必要としないようにする。
const result = await build({
  absWorkingDir: root,
  entryPoints: ["scripts/html-parser-entry.js"],
  outfile: "extension/lib/vendor/html-parser.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome116",
  minify: true,
  legalComments: "eof",
  metafile: true,
  banner: { js: "// npm run vendorで自動生成。直接編集せずscripts/html-parser-entry.jsを変更する。\n// 同梱ライブラリのライセンス: extension/third-party-licenses.txt" },
});

// 実際に同梱されたパッケージを生成結果から特定し、不要な開発依存は表記に混ぜない。
const packages = new Set(Object.keys(result.metafile.inputs).flatMap((path) => {
  const name = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/u)?.[1];
  return name ? [name] : [];
}));
const licenses = [];
for (const name of [...packages].sort()) {
  const directory = join(root, "node_modules", name);
  const info = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const licenseFile = (await readdir(directory)).find((file) => /^licen[cs]e(?:\..*)?$/iu.test(file));
  // ライセンスを欠落させた配布物を生成しないよう、不明な場合はビルドを失敗させる。
  if (!licenseFile) throw new Error(`License file missing: ${name}`);
  // 原文の文言を保ち、配布ファイルの行末にある空白だけを除去する。
  const license = (await readFile(join(directory, licenseFile), "utf8")).replace(/[\t ]+$/gmu, "");
  licenses.push(`${name}@${info.version}\n${license}`);
}
await writeFile(join(root, "extension/third-party-licenses.txt"), licenses.join("\n\n---\n\n"));
console.log("HTMLパーサーを拡張内に同梱しました。");
