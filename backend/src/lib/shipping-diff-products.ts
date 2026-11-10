import { allocateByWeight, ledgerItemIdOf } from "./order-ledger";
import type { ShippingDiffReason } from "./shipping-diff-reason";

/**
 * LỆCH PHÍ VẬN CHUYỂN THEO SẢN PHẨM — phần thuần (không gọi DB) của bảng "Theo sản
 * phẩm" ở Kiểm toán phí (10/11/2026, docs DOI-SOAT-PHI-SHIP-NGUYEN-NHAN-KHAO-SAT-31-10.md
 * mục 7). Trả lời: sản phẩm nào đang gánh tiền ship shop chịu thêm, và vì nguyên nhân gì.
 *
 * Luật:
 *  · Đơn vị gom = SẢN PHẨM TRÊN SÀN của một gian: (gian + itemId), itemId cắt từ
 *    OrderItem.externalId bằng `ledgerItemIdOf` — cùng id với cột itemId của sổ dòng
 *    hàng. Dòng chưa có id sàn (đơn cũ, Lazada) gom theo (gian + mã SKU sàn).
 *  · Tiền lệch của đơn chia xuống sản phẩm theo TỶ TRỌNG GIÁ TRỊ DÒNG (số lượng × giá)
 *    bằng `allocateByWeight` — đúng luật phân bổ của sổ cái đơn; quà tặng 0 đ không gánh
 *    nên không thành một dòng của bảng.
 *  · Mỗi phần chia là số đồng chẵn (tiền Việt không có số lẻ).
 *  · Đơn không có dòng hàng vào một dòng riêng "chưa rõ sản phẩm" của gian đó, để
 *    Σ các dòng = tổng tiền lệch của các đơn LUÔN đúng (cộng bằng xu, không trôi số lẻ).
 */

export interface ShipDiffLine {
  externalId: string | null;
  channelSku: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface ShipDiffOrder {
  channelId: string;
  createdAt: Date;
  /** Order.shippingFeeDiff (> 0). */
  diff: number;
  reason: ShippingDiffReason;
  /** shippingStatus = CANCELLED — để mẫu số "tổng đơn của sản phẩm" cộng lại đơn hủy có phát sinh cước. */
  cancelled: boolean;
  lines: ShipDiffLine[];
}

export interface ShipDiffReasonTotal {
  reason: ShippingDiffReason;
  orders: number;
  amount: number;
}

export interface ShipDiffProductGroup {
  key: string;
  channelId: string;
  /** Id sản phẩm trên sàn; null = gom theo mã SKU hoặc dòng "chưa rõ sản phẩm". */
  itemId: string | null;
  /** Mã SKU sàn của dòng mới nhất (tra ảnh; với nhóm không có id thì cũng là khóa gom). */
  sku: string | null;
  /** Tên sản phẩm ở đơn mới nhất; "" với dòng "chưa rõ sản phẩm". */
  productName: string;
  /** true = các đơn không có dòng hàng. */
  unattributed: boolean;
  /** Tiền ship shop chịu thêm đã phân bổ cho sản phẩm (dương). */
  amount: number;
  /** Số đơn lệch có sản phẩm này. */
  orders: number;
  cancelledOrders: number;
  /** Theo nguyên nhân, tiền nhiều trước; phần tử đầu là nguyên nhân chính. */
  reasons: ShipDiffReasonTotal[];
}

export type ShipDiffProductSort = "amount" | "orders" | "avg";

export interface ShipDiffProductFoldResult {
  groups: ShipDiffProductGroup[];
  /** Tổng theo nguyên nhân của MỌI đơn đã nạp (không theo bộ lọc nguyên nhân) — cho chip lọc. */
  reasonTotals: ShipDiffReasonTotal[];
  /** Tổng tiền + số đơn của các đơn khớp bộ lọc nguyên nhân (= Σ amount các nhóm). */
  totalAmount: number;
  orders: number;
}

const SEP = "\u0000";
const toCents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;

interface ReasonAcc {
  orders: number;
  cents: number;
}

interface GroupAcc {
  key: string;
  channelId: string;
  itemId: string | null;
  sku: string | null;
  productName: string;
  unattributed: boolean;
  latestAt: number;
  cents: number;
  orders: number;
  cancelledOrders: number;
  reasons: Map<ShippingDiffReason, ReasonAcc>;
}

function bump(map: Map<ShippingDiffReason, ReasonAcc>, reason: ShippingDiffReason, cents: number): void {
  const cur = map.get(reason);
  if (cur) {
    cur.orders += 1;
    cur.cents += cents;
  } else {
    map.set(reason, { orders: 1, cents });
  }
}

function reasonList(map: Map<ShippingDiffReason, ReasonAcc>): ShipDiffReasonTotal[] {
  return [...map.entries()]
    .map(([reason, v]) => ({ reason, orders: v.orders, amount: fromCents(v.cents) }))
    .sort((a, b) => b.amount - a.amount || b.orders - a.orders || a.reason.localeCompare(b.reason));
}

/**
 * Chia tiền một đơn (tính bằng xu) theo trọng số, mỗi phần là SỐ ĐỒNG CHẴN — tiền Việt không có số lẻ,
 * bảng và tệp Excel không nên in "10.534.910,35". Phần lẻ dưới một đồng của chính đơn (hiếm) dồn vào
 * phần có trọng số lớn nhất, nên Σ các phần = tiền đơn, đúng từng xu.
 */
function allocateWholeDong(orderCents: number, weights: number[]): number[] {
  const wholeDong = Math.floor(orderCents / 100);
  // allocateByWeight làm tròn 2 số lẻ → đưa vào theo đơn vị "trăm đồng" để mỗi phần tròn một đồng.
  const parts = allocateByWeight(wholeDong / 100, weights).map((x) => Math.round(x * 100) * 100);
  const fraction = orderCents - wholeDong * 100;
  if (fraction !== 0 && parts.length > 0) {
    let idx = 0;
    for (let i = 1; i < weights.length; i++) if (weights[i] > weights[idx]) idx = i;
    parts[idx] += fraction;
  }
  return parts;
}

/** Khóa gom của một dòng hàng trong gian — xem luật đầu tệp. */
export function shipDiffProductKey(
  channelId: string,
  line: Pick<ShipDiffLine, "externalId" | "channelSku">
): { key: string; itemId: string | null; sku: string } {
  const itemId = ledgerItemIdOf(line.externalId);
  // Giữ nguyên mã như trong đơn (không trim / đổi hoa thường): mẫu số tỷ lệ tra đúng mã này ở sổ dòng hàng.
  const sku = line.channelSku;
  return { key: itemId ? `${channelId}${SEP}i${SEP}${itemId}` : `${channelId}${SEP}s${SEP}${sku}`, itemId, sku };
}

/**
 * Gom dần từng lô đơn lệch thành nhóm sản phẩm — bộ nhớ theo SỐ SẢN PHẨM, không theo
 * số đơn. `matches` = bộ lọc nguyên nhân: đơn không khớp vẫn vào `reasonTotals` (chip
 * lọc luôn đủ số) nhưng không vào nhóm.
 */
export function createShipDiffProductFold(matches: (reason: ShippingDiffReason) => boolean) {
  const groups = new Map<string, GroupAcc>();
  const reasonTotals = new Map<ShippingDiffReason, ReasonAcc>();
  let totalCents = 0;
  let orders = 0;

  function add(o: ShipDiffOrder): void {
    const orderCents = toCents(o.diff);
    bump(reasonTotals, o.reason, orderCents);
    if (!matches(o.reason)) return;
    totalCents += orderCents;
    orders += 1;

    // Gộp các dòng cùng sản phẩm trong MỘT đơn trước khi chia tiền.
    const parts = new Map<string, { itemId: string | null; sku: string | null; name: string; weight: number }>();
    for (const line of o.lines) {
      const { key, itemId, sku } = shipDiffProductKey(o.channelId, line);
      const weight = Math.max(line.quantity, 0) * Math.max(line.price, 0);
      const cur = parts.get(key);
      if (cur) cur.weight += weight;
      else parts.set(key, { itemId, sku, name: line.productName, weight });
    }
    if (parts.size === 0) {
      parts.set(`${o.channelId}${SEP}-`, { itemId: null, sku: null, name: "", weight: 1 });
    }

    const entries = [...parts.entries()];
    const shareCents = allocateWholeDong(
      orderCents,
      entries.map(([, p]) => p.weight)
    );
    const at = o.createdAt.getTime();
    entries.forEach(([key, p], i) => {
      const cents = shareCents[i];
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          channelId: o.channelId,
          itemId: p.itemId,
          sku: p.sku,
          productName: p.name,
          unattributed: p.sku === null,
          latestAt: at,
          cents: 0,
          orders: 0,
          cancelledOrders: 0,
          reasons: new Map(),
        };
        groups.set(key, g);
      } else if (at > g.latestAt) {
        g.latestAt = at;
        g.productName = p.name;
        g.sku = p.sku;
      }
      g.cents += cents;
      g.orders += 1;
      if (o.cancelled) g.cancelledOrders += 1;
      bump(g.reasons, o.reason, cents);
    });
  }

  function result(): ShipDiffProductFoldResult {
    return {
      // Dòng không gánh đồng nào (quà tặng 0 đ đi kèm) không phải "sản phẩm gánh phí ship" → không liệt kê.
      groups: [...groups.values()].filter((g) => g.cents > 0).map((g) => ({
        key: g.key,
        channelId: g.channelId,
        itemId: g.itemId,
        sku: g.sku,
        productName: g.productName,
        unattributed: g.unattributed,
        amount: fromCents(g.cents),
        orders: g.orders,
        cancelledOrders: g.cancelledOrders,
        reasons: reasonList(g.reasons),
      })),
      reasonTotals: reasonList(reasonTotals),
      totalAmount: fromCents(totalCents),
      orders,
    };
  }

  return { add, result };
}

/** Tiền shop chịu trung bình mỗi đơn lệch của sản phẩm. */
export function shipDiffAvgPerOrder(g: Pick<ShipDiffProductGroup, "amount" | "orders">): number {
  return g.orders > 0 ? Math.round(g.amount / g.orders) : 0;
}

/** Sắp xếp tại chỗ theo cột đang chọn; hòa thì tiền nhiều trước, rồi theo khóa cho ổn định qua các trang. */
export function sortShipDiffProducts(
  groups: ShipDiffProductGroup[],
  sort: ShipDiffProductSort,
  dir: "asc" | "desc"
): ShipDiffProductGroup[] {
  const value = (g: ShipDiffProductGroup) =>
    sort === "orders" ? g.orders : sort === "avg" ? shipDiffAvgPerOrder(g) : g.amount;
  const sign = dir === "asc" ? 1 : -1;
  return groups.sort(
    (a, b) => sign * (value(a) - value(b)) || b.amount - a.amount || a.key.localeCompare(b.key)
  );
}

/**
 * Tỷ lệ đơn lệch của sản phẩm. Mẫu số = đơn KHÔNG hủy của sản phẩm trong kỳ (đếm ở sổ
 * dòng hàng) + đơn hủy có phát sinh cước (đã nằm trong tử số) — đơn hủy trước khi gửi
 * không tốn cước nên không tính. Sổ chưa kịp có dòng (mẫu số < tử số) → null, không in
 * tỷ lệ sai.
 */
export function shipDiffOrderRate(
  g: Pick<ShipDiffProductGroup, "orders" | "cancelledOrders">,
  nonCancelledOrders: number | undefined
): { totalOrders: number; rate: number } | null {
  if (nonCancelledOrders === undefined) return null;
  const totalOrders = nonCancelledOrders + g.cancelledOrders;
  if (totalOrders <= 0 || totalOrders < g.orders) return null;
  return { totalOrders, rate: Math.round((g.orders / totalOrders) * 1000) / 10 };
}
