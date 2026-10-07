/**
 * 拡張の操作と保存状態を管理するService Worker。
 * 集計はoffscreenに任せ、集計状態と除外設定の書き込みをこのファイルに集約する。
 */
import { STORAGE_KEY, EXCLUDED_TAGS_KEY, newJob, viewOf, errorInfo, AnalysisError } from "./lib/model.js";

// 操作と進捗保存を直列化し、中止・削除後の遅い応答で結果が復活するのを防ぐ。
let pending = Promise.resolve();
const serialized = (operation) => {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
};
const readJob = async () => (await chrome.storage.session.get(STORAGE_KEY))[STORAGE_KEY];
// 保存上限に達した場合も、途中の集計を成功として公開せず再操作を案内する。
const writeJob = async (job) => {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: job });
  } catch (error) {
    if (/quota|QUOTA_BYTES|maximum/i.test(error.message)) {
      throw new AnalysisError("STORAGE_LIMIT", "集計データがChromeの一時保存上限を超えました。この購入件数は現在の拡張では集計できません。");
    }
    throw error;
  }
};
const offscreenUrl = chrome.runtime.getURL("offscreen.html");

/** offscreenを閉じ、そこで実行中の通信・解析Workerも終了させる。 */
async function closeRunner() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [offscreenUrl] });
  if (contexts.length) await chrome.offscreen.closeDocument();
}

/** offscreenを必要なときだけ作り、保存済みのジョブを渡す。重複起動は受信側でも防ぐ。 */
async function launch(job) {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [offscreenUrl] });
  if (!contexts.length) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html", reasons: ["WORKERS"],
      justification: "DOMを持たないWorkerで取得HTMLを解析し、ポップアップを閉じてもタグ集計を続けるため。",
    });
  }
  const reply = await chrome.runtime.sendMessage({ target: "offscreen", action: "RUN", job });
  if (!reply?.ok) throw new Error("Could not start runner");
}

/** ポップアップの操作とoffscreenの通知を、共通の保存状態に反映する。 */
async function handle(message, sender) {
  const job = await readJob();
  switch (message.action) {
    case "STATE":
      // 実行環境だけが失われていた場合は、最後の保存地点から集計を再開する。
      if (job?.status === "running") await launch(job);
      return { ok: true, view: viewOf(job) };
    case "START": {
      if (job?.status === "running") {
        await launch(job);
        return { ok: true, view: viewOf(job) };
      }
      await closeRunner();
      const next = newJob();
      await writeJob(next);
      try {
        await launch(next);
      } catch (error) {
        next.status = "error";
        next.error = errorInfo(error);
        await writeJob(next);
      }
      return { ok: true, view: viewOf(next) };
    }
    case "STOP":
      // 先に状態を確定し、その後に実行環境を閉じて遅い進捗通知を無効にする。
      if (job?.status === "running") {
        job.status = "cancelled";
        job.revision += 1;
        await writeJob(job);
      }
      await closeRunner();
      return { ok: true, view: viewOf(job) };
    case "CLEAR":
      await closeRunner();
      await chrome.storage.session.remove(STORAGE_KEY);
      await chrome.storage.local.remove(EXCLUDED_TAGS_KEY);
      return { ok: true, view: viewOf(null) };
    case "SET_TAG_EXCLUSION": {
      if (typeof message.tag !== "string" || !message.tag || typeof message.excluded !== "boolean") {
        throw new AnalysisError("INVALID_SETTING", "除外するタグを確認できませんでした。もう一度操作してください。");
      }
      // タグ単位で変更を直列化し、複数のポップアップからの操作でも設定を上書きしない。
      const stored = await chrome.storage.local.get(EXCLUDED_TAGS_KEY);
      const excluded = new Set(stored[EXCLUDED_TAGS_KEY] ?? []);
      if (message.excluded) excluded.add(message.tag);
      else excluded.delete(message.tag);
      if (excluded.size) {
        await chrome.storage.local.set({ [EXCLUDED_TAGS_KEY]: [...excluded].sort((a, b) => a.localeCompare(b, "ja")) });
      } else {
        await chrome.storage.local.remove(EXCLUDED_TAGS_KEY);
      }
      return { ok: true, view: viewOf(job) };
    }
    case "RESET_EXCLUSIONS":
      await chrome.storage.local.remove(EXCLUDED_TAGS_KEY);
      return { ok: true, view: viewOf(job) };
    case "CHECKPOINT":
      if (sender.url !== offscreenUrl) throw new Error("Invalid sender");
      // 別の集計、中止済みの集計、古い更新番号から届いた結果は保存しない。
      if (!job || job.id !== message.job.id || job.status !== "running"
          || message.job.revision <= job.revision) return { ok: true, accepted: false };
      await writeJob(message.job);
      return { ok: true, accepted: true };
    case "RUNNER_ERROR":
      if (sender.url !== offscreenUrl) throw new Error("Invalid sender");
      if (job?.id === message.id && job.status === "running") {
        job.status = "error";
        job.error = message.error;
        job.revision += 1;
        // 保存上限などで失敗した際は、大きい作業データを捨ててエラー状態を保存する。
        job.works = [];
        job.pageSignatures = [];
        job.counts = [];
        job.cursor = 0;
        job.unavailableCount = 0;
        await writeJob(job);
      }
      return { ok: true };
    case "CLOSE":
      if (sender.url !== offscreenUrl) throw new Error("Invalid sender");
      if (job?.id === message.id && job.status !== "running") await closeRunner();
      return { ok: true };
    default:
      throw new Error("Unknown action");
  }
}

// 同じ拡張のページからの操作だけを受け付け、非同期の応答完了までチャネルを保持する。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "background") return;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  serialized(() => handle(message, sender))
    .then(sendResponse, (error) => sendResponse({ ok: false, error: errorInfo(error) }));
  return true;
});
