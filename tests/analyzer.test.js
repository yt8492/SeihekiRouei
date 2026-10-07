/** 通信・保存を差し替え、全ページ取得、作品単位の集計、再開、中止、投稿文を検証する。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../extension/lib/analyzer.js";
import { parseHistory } from "../extension/lib/parsers.js";
import { newJob, viewOf, AnalysisError, tweetUrl, tweetText } from "../extension/lib/model.js";
import { fixture, tagsByWork } from "./helpers.js";

test("全ページ・全作品を処理し、作品とタグの重複を除いて降順集計する", async () => {
  // 3ページを通じたIDの重複、リンクなし、404、タグなしをまとめて確認する。
  let final;
  const pages = [], requests = [];
  await analyze(newJob("test"), {
    async getHistory(page) {
      pages.push(page);
      return parseHistory(await fixture(`history-${page}.html`), page);
    },
    async getTags(work) {
      requests.push(work.id);
      if (work.id === "RJ000005") throw new AnalysisError("WORK_UNAVAILABLE", "404");
      return tagsByWork[work.id];
    },
    async checkpoint(job) { final = job; return true; },
  });
  const view = viewOf(final);
  assert.deepEqual(pages, [1, 2, 3]);
  assert.equal(requests.filter((id) => id === "RJ000002").length, 1);
  assert.equal(final.status, "completed");
  assert.equal(view.totalWorks, 7);
  assert.equal(view.analyzedWorks, 5);
  assert.equal(view.unavailableCount, 2);
  assert.equal(view.taglessCount, 1);
  assert.equal(view.ranking[0].tag, "ASMR");
  assert.equal(view.ranking[0].count, 4);
  assert.equal(view.ranking[1].tag, "癒し");
  assert.equal(view.ranking[1].count, 3);
  assert.equal(view.ranking[2].count, 2);
  assert.equal(view.ranking.length, 7);
});

test("中断後のチェックポイントから作品を二重計上せず再開する", async () => {
  const job = newJob("resume");
  Object.assign(job, { phase: "tags", nextPage: null, works: [{ id: "RJ000001", url: "one" }, { id: "RJ000002", url: "two" }], cursor: 1, counts: [["ASMR", 1]] });
  let final;
  await analyze(job, {
    getHistory() { throw new Error("must not fetch history"); },
    async getTags(work) { assert.equal(work.id, "RJ000002"); return ["ASMR", "癒し"]; },
    async checkpoint(next) { final = next; return true; },
  });
  assert.equal(viewOf(final).ranking[0].count, 2);
  assert.equal(final.cursor, 2);
});

test("同じ履歴ページの繰り返しは全件取得成功と扱わない", async () => {
  let final;
  await assert.rejects(analyze(newJob("repeat"), {
    async getHistory(page) { return { works: [{ id: "RJ000001", url: "one" }], nextPage: page + 1, totalPages: 2 }; },
    getTags() { throw new Error("must not fetch tags"); },
    async checkpoint(next) { final = next; return true; },
  }), { code: "PAGINATION_ERROR" });
  assert.equal(final.status, "error");
});

test("通信エラーは作品を除外せず集計を失敗させる", async () => {
  const job = newJob("error");
  Object.assign(job, { phase: "tags", works: [{ id: "RJ000001", url: "one" }] });
  let final;
  await assert.rejects(analyze(job, {
    async getTags() { throw new AnalysisError("NETWORK_ERROR", "通信失敗"); },
    async checkpoint(next) { final = next; return true; },
  }), { code: "NETWORK_ERROR" });
  assert.equal(final.status, "error");
  assert.equal(final.unavailableCount, 0);
  assert.equal(final.cursor, 0);
});

test("キャンセル済みのジョブのチェックポイントは処理を停止する", async () => {
  let checkpoints = 0;
  await analyze(newJob("cancel"), {
    async getHistory() { return { works: [], nextPage: null, totalPages: 1 }; },
    getTags() { throw new Error("must not fetch tags"); },
    async checkpoint() { checkpoints += 1; return false; },
  });
  assert.equal(checkpoints, 1);
});

test("ゼロ作品は正常完了し、タグはない", async () => {
  let final;
  await analyze(newJob("empty"), {
    async getHistory() { return { works: [], nextPage: null, totalPages: 1 }; },
    async checkpoint(job) { final = job; return true; },
  });
  assert.equal(final.status, "completed");
  assert.deepEqual(viewOf(final).ranking, []);
});

test("上位5つだけを、日本語と特殊文字を壊さずツイートURLにする", () => {
  const view = { ranking: Array.from({ length: 6 }, (_, i) => ({ tag: `タグ${i} & # + /`, count: 20 - i })), unavailableCount: 2 };
  const url = new URL(tweetUrl(view));
  assert.equal(url.origin, "https://x.com");
  assert.equal(url.pathname, "/intent/tweet");
  assert.equal(url.searchParams.get("text"), tweetText(view));
  assert.ok(!tweetText(view).includes("タグ5"));
  assert.ok(tweetText(view).includes("#SeihekiRouei"));
  assert.ok(!tweetText(view).includes("取得不可"));
  assert.equal([...url.searchParams].length, 1);
});
