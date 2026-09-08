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
 * Đơn HỎA TỐC (giao trong ngày/vài giờ) — nhận từ TÊN HÃNG / PHƯƠNG THỨC
 * nguyên văn sàn trả. KHÔNG sàn nào có cờ boolean "hỏa tốc" trong API (khảo
 * sát tài liệu chính thức 08/09/2026, chi tiết memory hubsell-hoa-toc-carriers),
 * nên so tên là cách duy nhất. KHÔNG dùng từ "express"/"spx" trần — "SPX
 * Express", "J&T Express" là giao THƯỚNG; Shopee nói rõ SPX Instant ≠ SPX Express.
 *
 * Danh mục hãng hỏa tốc theo sàn (08/09/2026):
 *   Shopee VN  — kênh "Hỏa Tốc" (≤4h) + "Hỏa Tốc - Ưu Tiên" (≤1h, từ 16/01/2026):
 *                SPX Instant, GrabExpress, beDelivery, Ahamove, Xanh SM (Green SM);
 *                kênh "Trong Ngày" (từ 29/08/2025): SPX Express + Ahamove — riêng
 *                SPX Express chỉ bắt được khi tên kênh "Trong Ngày" đi kèm.
 *   TikTok VN  — "Hỏa tốc (Instant)": tài liệu gốc KHÔNG nêu tên hãng (kiểm
 *                lại 08/09); "Giao Trong Ngày (Sameday)" từ Q2/2026: Ahamove +
 *                J&T Express — anh Trung chốt 08/09: GIAO TRONG NGÀY KHÔNG PHẢI
 *                HỎA TỐC, chỉ hiện chú thích "Giao trong ngày" dưới tên hãng
 *                (isSameDayShipping). TikTok service ghi delivery_option_name
 *                vào shippingCarrierName cùng shipping_provider để bắt được.
 *   Lazada VN  — "Giao Hàng Hỏa Tốc" nội thành HN/HCM/ĐN; API không có cờ, chỉ
 *                shipment_provider; LEX ngừng giao chặng cuối 31/03/2026 nên
 *                KHÔNG coi "LEX"/"Lazada Express" là hỏa tốc.
 */
/** Từ khoá nhận diện hỏa tốc — DÙNG CHUNG cho isExpressShipping() lẫn mảnh
 *  where Prisma (expressShippingWhere) để nhận diện ở JS và ở DB không lệch.
 *  Web (frontend/src/lib/shipping.ts) và mobile (hubsell-mobile/src/lib/shipping.ts)
 *  CHÉP TAY danh sách này — sửa đây phải sửa cả hai. */
export const EXPRESS_KEYWORDS = [
  // Tên kênh/phương thức (giao trong VÀI GIỜ)
  "hỏa tốc",
  "hoả tốc",
  "hoa toc",
  "instant",
  "siêu tốc",
  "sieu toc",
  // Hãng giao tức thời (Shopee + TikTok)
  "ahamove",
  "grab",
  "bedelivery",
  "be delivery",
  "xanh sm",
  "green sm",
] as const;

/**
 * Từ khoá GIAO TRONG NGÀY (Shopee "Trong Ngày", TikTok "Giao Trong Ngày /
 * Sameday") — KHÔNG phải hỏa tốc (anh Trung chốt 08/09): không badge đỏ,
 * không ghim đầu bảng, không vào bộ lọc Hỏa tốc; chỉ chú thích dưới tên hãng.
 * Web chép tay cùng danh sách (frontend/src/lib/shipping.ts); mobile chưa hiện
 * chú thích này nên chưa chép.
 */
export const SAME_DAY_KEYWORDS = [
  "trong ngày",
  "trong ngay",
  "same day",
  "sameday",
  "same-day",
] as const;

export function isExpressShipping(name?: string | null): boolean {
  const s = (name ?? "").toLowerCase();
  if (!s.trim()) return false;
  return EXPRESS_KEYWORDS.some((k) => s.includes(k));
}

/** Đơn GIAO TRONG NGÀY (không tính hỏa tốc). Tên vừa "Hỏa Tốc" vừa "Trong Ngày"
 *  (tên cũ Shopee trước 16/12/2025) thì hỏa tốc thắng — hàm này trả false. */
export function isSameDayShipping(name?: string | null): boolean {
  const s = (name ?? "").toLowerCase();
  if (!s.trim() || isExpressShipping(s)) return false;
  return SAME_DAY_KEYWORDS.some((k) => s.includes(k));
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
