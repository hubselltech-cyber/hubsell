// ============================================================
// ẢNH THEO MÃ SKU cho bảng xếp hạng sản phẩm (Top sản phẩm theo lãi, Lãi/Lỗ
// theo SKU) — 08/11/2026, anh Trung: "nhiều đơn không lấy được ảnh".
//
// Gốc: hai bảng đó lấy ảnh từ Product (Tổng kho) qua productId của dòng đơn,
// mà phần lớn dòng đơn CHƯA nối kho (prod ~96 % dòng sổ productId NULL) nên ô
// ảnh trống. Ảnh thật của món hàng nằm ở ChannelProduct.imageUrl (sản phẩm
// trên sàn, cùng gian) và OrderItem.imageUrl (chụp từ payload đơn, 08/09) —
// đúng nguồn mà danh sách đơn / thống kê đơn đang dùng (routes/orders.ts).
//
// Luật: ảnh kho (đã có từ SQL) → ảnh sản phẩm trên sàn theo mã sàn → ảnh dòng
// đơn theo mã sàn. Chỉ tra cho mã còn thiếu, theo lô để shop vài nghìn mã
// không dựng câu IN quá dài.
// ============================================================

import { prisma } from "./prisma";
import type { ChannelScope } from "./channel-filter";

const CHUNK = 500;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Map mã sàn → ảnh, cho các mã chưa có ảnh kho. Mã không tìm thấy thì vắng mặt. */
export async function loadSkuImages(scope: ChannelScope, skus: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(skus.filter((s) => s && s.trim()))];
  if (wanted.length === 0) return out;

  for (const part of chunks(wanted, CHUNK)) {
    const rows = await prisma.channelProduct.findMany({
      where: { channel: scope, channelSku: { in: part }, imageUrl: { not: null } },
      select: { channelSku: true, imageUrl: true },
    });
    for (const r of rows) if (r.imageUrl && !out.has(r.channelSku)) out.set(r.channelSku, r.imageUrl);
  }

  const rest = wanted.filter((s) => !out.has(s));
  for (const part of chunks(rest, CHUNK)) {
    const rows = await prisma.orderItem.findMany({
      where: { order: { channel: scope }, channelSku: { in: part }, imageUrl: { not: null } },
      select: { channelSku: true, imageUrl: true },
      distinct: ["channelSku"],
      orderBy: { order: { createdAt: "desc" } },
    });
    for (const r of rows) if (r.imageUrl && !out.has(r.channelSku)) out.set(r.channelSku, r.imageUrl);
  }
  return out;
}

/** Điền ảnh còn thiếu vào các dòng có `sku` + `imageUrl` (sửa tại chỗ, trả lại mảng). */
export async function fillMissingSkuImages<T extends { sku: string; imageUrl: string | null }>(
  scope: ChannelScope,
  rows: T[]
): Promise<T[]> {
  const missing = rows.filter((r) => !r.imageUrl).map((r) => r.sku);
  if (missing.length === 0) return rows;
  const images = await loadSkuImages(scope, missing);
  for (const r of rows) if (!r.imageUrl) r.imageUrl = images.get(r.sku) ?? null;
  return rows;
}
