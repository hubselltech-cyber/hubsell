import { ChannelName } from "@prisma/client";

// ============================================================
// GIẢ LẬP SÀN THƯƠNG MẠI ĐIỆN TỬ
// Ở giai đoạn này ta chưa gọi API thật của Shopee/TikTok,
// nên mỗi sàn có sẵn một "gian hàng ảo" với danh sách sản phẩm.
// Sau này khi tích hợp API thật, chỉ cần thay file này bằng
// lời gọi API tương ứng — phần còn lại của hệ thống giữ nguyên.
// ============================================================

export interface MarketplaceProduct {
  channelSku: string; // SKU trên sàn
  name: string; // tên hiển thị trên sàn
  price: number; // giá bán trên sàn (VND)
}

export const MOCK_CATALOG: Record<ChannelName, MarketplaceProduct[]> = {
  [ChannelName.SHOPEE]: [
    { channelSku: "SH-AO-THUN-TRANG-M", name: "Áo thun trắng cotton nam size M", price: 135000 },
    { channelSku: "SH-QUAN-DEN-M", name: "Quần đen ống rộng nữ size M", price: 305000 },
    { channelSku: "SH-GIAY-TRANG-40", name: "Giày trắng thể thao size 40", price: 465000 },
    { channelSku: "SH-TUI-CANVAS", name: "Túi vải canvas trơn", price: 92000 },
    { channelSku: "SH-MU-THEU", name: "Mũ lưỡi trai thêu logo", price: 88000 },
  ],
  [ChannelName.TIKTOK]: [
    { channelSku: "TT-AO-KHOAC-GIO", name: "Áo khoác gió unisex hot trend", price: 225000 },
    { channelSku: "TT-AO-THUN-BASIC", name: "Áo thun basic nam TikTok", price: 132000 },
    { channelSku: "TT-QUAN-JEAN-RONG", name: "Quần jean ống rộng vintage", price: 310000 },
    { channelSku: "TT-GIAY-SNEAKER", name: "Giày sneaker trắng full box", price: 470000 },
  ],
  [ChannelName.LAZADA]: [
    { channelSku: "LZ-AO-THUN-NAM", name: "Áo thun nam cổ tròn Lazada", price: 130000 },
    { channelSku: "LZ-TUI-TOTE", name: "Túi tote thời trang", price: 90000 },
    { channelSku: "LZ-MU-LUOI-TRAI", name: "Mũ lưỡi trai trơn", price: 86000 },
  ],
  // Kênh Offline không có gian hàng online nên không có danh mục sàn
  [ChannelName.OFFLINE]: [],
};

// Tra cứu 1 sản phẩm trong danh mục sàn theo SKU
export function findMarketplaceProduct(
  channelName: ChannelName,
  channelSku: string
): MarketplaceProduct | undefined {
  return MOCK_CATALOG[channelName].find((p) => p.channelSku === channelSku);
}

// Màu nền ảnh theo từng sàn (dùng cho ảnh giả lập)
const IMAGE_BG: Record<ChannelName, string> = {
  [ChannelName.SHOPEE]: "#f97316",
  [ChannelName.TIKTOK]: "#18181b",
  [ChannelName.LAZADA]: "#3b82f6",
  [ChannelName.OFFLINE]: "#a1a1aa",
};

/// Ảnh sản phẩm GIẢ LẬP (SVG data-URI, không cần tải mạng).
/// Khi tích hợp API sàn thật, hàm này được thay bằng URL ảnh do sàn trả về.
export function mockImageFor(channelName: ChannelName, name: string): string {
  // Lấy 2 chữ cái đầu của tên sản phẩm làm nhãn ảnh
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  const bg = IMAGE_BG[channelName];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="12" fill="${bg}"/><text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="bold" fill="#ffffff">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ===== GIAI ĐOẠN 1: TẠM TÍNH =====
// Tỷ lệ PHÍ SÀN mặc định dùng để ƯỚC TÍNH lợi nhuận khi đơn chưa quyết toán.
// Đây chỉ là con số tham chiếu — số thực tế lấy ở bước quyết toán bên dưới.
export const PLATFORM_FEE_RATE: Record<ChannelName, number> = {
  [ChannelName.SHOPEE]: 0.12, // 12%
  [ChannelName.TIKTOK]: 0.11, // 11%
  [ChannelName.LAZADA]: 0.1, // 10%
  [ChannelName.OFFLINE]: 0, // bán trực tiếp, không phí
};

// ===== GIAI ĐOẠN 2: QUYẾT TOÁN THỰC TẾ =====
// Biểu phí chi tiết mà sàn bóc tách khi đối soát/giải ngân.
const SETTLEMENT_SCHEME: Record<
  ChannelName,
  { fixed: number; serviceRate: number; paymentRate: number }
> = {
  [ChannelName.SHOPEE]: { fixed: 3000, serviceRate: 0.03, paymentRate: 0.044 },
  [ChannelName.TIKTOK]: { fixed: 2000, serviceRate: 0.028, paymentRate: 0.04 },
  [ChannelName.LAZADA]: { fixed: 2500, serviceRate: 0.025, paymentRate: 0.04 },
  [ChannelName.OFFLINE]: { fixed: 0, serviceRate: 0, paymentRate: 0 },
};

export interface SettlementDetail {
  fixedFee: number; // phí cố định
  serviceFee: number; // phí dịch vụ
  paymentFee: number; // phí thanh toán
  affiliateFee: number; // phí tiếp thị liên kết (Affiliate)
  sellerVoucher: number; // voucher trợ giá do SHOP tự chịu
  shippingFeeQuoted: number; // phí ship SÀN BÁO lúc đặt đơn
  shippingFeeActual: number; // phí ship THỰC TẾ sàn trừ khi quyết toán
  shippingFeeDiff: number; // chênh lệch = thực tế − sàn báo (dương = bị trừ thêm)
  platformSubsidy: number; // trợ giá từ SÀN (giảm chi phí cho shop)
  totalFee: number; // tổng khấu trừ thực tế
  actualPayout: number; // tiền thực nhận về ví = doanh thu − totalFee
}

// Hàm băm đơn giản, ổn định (cùng mã đơn luôn ra cùng kết quả) —
// dùng để mô phỏng sai lệch tự nhiên giữa số tạm tính và số quyết toán.
function stableHash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

/// GIẢ LẬP dữ liệu quyết toán do API/Webhook của sàn trả về khi đơn hoàn tất.
/// Khi tích hợp API thật: thay hàm này bằng dữ liệu đối soát sàn gửi về,
/// phần ghi vào database ở routes/orders.ts giữ nguyên.
export function mockSettlement(
  channelName: ChannelName,
  totalAmount: number,
  orderCode: string
): SettlementDetail {
  const scheme = SETTLEMENT_SCHEME[channelName];
  if (channelName === ChannelName.OFFLINE) {
    return {
      fixedFee: 0,
      serviceFee: 0,
      paymentFee: 0,
      affiliateFee: 0,
      sellerVoucher: 0,
      shippingFeeQuoted: 0,
      shippingFeeActual: 0,
      shippingFeeDiff: 0,
      platformSubsidy: 0,
      totalFee: 0,
      actualPayout: totalAmount,
    };
  }

  const h = stableHash(orderCode);
  // Sai lệch nhỏ ±0.5% quanh biểu phí (mô phỏng chương trình/khuyến mãi của sàn)
  const drift = ((h % 11) - 5) / 1000;

  const fixedFee = scheme.fixed;
  const serviceFee = Math.round(totalAmount * (scheme.serviceRate + drift));
  const paymentFee = Math.round(totalAmount * scheme.paymentRate);

  // ----- Các khoản "chi phí ẩn" hay bị chủ shop bỏ sót -----
  // Đơn đến từ cộng tác viên/KOL → mất hoa hồng tiếp thị liên kết
  const affiliateFee = h % 4 === 0 ? Math.round(totalAmount * 0.03) : 0;
  // Shop tự bỏ tiền chạy voucher giảm giá
  const sellerVoucher = h % 5 === 0 ? Math.round(totalAmount * 0.04) : 0;
  // Phí vận chuyển: sàn báo một đằng, lúc quyết toán trừ một nẻo.
  // Khoảng 1/3 số đơn bị trừ thêm — đây chính là khoản shop cần khiếu nại đòi lại.
  const shippingFeeQuoted = 16500 + (h % 4) * 1500; // phí sàn báo lúc đặt đơn
  const overcharged = h % 3 === 1;
  const shippingFeeActual = overcharged
    ? shippingFeeQuoted + 5000 + (h % 3) * 5000 // bị trừ thêm
    : shippingFeeQuoted;
  const shippingFeeDiff = shippingFeeActual - shippingFeeQuoted;
  // Khoảng 1/3 số đơn được sàn trợ giá một phần (khoản này GIẢM chi phí)
  const platformSubsidy = h % 3 === 0 ? Math.round(totalAmount * 0.02) : 0;

  const totalFee =
    fixedFee +
    serviceFee +
    paymentFee +
    affiliateFee +
    sellerVoucher +
    shippingFeeDiff -
    platformSubsidy;

  return {
    fixedFee,
    serviceFee,
    paymentFee,
    affiliateFee,
    sellerVoucher,
    shippingFeeQuoted,
    shippingFeeActual,
    shippingFeeDiff,
    platformSubsidy,
    totalFee,
    actualPayout: totalAmount - totalFee,
  };
}

// Tiền tố token giả lập cho từng sàn
/// Tên hiển thị của từng sàn — dùng làm tên gian hàng mặc định khi chủ shop
/// không đặt tên riêng.
export const CHANNEL_LABEL: Record<ChannelName, string> = {
  [ChannelName.SHOPEE]: "Shopee",
  [ChannelName.TIKTOK]: "TikTok Shop",
  [ChannelName.LAZADA]: "Lazada",
  [ChannelName.OFFLINE]: "Offline",
};

export const TOKEN_PREFIX: Record<ChannelName, string> = {
  [ChannelName.SHOPEE]: "shp",
  [ChannelName.TIKTOK]: "tik",
  [ChannelName.LAZADA]: "laz",
  [ChannelName.OFFLINE]: "off",
};
