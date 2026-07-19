/**
 * BỘ LỌC GIAN HÀNG DÙNG CHUNG
 *
 * Mọi API báo cáo đều nhận cùng một query param `?channelId=<id>` — tức là lọc
 * theo GIAN HÀNG cụ thể, không phải theo sàn. Một sàn có thể có nhiều gian
 * ("Shop Phụ Kiện B" và "Shopee" đều nằm trên Shopee), nên gom theo tên sàn sẽ
 * cộng dồn doanh thu của hai gian làm một và chủ shop không biết gian nào lãi.
 *
 * Hàm trả về mảnh `where` cho quan hệ `channel` của Order, đã bao gồm cả giới
 * hạn kênh của nhân viên — nơi gọi chỉ việc trải vào:
 *   where: { channel: channelScope(req), ... }
 */

import type { AuthRequest } from "./auth";

export interface ChannelScope {
  userId: string;
  id?: string | { in: string[] };
}

/**
 * Phạm vi kênh mà request này được phép xem, sau khi áp bộ lọc `?channelId=`.
 *
 * Nhân viên bị giới hạn kênh: nếu họ lọc một gian không nằm trong danh sách
 * được gán thì kết quả phải RỖNG, chứ không được âm thầm mở rộng ra toàn shop.
 */
export function channelScope(req: AuthRequest): ChannelScope {
  const channelId =
    typeof req.query.channelId === "string" ? req.query.channelId.trim() : "";
  const scope: ChannelScope = { userId: req.ownerId! };

  if (req.allowedChannelIds) {
    scope.id = channelId
      ? { in: req.allowedChannelIds.filter((id) => id === channelId) }
      : { in: req.allowedChannelIds };
  } else if (channelId) {
    scope.id = channelId;
  }

  return scope;
}

/** Có đang lọc về một gian hàng cụ thể hay không (để chú thích trên báo cáo). */
export function hasChannelFilter(req: AuthRequest): boolean {
  return typeof req.query.channelId === "string" && req.query.channelId.trim() !== "";
}
