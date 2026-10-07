/** 除外後の順位と投稿文を検証し、再取得せずに元の集計へ戻せることを確認する。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankTags, visibleTags, tweetText } from "../extension/lib/model.js";

test("除外した上位タグを飛ばして順位を繰り上げ、残りの上位5件を投稿する", () => {
  const ranking = rankTags([["除外", 10], ["次点", 9], ["三番", 8], ["四番", 7], ["五番", 6], ["六番", 5], ["七番", 4]]);
  const visible = visibleTags(ranking, ["除外"]);
  assert.deepEqual(visible.map(({ tag }) => tag), ["次点", "三番", "四番", "五番", "六番", "七番"]);
  const text = tweetText({ ranking: visible });
  assert.ok(text.includes("1. 次点（9作品）"));
  assert.ok(text.includes("5. 六番（5作品）"));
  assert.ok(!text.includes("除外"));
  assert.ok(!text.includes("七番"));
});

test("タグ名が完全一致するものだけを除外し、元の件数と順位を変更しない", () => {
  const ranking = rankTags([["ASMR", 4], ["ASMR作品", 3], ["asmr", 2], ["癒し", 1]]);
  const original = structuredClone(ranking);
  assert.deepEqual(visibleTags(ranking, ["ASMR", "ASMR", "今回存在しないタグ"]).map(({ tag }) => tag), ["ASMR作品", "asmr", "癒し"]);
  assert.deepEqual(ranking, original);
  assert.deepEqual(visibleTags(ranking, []), original);
});

test("すべてのタグを除外した場合と、集計タグがない場合は空の順位を返す", () => {
  const ranking = rankTags([["ASMR", 4], ["癒し", 3]]);
  assert.deepEqual(visibleTags(ranking, ["ASMR", "癒し"]), []);
  assert.deepEqual(visibleTags([], ["ASMR"]), []);
});
