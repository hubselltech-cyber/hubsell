// ============================================================
// MỐC GIAO THÀNH CÔNG khi sàn KHÔNG trả trường "thời điểm giao" riêng (Shopee,
// Lazada — TikTok có delivery_time nên không dùng hàm này).
//
// Trước 30/09/2026 mốc này ghi bằng GIỜ ĐỒNG BỘ (`new Date()`): đơn nạp lịch sử
// 90 ngày mang ngày nạp, lệch thật tới cả quý. Anh Trung chốt tờ khai thuế tính
// theo ngày giao thành công → mốc phải bám số của sàn.
//
// Dùng thời điểm sàn CẬP NHẬT đơn lần cuối tại lúc Hubsell thấy đơn ở trạng thái
// đã giao lần đầu. Đây là XẤP XỈ (có thể muộn hơn giờ giao thật nếu sau khi giao
// đơn còn đổi trạng thái), nhưng là số của sàn và không phụ thuộc lúc nào mình
// đồng bộ. Thiếu hoặc sai (tương lai / không đọc được) → rơi về giờ đồng bộ.
// ============================================================

export function deliveredAtFromPlatform(
  platformUpdatedAt: Date | null | undefined,
  now: Date = new Date()
): Date {
  if (!platformUpdatedAt) return now;
  const t = platformUpdatedAt.getTime();
  if (!Number.isFinite(t) || t <= 0 || t > now.getTime()) return now;
  return platformUpdatedAt;
}
