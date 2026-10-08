/** DLsiteとXの応答をローカルHTTPSで再現し、実サービスに触れずに拡張の通信を検証する。 */
import { createServer } from "node:https";
import { createHash, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fixture, tagsByWork, workHtml, withPageDecorations } from "../helpers.js";

/** 毎回空きポートを使い、テスト用の名前解決・証明書設定をブラウザ起動引数として返す。 */
export async function createMockDlsite() {
  const [key, cert] = await Promise.all([
    readFile(new URL("../fixtures/test-key.pem", import.meta.url)),
    readFile(new URL("../fixtures/test-cert.pem", import.meta.url)),
  ]);
  // 実サービスに使わない公開テスト鍵。この証明書の公開鍵だけをテストブラウザで許可する。
  const spki = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
  const fingerprint = createHash("sha256").update(spki).digest("base64");
  let options = { loggedIn: true, failWork: false, delayed: false, empty: false, loginMarkup: false, comipo: false };
  const requests = [];
  const errors = [];
  const server = createServer({ key, cert }, async (request, response) => {
    try {
      const url = new URL(request.url, `https://${request.headers.host}`);
      requests.push({ url: url.href, cookie: request.headers.cookie ?? "" });
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      if (url.hostname === "x.com" && url.pathname === "/intent/tweet") {
        response.end("<title>投稿画面</title><h1>ツイートを編集</h1>");
      } else if (url.hostname === "login.dlsite.com") {
        response.end('<form><input type="password"></form>');
      } else if (!options.loggedIn || !request.headers.cookie?.includes("test-session=mock-login")) {
        // ChromeがCookieを送信したことも確認し、未ログイン時の遷移を再現する。
        response.writeHead(302, { Location: "https://login.dlsite.com/login" });
        response.end();
      } else if (url.pathname.includes("/mypage/userbuy/")) {
        const page = url.pathname.match(/\/page\/(\d+)/u)?.[1];
        let html = await fixture(options.empty ? "empty-history.html" : `history-${page}.html`);
        if (options.comipo && !options.empty && page === "3") {
          // 旧comicと現在も取得できるbooksを同じ購入履歴に混ぜ、BJ作品の一括除外を検知する。
          html = html.replace("</tbody>", '<tr><td class="work_name"><a href="/comic/work/=/product_id/BJ03032468.html">comipoへ移動した作品</a></td><td class="buy_date">2026/03/01</td></tr></tbody>');
        }
        response.end(withPageDecorations(html));
      } else {
        const id = url.pathname.match(/product_id\/([^/.]+)/u)?.[1].toUpperCase();
        if (options.delayed) await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
        if (url.pathname.startsWith("/comic/")) {
          // 実サイトと同じ外部への302転送。修正前はここでCSP違反になり集計が止まる。
          response.writeHead(302, { Location: `https://www.comipo.app/product/${id}?locale=ja_JP` });
          response.end();
        } else if (id === "RJ000005") {
          response.writeHead(404);
          response.end("Not found");
        } else if (options.failWork) {
          response.writeHead(403);
          response.end("Forbidden");
        } else {
          response.end(withPageDecorations(options.loginMarkup ? '<form><input type="password"></form>' : workHtml(tagsByWork[id])));
        }
      }
    } catch (error) {
      errors.push(error.message);
      if (!response.headersSent) response.writeHead(500);
      response.end("Fixture error");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  server.unref();
  return {
    requests, errors,
    // テスト専用ブラウザの名前解決だけを変え、指定したホスト以外への通信先は解決させない。
    args: [
      `--host-resolver-rules=MAP www.dlsite.com:443 127.0.0.1:${port}, MAP login.dlsite.com:443 127.0.0.1:${port}, MAP x.com:443 127.0.0.1:${port}, MAP * ~NOTFOUND`,
      `--ignore-certificate-errors-spki-list=${fingerprint}`,
      "--no-proxy-server",
    ],
    configure(next) { options = { ...options, ...next }; },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
