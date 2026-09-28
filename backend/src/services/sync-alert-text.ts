// ============================================================
// LỜI CẢNH BÁO LỆCH TỒN CHO SELLER — nói việc cần làm, giấu kỹ thuật
//
// Anh Trung 05/09: "Phần báo lỗi này đọc rối quá. Nói đơn giản là phải làm gì
// thôi". Mọi cảnh báo InventorySyncAlert đi qua đây: dòng 1 = chuyện gì + cần
// làm gì (tiếng người), dòng 2 (sau "\n") = chi tiết kỹ thuật để em tra khi
// cần — UI hiện dòng 2 nhỏ, mờ, gập lại.
//
// 28/09 (khách Hi.Bé gặp TikTok 105005 "not been granted any access scope"):
// thêm loại "scope" = SÀN CHƯA CẤP QUYỀN cho app Hubsell (khác "auth" = gian
// mất kết nối). Anh chốt 28/09 bật scope Product Modify, nhưng console TikTok
// CHẶN đổi scope khi app đang xét duyệt ("Ứng dụng đang trong quá trình đánh
// giá") → câu hiện tại = giai đoạn CHỜ (sửa tay trên Seller Center). Khi scope
// bật xong: đổi câu thành "Kênh bán → Kết nối lại gian" (TikTok: đổi scope app
// thì gian phải ủy quyền lại). Kèm NHÃN NGẮN (`shortReason`)
// ≤ 1 dòng để banner in cạnh từng SKU / trên tiêu đề khi mọi SKU cùng lý do.
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
  | "scope"
  | "auth"
  | "promotion"
  | "not-found"
  | "unknown";

/** Nhận diện nguyên nhân từ lỗi thô (Shopee/Lazada/TikTok trả tiếng Anh, mã lỗi). */
export function classifyStockPushFailure(raw: string): FailureKind {
  const s = raw.toLowerCase();
  if (/multi warehouse|location id|location_id/.test(s)) return "multi-warehouse";
  if (/rate limit|error_rate_limit|too many requests|retry next second|901/.test(s))
    return "rate-limit";
  // Thiếu QUYỀN của app (TikTok 105005 "has not been granted any access scope")
  // phải bắt TRƯỚC "auth": câu lỗi TikTok có chữ "access token" nên rơi vào
  // auth sẽ khuyên "kết nối lại gian" — sai, kết nối lại không thêm được quyền.
  if (/105005|access scope|not been granted|scope required|insufficient scope/.test(s))
    return "scope";
  if (/access_token|refresh_token|invalid_access|error_auth|error_permission|unauthorized|token|uỷ quyền|ủy quyền|permission/.test(s))
    return "auth";
  if (/promotion|campaign|flash sale|reserved|khuyến mãi/.test(s)) return "promotion";
  if (/not found|not exist|item_not_found|invalid item|deleted|unlist|error_item/.test(s))
    return "not-found";
  return "unknown";
}

/**
 * NHÃN NGẮN cho seller — một dòng, không tên gian/SKU (banner tự ghép), không
 * mã lỗi. Dùng cạnh từng SKU hoặc làm tiêu đề khi mọi cảnh báo cùng lý do.
 */
export function shortStockPushReason(kind: FailureKind): string {
  switch (kind) {
    case "multi-warehouse":
      return "Gian có nhiều kho — Hubsell tự nhận diện kho và đẩy lại";
    case "rate-limit":
      return "Sàn giới hạn lượt gọi — hệ thống tự thử lại, không cần làm gì";
    case "scope":
      return "Sàn chưa cấp cho Hubsell quyền sửa tồn (đang chờ sàn duyệt) — tạm sửa tồn trên Seller Center";
    case "auth":
      return "Gian mất kết nối — vào Kênh bán kết nối lại gian";
    case "promotion":
      return "SKU đang khuyến mãi giữ chỗ — sàn không cho hạ tồn";
    case "not-found":
      return "Sàn không còn SKU này (đã xóa/ẩn)";
    default:
      return "Sàn từ chối, chưa rõ lý do — bấm Đẩy lại";
  }
}

/**
 * LỖI ĐỒNG BỘ ĐƠN (Channel.lastSyncError) → câu cho chủ shop, hoặc null nếu chưa
 * nhận diện được (bên gọi in lỗi thô). 28/09: gian "Shopee 321947895" 3 nhịp
 * lỗi `error_kyc_auth` liên tiếp — thẻ Trung tâm điều hành in nguyên câu tiếng
 * Anh của Shopee, khách không biết phải làm gì.
 */
export function humanizeOrderSyncError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/error_kyc_auth|seller registration/.test(s))
    return "Shopee chưa cho ứng dụng đọc đơn vì gian chưa hoàn tất đăng ký người bán (KYC) trên Seller Center. Hoàn tất đăng ký rồi vào Kênh bán → kết nối lại gian.";
  if (/105005|access scope|not been granted|scope required|insufficient scope/.test(s))
    return "Sàn chưa cấp cho Hubsell quyền cần thiết (đang chờ sàn duyệt) — không cần làm gì, Hubsell sẽ nhắc kết nối lại gian khi có quyền.";
  if (/invalid_access_token|invalid_token|token expired|refresh_token|error_auth|unauthorized|105002|IllegalAccessToken/i.test(raw))
    return "Gian mất kết nối với sàn — vào Kênh bán kết nối lại gian.";
  if (/rate limit|error_rate_limit|too many requests|http 429|901/.test(s))
    return "Sàn đang giới hạn lượt gọi — hệ thống tự thử lại ở nhịp sau, không cần làm gì.";
  if (/error_internal|system busy|internal error|36009003|timeout|econnreset|fetch failed/.test(s))
    return "Sàn đang chập chờn — hệ thống tự thử lại ở nhịp sau, không cần làm gì.";
  return null;
}

/** Nhãn ngắn suy từ message đã lưu ("dòng 1\nlỗi thô"): đọc lỗi thô ở cuối. */
export function shortReasonFromMessage(message: string): string {
  const lines = message.split("\n");
  const raw = lines.length > 1 ? lines.slice(1).join("\n") : message;
  return shortStockPushReason(classifyStockPushFailure(raw));
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
    case "scope":
      line = `Sàn chưa cấp cho Hubsell quyền sửa tồn trên gian "${f.shopName}" nên ${sku} chưa đẩy được${num}. Hubsell đang chờ sàn duyệt quyền này; tạm sửa tồn trên Seller Center, có quyền Hubsell sẽ nhắc bạn kết nối lại gian.`;
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
      : kind === "scope"
        ? `Sàn chưa cấp cho Hubsell quyền cần thiết trên gian "${shopName}" (đang chờ sàn duyệt). Tạm thao tác trên Seller Center; có quyền Hubsell sẽ nhắc bạn kết nối lại gian.`
        : kind === "rate-limit"
          ? `Sàn đang giới hạn lượt gọi với gian "${shopName}". Không cần làm gì — hệ thống tự thử lại.`
          : `Gian "${shopName}" đang không đồng bộ được với sàn. Thử "Sync ngay toàn bộ" trong Cài đặt đồng bộ; vẫn lỗi thì kết nối lại gian ở Kênh bán.`;
  return `${line}\n${raw}`;
}
