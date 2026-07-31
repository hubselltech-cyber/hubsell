/**
 * BỘ LỌC GIAN HÀNG DÙNG CHUNG
 *
 * Mọi API báo cáo nhận cùng một cặp query param, tương ứng với bộ lọc phân tầng
 * hai cấp trên giao diện:
 *
 *   (không có gì)        → toàn bộ gian hàng trong tầm nhìn của người đang xem
 *   ?channelName=SHOPEE  → mọi gian hàng trên sàn Shopee
 *   ?channelId=<id>      → đúng một gian hàng
 *
 * channelId khi có mặt thì thắng channelName: nó cụ thể hơn, và nếu hai tham số
 * mâu thuẫn (id thuộc sàn khác) thì phép giao bên dưới tự cho ra kết quả rỗng —
 * đúng hơn là đoán xem người dùng muốn gì.
 *
 * Hàm trả về mảnh `where` cho quan hệ `channel` của Order, đã bao gồm cả giới
 * hạn gian hàng của nhân viên — nơi gọi chỉ việc trải vào:
 *   where: { channel: channelScope(req), ... }
 */

import { ChannelName } from "@prisma/client";
import type { AuthRequest } from "./auth";

export interface ChannelScope {
  userId: string;
  id?: string | { in: string[] };
  channelName?: ChannelName;
}

/** Đọc ?channelName= và chỉ nhận giá trị có thật trong enum, tránh lọc bừa.
 *  Export cho nơi cần phân biệt lọc CẤP SÀN với lọc đích danh gian (luật tính
 *  khoản thu/chi chung theo sàn của Báo cáo dòng tiền). */
export function readChannelName(req: AuthRequest): ChannelName | undefined {
  const raw =
    typeof req.query.channelName === "string"
      ? req.query.channelName.trim().toUpperCase()
      : "";
  return raw in ChannelName ? (raw as ChannelName) : undefined;
}

export function readChannelId(req: AuthRequest): string {
  return typeof req.query.channelId === "string"
    ? req.query.channelId.trim()
    : "";
}

/**
 * Phạm vi gian hàng mà request này được phép xem, sau khi áp bộ lọc.
 *
 * Nhân viên bị giới hạn gian: nếu họ lọc một gian không nằm trong danh sách được
 * phân công thì kết quả phải RỖNG, chứ không được âm thầm mở rộng ra toàn shop.
 * Lọc theo sàn cũng vậy — điều kiện channelName chỉ THU HẸP thêm danh sách được
 * phép, không bao giờ nới nó ra.
 */
export function channelScope(req: AuthRequest): ChannelScope {
  const channelId = readChannelId(req);
  const channelName = readChannelName(req);
  const scope: ChannelScope = { userId: req.ownerId! };

  if (req.allowedChannelIds) {
    scope.id = channelId
      ? { in: req.allowedChannelIds.filter((id) => id === channelId) }
      : { in: req.allowedChannelIds };
  } else if (channelId) {
    scope.id = channelId;
  }

  // Lọc theo sàn đứng cạnh giới hạn gian hàng: Prisma nối hai điều kiện bằng AND
  // nên nhân viên chọn "tất cả gian Shopee" vẫn chỉ ra được các gian Shopee mà
  // họ được phân công.
  if (channelName) scope.channelName = channelName;

  return scope;
}

/**
 * Có đang thu hẹp về một phần gian hàng hay không (để chú thích trên báo cáo).
 * Lọc theo sàn cũng tính: chi phí vận hành vẫn là của toàn shop trong cả hai trường hợp.
 */
export function hasChannelFilter(req: AuthRequest): boolean {
  return readChannelId(req) !== "" || readChannelName(req) !== undefined;
}
