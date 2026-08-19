import { Carrier, ChannelName, Prisma } from "@prisma/client";

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

/**
 * Đoán enum Carrier từ TÊN HÃNG dạng chữ mà sàn trả về (Shopee shipping_carrier
 * "SPX Express", Lazada shipment_provider "Ninja Van VN"...). Khớp lỏng theo
 * chuỗi con vì mỗi sàn/mỗi nước viết một kiểu; không nhận ra thì KHAC — thà
 * nhãn chung còn hơn null làm bộ lọc theo hãng bỏ sót đơn.
 */
export function carrierFromName(name?: string | null): Carrier | null {
  const s = (name ?? "").toLowerCase();
  if (!s.trim()) return null;
  if (s.includes("spx") || s.includes("shopee xpress") || s.includes("shopee express"))
    return Carrier.SPX;
  if (s.includes("ghtk") || s.includes("tiết kiệm") || s.includes("tiet kiem"))
    return Carrier.GHTK;
  if (s.includes("ghn") || s.includes("giao hàng nhanh") || s.includes("giao hang nhanh"))
    return Carrier.GHN;
  if (s.includes("j&t") || s.includes("jnt") || s.includes("j-t") || s.startsWith("jt"))
    return Carrier.JT;
  if (s.includes("viettel")) return Carrier.VIETTEL_POST;
  if (s.includes("ninja")) return Carrier.NINJA_VAN;
  if (s.includes("best")) return Carrier.BEST;
  return Carrier.KHAC;
}

/**
 * Đơn HỎA TỐC (giao trong ngày/vài giờ) — nhận từ TÊN HÃNG nguyên văn sàn trả.
 * Shopee giao hỏa tốc qua đối tác tức thời (AhaMove/Grab/be) hoặc ghi thẳng
 * "Hỏa Tốc"/"Instant". KHÔNG dùng từ "express" trần — "SPX Express" là
 * giao THƯỜNG, dính từ khoá này là báo đỏ oan cả sàn.
 */
/** Từ khoá nhận diện hỏa tốc — DÙNG CHUNG cho isExpressShipping() lẫn mảnh
 *  where Prisma (expressShippingWhere) để nhận diện ở JS và ở DB không lệch. */
export const EXPRESS_KEYWORDS = [
  "hỏa tốc",
  "hoả tốc",
  "hoa toc",
  "instant",
  "siêu tốc",
  "sieu toc",
  "ahamove",
  "grab",
  "bedelivery",
  "be delivery",
  "trong ngày",
  "trong ngay",
  "same day",
] as const;

export function isExpressShipping(name?: string | null): boolean {
  const s = (name ?? "").toLowerCase();
  if (!s.trim()) return false;
  return EXPRESS_KEYWORDS.some((k) => s.includes(k));
}

/**
 * Mảnh `where` Prisma tương đương isExpressShipping() — cho truy vấn DB lọc /
 * ghim đơn hỏa tốc (ILIKE không phân biệt hoa thường, giữ nguyên dấu tiếng Việt).
 */
export function expressShippingWhere(): Prisma.OrderWhereInput {
  return {
    OR: EXPRESS_KEYWORDS.map((k) => ({
      shippingCarrierName: { contains: k, mode: "insensitive" as const },
    })),
  };
}

/**
 * Phần bù của expressShippingWhere() — viết TƯỜNG MINH thay vì bọc NOT{...}
 * vì shippingCarrierName nullable: `NOT (name ILIKE ...)` với name NULL ra
 * NULL theo logic 3 trị SQL → đơn không có tên hãng bị rơi khỏi kết quả.
 */
export function notExpressShippingWhere(): Prisma.OrderWhereInput {
  return {
    OR: [
      { shippingCarrierName: null },
      {
        AND: EXPRESS_KEYWORDS.map((k) => ({
          NOT: {
            shippingCarrierName: { contains: k, mode: "insensitive" as const },
          },
        })),
      },
    ],
  };
}

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
