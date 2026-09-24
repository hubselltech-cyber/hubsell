// ============================================================
// VỊ TRÍ LẤY HÀNG trên phiếu nhặt (đợt 2 vị trí chứa hàng, 24/09/2026)
//
// Đơn ĐÃ trừ kho: đọc chính các dòng nhật ký trừ (kèm locationId) → "Vị trí: Kho 2 › Kệ A1"
// (nhiều chỗ thì mỗi chỗ một dòng kèm ×số). Đơn CHƯA trừ (đang giữ chỗ / chưa chốt):
// gợi ý theo tồn hiện có "Vị trí: Kho chính (còn 40)".
// Shop không dùng vị trí → không in gì (phiếu y hệt cũ).
// ============================================================
import { prisma } from "../../lib/prisma";

export interface DeductionLine {
  locationName: string;
  quantity: number;
  /** Sổ tại vị trí đang ÂM (bán vượt) — phiếu nhắc người nhặt kiểm lại thay vì tìm hàng không có. */
  negative?: boolean;
}
export interface LevelLine {
  locationName: string;
  quantity: number;
  sortOrder: number;
}

/**
 * Phần thuần: ghép câu vị trí cho MỘT dòng hàng. Nhiều vị trí → MỖI VỊ TRÍ MỘT DÒNG
 * (ngăn bằng "\n") vì đường dẫn cây "Kho Bình Tân › Kệ A1 › T2" dài, gộp một dòng
 * trên khổ A6 sẽ bị cắt (kiểm 24/09 với mô hình cây).
 *   Vị trí: Kho Bình Tân › Kệ A1 › T1 ×1
 *   Vị trí: Kho Bình Tân › Kệ A1 › T2 ×29
 * (anh Trung 24/09: "Vị trí" nghe chuyên nghiệp hơn "Lấy ở"; đơn chưa trừ thêm "(còn N)")
 */
export function pickLocationText(deductions: DeductionLine[], levels: LevelLine[]): string | null {
  if (deductions.length > 0) {
    const byName = new Map<string, { q: number; neg: boolean }>();
    for (const d of deductions) {
      const cur = byName.get(d.locationName) ?? { q: 0, neg: false };
      byName.set(d.locationName, { q: cur.q + d.quantity, neg: cur.neg || Boolean(d.negative) });
    }
    const parts = [...byName.entries()];
    const warn = (neg: boolean) => (neg ? " — sổ âm, kiểm lại" : "");
    if (parts.length === 1) return `Vị trí: ${parts[0][0]}${warn(parts[0][1].neg)}`;
    return parts.map(([n, { q, neg }]) => `Vị trí: ${n} ×${q}${warn(neg)}`).join("\n");
  }
  const stocked = levels
    .filter((l) => l.quantity > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, 2);
  if (stocked.length === 0) return null;
  return stocked.map((l) => `Vị trí: ${l.locationName} (còn ${l.quantity})`).join("\n");
}

/**
 * Tra vị trí cho nhiều đơn một lượt (3 câu truy vấn, không lặp theo đơn).
 * Trả về Map orderId → Map productId → câu in.
 */
export async function pickLocationTextForOrders(
  ownerId: string,
  orders: { id: string; productIds: string[] }[]
): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  const hasLocations = await prisma.stockLocation.count({ where: { userId: ownerId } });
  if (hasLocations === 0) return out;

  const orderIds = orders.map((o) => o.id);
  const productIds = [...new Set(orders.flatMap((o) => o.productIds))];
  if (orderIds.length === 0 || productIds.length === 0) return out;

  const [logs, levels, allLocs] = await Promise.all([
    prisma.inventoryLog.findMany({
      where: { orderId: { in: orderIds }, changeQuantity: { lt: 0 }, locationId: { not: null } },
      select: { orderId: true, productId: true, changeQuantity: true, locationId: true },
    }),
    prisma.productStockLevel.findMany({
      where: { productId: { in: productIds }, quantity: { not: 0 } },
      select: { productId: true, quantity: true, locationId: true, location: { select: { sortOrder: true } } },
    }),
    prisma.stockLocation.findMany({
      where: { userId: ownerId },
      select: { id: true, parentId: true, name: true },
    }),
  ]);
  // Tên in trên phiếu = đường dẫn cây "Kho 2 › Kệ A1" để người nhặt biết đi kho nào, kệ nào.
  const byId = new Map(allLocs.map((l) => [l.id, l]));
  const pathCache = new Map<string, string>();
  const pathOf = (id: string, guard = 0): string => {
    const c = pathCache.get(id);
    if (c) return c;
    const l = byId.get(id);
    if (!l) return "?";
    const parent = l.parentId && byId.has(l.parentId) && guard < 20 ? pathOf(l.parentId, guard + 1) : null;
    const p = parent ? `${parent} › ${l.name}` : l.name;
    pathCache.set(id, p);
    return p;
  };

  // Vị trí đang ÂM cho SKU (bán vượt) → nhắc trên phiếu.
  const negative = new Set(levels.filter((lv) => lv.quantity < 0).map((lv) => `${lv.productId}:${lv.locationId}`));
  const dedByOrderProduct = new Map<string, DeductionLine[]>();
  for (const l of logs) {
    if (!l.orderId || !l.locationId) continue;
    const key = `${l.orderId}:${l.productId}`;
    const arr = dedByOrderProduct.get(key) ?? [];
    arr.push({
      locationName: pathOf(l.locationId),
      quantity: -l.changeQuantity,
      negative: negative.has(`${l.productId}:${l.locationId}`),
    });
    dedByOrderProduct.set(key, arr);
  }
  const levelsByProduct = new Map<string, LevelLine[]>();
  for (const lv of levels) {
    if (lv.quantity <= 0) continue;
    const arr = levelsByProduct.get(lv.productId) ?? [];
    arr.push({ locationName: pathOf(lv.locationId), quantity: lv.quantity, sortOrder: lv.location.sortOrder });
    levelsByProduct.set(lv.productId, arr);
  }

  for (const o of orders) {
    const m = new Map<string, string>();
    for (const pid of o.productIds) {
      const text = pickLocationText(
        dedByOrderProduct.get(`${o.id}:${pid}`) ?? [],
        levelsByProduct.get(pid) ?? []
      );
      if (text) m.set(pid, text);
    }
    if (m.size) out.set(o.id, m);
  }
  return out;
}
