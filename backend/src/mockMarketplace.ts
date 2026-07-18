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

// Tiền tố token giả lập cho từng sàn
export const TOKEN_PREFIX: Record<ChannelName, string> = {
  [ChannelName.SHOPEE]: "shp",
  [ChannelName.TIKTOK]: "tik",
  [ChannelName.LAZADA]: "laz",
  [ChannelName.OFFLINE]: "off",
};
