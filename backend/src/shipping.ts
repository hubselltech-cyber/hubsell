import { Carrier, ChannelName } from "@prisma/client";

/**
 * DỮ LIỆU VẬN CHUYỂN CHO ĐƠN GIẢ LẬP
 *
 * Hubsell chưa kết nối API thật tới Shopee/TikTok/Lazada, nên hãng vận chuyển
 * và mã vận đơn của đơn giả lập được sinh ở đây. Khi có tích hợp thật, chỉ cần
 * thay chỗ gọi các hàm này bằng dữ liệu sàn trả về — phần còn lại của hệ thống
 * (lọc theo hãng, in phiếu giao) không phải sửa gì.
 */

/** Nhãn tiếng Việt của từng hãng, dùng chung cho bộ lọc và phiếu in. */
export const CARRIER_LABEL: Record<Carrier, string> = {
  SPX: "SPX Express",
  GHTK: "Giao Hàng Tiết Kiệm",
  GHN: "Giao Hàng Nhanh",
  JT: "J&T Express",
  VIETTEL_POST: "Viettel Post",
  NINJA_VAN: "Ninja Van",
  BEST: "BEST Express",
  KHAC: "Hãng khác",
};

/** Mỗi sàn có nhóm hãng vận chuyển hay dùng riêng. */
const CARRIERS_BY_CHANNEL: Record<ChannelName, Carrier[]> = {
  SHOPEE: [Carrier.SPX, Carrier.GHTK, Carrier.JT, Carrier.GHN],
  TIKTOK: [Carrier.BEST, Carrier.JT, Carrier.NINJA_VAN, Carrier.GHTK],
  LAZADA: [Carrier.NINJA_VAN, Carrier.VIETTEL_POST, Carrier.GHN, Carrier.JT],
  OFFLINE: [Carrier.KHAC],
};

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export function randomCarrierFor(channelName: ChannelName): Carrier {
  return pick(CARRIERS_BY_CHANNEL[channelName] ?? [Carrier.KHAC]);
}

/** Mã vận đơn dạng "SPX" + 11 chữ số, giống định dạng thật của các hãng. */
export function randomTrackingCode(): string {
  const digits = Array.from({ length: 11 }, () =>
    Math.floor(Math.random() * 10)
  ).join("");
  return `VN${digits}`;
}

/** Số điện thoại Việt Nam giả lập (đầu số di động thật). */
export function randomPhone(): string {
  const prefixes = ["032", "033", "034", "035", "036", "037", "038", "039",
                    "070", "076", "077", "078", "079",
                    "081", "082", "083", "084", "085", "086", "088", "089",
                    "090", "091", "093", "094", "096", "097", "098"];
  const rest = Array.from({ length: 7 }, () =>
    Math.floor(Math.random() * 10)
  ).join("");
  return `${pick(prefixes)}${rest}`;
}
