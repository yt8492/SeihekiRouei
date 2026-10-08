# SeihekiRouei

DLsiteにログイン済みのChromeで全購入履歴を取得し、購入作品が多い順にタグを表示するChrome拡張です。上位5つのタグを入力したXのツイート画面を開けます。

## Chromeに読み込む

Chrome 116以降で利用できます。

1. [最新のRelease](https://github.com/yt8492/SeihekiRouei/releases/latest)を開き、Assetsから **`SeihekiRouei-1.0.2.zip`** をダウンロードします。[1.0.2のZIPを直接ダウンロード](https://github.com/yt8492/SeihekiRouei/releases/download/1.0.2/SeihekiRouei-1.0.2.zip)することもできます。GitHubが自動で用意する「Source code」ではなく、拡張用のZIPを選んでください。
2. ZIPを解凍します。中にある **`extension` フォルダ**は、拡張を使用している間は削除や移動をせず、保存しておいてください。
3. Chromeで `chrome://extensions` を開き、「デベロッパーモード」を有効にします。
4. 「パッケージ化されていない拡張機能を読み込む」で、解凍した **`extension` フォルダ**を選択します。ビルドやNode.jsのインストールは不要です。
5. 同じChromeプロファイルでDLsiteにログインします。
6. 拡張のポップアップで「購入履歴を集計する」を押します。
7. 完了後に「上位5タグをツイートする」を押すと、Xの投稿画面が開きます。内容を編集し、X側で投稿してください。

## 集計の仕様

- 購入履歴の `type/all/start/all` を利用し、全種別・全期間を最終ページまで順に取得します。購入年月の手動指定は不要です。
- 購入履歴から得た作品URLの「ジャンル」欄をタグとして扱います。作品形式、声優、ファイル形式、おすすめ作品のタグは集計しません。
- 同じ作品IDは一度だけ数えます。同一作品内に同じタグが複数表示されても1作品として数えます。
- 作品数の降順で並べ、同数なら日本語のタグ名順に並べます。上位5つに加え、残りのタグもポップアップで展開できます。
- 「タグの除外」を開き、除外したいタグにチェックすると、ランキングとツイートからそのタグを外して順位を繰り上げます。タグ名は完全一致で判定し、購入作品数や元の集計件数は変更しません。チェックを外すか「除外をすべて解除」を押すと、再取得なしで元に戻せます。
- 除外設定は再集計・ポップアップの開き直し・Chromeの再起動後も引き継ぎます。今回の集計に含まれない保存済みの除外タグも、設定一覧から解除できます。すべてのタグを除外した場合はツイートボタンを表示しません。
- 販売終了、作品URLなし、HTTP 404/410などでタグを取得できない作品は、ポップアップに取得不可の件数を表示します。タグが登録されていない作品の件数は別に表示します。
- comipoへ移動した旧DLsiteの `comic` 作品は、外部への転送で集計全体が止まらないよう、通信前にタグ取得不可としてスキップします。購入作品数には含め、DLsite内の `books` 作品は引き続き集計します。
- ツイート文には上位5タグと各作品数、`#SeihekiRouei`を含めます。取得不可作品の注釈は付けません。
- 取得中のログイン切れ、通信エラー、ページ形式の不一致などでは集計を中止し、途中の結果からツイートできないようにします。ログインや通信環境を確認して再集計してください。
- 作品ページは順番に、各リクエストの間に最低600ミリ秒の間隔を空けて取得します。作品数が多いほど時間がかかります。混雑時は最大3回まで再試行し、サーバーの `Retry-After` を尊重します。
- ポップアップを閉じても集計は続きます。開き直すと進捗・結果を確認できます。「集計を中止」と「データを削除」も利用できます。

## データと権限

集計はChrome内で行います。DLsiteへのリクエストに既存のログインCookieを利用し、パスワードの入力やCookieを直接読み取る権限は要求しません。

作品ID・作品URL・タグ集計・進捗は `chrome.storage.session` に保持し、Chromeの再起動、拡張の無効化・再読み込みで消去されます。除外するタグ名だけは `chrome.storage.local` に保存して再起動後も引き継ぎます。外部の集計サーバーやChrome Syncには送信しません。「データを削除」で集計データと除外設定を両方削除できます。ツイートボタンを押すと、除外設定を反映した上位5タグの投稿文がXの投稿画面に渡ります。

必要な権限は以下です。

| 権限 | 用途 |
| --- | --- |
| `https://www.dlsite.com/*` | ログイン済みの購入履歴と作品ページを取得 |
| `https://login.dlsite.com/*` | ログイン画面へのリダイレクトを検知 |
| `storage` | セッション内の進捗・結果の保持と、端末内のタグ除外設定の保存 |
| `offscreen` | HTML解析用Workerの起動と、ポップアップを閉じた後の集計継続 |

DLsiteのHTMLに依存するため、サイト側の変更で取得できなくなる可能性があります。DLsite以外のサービスに移動した作品のタグは対象外です。取得できない作品も含め、全購入作品のタグを必ず復元できるわけではありません。

## 開発・検証

HTML解析には `htmlparser2` と `css-select` を拡張内に同梱し、DOMを持たないWorkerで実行します。取得HTMLをブラウザの `DOMParser` や `innerHTML` に渡さないため、ページ中のスタイル・スクリプト・画像などを適用せずに読み取ります。外部CDNからコードを読み込むことはありません。開発用の検証にはNode.js 22以降を使います。

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run package
```

`npm run build` はHTMLパーサーの同梱ファイルとライセンス表記を再生成し、ManifestとJavaScript構文を検証して読み込み用の `dist` フォルダを作成します。同梱ファイルはリポジトリにも含めるため、`extension` は引き続きビルドなしで読み込めます。`extension` と `dist` のどちらもChromeで読み込めます。

`npm run package` はビルド後、`release/SeihekiRouei-<バージョン>.zip` を作成します。ZIPには読み込み用の `extension` フォルダと同梱ライブラリのライセンスを含め、開発用コードやテストデータは含めません。配布物の作成には `zip` コマンドが必要です。

配布ZIPを検証する場合は、解凍した `extension` フォルダの絶対パスを `SEIHEKI_EXTENSION_PATH` に指定して `npm run test:e2e` を実行します。

単体テストではページ巡回・タグ抽出・重複除去・取得失敗・再開・タグ除外後の順位と投稿文・URLエンコードを確認します。E2EテストではChromiumに実際のManifest V3拡張を読み込み、テストブラウザの名前解決をローカルHTTPSフィクスチャサーバーへ向けます。Cookie送信、ポップアップの再表示、集計結果、投稿画面への遷移、未ログイン・通信エラー・中止・再集計・データ削除に加え、除外設定の変更・解除とブラウザ再起動後の保持を検証します。`tests/fixtures/test-key.pem` はこのサーバー専用の公開テスト鍵で、実サービスの認証情報ではありません。システムのDNS設定や証明書の信頼設定は変更しません。E2Eテストは実際の購入履歴やXへの投稿を利用しません。

現在の公開作品ページの「ジャンル」欄と、未ログイン時にviviON IDの画面へ移動する挙動は確認済みです。ログイン済みアカウントの実購入履歴を用いた全件取得は、この環境では未検証です。

## ファイルの役割

手書きのJavaScript・HTML・CSSとテストには、日本語で役割や判断理由をコメントしています。コメントを記述できないJSONや、形式を維持する必要がある証明書の用途は次のとおりです。

| ファイル | 用途・編集方法 |
| --- | --- |
| `extension/manifest.json` | Manifest V3の拡張名、起動ファイル、Chrome 116以降の指定、権限、CSPを定義します。通信先をDLsiteに限定し、インラインスタイルや外部コードを許可しません。 |
| `package.json` | 開発用コマンドと依存バージョンを定義します。`vendor`でパーサーを同梱し、`build`で配布物を生成、`test`で単体テスト、`test:e2e`でブラウザ検証、`package`でRelease用ZIPを作成します。 |
| `package-lock.json` | npmが生成する依存関係の固定情報です。手動編集せず、依存変更時にnpmで更新します。 |
| `extension/lib/vendor/html-parser.js` | HTML解析ライブラリの生成物です。`scripts/html-parser-entry.js`と`scripts/vendor.mjs`を編集し、`npm run vendor`または`npm run build`で再生成します。 |
| `extension/third-party-licenses.txt` | 同梱されたライブラリのライセンス原文をまとめた生成物です。`scripts/vendor.mjs`から再生成し、原文は直接編集しません。 |
| `tests/fixtures/test-key.pem` / `test-cert.pem` | ローカルHTTPSテストサーバーだけで使う公開テスト鍵と証明書です。実サービスの認証や通信には利用しません。 |
| `dist/` | `extension/`から作る配布用のコピーです。直接編集せず、`npm run build`で更新します。 |
| `release/` | GitHub Releaseへ添付するZIPの生成先です。`scripts/package.mjs`で作成し、Gitには含めません。 |

## 参考

- [SeiyokuImashime](https://github.com/yt8492/SeiyokuImashime/tree/master): 全期間・全種別の購入履歴を巡回する方式を参考に、Manifest V3向けに新規実装。
- [Chrome Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen): HTML解析Workerを動かすoffscreen document。
- [ChromeのStorageとCookie](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies): 拡張からのログインCookie付きリクエスト。
- [X Web Intents](https://docs.x.com/x-for-websites/web-intents/overview): 投稿文を入力したツイート画面を開く仕組み。
