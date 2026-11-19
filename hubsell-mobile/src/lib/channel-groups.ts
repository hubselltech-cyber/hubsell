import type { ChannelName } from "../types/api";

/**
 * Thứ tự sàn dùng chung cho mọi chỗ liệt kê gian theo sàn (màn Gian hàng, hộp Bộ lọc của
 * Đơn hàng) — trùng thứ tự hàng chip sàn ở đầu màn Đơn hàng: Shopee · TikTok · Lazada, Offline
 * đứng cuối vì không phải sàn.
 */
export const PLATFORM_ORDER: ChannelName[] = ["SHOPEE", "TIKTOK", "LAZADA", "OFFLINE"];

export type PlatformGroup<T> = { platform: string; rows: T[] };

/**
 * Xếp danh sách gian thành cây hai tầng SÀN → GIAN (anh Trung 19/11: "sắp xếp luôn bộ lọc dạng
 * cha-con, vẫn liệt kê hết các shop ra nhưng theo thứ tự Sàn - shop").
 *  - Sàn theo PLATFORM_ORDER; sàn lạ (backend thêm sàn mới mà app chưa biết) xếp sau cùng,
 *    theo thứ tự chữ cái — không bao giờ làm rơi gian.
 *  - Gian trong một sàn xếp theo tên, kiểu tiếng Việt (không phân biệt hoa thường, "Shop 2"
 *    đứng trước "Shop 10") — người có 6–10 gian dò tên bằng mắt.
 *  - Sàn không có gian nào thì không sinh nhóm.
 */
export function groupChannelsByPlatform<T extends { channelName: string; shopName: string }>(
  channels: readonly T[]
): PlatformGroup<T>[] {
  const byPlatform = new Map<string, T[]>();
  for (const c of channels) {
    const list = byPlatform.get(c.channelName);
    if (list) list.push(c);
    else byPlatform.set(c.channelName, [c]);
  }
  const known = PLATFORM_ORDER.filter((p) => byPlatform.has(p)) as string[];
  const unknown = [...byPlatform.keys()].filter((p) => !known.includes(p)).sort();
  return [...known, ...unknown].map((platform) => ({
    platform,
    rows: [...(byPlatform.get(platform) ?? [])].sort((a, b) =>
      a.shopName.localeCompare(b.shopName, "vi", { sensitivity: "base", numeric: true })
    ),
  }));
}
