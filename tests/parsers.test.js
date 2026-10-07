/** 保存したHTMLを使い、ブラウザDOMなしでの作品抽出・ページ送り・タグ抽出と誤判定防止を検証する。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHistory, parseTags, workFromUrl } from "../extension/lib/parsers.js";
import { historyUrl } from "../extension/lib/model.js";
import { fixture, workHtml, withPageDecorations } from "./helpers.js";

test("購入履歴の作品・相対URL・次ページ・最終ページを読む", async () => {
  const result = parseHistory(await fixture("history-1.html"), 1);
  assert.deepEqual(result.works.map((work) => work.id), ["RJ000001", "RJ000002"]);
  assert.equal(result.works[1].url, "https://www.dlsite.com/maniax/work/=/product_id/RJ000002.html?locale=ja_JP");
  assert.equal(result.nextPage, 2);
  assert.equal(result.totalPages, 3);
});

test("最終ページへのリンクだけでも中間のページを飛ばさない", async () => {
  const result = parseHistory(await fixture("history-2.html"), 2);
  assert.equal(result.nextPage, 3);
  assert.equal(result.works[2].url, null);
  assert.equal(result.works[2].id, "RJ000004");
});

test("作品IDのない販売終了作品でもページが繰り返されたことを判別できる", () => {
  const html = '<table class="work_list_main"><tr><td class="work_name">販売終了作品A</td><td class="buy_date">2026/10/01</td></tr></table>';
  assert.equal(parseHistory(html, 1).works[0].id, parseHistory(html, 2).works[0].id);
});

test("最終ページの無効な次へをたどらない", async () => {
  assert.equal(parseHistory(await fixture("history-3.html"), 3).nextPage, null);
});

test("data-valueのみのページ切替にも対応する", async () => {
  const html = (await fixture("history-1.html")).replace(/ href="[^"]*mypage[^"]*"/gu, "");
  assert.equal(parseHistory(html, 1).nextPage, 2);
});

test("作品のない購入履歴を扱う", async () => {
  assert.deepEqual(parseHistory(await fixture("empty-history.html"), 1).works, []);
  assert.equal(parseHistory('<table class="work_list_main"><tr><th>作品名</th></tr></table>', 1).nextPage, null);
  const messageRow = '<table class="work_list_main"><tr><td colspan="2">購入履歴はありません。</td></tr></table>';
  assert.deepEqual(parseHistory(messageRow, 1).works, []);
});

test("空履歴の案内と同じ文言を含む作品名でも購入作品を保持する", async () => {
  // 案内文と作品名は文章だけでは区別できないため、購入行の構造を優先する回帰テスト。
  const html = (await fixture("history-1.html")).replace("作品1", "購入作品はありません ～テスト作品～");
  const result = parseHistory(html, 1);
  assert.deepEqual(result.works.map(({ id }) => id), ["RJ000001", "RJ000002"]);
  assert.equal(result.nextPage, 2);
  const delisted = '<table class="work_list_main"><tr data-product-id="RJ000004"><td class="work_name">購入商品はございません</td><td class="buy_date">2026/10/01</td></tr></table>';
  assert.deepEqual(parseHistory(delisted, 1).works, [{ id: "RJ000004", url: null }]);
});

test("空履歴の文言を含む不正な購入行も形式エラーにする", () => {
  const missingDate = '<table class="work_list_main"><tr><td class="work_name">購入作品はありません</td></tr></table>';
  assert.throws(() => parseHistory(missingDate, 1), { code: "HISTORY_FORMAT" });
  const changedFields = '<table class="work_list_main"><tr><td class="changed_name">購入作品はありません</td><td class="changed_date">2026/10/01</td></tr></table>';
  assert.throws(() => parseHistory(changedFields, 1), { code: "HISTORY_FORMAT" });
  const changedTable = '<div id="buy_history_this"><table class="changed_table"><tr><td class="work_name">購入作品はありません</td><td class="buy_date">2026/10/01</td></tr></table></div>';
  assert.throws(() => parseHistory(changedTable, 1), { code: "HISTORY_FORMAT" });
});

test("ログイン画面や未知のHTMLを購入作品ゼロとして扱わない", () => {
  assert.throws(() => parseHistory("<html>登録してください</html>", 1, "https://login.dlsite.com/register"), { code: "LOGIN_REQUIRED" });
  assert.throws(() => parseHistory('<form><input type="password"></form>', 1), { code: "LOGIN_REQUIRED" });
  assert.throws(() => parseHistory("<html>アクセスを確認中</html>", 1), { code: "HISTORY_FORMAT" });
  assert.throws(() => parseHistory('<table class="work_list_main"><tr><td class="unknown">作品</td></tr></table>', 1), { code: "HISTORY_FORMAT" });
});

test("購入日が失われた作品行は形式エラーになる", async () => {
  const html = (await fixture("history-1.html")).replaceAll('class="buy_date"', 'class="new_date"');
  assert.throws(() => parseHistory(html, 1), { code: "HISTORY_FORMAT" });
});

test("tdで構成された既知の見出し行を作品として数えない", async () => {
  const html = (await fixture("history-1.html")).replace('<tr class="item_name"><th>作品名</th><th>購入日</th></tr>', '<tr class="item_name"><td class="work_name">作品名</td><td class="buy_date">購入日</td></tr>');
  assert.equal(parseHistory(html, 1).works.length, 2);
});

test("一部の行だけ形式が変わった場合も作品を黙って欠落させない", async () => {
  const html = (await fixture("history-1.html")).replace('class="work_name"', 'class="changed_name"');
  assert.throws(() => parseHistory(html, 1), { code: "HISTORY_FORMAT" });
});

test("タグだけを抽出し、重複・声優・おすすめ・容量を除外する", async () => {
  assert.deepEqual(parseTags(await fixture("work.html"), "https://www.dlsite.com/home/work/=/product_id/RJ000001.html"), ["ASMR", "日常/生活"]);
});

test("インラインCSS・スクリプト・画像を含むHTMLをDOMなしで読み取る", async () => {
  const history = parseHistory(withPageDecorations(await fixture("history-1.html")), 1);
  assert.deepEqual(history.works.map(({ id }) => id), ["RJ000001", "RJ000002"]);
  assert.equal(history.nextPage, 2);
  assert.deepEqual(parseTags(withPageDecorations(await fixture("work.html")), history.works[0].url), ["ASMR", "日常/生活"]);
  assert.equal(globalThis.parsedScriptRan, undefined);
});

test("HTMLエンティティを含むタグ名とURLを復元する", () => {
  const url = "https://www.dlsite.com/home/work/=/product_id/RJ000001.html";
  assert.deepEqual(parseTags(workHtml(["A & B", "タグ<特別>", "癒し"]), url), ["A & B", "タグ<特別>", "癒し"]);
  const html = '<table class="work_list_main"><tr><td class="work_name"><a href="&#47;home/work/=/product_id/RJ000001.html">作品</a></td><td class="buy_date">2026/10/01</td></tr></table>';
  assert.equal(parseHistory(html, 1).works[0].id, "RJ000001");
});

test("有効な作品のタグなしと、未知のページ・販売終了を区別する", () => {
  const url = "https://www.dlsite.com/home/work/=/product_id/RJ000001.html";
  assert.deepEqual(parseTags(workHtml([]), url), []);
  assert.throws(() => parseTags("<title>確認中</title>", url), { code: "WORK_FORMAT" });
  assert.throws(() => parseTags("<title>作品が見つかりません</title>", url), { code: "WORK_UNAVAILABLE" });
});

test("外部・HTTP・不正な作品URLをフェッチ対象にしない", () => {
  for (const href of ["https://evil.example/home/work/=/product_id/RJ000001.html", "http://www.dlsite.com/home/work/=/product_id/RJ000001.html", "javascript:alert(1)", "/home/profile", "https://www.dlsite.com.evil.example/home/work/=/product_id/RJ000001.html"]) {
    assert.equal(workFromUrl(href, historyUrl(1)), null);
  }
});
