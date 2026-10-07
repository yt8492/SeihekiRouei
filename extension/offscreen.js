/**
 * ポップアップを閉じても通信と集計を続ける非表示ページの実行処理。
 * HTML解析は専用Workerへ渡し、Chrome APIによる進捗保存はbackgroundへ依頼する。
 */
import { analyze } from "./lib/analyzer.js";
import { createClient } from "./lib/client.js";
import { errorInfo, AnalysisError } from "./lib/model.js";

let activeId = null;
const send = (message) => chrome.runtime.sendMessage({ target: "background", ...message });
const parser = new Worker("parser-worker.js", { type: "module" });
// 解析要求ごとのIDでPromiseと応答を対応付け、Workerを繰り返し利用する。
const pendingParses = new Map();
let nextParseId = 0;
let parserError = null;

// Workerから届く通常オブジェクトのエラーを、集計側で判別できるAnalysisErrorに戻す。
parser.addEventListener("message", ({ data }) => {
  const pending = pendingParses.get(data.id);
  if (!pending) return;
  pendingParses.delete(data.id);
  if (data.error) pending.reject(new AnalysisError(data.error.code, data.error.message));
  else pending.resolve(data.result);
});
// Workerの読み込みなどに失敗した場合は、待機中・後続の解析を失敗させて停止を通知する。
parser.addEventListener("error", () => {
  parserError = new AnalysisError("PARSER_ERROR", "HTML解析を開始できませんでした。拡張機能を再読み込みしてください。");
  for (const pending of pendingParses.values()) pending.reject(parserError);
  pendingParses.clear();
});
/** HTML解析をメッセージとして依頼し、結果または解析エラーを待つ。 */
function parse(action, html, page, url) {
  if (parserError) return Promise.reject(parserError);
  return new Promise((resolve, reject) => {
    const id = ++nextParseId;
    pendingParses.set(id, { resolve, reject });
    try {
      parser.postMessage({ id, action, html, page, url });
    } catch (error) {
      pendingParses.delete(id);
      reject(error);
    }
  });
}

/** ジョブを実行し、保存が拒否されたら停止する。完了・異常終了後はoffscreenを閉じる。 */
async function run(job) {
  try {
    await analyze(job, {
      ...createClient({
        parseHistoryImpl: (html, page, url) => parse("history", html, page, url),
        parseTagsImpl: (html, url) => parse("tags", html, undefined, url),
      }),
      async checkpoint(next) {
        const reply = await send({ action: "CHECKPOINT", job: next });
        if (!reply?.ok) throw new AnalysisError(reply?.error?.code ?? "STORAGE_ERROR", reply?.error?.message ?? "集計の進捗を保存できませんでした。もう一度集計してください。");
        return reply.accepted;
      },
    });
  } catch (error) {
    await send({ action: "RUNNER_ERROR", id: job.id, error: errorInfo(error) }).catch(() => {});
  } finally {
    activeId = null;
    // このページ自身が閉じると応答が切れる場合があるが、残りの作業はない。
    await send({ action: "CLOSE", id: job.id }).catch(() => {});
  }
}

// ポップアップ再表示時などに同じRUNが届いても、実行中の集計を二重に開始しない。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen" || message.action !== "RUN" || sender.id !== chrome.runtime.id) return;
  if (activeId && activeId !== message.job.id) {
    sendResponse({ ok: false });
    return;
  }
  if (!activeId) {
    activeId = message.job.id;
    void run(message.job);
  }
  sendResponse({ ok: true });
});
