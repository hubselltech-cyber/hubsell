import { ApiError, api, apiBinary } from "./client";
import type { OrdersFilter } from "./orders";
import type { ChannelName } from "../types/api";

// ============================================================
// XỬ LÝ ĐƠN TRÊN APP (19/11/2026, docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md): chuẩn bị hàng
// THẬT trên sàn + lấy tệp vận đơn để in. Cùng route với web (backend/src/routes/orders.ts
// /bulk/*), kiểu dữ liệu CHÉP TAY từ frontend/src/lib/api.ts — sửa backend phải sửa theo.
// ============================================================

// ───────── Hàng chờ xử lý (GET /api/orders/process-queue) ─────────

/** ARRANGE = Chờ xử lý · PRINT = Đã xử lý chưa in phiếu · REPRINT = đã in, chưa đóng gói. */
export type QueueStage = "ARRANGE" | "PRINT" | "REPRINT";

export interface QueueCarrier {
  /** "EXPRESS" (hỏa tốc) · mã hãng · "NONE" (sàn chưa gán hãng). */
  key: string;
  label: string;
  express: boolean;
  count: number;
  orderIds: string[];
}

export interface QueueGroup {
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  count: number;
  express: number;
  cancelRequested: number;
  carriers: QueueCarrier[];
}

export interface ProcessQueue {
  stage: QueueStage;
  /** Số đơn của cả nhóm trong phạm vi lọc. */
  total: number;
  /** Số đơn có mặt trong `groups` (tối đa `max`). */
  taken: number;
  truncated: boolean;
  max: number;
  /** Chỉ ARRANGE: đơn khách chưa thanh toán — sàn chưa cho chuẩn bị, không nằm trong groups. */
  unpaid: number;
  groups: QueueGroup[];
}

/** Nhóm đơn của một công đoạn, gom gian → hãng. Phạm vi = sàn / gian / hãng / từ khóa đang lọc. */
export function fetchProcessQueue(stage: QueueStage, scope: OrdersFilter) {
  const q = new URLSearchParams({ stage });
  if (scope.search) q.set("search", scope.search);
  if (scope.channelName) q.set("channelName", scope.channelName);
  if (scope.channelId) q.set("channelId", scope.channelId);
  if (scope.carrier) q.set("carrier", scope.carrier);
  if (scope.cancelRequested) q.set("cancelRequested", "1");
  return api<ProcessQueue>(`/api/orders/process-queue?${q.toString()}`);
}

// ───────── Chuẩn bị hàng ─────────

export type FulfillMethod = "PICKUP" | "DROPOFF";

export interface FulfillChoice {
  method: FulfillMethod;
  addressId?: string;
  pickupTimeId?: string;
  branchId?: string;
}

export interface ShippingOptionSlot {
  id: string;
  label: string;
}

export interface ShippingOptionAddress {
  id: string;
  label: string;
  isDefault: boolean;
  timeSlots: ShippingOptionSlot[];
}

export interface ShippingOptionGroup {
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  orderCount: number;
  /** PLATFORM: gọi sàn thật · INTERNAL: kênh offline · UNSUPPORTED: sàn giữ chỗ · ERROR: không hỏi được sàn */
  mode: "PLATFORM" | "INTERNAL" | "UNSUPPORTED" | "ERROR";
  methods: FulfillMethod[];
  pickupAddresses: ShippingOptionAddress[];
  dropoffBranches: ShippingOptionSlot[];
  note?: string;
  defaults: { method: FulfillMethod; addressId?: string; branchId?: string } | null;
}

export interface ExcludedOrder {
  orderCode: string;
  reason: string;
  channelId: string;
  channelName: ChannelName;
  shopName: string;
}

export interface ShippingOptionsResult {
  groups: ShippingOptionGroup[];
  pendingCount: number;
  excluded: ExcludedOrder[];
  unpaidCount: number;
}

/** Hỏi sàn phương án vận chuyển cho các gian có đơn (chỉ đơn Chờ xử lý). */
export function fetchShippingOptions(orderIds: string[]) {
  return api<ShippingOptionsResult>("/api/orders/bulk/shipping-options", {
    method: "POST",
    body: { orderIds },
  });
}

export interface BulkConfirmResult {
  confirmed: number;
  confirmedIds: string[];
  skipped: { orderCode: string; reason: string }[];
  /** Sàn từ chối — đơn ở nguyên Chờ xử lý kèm lý do. */
  failed: { orderCode: string; reason: string }[];
  notes?: { orderCode: string; note: string }[];
}

interface BulkConfirmStarted {
  batchId: string;
  total: number;
  skipped: { orderCode: string; reason: string }[];
  reattached?: boolean;
}

interface BulkConfirmProgress extends BulkConfirmResult {
  batchId: string;
  status: "RUNNING" | "DONE" | "FAILED";
  total: number;
  done: number;
  error: string | null;
}

/** Mã 409 của /bulk/confirm khi không còn đơn nào gọi sàn được (backend confirm-skip.ts). */
export const NO_READY_ORDERS_CODE = "NO_READY_ORDERS";

export function isNoReadyOrders(err: unknown): err is ApiError {
  return err instanceof ApiError && (err.body as { code?: string } | null)?.code === NO_READY_ORDERS_CODE;
}

const CONFIRM_POLL_MS = 1500;
/** Trần đợi một lượt chạy nền — cùng số với web (200 đơn Lazada từng đơn vẫn dưới mức này). */
const CONFIRM_MAX_MS = 15 * 60_000;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Chuẩn bị hàng THẬT: máy chủ trả mã lượt ngay rồi gọi sàn theo mẻ ở nền; hàm này hỏi tiến
 * độ mỗi 1,5 giây tới khi xong. Mất mạng một nhịp không làm hỏng lượt trên máy chủ — hỏi
 * lại. `onReattached` = máy chủ bảo theo dõi tiếp lượt trước (bấm lại khi lượt cũ còn chạy).
 */
export async function runBulkConfirm(
  orderIds: string[],
  choices: Record<string, FulfillChoice>,
  onProgress?: (done: number, total: number) => void,
  onReattached?: () => void
): Promise<BulkConfirmResult> {
  const started = await api<BulkConfirmStarted>("/api/orders/bulk/confirm", {
    method: "POST",
    body: { orderIds, choices },
  });
  if (started.reattached) onReattached?.();
  onProgress?.(0, started.total);
  const t0 = Date.now();
  for (;;) {
    await wait(CONFIRM_POLL_MS);
    let p: BulkConfirmProgress;
    try {
      p = await api<BulkConfirmProgress>(`/api/orders/bulk/confirm/${encodeURIComponent(started.batchId)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) throw err;
      if (Date.now() - t0 > CONFIRM_MAX_MS) throw err;
      continue;
    }
    onProgress?.(p.done, p.total);
    if (p.status === "DONE") return p;
    if (p.status === "FAILED") {
      throw new ApiError(p.error ?? "Lượt chuẩn bị hàng bị gián đoạn", 500, null);
    }
    if (Date.now() - t0 > CONFIRM_MAX_MS) {
      throw new ApiError(
        "Lượt chuẩn bị hàng chạy quá lâu — tải lại danh sách để xem đơn nào sàn đã nhận",
        504,
        null
      );
    }
  }
}

// ───────── Vận đơn ─────────

interface LabelReadinessResult {
  ready: string[];
  waiting: { id: string; orderCode: string; reason?: string }[];
  failed: { orderCode: string; reason: string }[];
}

const READY_POLL_MS = 2500;
/** Hết kiên nhẫn sau ~45 giây — in phần đã có, phần thiếu ở nguyên Chưa in phiếu (cùng số với web). */
const READY_MAX_MS = 45_000;

/**
 * ĐỢI sàn cấp vận đơn cho các đơn vừa chuẩn bị (Shopee cấp mã trễ vài giây sau khi nhận
 * đơn — xin tệp ngay là đơn chưa có mã rơi khỏi tệp in). Trả các đơn còn thiếu khi hết
 * kiên nhẫn (rỗng = đủ).
 */
export async function waitForLabelsReady(
  orderIds: string[],
  onProgress?: (ready: number, total: number) => void
): Promise<{ id: string; orderCode: string }[]> {
  const total = orderIds.length;
  const started = Date.now();
  let pending = orderIds;
  let lastWaiting: { id: string; orderCode: string }[] = [];
  onProgress?.(0, total);
  for (;;) {
    try {
      const r = await api<LabelReadinessResult>("/api/orders/bulk/label-readiness", {
        method: "POST",
        body: { orderIds: pending },
      });
      lastWaiting = r.waiting;
      const waitingIds = new Set(r.waiting.map((w) => w.id));
      pending = pending.filter((id) => waitingIds.has(id));
      onProgress?.(total - pending.length, total);
      if (pending.length === 0) return [];
    } catch {
      // nhịp này lỗi (mạng / máy chủ) — giữ nguyên, nhịp sau hỏi lại
    }
    if (Date.now() - started >= READY_MAX_MS) break;
    await wait(READY_POLL_MS);
  }
  return lastWaiting;
}

export interface LabelSummary {
  orders: number;
  labels: number;
  pages: number;
  broken: number;
  failed: { orderCode: string; reason: string }[];
  /** id các đơn KHÔNG có vận đơn sàn trong tệp — không được đánh dấu đã in. */
  failedIds: string[];
  /**
   * Mẫu "bảng sản phẩm gọn" (Tùy chỉnh phiếu in): số vận đơn đã chèn / số vận đơn bật mẫu
   * mà máy không dò được chỗ bảng sản phẩm nên in nguyên phiếu sàn. Máy chủ cũ không trả.
   */
  overlay?: { applied: number; missed: number };
}

export interface PrintChoice {
  /** Vận đơn của sàn (dán kiện). */
  labels: boolean;
  /** Phiếu xuất hàng của Hubsell (kho nhặt hàng). */
  pickList: boolean;
}

/** Giải mã base64 → chuỗi UTF-8 (header tóm tắt của tệp vận đơn), không cần thư viện. */
function decodeBase64Utf8(b64: string): string {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of b64.replace(/=+$/, "")) {
    const v = table.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

export function parseLabelSummary(raw: string | null): LabelSummary | null {
  if (!raw) return null;
  try {
    return JSON.parse(decodeBase64Utf8(raw)) as LabelSummary;
  } catch {
    return null;
  }
}

/**
 * Tải MỘT tệp PDF khổ A6: vận đơn chính chủ của sàn (+ phiếu xuất hàng nếu chọn), theo
 * đúng thứ tự `orderIds`. Tóm tắt (đơn nào thiếu vận đơn) nằm ở header X-Hubsell-Labels.
 * Lượt này máy chủ có gọi sàn lấy tệp nên mất vài giây tới vài chục giây.
 */
export async function fetchLabelsPdf(
  orderIds: string[],
  choice: PrintChoice
): Promise<{ bytes: Uint8Array; summary: LabelSummary | null }> {
  const res = await apiBinary("/api/orders/bulk/labels", {
    method: "POST",
    body: { orderIds, labels: choice.labels, pickList: choice.pickList },
  });
  return { bytes: res.bytes, summary: parseLabelSummary(res.header("X-Hubsell-Labels")) };
}

/** Đánh dấu ĐÃ IN — gọi SAU khi hộp in / bảng chia sẻ đã mở được (xem lib/print-labels). */
export function markOrdersPrinted(orderIds: string[]) {
  return api<{ markedPrinted: number }>("/api/orders/bulk/mark-printed", {
    method: "POST",
    body: { orderIds },
  });
}
