/**
 * Dịch lỗi kỹ thuật từng gian (chat / đánh giá) sang tiếng người.
 *
 * Backend trả `message` là chuỗi lỗi thô của sàn (vd. Lazada
 * "im/session/list lỗi: InsufficientPermission — App does not have permission
 * to access this api"). Người bán không cần đọc tên endpoint; họ cần biết
 * "gian này tạm chưa dùng được tính năng, vì sao, có phải lỗi của mình không".
 * Chuỗi gốc giữ lại ở `detail` để hiện trong tooltip khi cần báo hỗ trợ.
 */
export interface HumanChannelError {
  /** Câu ngắn hiện trên màn hình. */
  text: string;
  /** Chuỗi lỗi gốc — đổ vào title/tooltip. */
  detail: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok Shop",
};

function guessPlatform(lower: string, channelName?: string): string {
  if (channelName && PLATFORM_LABEL[channelName]) return PLATFORM_LABEL[channelName];
  if (lower.includes("lazada")) return "Lazada";
  if (lower.includes("tiktok")) return "TikTok Shop";
  if (lower.includes("shopee")) return "Shopee";
  return "sàn";
}

export function humanizeChannelError(
  e: { shopName: string; message: string; channelName?: string },
  feature: "chat" | "reviews" = "chat"
): HumanChannelError {
  const raw = e.message ?? "";
  const lower = raw.toLowerCase();
  const platform = guessPlatform(lower, e.channelName);
  const what = feature === "chat" ? "hội thoại" : "đánh giá";
  const scope = feature === "chat" ? "tin nhắn" : "đánh giá";

  if (
    lower.includes("insufficientpermission") ||
    lower.includes("does not have permission") ||
    lower.includes("permission") ||
    lower.includes("forbidden") ||
    lower.includes("403")
  ) {
    return {
      text: `${e.shopName}: ${platform} chưa mở quyền ${scope} cho Hubsell — ${what} của gian này sẽ có khi sàn cấp quyền.`,
      detail: raw,
    };
  }
  if (
    lower.includes("token") ||
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("expired") ||
    lower.includes("hết hạn") ||
    lower.includes("ủy quyền") ||
    lower.includes("uỷ quyền")
  ) {
    return {
      text: `${e.shopName}: kết nối với ${platform} đã hết hạn — vào Kênh bán bấm Kết nối lại.`,
      detail: raw,
    };
  }
  if (lower.includes("rate") || lower.includes("429") || lower.includes("too many")) {
    return {
      text: `${e.shopName}: ${platform} đang giới hạn lượt gọi — ${what} sẽ tự tải lại sau ít phút.`,
      detail: raw,
    };
  }
  if (e.shopName === "Hệ thống") {
    return { text: `Không tải được ${what} lúc này — thử lại sau ít phút.`, detail: raw };
  }
  return {
    text: `${e.shopName}: chưa tải được ${what} từ ${platform} — hệ thống sẽ tự thử lại.`,
    detail: raw,
  };
}
