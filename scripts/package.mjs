/** ビルド済みの拡張だけを、解凍後そのまま読み込めるextensionフォルダとしてZIPにまとめる。 */
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import "./build.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "dist", "manifest.json"), "utf8"));
const project = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (manifest.version !== project.version) throw new Error("Manifestとpackage.jsonのバージョンが一致していません。");
const output = join(root, "release");
const archive = join(output, `SeihekiRouei-${manifest.version}.zip`);
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(tmpdir(), "SeihekiRouei-package-"));
try {
  // リポジトリ全体を圧縮せず、検証済みの拡張本体とライセンスだけを含める。
  await cp(join(root, "dist"), join(staging, "extension"), { recursive: true });
  // 既存ZIPを更新すると削除済みファイルが残るため、必ず新規作成する。
  await rm(archive, { force: true });
  execFileSync("zip", ["-r", "-X", archive, "extension"], { cwd: staging, stdio: "pipe" });
} finally {
  await rm(staging, { recursive: true, force: true });
}
console.log(`Release用ZIPを生成しました: ${archive}`);
