/** DLsiteのHTMLをJavaScriptのノードとして解析し、購入作品・ページ情報・ジャンルを取り出す。 */
import { AnalysisError, historyUrl } from "./model.js";
import { parseDocument, selectOne, selectAll, is, textContent } from "./vendor/html-parser.js";

const normalize = (text) => (text ?? "").replace(/\s+/gu, " ").trim();
const PRODUCT_PATH = /^\/[^/]+\/work\/=\/product_id\/((?:RJ|VJ|BJ)\d+)\.html\/?$/i;

// ブラウザのDOMを使わないため、取得HTMLのCSS・スクリプト・画像などは適用されない。
const query = (node, selector) => node ? selectOne(selector, node) : null;
const queryAll = (node, selector) => node ? selectAll(selector, node) : [];
const attribute = (node, name) => node?.attribs?.[name] ?? null;
const text = (node) => node ? textContent(node) : "";
function closest(node, selector) {
  for (let ancestor = node; ancestor; ancestor = ancestor.parent) {
    if (ancestor.name && is(ancestor, selector)) return ancestor;
  }
  return null;
}

function unavailableId(row) {
  // IDのない販売終了作品は作品名と購入日の固定ハッシュで識別し、ページの繰り返しも検知する。
  const identity = `${normalize(text(query(row, ".work_name")))}|${normalize(text(query(row, ".buy_date")))}`;
  let hash = 0xcbf29ce484222325n;
  for (const character of identity) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0))) * 0x100000001b3n);
  }
  return `unavailable:${hash.toString(16)}`;
}

/** 対応するDLsiteの作品URLだけを許可し、作品IDの大文字化と表示言語の統一を行う。 */
export function workFromUrl(href, base) {
  try {
    const url = new URL(href, base);
    const match = url.pathname.match(PRODUCT_PATH);
    if (url.origin !== "https://www.dlsite.com" || !match) return null;
    url.search = "?locale=ja_JP";
    url.hash = "";
    return { id: match[1].toUpperCase(), url: url.href };
  } catch {
    return null;
  }
}

/** 認証画面を購入作品ゼロやタグなしと誤認しないよう、解析前に確認する。 */
export function assertLoggedIn(document, url) {
  const host = new URL(url).hostname;
  if (host === "login.dlsite.com" || host.endsWith(".vivion.jp")
      || query(document, 'form input[type="password"]')) {
    throw new AnalysisError("LOGIN_REQUIRED", "DLsiteにログインしてから、もう一度集計してください。");
  }
}

/** data-valueだけのページャーと、URLにページ番号を持つページャーの両方を読む。 */
function pageNumber(element, base) {
  const value = attribute(element, "data-value");
  if (value && /^\d+$/u.test(value)) return Number(value);
  const href = attribute(element, "href");
  if (!href) return null;
  try {
    const url = new URL(href, base);
    if (url.origin !== "https://www.dlsite.com" || !url.pathname.includes("/mypage/userbuy")) return null;
    const page = url.pathname.match(/\/page\/(\d+)(?:\/|$)/u)?.[1] ?? url.searchParams.get("page");
    return page && /^\d+$/u.test(page) ? Number(page) : null;
  } catch {
    return null;
  }
}

/** 履歴の作品一覧と次ページを返す。未知の形式を空の購入履歴として扱わない。 */
export function parseHistory(html, page, url = historyUrl(page)) {
  const document = parseDocument(html);
  assertLoggedIn(document, url);
  const container = query(document, "#buy_history_this");
  const table = query(container ?? document, ".work_list_main");
  const emptyMessage = /(?:購入(?:履歴|作品|商品).{0,30}(?:ありません|ございません|ありませんでした)|該当する.{0,20}(?:ありません|ございません))/u;
  const hasPurchaseInfo = (node) => attribute(node, "data-product-id") !== null
    || query(node, ".work_name, .buy_date, [data-product-id]")
    || queryAll(node, "a[href]").some((anchor) => workFromUrl(attribute(anchor, "href"), url));
  // 空履歴の案内は購入情報のない1セルの行だけ。作品名中の「購入作品はありません」等は除外しない。
  const isEmptyMessageRow = (row) => !hasPurchaseInfo(row)
    && queryAll(row, "td").length === 1 && emptyMessage.test(normalize(text(row)));
  if (!table) {
    if (container && !hasPurchaseInfo(container) && emptyMessage.test(normalize(text(container)))) {
      return { works: [], nextPage: null, totalPages: page };
    }
    throw new AnalysisError("HISTORY_FORMAT", "購入履歴を読み取れませんでした。DLsiteの購入履歴ページを確認してください。");
  }

  // 見出し行や入れ子の別テーブルの行は、購入作品として数えない。
  const dataRows = queryAll(table, "tr:not(.item_name)")
    .filter((row) => closest(row, "table") === table && query(row, "td"));
  const rows = dataRows.filter((row) => !isEmptyMessageRow(row));
  const works = rows.map((row) => {
    if (!query(row, ".work_name") || !query(row, ".buy_date")) {
      throw new AnalysisError("HISTORY_FORMAT", "購入履歴の形式が変わっているため、集計を中止しました。");
    }
    const link = queryAll(row, ".work_name a[href]")
      .map((anchor) => workFromUrl(attribute(anchor, "href"), url)).find(Boolean);
    const id = attribute(row, "data-product-id") ?? attribute(query(row, "[data-product-id]"), "data-product-id");
    // 作品リンクがなくても履歴から消さず、タグ取得不可の件数に含めるため残す。
    return link ?? { id: /^(?:RJ|VJ|BJ)\d+$/i.test(id ?? "") ? id.toUpperCase() : unavailableId(row), url: null };
  });

  // データ行の存在する未知のテーブルを、正常なゼロ作品の履歴として返さない。
  if (!works.length && queryAll(table, "tr:not(.item_name)")
    .some((row) => query(row, "td") && !isEmptyMessageRow(row))) {
    throw new AnalysisError("HISTORY_FORMAT", "購入履歴の作品を読み取れませんでした。DLsiteのページ形式を確認してください。");
  }

  const pager = queryAll(document, ".page_no a, .page_no [data-value], a[rel='next']")
    .filter((element) => !closest(element, '.disabled, .is-disabled, [aria-disabled="true"]'));
  const numbers = pager.map((element) => pageNumber(element, url))
    .filter((number) => Number.isSafeInteger(number) && number > 0);
  const hasNext = pager.some((element) => {
    const number = pageNumber(element, url);
    return (number !== null && number > page)
      || ((attribute(element, "href") !== null || attribute(element, "data-value") !== null)
        && /^(?:次(?:へ|のページ)?|next|[>›»])$/iu.test(normalize(text(element))));
  });
  return {
    works,
    // 最終ページへのリンクしかない場合でも、中間ページを飛ばさず1ページずつ進める。
    nextPage: hasNext ? page + 1 : null,
    totalPages: numbers.length ? Math.max(page, ...numbers) : null,
  };
}

/** ジャンル欄のタグだけを抽出する。有効な作品のタグなしと、未知のページ形式を区別する。 */
export function parseTags(html, url) {
  const document = parseDocument(html);
  assertLoggedIn(document, url);
  const outline = query(document, "#work_outline");
  if (!outline) {
    const message = normalize(text(query(document, "#main_inner, main") ?? query(document, "title")));
    if (/(?:作品|商品|ページ).{0,20}(?:見つかりません|存在しません|販売終了|販売を終了)/u.test(message)) {
      throw new AnalysisError("WORK_UNAVAILABLE", "販売終了などにより作品情報を取得できませんでした。");
    }
    throw new AnalysisError("WORK_FORMAT", "作品のタグを読み取れませんでした。DLsiteの作品ページの形式を確認してください。");
  }
  // 作品の詳細表に限定し、声優・容量・おすすめ作品などのリンクを混ぜない。
  const genreRows = queryAll(outline, "tr")
    .filter((row) => /^(?:ジャンル|genre)$/iu.test(normalize(text(query(row, "th")))));
  const anchors = genreRows.length
    ? genreRows.flatMap((row) => queryAll(row, "td a"))
    : queryAll(outline, '.main_genre a[href*="/genre/"]');
  return [...new Set(anchors.map((anchor) => normalize(text(anchor))).filter(Boolean))];
}
