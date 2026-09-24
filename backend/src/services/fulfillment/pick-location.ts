// ============================================================
// VỊ TRÍ LẤY HÀNG trên phiếu nhặt (đợt 2 vị trí chứa hàng, 24/09/2026)
//
// Đơn ĐÃ trừ kho: đọc chính các dòng nhật ký trừ (kèm locationId) → "Lấy ở: Kho 2"
// hoặc "Lấy ở: Kho chính 1 · Kho 2 4" khi phải gom từ nhiều chỗ. Đơn CHƯA trừ
// (đang giữ chỗ / chưa chốt): chỉ gợi ý theo tồn hiện có "Đang ở: Kho chính 40".
// Shop không dùng vị trí → không in gì (phiếu y hệt cũ).
// ============================================================
import { prisma } from "../../lib/prisma";

export interface DeductionLine {
  locationName: string;
  quantity: number;
}
export interface LevelLine {
  locationName: string;
  quantity: number;
  sortOrder: number;
}

/** Phần thuần: ghép câu vị trí cho MỘT dòng hàng. */
export function pickLocationText(deductions: DeductionLine[], levels: LevelLine[]): string | null {
  if (deductions.length > 0) {
    const byName = new Map<string, number>();
    for (const d of deductions) byName.set(d.locationName, (byName.get(d.locationName) ?? 0) + d.quantity);
    const parts = [...byName.entries()];
    if (parts.length === 1) return `Lấy ở: ${parts[0][0]}`;
    return `Lấy ở: ${parts.map(([n, q]) => `${n} ${q}`).join(" · ")}`;
  }
  const stocked = levels
    .filter((l) => l.quantity > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, 2);
  if (stocked.length === 0) return null;
  return `Đang ở: ${stocked.map((l) => `${l.locationName} ${l.quantity}`).join(" · ")}`;
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

  const [logs, levels] = await Promise.all([
    prisma.inventoryLog.findMany({
      where: { orderId: { in: orderIds }, changeQuantity: { lt: 0 }, locationId: { not: null } },
      select: {
        orderId: true,
        productId: true,
        changeQuantity: true,
        location: { select: { name: true } },
      },
    }),
    prisma.productStockLevel.findMany({
      where: { productId: { in: productIds }, quantity: { gt: 0 } },
      select: { productId: true, quantity: true, location: { select: { name: true, sortOrder: true } } },
    }),
  ]);

  const dedByOrderProduct = new Map<string, DeductionLine[]>();
  for (const l of logs) {
    if (!l.orderId || !l.location) continue;
    const key = `${l.orderId}:${l.productId}`;
    const arr = dedByOrderProduct.get(key) ?? [];
    arr.push({ locationName: l.location.name, quantity: -l.changeQuantity });
    dedByOrderProduct.set(key, arr);
  }
  const levelsByProduct = new Map<string, LevelLine[]>();
  for (const lv of levels) {
    const arr = levelsByProduct.get(lv.productId) ?? [];
    arr.push({ locationName: lv.location.name, quantity: lv.quantity, sortOrder: lv.location.sortOrder });
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
