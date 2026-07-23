/**
 * OPERATIONS COMMAND CENTER — dữ liệu giả lập & tiện ích.
 *
 * Toàn bộ dữ liệu ở đây là MOCK, sống trong bộ nhớ phiên làm việc. Không gọi
 * API thật — mục tiêu là trình diễn luồng RBAC + thảo luận theo sự cố.
 */

import type {
  ActivityItem,
  ChatMessage,
  OpsAlert,
  Severity,
} from "./types";

/** Mốc thời gian gốc để các timestamp giả lập ổn định (không nhảy mỗi render). */
const BASE = new Date("2026-07-21T09:00:00+07:00").getTime();
const minsAgo = (m: number) => new Date(BASE - m * 60_000).toISOString();

let seq = 0;
/**
 * Sinh id duy nhất cho tin nhắn / hoạt động mới trong phiên.
 * Có hậu tố "gen" để KHÔNG bao giờ trùng id của dữ liệu seed (ac-1, ms-1…),
 * tránh lỗi trùng key khi React render danh sách.
 */
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-gen-${seq}`;
}

// ─────────── CẢNH BÁO CHÁY HÀNG: BACKEND QUÉT TỪNG SKU (mô phỏng) ───────────
//
// Backend soi độc lập từng SKU (chính xác nhất). Việc GOM nhiều SKU cùng sản
// phẩm cha + cùng sàn thành một cảnh báo là do FRONTEND làm — buildInventoryAlerts().

interface StockoutSku {
  /** Sản phẩm cha — khoá để gom nhóm. */
  product: string;
  variantName: string;
  sku: string;
  channel: string;
  channelStock: number;
  warehouseStock: number;
  suggestQty: number;
  severity: Severity;
}

const MOCK_STOCKOUTS: StockoutSku[] = [
  // Áo thun basic — cháy cả 3 size trên Shopee → sẽ gom thành 1 cảnh báo
  { product: "Áo thun basic", variantName: "Size S", sku: "SH-AO-THUN-S", channel: "Shopee", channelStock: 0, warehouseStock: 40, suggestQty: 40, severity: "high" },
  { product: "Áo thun basic", variantName: "Size M", sku: "SH-AO-THUN-M", channel: "Shopee", channelStock: 0, warehouseStock: 12, suggestQty: 12, severity: "high" },
  { product: "Áo thun basic", variantName: "Size L", sku: "SH-AO-THUN-L", channel: "Shopee", channelStock: 0, warehouseStock: 0, suggestQty: 0, severity: "high" },
  // Giày sneaker — chỉ 1 size cháy trên TikTok Shop (trường hợp không gom)
  { product: "Giày sneaker trắng", variantName: "Size 40", sku: "SH-GIAY-40", channel: "TikTok Shop", channelStock: 0, warehouseStock: 8, suggestQty: 8, severity: "medium" },
];

function worstSeverity(items: StockoutSku[]): Severity {
  if (items.some((i) => i.severity === "high")) return "high";
  if (items.some((i) => i.severity === "medium")) return "medium";
  return "low";
}

/**
 * GOM các SKU cháy hàng theo (sản phẩm cha + sàn) thành một cảnh báo duy nhất.
 * Nhiều size cùng cháy trên một sàn → 1 dòng, xử lý một thể thay vì click N lần.
 */
function buildInventoryAlerts(): OpsAlert[] {
  const groups = new Map<string, StockoutSku[]>();
  for (const s of MOCK_STOCKOUTS) {
    const key = `${s.product}|||${s.channel}`;
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }

  const alerts: OpsAlert[] = [];
  let n = 0;
  for (const items of groups.values()) {
    const { product, channel } = items[0];
    const count = items.length;
    alerts.push({
      id: `al-inv-grp-${++n}`,
      tag: "inventory",
      severity: worstSeverity(items),
      title:
        count > 1
          ? `${product} có ${count} phân loại đang cháy hàng trên ${channel}`
          : `${product} (${items[0].variantName}) đang cháy hàng trên ${channel}`,
      summary:
        count > 1
          ? `${count} phân loại tồn 0 trên ${channel} nhưng vẫn mở bán — bơm tồn hàng loạt để mở bán lại.`
          : `Tồn 0 trên ${channel} nhưng vẫn mở bán — bơm tồn để mở bán lại.`,
      actionLabel: "Cập nhật tồn",
      action: {
        kind: "restock",
        product,
        channel,
        variants: items.map((i) => ({
          sku: i.sku,
          variantName: i.variantName,
          channelStock: i.channelStock,
          warehouseStock: i.warehouseStock,
          suggestQty: i.suggestQty,
        })),
      },
      createdAt: minsAgo(6),
    });
  }
  return alerts;
}

// ───────────── CẢNH BÁO KHÁC (không gom — tài chính, sàn, ads, lệch tồn) ─────────────

const STATIC_ALERTS: OpsAlert[] = [
  {
    id: "al-fin-1",
    tag: "finance",
    severity: "high",
    title: "Quần jean SP002 đang bán dưới giá hoà vốn",
    summary:
      "Biên lợi nhuận âm sau khi trừ phí sàn. Cần chỉnh giá bán để về dương.",
    actionLabel: "Sửa giá nhanh",
    // Giá gốc 220k, KM 170k, vốn 155k. Chi phí sàn KHÔNG fix ở đây — modal tự
    // ước tính từ đơn thành công gần nhất của SP002 (xem MOCK_SKU_ORDERS).
    action: {
      kind: "edit-price",
      sku: "SP002",
      cost: 155000,
      price: 220000,
      promoPrice: 170000,
    },
    createdAt: minsAgo(22),
  },
  {
    id: "al-chn-1",
    tag: "channel",
    severity: "medium",
    title: "Lazada trễ đồng bộ đơn 40 phút",
    summary:
      "Webhook Lazada chậm bất thường, 5 đơn mới chưa kéo về kho. Kiểm tra kết nối gian hàng.",
    actionLabel: "Đồng bộ lại",
    action: {
      kind: "confirm",
      description:
        "Kích hoạt đồng bộ thủ công gian hàng Lazada để kéo 5 đơn còn treo về kho ngay.",
    },
    createdAt: minsAgo(38),
  },
  {
    id: "al-ads-1",
    tag: "ads",
    severity: "high",
    title: "ROAS chiến dịch áo khoác giảm còn 1.2",
    summary:
      "Chi phí quảng cáo TikTok vượt trần: 600.000₫/ngày nhưng doanh thu quy đổi chỉ 720.000₫.",
    actionLabel: "Xử lý chiến dịch",
    action: {
      kind: "roas",
      campaign: "TikTok · Áo khoác gió",
      roas: 1.2,
      dailyBudget: 600000,
    },
    createdAt: minsAgo(12),
  },
  {
    id: "al-inv-2",
    tag: "inventory",
    severity: "medium",
    title: "Lệch tồn SH-GIAY-40 giữa Hubsell và Shopee",
    summary:
      "Kho ghi 8 nhưng sàn Shopee đang hiển thị 15 — chênh 7, dễ phát sinh quá bán.",
    actionLabel: "Đối soát tồn",
    action: {
      kind: "stock-mismatch",
      sku: "SH-GIAY-40",
      channel: "Shopee",
      hubsellStock: 8,
      channelStock: 15,
    },
    createdAt: minsAgo(75),
  },
  {
    id: "al-chn-2",
    tag: "channel",
    severity: "low",
    title: "Khách 0908****21 bom 3 đơn Shopee liên tiếp",
    summary:
      "Cùng số điện thoại từ chối nhận 3 đơn trong tuần. Cân nhắc gọi xác minh hoặc chặn.",
    actionLabel: "Xử lý khách bom",
    action: {
      kind: "customer-refusal",
      customer: "Nguyễn Thị H.",
      phone: "0908xxxx21",
      refusedOrders: 3,
    },
    createdAt: minsAgo(140),
  },
  {
    id: "al-fin-2",
    tag: "finance",
    severity: "medium",
    title: "Phí ship SH-AO-KHOAC cao do khai sai cân nặng",
    summary:
      "Sàn tính 1.8kg trong khi hàng thực ~0.6kg. Cập nhật lại cân nặng/kích thước để giảm phí.",
    actionLabel: "Sửa cân nặng/KT",
    action: {
      kind: "edit-shipping",
      sku: "SH-AO-KHOAC",
      weightKg: 0.6,
      lengthCm: 30,
      widthCm: 24,
      heightCm: 6,
    },
    createdAt: minsAgo(180),
  },
];

// Luồng THUẾ ở Trung tâm điều hành CHỦ ĐỘNG không có cảnh báo tĩnh — sau này chỉ
// phát cảnh báo khi có LỖI phát sinh (lỗi kết nối API hóa đơn, lỗi ký số…). Trạng
// thái "đang thiết lập (Beta)" được thể hiện ở Empty State của bộ lọc THUẾ trong
// Nhật ký, không chiếm chỗ trong danh sách cảnh báo real-time.

/** Cảnh báo cháy hàng (đã gom theo sản phẩm cha) đứng trước, rồi tới cảnh báo khác. */
export const MOCK_ALERTS: OpsAlert[] = [
  ...buildInventoryAlerts(),
  ...STATIC_ALERTS,
];

// ───────────────────────── NHẬT KÝ VẬN HÀNH ─────────────────────────

export const MOCK_ACTIVITY: ActivityItem[] = [
  {
    id: "ac-1",
    tag: "inventory",
    message: "Hệ thống phát hiện SH-AO-THUN-M cháy kho trên Shopee.",
    at: minsAgo(6),
  },
  {
    id: "ac-2",
    tag: "ads",
    message: "Ads TikTok chạm mốc chi phí 600.000₫ trong ngày.",
    at: minsAgo(12),
  },
  {
    id: "ac-3",
    tag: "finance",
    message: "Kế toán vừa mở rà soát nhóm đơn bán dưới giá vốn.",
    at: minsAgo(20),
  },
  {
    id: "ac-4",
    tag: "channel",
    message: "Lazada trễ đồng bộ, 5 đơn chưa kéo về kho.",
    at: minsAgo(38),
  },
  {
    id: "ac-5",
    tag: "inventory",
    message: "Kho vừa nhập bổ sung 200 chiếc SH-MU-THEU.",
    at: minsAgo(95),
  },
  {
    id: "ac-6",
    tag: "channel",
    message: "Đồng bộ Shopee hoàn tất, 128 sản phẩm cập nhật tồn.",
    at: minsAgo(160),
  },
];

// ───────────────────────── CHAT SEED ─────────────────────────

export const MOCK_CHAT: ChatMessage[] = [
  {
    id: "ms-1",
    // Gắn vào cảnh báo gom "Áo thun basic" (buildInventoryAlerts sinh id ...-grp-1)
    alertId: "al-inv-grp-1",
    author: "Hệ thống",
    role: "ADMIN",
    body: {
      kind: "text",
      text: "Áo thun basic cháy cả 3 size trên Shopee lúc 08:54. Đơn mới vẫn đang vào.",
    },
    at: minsAgo(6),
  },
  {
    id: "ms-2",
    alertId: "al-ads-1",
    author: "Hệ thống",
    role: "ADMIN",
    body: {
      kind: "text",
      text: "ROAS tụt dưới 1.5 — ngưỡng cảnh báo của chiến dịch áo khoác gió.",
    },
    at: minsAgo(12),
  },
];

// ───────────────────────── TIỆN ÍCH ─────────────────────────

/**
 * Nhận diện dữ liệu bảng dán từ Excel / Google Sheets.
 * Excel/Sheets luôn dán ra dạng TAB phân tách; file CSV thì dùng dấu phẩy.
 * Trả về mảng 2 chiều nếu đúng là bảng (≥2 cột), ngược lại null để dán như text.
 */
export function parsePastedTable(raw: string): string[][] | null {
  const text = raw.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
  if (!text) return null;
  const lines = text.split("\n");

  // Ưu tiên TAB (dán từ bảng tính). Chỉ chấp nhận dấu phẩy khi có ≥2 dòng để
  // tránh biến một câu văn "a, b, c" thành bảng ngoài ý muốn.
  const hasTab = lines[0].includes("\t");
  const delimiter = hasTab ? "\t" : lines.length >= 2 && lines[0].includes(",") ? "," : null;
  if (!delimiter) return null;

  const rows = lines.map((line) => line.split(delimiter).map((c) => c.trim()));
  if (rows[0].length < 2) return null;
  // Bảng thật sự thì các dòng có số cột xấp xỉ nhau
  const cols = rows[0].length;
  const consistent = rows.every((r) => Math.abs(r.length - cols) <= 1);
  return consistent ? rows : null;
}

// ─────────────── LỊCH SỬ ĐƠN THÀNH CÔNG THEO SKU (mô phỏng API sàn) ───────────────

/** Một đơn ĐÃ GIAO — nguồn để tạm tính chi phí sàn thực tế của SKU. */
export interface SkuOrderRecord {
  orderCode: string;
  channel: string;
  deliveredAt: string; // ISO
  /** Giá khách thực trả trên đơn đó. */
  sellPrice: number;
  /** Phí sàn THỰC TẾ sàn đã khấu trừ trên đơn đó. */
  platformFee: number;
}

/**
 * "Cơ sở dữ liệu" đơn hàng giả lập, thay cho API thật của sàn. Mỗi SKU giữ vài
 * đơn giao gần nhất kèm phí sàn thực — để ước tính chi phí động, KHÔNG hardcode.
 */
const MOCK_SKU_ORDERS: Record<string, SkuOrderRecord[]> = {
  SP002: [
    {
      orderCode: "SHOPEE-1784490221",
      channel: "Shopee",
      deliveredAt: minsAgo(95),
      sellPrice: 170000,
      platformFee: 21200,
    },
    {
      orderCode: "SHOPEE-1784471880",
      channel: "Shopee",
      deliveredAt: minsAgo(640),
      sellPrice: 175000,
      platformFee: 21800,
    },
  ],
};

/** Chi phí sàn ước tính cho một SKU, suy ra từ đơn giao GẦN NHẤT của nó. */
export interface EstimatedCost {
  /** Tỷ lệ phí/giá bán của đơn gần nhất (thập phân). */
  rate: number;
  /** Phí thực tế của đơn gần nhất (đồng). */
  amount: number;
  order: SkuOrderRecord;
}

/**
 * Trích xuất chi phí sàn ĐỘNG từ đơn giao thành công gần nhất của SKU.
 * Không có đơn nào để dựa vào ⇒ null (form sẽ báo "chưa đủ dữ liệu tạm tính").
 */
export function estimateChannelCost(sku: string): EstimatedCost | null {
  const orders = MOCK_SKU_ORDERS[sku];
  if (!orders || orders.length === 0) return null;
  const latest = [...orders].sort((a, b) =>
    b.deliveredAt.localeCompare(a.deliveredAt)
  )[0];
  return {
    rate: latest.platformFee / latest.sellPrice,
    amount: latest.platformFee,
    order: latest,
  };
}

/** Giả lập gọi API xử lý — trễ ~800ms để pop-up hiển thị trạng thái loading. */
export function runMockAction(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 800));
}

/** ISO → "x phút trước" / "x giờ trước" / "dd/mm HH:mm". */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const diffMin = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "vừa xong";
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
