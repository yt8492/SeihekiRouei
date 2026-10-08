/** 実サービスへ通信せず、Cookie送信の指定・待機間隔・HTTP判定・再試行・タイムアウトを検証する。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../extension/lib/client.js";
import { fixture } from "./helpers.js";

const work = { id: "RJ000001", url: "https://www.dlsite.com/home/work/=/product_id/RJ000001.html" };

test("ChromeのログインCookieを付け、リクエスト間隔を空ける", async () => {
  const waits = [], options = [];
  const html = await fixture("work.html");
  const client = createClient({
    async fetchImpl(url, init) { options.push(init); return new Response(html); },
    async wait(delay) { waits.push(delay); },
  });
  await client.getTags(work);
  await client.getTags(work);
  assert.ok(options.every((init) => init.credentials === "include" && init.cache === "no-store"));
  assert.deepEqual(waits, [600]);
});

test("comipoへ移動した旧comic作品は通信前に取得不可とし、再試行しない", async () => {
  const requests = [], waits = [];
  const client = createClient({
    async fetchImpl(url) { requests.push(url); throw new TypeError("CSP blocked redirect"); },
    async wait(delay) { waits.push(delay); },
  });
  await assert.rejects(client.getTags({ id: "BJ03032468", url: "https://www.dlsite.com/comic/work/=/product_id/BJ03032468.html?locale=ja_JP" }), { code: "WORK_UNAVAILABLE" });
  assert.deepEqual(requests, []);
  assert.deepEqual(waits, []);
});

test("同じBJ番号の形式でも、DLsite内のbooks作品は通常どおりタグを取得する", async () => {
  const requests = [];
  const client = createClient({
    async fetchImpl(url) { requests.push(url); return new Response(await fixture("work.html")); },
  });
  const book = { id: "BJ000007", url: "https://www.dlsite.com/books/work/=/product_id/BJ000007.html?locale=ja_JP" };
  assert.deepEqual(await client.getTags(book), ["ASMR", "日常/生活"]);
  assert.deepEqual(requests, [book.url]);
});

test("429のRetry-Afterを守って再試行する", async () => {
  const waits = [];
  let requests = 0;
  const client = createClient({
    async fetchImpl() { requests += 1; return requests === 1 ? new Response("", { status: 429, headers: { "Retry-After": "3" } }) : new Response(await fixture("work.html")); },
    async wait(delay) { waits.push(delay); },
  });
  assert.deepEqual(await client.getTags(work), ["ASMR", "日常/生活"]);
  assert.equal(requests, 2);
  assert.deepEqual(waits, [3000]);
});

test("長いアクセス制限では再試行を打ち切り、成功として扱わない", async () => {
  const client = createClient({ async fetchImpl() { return new Response("", { status: 429, headers: { "Retry-After": "120" } }); } });
  await assert.rejects(client.getTags(work), { code: "RATE_LIMIT" });
});

test("ログインへのリダイレクトを明示する", async () => {
  const response = new Response("ログイン画面");
  Object.defineProperty(response, "url", { value: "https://login.dlsite.com/register?user=self" });
  const client = createClient({ async fetchImpl() { return response; } });
  await assert.rejects(client.getHistory(1), { code: "LOGIN_REQUIRED" });
});

test("購入履歴404と作品404を区別する", async () => {
  const client = createClient({ async fetchImpl() { return new Response("", { status: 404 }); }, async wait() {} });
  await assert.rejects(client.getTags(work), { code: "WORK_UNAVAILABLE" });
  await assert.rejects(client.getHistory(1), { code: "HISTORY_UNAVAILABLE" });
});

test("403でログイン成功やタグなしを推測しない", async () => {
  const client = createClient({ async fetchImpl() { return new Response("", { status: 403 }); } });
  await assert.rejects(client.getTags(work), { code: "HTTP_ERROR" });
});

test("通信失敗は3回までで終了する", async () => {
  let count = 0;
  const waits = [];
  const client = createClient({ async fetchImpl() { count += 1; throw new TypeError("offline"); }, async wait(delay) { waits.push(delay); } });
  await assert.rejects(client.getTags(work), { code: "NETWORK_ERROR" });
  assert.equal(count, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test("応答のない通信はタイムアウトして終了する", async () => {
  let count = 0;
  const client = createClient({
    timeout: 5,
    fetchImpl(url, { signal }) {
      count += 1;
      return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    },
    async wait() {},
  });
  await assert.rejects(client.getTags(work), { code: "NETWORK_ERROR" });
  assert.equal(count, 3);
});
