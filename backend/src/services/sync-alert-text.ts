// ============================================================
// LỜI CẢNH BÁO LỆCH TỒN CHO SELLER — nói việc cần làm, giấu kỹ thuật
//
// Anh Trung 05/09: "Phần báo lỗi này đọc rối quá. Nói đơn giản là phải làm gì
// thôi". Mọi cảnh báo InventorySyncAlert đi qua đây: dòng 1 = chuyện gì + cần
// làm gì (tiếng người), dòng 2 (sau "\n") = chi tiết kỹ thuật để em tra khi
// cần — UI hiện dòng 2 nhỏ, mờ, gập lại.
// ============================================================

export interface StockPushFailure {
  /** Lỗi thô từ sàn/hệ thống. */
  raw: string;
  shopName: string;
  channelSku?: string;
  /** Số Hubsell muốn sàn giữ (có thể bán). */
  expected?: number;
}

export type FailureKind =
  | "multi-warehouse"
  | "rate-limit"
  | "auth"
  | "promotion"
  | "not-found"
  | "unknown";

/** Nhận diện nguyên nhân từ lỗi thô (Shopee/Lazada trả tiếng Anh, mã lỗi). */
export function classifyStockPushFailure(raw: string): FailureKind {
  const s = raw.toLowerCase();
  if (/multi warehouse|location id|location_id/.test(s)) return "multi-warehouse";
  if (/rate limit|error_rate_limit|too many requests|retry next second|901/.test(s))
    return "rate-limit";
  if (/access_token|refresh_token|invalid_access|error_auth|error_permission|unauthorized|token|uỷ quyền|ủy quyền|permission/.test(s))
    return "auth";
  if (/promotion|campaign|flash sale|reserved|khuyến mãi/.test(s)) return "promotion";
  if (/not found|not exist|item_not_found|invalid item|deleted|unlist|error_item/.test(s))
    return "not-found";
  return "unknown";
}

/**
 * Lời cho seller theo nguyên nhân. Trả `message` = "dòng 1\nchi tiết".
 * Tiêu chí: câu đầu ≤ 2 mệnh đề, có động từ hành động; không mã lỗi ở dòng 1.
 */
export function describeStockPushFailure(f: StockPushFailure): string {
  const kind = classifyStockPushFailure(f.raw);
  const sku = f.channelSku ? `SKU ${f.channelSku}` : "tồn kho";
  const num = f.expected !== undefined ? ` (${f.expected})` : "";

  let line: string;
  switch (kind) {
    case "multi-warehouse":
      line = `Shopee báo gian "${f.shopName}" có nhiều kho nên chưa nhận số tồn${num} cho ${sku}. Hubsell sẽ tự nhận diện kho và đẩy lại ở lượt sau; nếu cảnh báo còn treo, bấm "Đẩy lại".`;
      break;
    case "rate-limit":
      line = `Sàn đang giới hạn lượt gọi, chưa đẩy được ${sku} lên "${f.shopName}". Không cần làm gì — hệ thống tự thử lại; còn treo sau 15 phút thì bấm "Đẩy lại".`;
      break;
    case "auth":
      line = `Gian "${f.shopName}" mất kết nối nên không đẩy được tồn. Vào Kênh bán → kết nối lại gian, rồi bấm "Đẩy lại".`;
      break;
    case "promotion":
      line = `${sku} trên "${f.shopName}" đang trong chương trình khuyến mãi giữ chỗ, sàn không cho hạ tồn xuống${num}. Sửa tồn trực tiếp trên Seller Centre hoặc chờ khuyến mãi kết thúc.`;
      break;
    case "not-found":
      line = `Sàn không còn thấy ${sku} trên "${f.shopName}" (đã xóa/ẩn). Vào tab Chờ liên kết bấm "Đồng bộ từ sàn" rồi gỡ nối SKU này nếu không bán nữa.`;
      break;
    default:
      line = `Chưa đẩy được ${sku} lên "${f.shopName}", tồn trên sàn có thể đang khác Hubsell${num}. Bấm "Đẩy lại"; vẫn lỗi thì sửa tồn trực tiếp trên Seller Centre.`;
  }
  return `${line}\n${f.raw}`;
}

/** Lời cho lỗi cấp GIAN (không lấy được token, sự kiện webhook hỏng...). */
export function describeChannelFailure(shopName: string, raw: string): string {
  const kind = classifyStockPushFailure(raw);
  const line =
    kind === "auth"
      ? `Gian "${shopName}" mất kết nối với sàn nên tồn kho và đơn hàng không đồng bộ. Vào Kênh bán → kết nối lại gian.`
      : kind === "rate-limit"
        ? `Sàn đang giới hạn lượt gọi với gian "${shopName}". Không cần làm gì — hệ thống tự thử lại.`
        : `Gian "${shopName}" đang không đồng bộ được với sàn. Thử "Sync ngay toàn bộ" trong Cài đặt đồng bộ; vẫn lỗi thì kết nối lại gian ở Kênh bán.`;
  return `${line}\n${raw}`;
}
