/**
 * PHÂN BỔ TRỪ HÀNG THEO VỊ TRÍ (đợt B 24/09/2026) — phần thuần, không đụng DB.
 *
 * Luật anh Trung chốt 15/09 (học Sapo): đơn bán trừ TỰ ĐỘNG theo thứ tự ưu tiên
 * vị trí, không hỏi trên từng đơn. Vị trí nào ĐỦ CẢ DÒNG thì lấy trọn ở đó (ưu
 * tiên vị trí xếp trước); không vị trí nào đủ thì trừ LẦN LƯỢT theo thứ tự cho
 * tới khi đủ. Thiếu hàng toàn kho thì phần thiếu dồn vào vị trí cuối cùng được
 * đụng tới (tồn vị trí đó âm) — cùng triết lý "phơi bày bán vượt, không âm thầm
 * chặn" của tồn tổng (order-stock.ts).
 */

export interface LevelLike {
  locationId: string;
  quantity: number;
  /** Thứ tự ưu tiên của vị trí (nhỏ = lấy trước). */
  sortOrder: number;
  /** Vị trí không bán (ô hàng lỗi) — không lấy hàng ở đây. */
  sellable?: boolean;
}

export interface Allocation {
  locationId: string;
  quantity: number;
}

/**
 * Chia `qty` cần trừ lên các vị trí. `levels` là tồn hiện có theo vị trí của
 * MỘT SKU (dòng thiếu = 0). `fallbackLocationId` = vị trí gốc, dùng khi không
 * còn vị trí nào có hàng (SKU chưa có tồn ở đâu nhưng đơn vẫn phát sinh thật).
 */
export function allocateDeduction(
  levels: LevelLike[],
  qty: number,
  fallbackLocationId: string
): Allocation[] {
  if (qty <= 0) return [];
  const usable = levels
    .filter((l) => l.sellable !== false)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.locationId.localeCompare(b.locationId));

  // 1) Một vị trí đủ cả dòng → lấy trọn ở vị trí xếp trước nhất trong số đó.
  const whole = usable.find((l) => l.quantity >= qty);
  if (whole) return [{ locationId: whole.locationId, quantity: qty }];

  // 2) Không ai đủ → trừ lần lượt theo ưu tiên.
  const out: Allocation[] = [];
  let remaining = qty;
  for (const l of usable) {
    if (remaining <= 0) break;
    if (l.quantity <= 0) continue;
    const take = Math.min(l.quantity, remaining);
    out.push({ locationId: l.locationId, quantity: take });
    remaining -= take;
  }

  // 3) Vẫn thiếu → phần thiếu dồn vào vị trí cuối cùng đã đụng (hoặc gốc nếu
  //    chưa đụng vị trí nào) để tồn vị trí đó âm và lộ ra bán vượt.
  if (remaining > 0) {
    const last = out[out.length - 1];
    if (last) last.quantity += remaining;
    else out.push({ locationId: fallbackLocationId, quantity: remaining });
  }
  return out;
}

/**
 * Xem trước một lệnh CHUYỂN vị trí: trả về số cũ → mới ở hai đầu. Chỉ tính,
 * không ghi. `fromQty` / `toQty` là tồn hiện tại tại hai vị trí.
 */
export function previewTransfer(fromQty: number, toQty: number, qty: number) {
  return {
    from: { before: fromQty, after: fromQty - qty },
    to: { before: toQty, after: toQty + qty },
    insufficient: qty > fromQty,
  };
}
