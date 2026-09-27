// ============================================================
// XÓA BỘ ĐỆM PHỤ THUỘC GIÁ VỐN (28/09/2026)
//
// Trợ lý quảng cáo nhớ biên lãi 30 ngày theo gian tới 30 phút (ads-insights,
// chống egress) và hòa vốn TikTok 45 giây. Nhập giá vốn / áp cho đơn cũ xong
// mà không xóa các bộ đệm này thì bảng ROAS hòa vốn vẫn báo "chưa có giá vốn"
// tới nửa tiếng — anh Trung 28/09 tưởng nút không chạy.
//
// Sổ đăng ký đơn giản để lib/cost-price.ts không import ngược vào module ads
// (ads-insights → routes/finance → cost-price → ads-insights là vòng lặp).
// ============================================================

type Invalidator = (channelIds: string[]) => void;

const invalidators = new Set<Invalidator>();

/** Module giữ bộ đệm theo gian đăng ký hàm xóa của mình lúc nạp module. */
export function registerCostCacheInvalidator(fn: Invalidator): void {
  invalidators.add(fn);
}

/** Xóa mọi bộ đệm phụ thuộc giá vốn của các gian này. Không ném lỗi ra ngoài. */
export function invalidateCostCaches(channelIds: string[]): void {
  if (channelIds.length === 0) return;
  for (const fn of invalidators) {
    try {
      fn(channelIds);
    } catch {
      // bộ đệm chỉ là tối ưu đọc — hỏng thì bỏ qua, không chặn ghi giá vốn
    }
  }
}
