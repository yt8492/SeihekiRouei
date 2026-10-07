/** ポップアップの状態表示と操作を担当する。集計は開始要求だけを送り、実行環境にはしない。 */
import { STORAGE_KEY, EXCLUDED_TAGS_KEY, viewOf, visibleTags, tweetUrl } from "./lib/model.js";

const $ = (id) => document.getElementById(id);
let busy = false;
let current = { status: "idle", ranking: [] };
let excludedTags = [];
let exclusionsRevision = 0;
let settingsSignature = "";
let operationError = "";

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

/** 今回のタグと保存済みの除外タグを表示し、今回存在しないタグも解除できるようにする。 */
function renderExclusions(view) {
  const tags = [...new Set([...view.ranking.map(({ tag }) => tag), ...excludedTags])]
    .sort((a, b) => a.localeCompare(b, "ja"));
  $("tag-settings").hidden = !tags.length;
  $("tag-settings-title").textContent = excludedTags.length ? `タグの除外（${excludedTags.length}）` : "タグの除外";
  $("reset-exclusions").disabled = busy || !excludedTags.length;
  const signature = JSON.stringify(tags);
  // 選択だけが変わったときは要素を作り直さず、キーボードのフォーカスを維持する。
  if (signature !== settingsSignature) {
    settingsSignature = signature;
    $("excluded-tags").replaceChildren(...tags.map((tag) => {
      const label = document.createElement("label");
      label.className = "exclusion-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = tag;
      const name = document.createElement("span");
      name.textContent = tag;
      label.append(input, name);
      return label;
    }));
  }
  const excluded = new Set(excludedTags);
  for (const input of $("excluded-tags").querySelectorAll("input")) {
    // 保存待ち中はクリック直後のチェック表示を維持し、失敗時は確定済みの設定へ戻す。
    if (!busy) input.checked = excluded.has(input.value);
    input.disabled = busy;
  }
}

/** idle・running・completed・error・cancelledの保存状態から画面を描画する。 */
function render(view) {
  current = view;
  // 保存済みの集計を保持し、除外を解除したときも再取得なしで元の順位を復元する。
  const ranking = visibleTags(view.ranking, excludedTags);
  const running = view.status === "running";
  const completed = view.status === "completed";
  $("intro").hidden = view.status !== "idle";
  $("total-summary").hidden = !completed;
  $("controls").classList.toggle("completed", completed);
  $("analyze").disabled = running || busy;
  $("analyze").textContent = running ? "集計中…" : completed ? "再集計" : view.status === "idle" ? "購入履歴を集計する" : "もう一度集計する";
  $("stop").hidden = !running;
  $("stop").disabled = busy;
  $("clear").hidden = view.status === "idle" && !excludedTags.length;
  $("clear").disabled = busy;
  $("progress").hidden = !running;
  $("error").hidden = view.status !== "error" && !operationError;
  $("error").textContent = operationError || view.error?.message || "";
  $("cancelled").hidden = view.status !== "cancelled";
  $("result").hidden = !completed;
  renderExclusions(view);

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
  const shareable = completed && ranking.length > 0;
  $("tweet").hidden = !shareable;
  $("tweet").setAttribute("aria-disabled", String(busy));
  if (!shareable || busy) $("tweet").removeAttribute("href");
  if (!completed) return;
  $("total-works").textContent = `${view.totalWorks.toLocaleString("ja-JP")}作品`;
  rows($("top-tags"), ranking.slice(0, 5));
  rows($("remaining-tags"), ranking.slice(5), 5);
  $("more-tags").hidden = ranking.length <= 5;
  $("more-title").textContent = `すべてのタグ（${ranking.length}）`;
  $("empty").hidden = ranking.length > 0;
  $("empty").textContent = view.ranking.length ? "すべてのタグが除外されています。"
    : view.totalWorks === 0 ? "購入作品はありませんでした。" : "集計できるタグがありませんでした。";
  // 取得不可・タグなしの件数は画面に残すが、投稿文には含めない。
  const coverage = [];
  if (view.unavailableCount) coverage.push(`タグ取得不可：${view.unavailableCount.toLocaleString("ja-JP")}作品`);
  if (view.taglessCount) coverage.push(`タグなし：${view.taglessCount.toLocaleString("ja-JP")}作品`);
  $("coverage").hidden = !coverage.length;
  $("coverage").textContent = coverage.join(" · ");
  if (shareable && !busy) {
    $("tweet").href = tweetUrl({ ...view, ranking });
  }
}

/** 読み込み中に変更通知が届いていた場合、古い設定で上書きしない。 */
async function refreshExclusions() {
  const revision = exclusionsRevision;
  const stored = await chrome.storage.local.get(EXCLUDED_TAGS_KEY);
  if (revision === exclusionsRevision) excludedTags = stored[EXCLUDED_TAGS_KEY] ?? [];
}

/** 操作の応答待ち中はボタンを無効にし、backgroundの返す状態で画面を更新する。 */
async function command(action, options = {}) {
  if (busy) return;
  const focusedControl = document.activeElement;
  busy = true;
  operationError = "";
  render(current);
  try {
    const reply = await chrome.runtime.sendMessage({ target: "background", action, ...options });
    if (!reply?.ok) throw new Error(reply?.error?.message ?? "拡張機能から応答がありません。もう一度開いてください。");
    await refreshExclusions();
    // 応答より先に新しいStorage通知が来ていたら、古い応答で表示を巻き戻さない。
    if (reply.view && !(reply.view.id === current.id && reply.view.revision < current.revision)) render(reply.view);
  } catch (error) {
    operationError = error.message;
  } finally {
    busy = false;
    render(current);
    // 保存待ちで一時的に無効化した入力へフォーカスを戻し、キーボードでも続けて選べるようにする。
    if (focusedControl?.isConnected && document.activeElement === document.body) focusedControl.focus({ preventScroll: true });
  }
}

$("analyze").addEventListener("click", () => command("START"));
$("stop").addEventListener("click", () => command("STOP"));
$("clear").addEventListener("click", () => command("CLEAR"));
$("reset-exclusions").addEventListener("click", () => command("RESET_EXCLUSIONS"));
$("excluded-tags").addEventListener("change", ({ target }) => {
  if (target instanceof HTMLInputElement) command("SET_TAG_EXCLUSION", { tag: target.value, excluded: target.checked });
});
// 集計中のページ・作品ごとの保存通知を受け、ポップアップを開いている間の進捗を更新する。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[STORAGE_KEY]) render(viewOf(changes[STORAGE_KEY].newValue));
  // 別のポップアップから設定が変わった場合も、現在のランキングと投稿文へ反映する。
  if (area === "local" && changes[EXCLUDED_TAGS_KEY]) {
    exclusionsRevision += 1;
    excludedTags = changes[EXCLUDED_TAGS_KEY].newValue ?? [];
    render(current);
  }
});
// 開き直したポップアップも、最後の保存状態を読み込んで表示を復元する。
await command("STATE");
