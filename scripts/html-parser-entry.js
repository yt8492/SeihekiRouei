/** vendor.mjsの生成元。HTML解析・固定セレクタ検索・文字列取得の機能を同梱する。 */
export { parseDocument } from "htmlparser2";
export { selectOne, selectAll, is } from "css-select";
import { DomUtils } from "htmlparser2";
export const textContent = DomUtils.textContent;
