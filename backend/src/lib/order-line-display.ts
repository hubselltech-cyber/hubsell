// ============================================================
// HIỂN THỊ MỘT DÒNG HÀNG CỦA ĐƠN (19/11/2026) — tên / phân loại / SKU người bán.
//
// Khách không đặt SKU trên sàn kêu (18/11): màn "Quét xem chi tiết đơn" in
// "SKU: 1733668291614…" (id sàn) còn tên phân loại thì bị cắt. Gốc: dòng đơn chỉ có
// MỘT ô `productName` = "Tên sản phẩm - Tên phân loại" và ô `channelSku` vốn là KHÓA
// khớp kho — người bán để trống thì nó là mã máy của sàn.
//
// MỘT luật cho mọi màn (web + mobile), không có công tắc cài đặt:
//   1. baseName     tên sản phẩm KHÔNG đuôi phân loại
//   2. variantName  tên phân loại ("Đen, M") — null = sản phẩm đơn / không tách được
//   3. sellerSku    mã NGƯỜI BÁN tự đặt — null khi `channelSku` là mã máy
//
// Bất biến: chữ phân loại hiện ra luôn là chữ CỦA CHÍNH ĐƠN (thứ sàn in lúc bán).
// Danh mục sàn (ChannelProduct) chỉ được dùng để tìm ĐIỂM CẮT trong tên dòng đơn cũ
// chưa có cột `variantName`; không bao giờ lấy tên phân loại hiện tại của danh mục đè
// lên đơn (người bán đổi tên phân loại sau khi bán thì đơn cũ vẫn phải đúng món đã bán).
// KHÔNG cắt mò theo dấu " - " — tên sản phẩm của khách có sẵn " - " rất nhiều.
//
// Hàm thuần. `channelSku` vẫn là khóa gom / khóa khớp kho ở mọi nơi — tệp này chỉ lo CHỮ.
// ============================================================

import { leafIdOf, normalizeVariantName } from "../marketplace/sku-key";

export interface LineDisplayInput {
  productName: string;
  channelSku: string | null;
  externalId?: string | null;
  /** OrderItem.variantName — nguyên văn sàn trả lúc tạo đơn; null = SP đơn hoặc đơn tạo trước 19/11/2026. */
  variantName?: string | null;
}

/** Dòng danh mục sàn cùng khóa (nếu có) — chỉ để tìm điểm cắt tên cho dòng đơn cũ. */
export interface LineCatalogHint {
  productName: string;
  variantName: string | null;
}

export interface LineDisplay {
  baseName: string;
  variantName: string | null;
  sellerSku: string | null;
}

/** Mã máy Hubsell tự dựng khi sàn không có mã người bán (shopeeChannelSku / lazadaChannelSku; TTK- là khuôn cũ). */
const FALLBACK_PREFIX = /^(SPE|TTK|LZD)-\d/;
/**
 * Dãy toàn số từ 16 chữ số: sku_id TikTok dài 19 số. Ngưỡng 16 là mặc định TỰ CHỌN — mã vạch
 * dài nhất thông dụng (GTIN-14) có 14 số, mã vạch Tổng kho Hubsell 13 số, nên mã người bán
 * toàn số không chạm ngưỡng này. Chỉ dùng khi dòng không có `externalId` để so chính xác.
 */
const LONG_DIGITS = /^\d{16,}$/;
/** ShopSku Lazada tự sinh, khuôn "{item}_VNAMZ-{sku}" — lazadaChannelSku lui về nó khi SellerSku trống. */
const LAZADA_SHOP_SKU = /^\d+_[A-Z]{2}AMZ-\d+$/;

/**
 * `channelSku` có phải MÃ MÁY (sàn / Hubsell tự sinh) chứ không phải mã người bán tự đặt.
 * Có `externalId` thì so đúng id sàn; không có mới dùng khuôn.
 */
export function isMachineSku(channelSku: string | null | undefined, externalId?: string | null): boolean {
  const sku = (channelSku ?? "").trim();
  if (!sku) return false;
  if (FALLBACK_PREFIX.test(sku) || LAZADA_SHOP_SKU.test(sku) || LONG_DIGITS.test(sku)) return true;
  const ext = (externalId ?? "").trim();
  if (!ext) return false;
  // TikTok để trống seller_sku → khóa = sku_id trần = đuôi của "product-sku".
  return sku === ext || sku === leafIdOf(ext) || sku === ext.split("-")[0];
}

/**
 * Tìm điểm cắt " - " mà phần đuôi (sau chuẩn hóa) đúng bằng tên phân loại đã biết.
 * Quét MỌI vị trí " - " nên tên sản phẩm có sẵn " - " không bị cắt nhầm; so sau chuẩn hóa
 * để "Đen,M" (Shopee thô trong tên) khớp "Đen, M". Trả null khi đuôi không khớp.
 */
function splitByVariant(name: string, variant: string): { base: string; tail: string } | null {
  let from = 0;
  for (;;) {
    const i = name.indexOf(" - ", from);
    if (i < 0) return null;
    const tail = name.slice(i + 3);
    if (normalizeVariantName(tail) === variant) {
      const base = name.slice(0, i).trim();
      return base ? { base, tail: variant } : null;
    }
    from = i + 1;
  }
}

/** Bỏ đuôi product-sync thêm vào khóa trùng mã: "LT075 (Hồng, 3-5kg) #173…" → "LT075". */
function stripKeySuffix(sku: string, variants: (string | null)[]): string {
  let out = sku.replace(/\s#\d+$/, "");
  for (const v of variants) {
    if (v && out.endsWith(` (${v})`)) {
      out = out.slice(0, -(v.length + 3));
      break;
    }
  }
  return out.trim();
}

export function lineDisplay(line: LineDisplayInput, catalog?: LineCatalogHint | null): LineDisplay {
  const name = (line.productName ?? "").trim();
  const own = normalizeVariantName(line.variantName);
  const catVariant = normalizeVariantName(catalog?.variantName);
  const catName = (catalog?.productName ?? "").trim();

  let baseName = name;
  let variantName: string | null = null;

  if (own) {
    // Đơn mới: cột riêng là nguồn chuẩn; tên chỉ cần bỏ đuôi.
    variantName = own;
    baseName = splitByVariant(name, own)?.base ?? name;
  } else {
    // Đơn cũ: danh mục chỉ giúp TÌM ĐIỂM CẮT, chữ vẫn lấy từ tên dòng đơn.
    const byVariant = catVariant ? splitByVariant(name, catVariant) : null;
    if (byVariant) {
      baseName = byVariant.base;
      variantName = byVariant.tail;
    } else if (catName && name.length > catName.length + 3 && name.startsWith(`${catName} - `)) {
      const tail = normalizeVariantName(name.slice(catName.length + 3));
      if (tail) {
        baseName = catName;
        variantName = tail;
      }
    }
  }

  const rawSku = (line.channelSku ?? "").trim();
  let sellerSku: string | null = null;
  if (rawSku && !isMachineSku(rawSku, line.externalId)) {
    const stripped = stripKeySuffix(rawSku, [variantName, catVariant]);
    sellerSku = stripped && !isMachineSku(stripped, line.externalId) ? stripped : null;
  }

  return { baseName: baseName || name, variantName, sellerSku };
}
