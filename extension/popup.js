/** ポップアップの状態表示と操作を担当する。集計は開始要求だけを送り、実行環境にはしない。 */
import { STORAGE_KEY, viewOf, tweetUrl } from "./lib/model.js";

const $ = (id) => document.getElementById(id);
let busy = false;
let current = { status: "idle", ranking: [] };

/** タグ名はHTMLとして解釈せず、textContentで表示する。offsetは6位以降の表示に使う。 */
function rows(element, tags, offset = 0) {
  element.replaceChildren(...tags.map(({ tag, count }, index) => {
    const li = document.createElement("li");
    for (const [className, value] of [["rank", index + offset + 1], ["tag", tag], ["count", `${count.toLocaleString("ja-JP")}作品`]]) {
      const span = document.createElement("span");
      span.className = className;
      span.textContent = value;
      li.append(span);
    }
    return li;
  }));
}

/** idle・running・completed・error・cancelledの保存状態から画面を描画する。 */
function render(view) {
  current = view;
  const running = view.status === "running";
  const completed = view.status === "completed";
  $("intro").hidden = view.status !== "idle";
  $("total-summary").hidden = !completed;
  $("controls").classList.toggle("completed", completed);
  $("analyze").disabled = running || busy;
  $("analyze").textContent = running ? "集計中…" : completed ? "再集計" : view.status === "idle" ? "購入履歴を集計する" : "もう一度集計する";
  $("stop").hidden = !running;
  $("stop").disabled = busy;
  $("clear").hidden = view.status === "idle";
  $("clear").disabled = busy;
  $("progress").hidden = !running;
  $("error").hidden = view.status !== "error";
  $("error").textContent = view.error?.message ?? "";
  $("cancelled").hidden = view.status !== "cancelled";
  $("result").hidden = !completed;

  if (running) {
    if (view.phase === "history") {
      $("status").textContent = `購入履歴を取得中：${view.nextPage}ページ目（${view.totalWorks.toLocaleString("ja-JP")}作品取得済み）`;
      $("progress-bar").removeAttribute("value");
    } else {
      $("status").textContent = `タグを集計中：${view.processedWorks.toLocaleString("ja-JP")} / ${view.totalWorks.toLocaleString("ja-JP")}作品`;
      $("progress-bar").max = Math.max(1, view.totalWorks);
      $("progress-bar").value = view.processedWorks;
    }
  }
  // 途中や失敗した集計は最終結果として公開せず、完了してタグがある場合だけ投稿可能にする。
  const shareable = completed && view.ranking.length > 0;
  $("tweet").hidden = !shareable;
  if (!shareable) $("tweet").removeAttribute("href");
  if (!completed) return;
  $("total-works").textContent = `${view.totalWorks.toLocaleString("ja-JP")}作品`;
  rows($("top-tags"), view.ranking.slice(0, 5));
  rows($("remaining-tags"), view.ranking.slice(5), 5);
  $("more-tags").hidden = view.ranking.length <= 5;
  $("more-title").textContent = `すべてのタグ（${view.ranking.length}）`;
  $("empty").hidden = view.ranking.length > 0;
  $("empty").textContent = view.totalWorks === 0 ? "購入作品はありませんでした。" : "集計できるタグがありませんでした。";
  // 取得不可・タグなしの件数は画面に残すが、投稿文には含めない。
  const coverage = [];
  if (view.unavailableCount) coverage.push(`タグ取得不可：${view.unavailableCount.toLocaleString("ja-JP")}作品`);
  if (view.taglessCount) coverage.push(`タグなし：${view.taglessCount.toLocaleString("ja-JP")}作品`);
  $("coverage").hidden = !coverage.length;
  $("coverage").textContent = coverage.join(" · ");
  if (shareable) {
    $("tweet").href = tweetUrl(view);
  }
}

/** 操作の応答待ち中はボタンを無効にし、backgroundの返す状態で画面を更新する。 */
async function command(action) {
  busy = true;
  render(current);
  try {
    const reply = await chrome.runtime.sendMessage({ target: "background", action });
    if (!reply?.ok) throw new Error(reply?.error?.message ?? "拡張機能から応答がありません。もう一度開いてください。");
    // 応答より先に新しいStorage通知が来ていたら、古い応答で表示を巻き戻さない。
    if (reply.view && !(reply.view.id === current.id && reply.view.revision < current.revision)) render(reply.view);
  } catch (error) {
    $("error").textContent = error.message;
    $("error").hidden = false;
  } finally {
    busy = false;
    $("analyze").disabled = current.status === "running";
    $("stop").disabled = false;
    $("clear").disabled = false;
  }
}

$("analyze").addEventListener("click", () => command("START"));
$("stop").addEventListener("click", () => command("STOP"));
$("clear").addEventListener("click", () => command("CLEAR"));
// 集計中のページ・作品ごとの保存通知を受け、ポップアップを開いている間の進捗を更新する。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[STORAGE_KEY]) render(viewOf(changes[STORAGE_KEY].newValue));
});
// 開き直したポップアップも、最後の保存状態を読み込んで表示を復元する。
await command("STATE");
