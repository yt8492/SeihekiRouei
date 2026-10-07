/** ジョブの保存形式、表示用データ、タグの並び順、Xの投稿文を定義する。 */
export const STORAGE_KEY = "analysis";
// type/allとstart/allで、作品種別や購入年月を絞らずにページを巡回する。
export const HISTORY_BASE = "https://www.dlsite.com/maniax/mypage/userbuy/=/type/all/start/all/sort/1/order/1/page/";

/** 通信・解析・保存をまたいで、エラーコードと利用者向けの説明を保持する。 */
export class AnalysisError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AnalysisError";
    this.code = code;
  }
}

/** ページ番号を検証し、タグ名の言語をそろえるため日本語表示を指定する。 */
export function historyUrl(page) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid page");
  return `${HISTORY_BASE}${page}?locale=ja_JP`;
}

/**
 * 新しい集計の保存状態を作る。phaseはhistory（履歴取得）からtags（タグ集計）へ進む。
 * cursorは次に処理する作品の位置、revisionは保存のたびに増える更新番号。
 * countsはMapの内容を配列で保存し、再開時に復元する。
 */
export function newJob(id = crypto.randomUUID(), now = Date.now()) {
  return {
    id, revision: 0, status: "running", phase: "history",
    nextPage: 1, totalPages: null, historyPages: 0,
    works: [], pageSignatures: [], cursor: 0, counts: [],
    unavailableCount: 0, taglessCount: 0,
    startedAt: now, updatedAt: now, finishedAt: null, error: null,
  };
}

/** 作品数の降順で並べ、同数のタグは日本語の名前順にする。 */
export function rankTags(counts) {
  return counts.map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ja"));
}

/** 大きい作品一覧や再開用データを含めず、ポップアップに必要な状態だけを返す。 */
export function viewOf(job) {
  if (!job) return { status: "idle", ranking: [] };
  return {
    id: job.id, revision: job.revision, status: job.status, phase: job.phase,
    nextPage: job.nextPage, totalPages: job.totalPages, historyPages: job.historyPages,
    totalWorks: job.works.length, processedWorks: job.cursor,
    analyzedWorks: job.cursor - job.unavailableCount,
    unavailableCount: job.unavailableCount, taglessCount: job.taglessCount,
    finishedAt: job.finishedAt, error: job.error, ranking: rankTags(job.counts),
  };
}

/** 上位5タグだけを投稿文に含める。取得不可作品の注釈は付けない。 */
export function tweetText(view) {
  const lines = ["私のDLsite購入作品のタグTOP5"];
  for (const [index, { tag, count }] of view.ranking.slice(0, 5).entries()) {
    lines.push(`${index + 1}. ${tag}（${count}作品）`);
  }
  lines.push("#SeihekiRouei");
  return lines.join("\n");
}

/** 日本語や記号をURLSearchParamsでエンコードし、投稿の編集画面を開くURLを作る。 */
export function tweetUrl(view) {
  const url = new URL("https://x.com/intent/tweet");
  url.searchParams.set("text", tweetText(view));
  return url.href;
}

/** WorkerのメッセージやStorageで扱えるよう、Errorを通常のオブジェクトに変換する。 */
export function errorInfo(error) {
  return {
    code: error.code ?? "UNKNOWN",
    message: error instanceof AnalysisError ? error.message
      : "集計を続けられませんでした。Chromeと通信環境を確認し、もう一度集計してください。",
  };
}
