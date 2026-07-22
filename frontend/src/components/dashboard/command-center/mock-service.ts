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

// ───────────────────────── CẢNH BÁO ─────────────────────────

export const MOCK_ALERTS: OpsAlert[] = [
  {
    id: "al-inv-1",
    tag: "inventory",
    severity: "high",
    title: "SH-AO-THUN-M cháy hàng trên Shopee",
    summary:
      "Áo thun basic còn 0 tồn nhưng vẫn đang mở bán — nguy cơ quá bán, bị sàn phạt.",
    actionLabel: "+ Nhập kho",
    action: {
      kind: "restock",
      sku: "SH-AO-THUN-M",
      currentStock: 0,
      suggestQty: 100,
    },
    createdAt: minsAgo(6),
  },
  {
    id: "al-fin-1",
    tag: "finance",
    severity: "high",
    title: "Quần jean SP002 đang bán dưới giá hoà vốn",
    summary:
      "Biên lợi nhuận âm sau khi trừ phí sàn. Cần chỉnh giá bán để về dương.",
    actionLabel: "Sửa giá nhanh",
    // Giá 170k, vốn 155k, phí sàn 12% → biên hiện tại ≈ −3.2% (đúng "dưới hoà vốn")
    action: {
      kind: "edit-price",
      sku: "SP002",
      cost: 155000,
      price: 170000,
      feeRate: 0.12,
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
    alertId: "al-inv-1",
    author: "Hệ thống",
    role: "ADMIN",
    body: {
      kind: "text",
      text: "Tồn SH-AO-THUN-M về 0 lúc 08:54. Đơn mới vẫn đang vào.",
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
