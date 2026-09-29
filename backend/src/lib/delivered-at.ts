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

/**
 * Mốc giao cần GHI khi đồng bộ thấy đơn ở trạng thái đã giao; null = giữ nguyên.
 *   - Chưa có mốc → ghi mốc của sàn.
 *   - Đã có mốc nhưng MUỘN hơn mốc sàn vừa báo → kéo về mốc sàn. Mốc cũ ghi bằng
 *     giờ đồng bộ luôn ≥ thời điểm sàn cập nhật đơn, nên lấy số nhỏ hơn chỉ làm
 *     mốc chính xác dần lên, không bao giờ lùi trước lúc sàn báo giao. Nhờ vậy
 *     chỉ cần đồng bộ lại là đơn cũ tự sửa (scripts/fix-delivered-at.ts).
 * Lệch dưới 1 phút coi như bằng nhau để không ghi DB vô ích.
 */
export function correctedDeliveredAt(
  stored: Date | null,
  platformUpdatedAt: Date | null | undefined,
  now: Date = new Date()
): Date | null {
  const fromPlatform = deliveredAtFromPlatform(platformUpdatedAt, now);
  if (!stored) return fromPlatform;
  return stored.getTime() - fromPlatform.getTime() > 60_000 ? fromPlatform : null;
}

export function deliveredAtFromPlatform(
  platformUpdatedAt: Date | null | undefined,
  now: Date = new Date()
): Date {
  if (!platformUpdatedAt) return now;
  const t = platformUpdatedAt.getTime();
  if (!Number.isFinite(t) || t <= 0 || t > now.getTime()) return now;
  return platformUpdatedAt;
}
