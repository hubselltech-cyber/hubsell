/**
 * OPERATIONS COMMAND CENTER — tiện ích thuần (id, thời gian tương đối, dán
 * bảng từ Excel) + ước tính chi phí đổi sàn theo lịch sử SKU mô phỏng.
 *
 * 09/09/2026: bộ cảnh báo / chat / nhật ký "mồi" đã gỡ — khối chỉ hiện cảnh
 * báo thật từ /api/command-center/state. 21/10/2026 dọn nốt dữ liệu mồi còn sót.
 */


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
