/** Chromiumに配布用の拡張を読み込み、画面・offscreen・解析Worker・Cookie送信をまとめて検証する。 */
import { test as base, expect, chromium } from "@playwright/test";
import { join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createMockDlsite } from "./mock-dlsite.js";
import { fixture, withPageDecorations } from "../helpers.js";

// 各テストに専用のブラウザ環境とHTTPSサーバーを用意し、終了時に両方を閉じる。
const test = base.extend({
  extension: async ({}, use) => {
    // Release用ZIPの検証では解凍したextensionを指定し、通常はビルド済みdistを使う。
    const path = resolve(process.env.SEIHEKI_EXTENSION_PATH ?? "dist");
    const mock = await createMockDlsite();
    // 同じプロファイルで再起動し、除外設定が実際に端末内へ永続化されることも検証する。
    const profile = await mkdtemp(join(tmpdir(), "seiheki-e2e-"));
    const launch = () => chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true,
      viewport: { width: 340, height: 600 },
      args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`, ...mock.args],
    });
    let context;
    try {
      context = await launch();
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      const id = worker.url().split("/")[2];
      const extension = {
        context, worker, mock, popupUrl: `chrome-extension://${id}/popup.html`,
        async restart() {
          await context.close();
          context = await launch();
          extension.context = context;
          extension.worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
        },
      };
      await use(extension);
      expect(mock.errors).toEqual([]);
    } finally {
      await context?.close();
      await mock.close();
      await rm(profile, { recursive: true, force: true });
    }
  },
});

test("タグの除外が順位と投稿文に反映され、再集計とブラウザ再起動後も保持される", async ({ extension }, testInfo) => {
  await mockDlsite(extension);
  let popup = await extension.context.newPage();
  await popup.goto(extension.popupUrl);
  await popup.getByRole("button", { name: "購入履歴を集計する" }).click();
  await expect(popup.locator("#result")).toBeVisible({ timeout: 20000 });
  await expect(popup.locator("#tag-settings")).not.toHaveAttribute("open", "");
  const requestsBeforeSettings = extension.mock.requests.length;
  await popup.locator("#tag-settings summary").click();
  const asmr = popup.getByRole("checkbox", { name: "ASMR", exact: true });
  await asmr.check();
  await expect(asmr).toBeChecked();
  await expect(asmr).toBeEnabled();
  await expect(asmr).toBeFocused();
  await expect(popup.locator("#top-tags li").first()).toContainText("癒し");
  await expect(popup.locator("#top-tags li")).toHaveCount(5);
  await expect(popup.locator("#remaining-tags li")).toHaveCount(1);
  await expect(popup.locator("#total-works")).toHaveText("7作品");
  const draft = new URL(await popup.locator("#tweet").getAttribute("href"));
  expect(draft.searchParams.get("text")).not.toContain("ASMR");
  expect(draft.searchParams.get("text").match(/^\d\./gm)).toHaveLength(5);
  expect(extension.mock.requests).toHaveLength(requestsBeforeSettings);
  const job = await popup.evaluate(async () => (await chrome.storage.session.get("analysis")).analysis);
  expect(job.counts).toContainEqual(["ASMR", 4]);
  await popup.screenshot({ path: testInfo.outputPath("popup-exclusions.png"), fullPage: true });

  await popup.close();
  popup = await extension.context.newPage();
  await popup.goto(extension.popupUrl);
  await expect(popup.locator("#top-tags li").first()).toContainText("癒し");
  await popup.getByRole("button", { name: "再集計", exact: true }).click();
  await expect(popup.locator("#progress")).toBeVisible();
  await expect(popup.locator("#result")).toBeVisible({ timeout: 20000 });
  await expect(popup.locator("#top-tags li").first()).toContainText("癒し");

  await extension.restart();
  popup = await extension.context.newPage();
  await popup.goto(extension.popupUrl);
  await expect(popup.locator("#intro")).toBeVisible();
  await popup.locator("#tag-settings summary").click();
  await expect(popup.getByRole("checkbox", { name: "ASMR", exact: true })).toBeChecked();
  // ログイン用のセッションCookieは再起動で消えるため、再ログインしてから再取得を検証する。
  await mockDlsite(extension);
  await popup.getByRole("button", { name: "購入履歴を集計する" }).click();
  await expect(popup.locator("#result")).toBeVisible({ timeout: 20000 });
  await expect(popup.locator("#top-tags li").first()).toContainText("癒し");
  await popup.getByRole("button", { name: "データを削除" }).click();
  await expect(popup.locator("#intro")).toBeVisible();
  await expect(popup.locator("#tag-settings")).toBeHidden();
  expect(await popup.evaluate(() => chrome.storage.local.get("excludedTags"))).toEqual({});
  expect(await popup.evaluate(() => chrome.storage.session.get("analysis"))).toEqual({});
});

test("全タグ除外で投稿を隠し、チェック解除や一括解除で再取得せず復元できる", async ({ extension }) => {
  await mockDlsite(extension);
  const popup = await extension.context.newPage();
  await popup.goto(extension.popupUrl);
  await popup.getByRole("button", { name: "購入履歴を集計する" }).click();
  await expect(popup.locator("#result")).toBeVisible({ timeout: 20000 });
  const requestsBeforeSettings = extension.mock.requests.length;
  await popup.locator("#tag-settings summary").click();
  // 別のポップアップから同時に変更しても、両方のタグが保存されて画面も同期する。
  const secondPopup = await extension.context.newPage();
  await secondPopup.goto(extension.popupUrl);
  await secondPopup.locator("#tag-settings summary").click();
  await Promise.all([
    popup.getByRole("checkbox", { name: "ASMR", exact: true }).check(),
    secondPopup.getByRole("checkbox", { name: "癒し", exact: true }).check(),
  ]);
  for (const page of [popup, secondPopup]) {
    await expect(page.getByRole("checkbox", { name: "ASMR", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "癒し", exact: true })).toBeChecked();
  }
  await secondPopup.close();
  const tags = await popup.getByRole("checkbox").evaluateAll((inputs) => inputs.map((input) => input.value));
  expect(tags).toHaveLength(7);
  for (const tag of tags) {
    const input = popup.getByRole("checkbox", { name: tag, exact: true });
    await input.check();
    await expect(input).toBeChecked();
    await expect(input).toBeEnabled();
  }
  await expect(popup.locator("#top-tags li")).toHaveCount(0);
  await expect(popup.locator("#empty")).toHaveText("すべてのタグが除外されています。");
  await expect(popup.locator("#tweet")).toBeHidden();
  expect(await popup.locator("#tweet").getAttribute("href")).toBeNull();
  await expect(popup.getByRole("checkbox")).toHaveCount(7);

  await popup.getByRole("checkbox", { name: "ASMR", exact: true }).uncheck();
  await expect(popup.locator("#tweet")).toHaveAttribute("href", /ASMR/u);
  await expect(popup.locator("#top-tags li")).toHaveCount(1);
  await popup.getByRole("button", { name: "除外をすべて解除" }).click();
  await expect(popup.locator("#top-tags li")).toHaveCount(5);
  await expect(popup.locator("#top-tags li").first()).toContainText("ASMR");
  await expect(popup.locator("#remaining-tags li")).toHaveCount(2);
  await expect(popup.getByRole("checkbox", { checked: true })).toHaveCount(0);
  expect(await popup.evaluate(() => chrome.storage.local.get("excludedTags"))).toEqual({});
  expect(extension.mock.requests).toHaveLength(requestsBeforeSettings);
});

async function mockDlsite({ context, mock }, { loggedIn = true, failWork = false, delayed = false, empty = false, loginMarkup = false } = {}) {
  if (loggedIn) await context.addCookies([{ name: "test-session", value: "mock-login", url: "https://www.dlsite.com", sameSite: "Strict" }]);
  // offscreenの通信はPlaywrightのルーティング対象にならないため、ローカルHTTPSで応答する。
  // URLのoriginを変えず、ホスト権限とCookieのブラウザ側の扱いも検証する。
  mock.configure({ loggedIn, failWork, delayed, empty, loginMarkup });
  return mock.requests;
}

test("全履歴を集計し、ポップアップ再表示後に上位5つの投稿画面を開く", async ({ extension }, testInfo) => {
  const { context, popupUrl } = extension;
  const requests = await mockDlsite(extension, { delayed: true });
  let popup = await context.newPage();
  await popup.goto(popupUrl);
  await popup.getByRole("button", { name: "購入履歴を集計する" }).click();
  await expect(popup.locator("#progress")).toBeVisible();
  await popup.close();
  // 集計はoffscreenが担当するため、ポップアップを閉じて開き直しても継続する。
  popup = await context.newPage();
  await popup.goto(popupUrl);
  await expect(popup.locator("#result")).toBeVisible({ timeout: 20000 });
  await expect(popup.locator("#total-works")).toHaveText("7作品");
  await expect(popup.locator("#top-tags li")).toHaveCount(5);
  await expect(popup.locator("#top-tags li").first()).toContainText("ASMR");
  await expect(popup.locator("#top-tags li").first()).toContainText("4作品");
  await expect(popup.locator("#coverage")).toContainText("タグ取得不可：2作品");
  expect(requests.filter(({ url }) => url.includes("/mypage/userbuy/"))).toHaveLength(3);
  expect(requests.filter(({ url }) => /RJ000002/i.test(url))).toHaveLength(1);
  expect(requests.every(({ cookie }) => cookie.includes("test-session=mock-login"))).toBe(true);
  const button = await popup.locator("#tweet").boundingBox();
  const fifthTag = await popup.locator("#top-tags li").nth(4).boundingBox();
  expect(button.y + button.height).toBeLessThanOrEqual(600);
  expect(fifthTag.y + fifthTag.height).toBeLessThanOrEqual(button.y);
  await popup.screenshot({ path: testInfo.outputPath("popup-completed.png") });
  await popup.locator("#more-tags summary").click();
  await expect(popup.locator("#remaining-tags li")).toHaveCount(2);
  const draft = new URL(await popup.locator("#tweet").getAttribute("href"));
  const text = draft.searchParams.get("text");
  expect(text.match(/^\d\./gm)).toHaveLength(5);
  expect(text).toContain("ASMR（4作品）");
  expect(text).toContain("#SeihekiRouei");
  expect(text).not.toContain("取得不可");
  const newTab = context.waitForEvent("page");
  await popup.getByRole("link", { name: "上位5タグをツイートする" }).click();
  const composer = await newTab;
  await expect(composer).toHaveURL(draft.href);
  await expect(composer.getByRole("heading", { name: "ツイートを編集" })).toBeVisible();
  await popup.getByRole("button", { name: "データを削除" }).click();
  await expect(popup.locator("#intro")).toBeVisible();
  await expect(popup.locator("#tweet")).toBeHidden();
  expect(await popup.evaluate(() => chrome.storage.session.get("analysis"))).toEqual({});
});

test("未ログイン時は案内を表示し、ツイートを有効にしない", async ({ extension }) => {
  const { context, popupUrl } = extension;
  await mockDlsite(extension, { loggedIn: false });
  const popup = await context.newPage();
  await popup.goto(popupUrl);
  await popup.getByRole("button", { name: "購入履歴を集計する" }).click();
  await expect(popup.getByRole("alert")).toContainText("ログインしてから");
  await expect(popup.locator("#result")).toBeHidden();
  await expect(popup.locator("#tweet")).toBeHidden();
  await expect(popup.getByRole("button", { name: "もう一度集計する" })).toBeEnabled();
});

test("作品ページの通信エラーで途中のランキングを公開しない", async ({ extension }) => {
  const { context, popupUrl } = extension;
  await mockDlsite(extension, { failWork: true });
  const popup = await context.newPage();
  await popup.goto(popupUrl);
  await popup.getByRole("button", { name: "購入履歴を集計する" }).click();
  await expect(popup.getByRole("alert")).toContainText("HTTP 403");
  await expect(popup.locator("#result")).toBeHidden();
  await expect(popup.locator("#tweet")).toBeHidden();
});

test("WorkerのHTML解析で検知したログインエラーをポップアップに伝える", async ({ extension }) => {
  const { context, popupUrl } = extension;
  await mockDlsite(extension, { loginMarkup: true });
  const popup = await context.newPage();
  await popup.goto(popupUrl);
  await popup.getByRole("button", { name: "購入履歴を集計する" }).click();
  await expect(popup.getByRole("alert")).toContainText("ログインしてから");
  await expect(popup.locator("#result")).toBeHidden();
  await expect(popup.locator("#tweet")).toBeHidden();
});

test("中止後の遅れた応答で結果が復活せず、再集計できる", async ({ extension }) => {
  const { context, popupUrl } = extension;
  await mockDlsite(extension, { delayed: true });
  const popup = await context.newPage();
  await popup.goto(popupUrl);
  await popup.getByRole("button", { name: "購入履歴を集計する" }).click();
  await expect(popup.locator("#progress")).toBeVisible();
  await popup.getByRole("button", { name: "集計を中止" }).click();
  await expect(popup.locator("#cancelled")).toBeVisible();
  await expect(popup.locator("#tweet")).toBeHidden();
  await popup.getByRole("button", { name: "もう一度集計する" }).click();
  await expect(popup.locator("#result")).toBeVisible({ timeout: 20000 });
  await expect(popup.locator("#total-works")).toHaveText("7作品");
});

test("DOMのないWorkerで装飾付きHTMLをCSP違反や追加通信なく解析する", async ({ extension }) => {
  const popup = await extension.context.newPage();
  const violations = [];
  popup.on("console", (message) => {
    if (/content security policy/iu.test(message.text())) violations.push(message.text());
  });
  await popup.goto(extension.popupUrl);
  const [history, work] = await Promise.all([fixture("history-1.html"), fixture("work.html")]);
  const workerCreated = popup.waitForEvent("worker");
  await popup.evaluate(() => { globalThis.testParserWorker = new Worker("./parser-worker.js", { type: "module" }); });
  const worker = await workerCreated;
  // 実行場所にDOM APIがないことを確認し、CSSの適用を避ける設計そのものを検証する。
  expect(await worker.evaluate(() => [typeof DOMParser, typeof document])).toEqual(["undefined", "undefined"]);
  const result = await popup.evaluate(async ({ history, work }) => {
    const parser = globalThis.testParserWorker;
    const parse = (data) => new Promise((resolve, reject) => {
      parser.addEventListener("message", ({ data }) => data.error ? reject(new Error(data.error.message)) : resolve(data.result), { once: true });
      parser.postMessage(data);
    });
    try {
      return {
        history: await parse({ id: 1, action: "history", html: history, page: 1 }),
        tags: await parse({ id: 2, action: "tags", html: work, url: "https://www.dlsite.com/home/work/=/product_id/RJ000001.html" }),
      };
    } finally {
      parser.terminate();
    }
  }, { history: withPageDecorations(history), work: withPageDecorations(work) });
  expect(result.history.works.map(({ id }) => id)).toEqual(["RJ000001", "RJ000002"]);
  expect(result.history.nextPage).toBe(2);
  expect(result.tags).toEqual(["ASMR", "日常/生活"]);
  expect(extension.mock.requests).toEqual([]);
  expect(violations).toEqual([]);
});
