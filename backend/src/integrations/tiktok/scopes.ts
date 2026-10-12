// ============================================================
// PHẠM VI (SCOPE) APP TIKTOK — mốc bật thêm quyền và hệ quả với token cũ
//
// TikTok cấp token theo đúng bộ phạm vi app đang bật LÚC gian ủy quyền. Bật
// thêm phạm vi trên Partner Center về sau thì token cũ KHÔNG tự có quyền mới
// (làm mới token cũng không), gian phải đi lại luồng "Kết nối lại gian".
//
// 12/10/2026 14:30 VN: app Hubsell (service 7685556109353699080) bật
// Product Modify (seller.product.write) — quyền mà POST
// /product/202309/products/{id}/inventory/update đòi (lỗi 105005 nếu thiếu).
// Trước mốc này đẩy tồn TikTok chưa bao giờ chạy được trên prod.
// ============================================================

/** Thời điểm app Hubsell bật phạm vi Product Modify trên Partner Center. */
export const TIKTOK_PRODUCT_WRITE_SCOPE_AT = new Date("2026-10-12T07:30:00.000Z");

/**
 * Gian TikTok có cần ủy quyền lại để ĐẨY TỒN không: token cấp trước mốc bật
 * Product Modify (hoặc chưa ghi mốc — gian nối trước khi có cột authorizedAt)
 * thì thiếu quyền. Sàn khác luôn false.
 */
export function tiktokNeedsReauthForStockPush(channel: {
  channelName: string;
  authorizedAt: Date | null;
}): boolean {
  if (channel.channelName !== "TIKTOK") return false;
  if (!channel.authorizedAt) return true;
  return channel.authorizedAt.getTime() < TIKTOK_PRODUCT_WRITE_SCOPE_AT.getTime();
}
