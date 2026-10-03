// ============================================================
// HÀNG ĐỢI BỀN — phần cấu hình THUẦN (không mở kết nối), có test riêng.
// Thiết kế: docs/HANG-DOI-BEN.md. Module chạy thật: lib/queue.ts.
//
// Tên hàng đợi ở đây phải khớp các hàng đợi đã tạo trong migration
// 20261001200000_queue_foundation — ứng dụng chạy pg-boss với migrate:false và
// KHÔNG tạo hàng đợi lúc chạy, nên thêm hàng đợi = thêm migration + thêm tên ở đây.
// ============================================================

import type { HubsellRole } from "../workers";

/** Schema của pg-boss trong database (tách khỏi "public" của Prisma). */
export const QUEUE_SCHEMA = "pgboss";

export const QUEUES = {
  /** Sự kiện đơn từ sàn — khóa sàn:mã shop:mã đơn, gộp theo khóa. */
  evtOrder: "evt.order",
  /** Sự kiện ủy quyền / thu hồi ủy quyền gian. */
  evtAuth: "evt.auth",
  /** Việc sự kiện sàn hỏng sau khi hết lượt thử. */
  evtDead: "evt.dead",
  /** Đẩy hết tồn đang chờ của một gian — khóa mã gian, gộp theo khóa. */
  stockChannel: "stock.channel",
  /** Đọc lại tồn Shopee sau khi đẩy (việc hẹn giờ). */
  stockVerify: "stock.verify",
  /** Việc đẩy tồn hỏng sau khi hết lượt thử. */
  stockDead: "stock.dead",
  /**
   * Tín hiệu "shop này vừa có yêu cầu phát hành hóa đơn" — khóa mã chủ shop, gộp
   * theo khóa. Việc chỉ gọi làn của shop rồi trả về (bước 5 lát 9); không có hàng
   * đợi lỗi vì mất tín hiệu thì lưới quét invoice_requests nhặt.
   */
  invoiceIssue: "invoice.issue",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: readonly QueueName[] = Object.values(QUEUES);

/** Hàng đợi lỗi — có việc nằm trong đây là có việc cần người xem. */
export const DEAD_QUEUES: readonly QueueName[] = [QUEUES.evtDead, QUEUES.stockDead];

/**
 * Số kết nối pg-boss tự mở ở tiến trình worker. MẶC ĐỊNH TỰ CHỌN 2: đo trên
 * Supabase 01/10/2026 hai kết nối xử lý 4.000 việc/giây, và trần chế độ phiên
 * của bộ gộp là 30 cho mọi tiến trình (web 5 + worker 3 đã dùng; lúc deploy bản
 * cũ và mới cùng sống). Đổi bằng QUEUE_POOL_MAX.
 */
export const DEFAULT_WORKER_POOL_MAX = 2;
/**
 * Tiến trình web chỉ GỬI việc, và gửi qua kết nối sẵn có của Prisma (xem
 * enqueue ở lib/queue.ts). Pool riêng của pg-boss ở web chỉ để thư viện đọc
 * danh sách hàng đợi; 1 kết nối, tự trả khi nghỉ (đo 01/10: nghỉ 12 giây còn 0).
 */
export const WEB_POOL_MAX = 1;

/**
 * Số việc evt.order chạy cùng lúc ở MỘT tiến trình worker. MẶC ĐỊNH TỰ CHỌN 4
 * (anh Trung nhận làm mặc định 01/10/2026): trước giai đoạn 2 Shopee chạy 1
 * luồng, TikTok 3 làn, và worker có 3 kết nối database. Đổi bằng
 * QUEUE_EVT_ORDER_CONCURRENCY.
 */
export const DEFAULT_EVT_ORDER_CONCURRENCY = 4;

export function evtOrderConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.QUEUE_EVT_ORDER_CONCURRENCY);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : DEFAULT_EVT_ORDER_CONCURRENCY;
}

/**
 * Tổng số lượt chạy của một việc evt.order trước khi sang hàng đợi lỗi: 1 lượt
 * đầu + retryLimit 2 khai ở migration queue_foundation. Chỉ dùng cho câu chữ
 * cảnh báo; số lượt thật do cấu hình hàng đợi trong database quyết định.
 */
export const EVT_ORDER_MAX_ATTEMPTS = 3;

// ---------- Đẩy tồn (giai đoạn 2 bước 4 — docs/HANG-DOI-BEN.md mục 4.5) ----------

export type StockPushMode = "queue" | "legacy";

/**
 * Đường đi của việc đẩy tồn:
 *   · legacy — bảng stock_push_jobs + một vòng quét một luồng trong worker (trước giai đoạn 2).
 *   · queue  — vẫn bảng stock_push_jobs giữ trạng thái; dòng chờ đẩy được ghi
 *     chung giao dịch với biến động kho, các gian chạy song song (mỗi gian một
 *     bộ chạy, không hai tiến trình cùng đẩy một gian), hàng đợi stock.channel
 *     chỉ làm tín hiệu "gian X có dòng mới" (workers/stock-queue.ts).
 * Bước 4 ĐƯA LÊN HAI LẦN: lần một (e44c58f, 01/10/2026) mặc định còn là legacy
 * — worker đã biết xử lý việc mới nhưng chưa ai gửi; lần hai (anh Trung gật
 * 02/10/2026) đổi mặc định sang queue. Đường lui: STOCK_PUSH_MODE=legacy đặt ở
 * CẢ web lẫn worker.
 */
export const DEFAULT_STOCK_PUSH_MODE: StockPushMode = "queue";

export function stockPushMode(env: NodeJS.ProcessEnv = process.env): StockPushMode {
  const raw = (env.STOCK_PUSH_MODE ?? "").trim().toLowerCase();
  return raw === "queue" || raw === "legacy" ? raw : DEFAULT_STOCK_PUSH_MODE;
}

/**
 * Số GIAN được đẩy tồn cùng lúc ở MỘT tiến trình worker (trước bước 4: 1 gian
 * một lúc). MẶC ĐỊNH TỰ CHỌN 4 (anh Trung nhận làm mặc định 02/10/2026), lấy
 * bằng số của evt.order; một lượt đẩy tồn phần lớn thời gian là chờ sàn trả lời
 * và nghỉ giãn nhịp, ít dùng kết nối database. Đổi bằng QUEUE_STOCK_CHANNEL_CONCURRENCY.
 */
export const DEFAULT_STOCK_CHANNEL_CONCURRENCY = 4;

export function stockChannelConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.QUEUE_STOCK_CHANNEL_CONCURRENCY);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : DEFAULT_STOCK_CHANNEL_CONCURRENCY;
}

/**
 * Hạn thuê một gian, giây. Tiến trình đang đẩy một gian giữ gian đó bằng chính
 * các dòng stock_push_jobs ở RUNNING của lô nó đã nhận; dòng RUNNING lâu hơn
 * hạn này coi là mồ côi (tiến trình cầm nó đã chết) và được trả về hàng chờ.
 * MẶC ĐỊNH TỰ CHỌN 300 giây (anh Trung nhận làm mặc định 02/10/2026): một lô 30 dòng bình thường xong trong 1–2 phút
 * (giãn 0,4 giây + một lệnh gọi sàn mỗi dòng), và lệnh gọi sàn chưa có thời hạn
 * chờ nên phải chừa chỗ cho sàn treo. Đường cũ dùng 15 phút (cũng tự chọn).
 */
export const STOCK_PUSH_LEASE_SECONDS = 300;

/**
 * Nhịp lưới quét dòng tới hạn của đường hàng đợi bền, giây. Mặc định 5 — bằng
 * nhịp vòng quét của đường cũ, nên trường hợp xấu nhất (tín hiệu qua hàng đợi
 * không tới) vẫn không chậm hơn trước. Đổi bằng STOCK_SWEEP_SECONDS.
 */
export const DEFAULT_STOCK_SWEEP_SECONDS = 5;

export function stockSweepSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.STOCK_SWEEP_SECONDS);
  return Number.isFinite(n) && n >= 1 && n <= 3600 ? n : DEFAULT_STOCK_SWEEP_SECONDS;
}

/** Tham số trong chuỗi kết nối chỉ Prisma hiểu — thư viện `pg` nhận vào sẽ hiểu sai hoặc cảnh báo. */
const PRISMA_ONLY_PARAMS = [
  "schema",
  "connection_limit",
  "pool_timeout",
  "statement_cache_size",
  "pgbouncer",
  "sslmode",
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface QueueConnection {
  connectionString: string;
  /** undefined = không TLS (database trên máy mình). */
  ssl: { rejectUnauthorized: false } | undefined;
}

/**
 * Chuỗi kết nối cho pool riêng của pg-boss. QUEUE_DATABASE_URL đặt thì dùng
 * (để sau này trỏ pg-boss sang cổng 6543 — chế độ giao dịch của bộ gộp — mà
 * không sửa mã), không thì dùng DATABASE_URL.
 *
 * TLS: database không nằm trên máy mình thì mã hóa đường truyền nhưng KHÔNG
 * kiểm chuỗi chứng chỉ — đúng hành vi Prisma đang chạy với sslmode=require
 * (chứng chỉ của bộ gộp Supabase do CA riêng của họ ký). sslmode=disable trong
 * chuỗi thì tắt TLS.
 */
export function resolveQueueConnection(env: NodeJS.ProcessEnv = process.env): QueueConnection | null {
  const raw = (env.QUEUE_DATABASE_URL ?? "").trim() || (env.DATABASE_URL ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) return null;
  const sslmode = url.searchParams.get("sslmode");
  for (const key of PRISMA_ONLY_PARAMS) url.searchParams.delete(key);
  const useTls = sslmode ? sslmode !== "disable" : !LOCAL_HOSTS.has(url.hostname);
  return {
    connectionString: url.toString(),
    ssl: useTls ? { rejectUnauthorized: false } : undefined,
  };
}

export interface QueueRoleOptions {
  /** Số kết nối tối đa của pool riêng pg-boss. */
  max: number;
  /** Chạy phần giám sát của pg-boss (trả việc quá hạn giữ, dọn việc cũ, đếm hàng đợi). */
  supervise: boolean;
  /** Tiến trình này có nhận việc để xử lý không. */
  consumes: boolean;
}

/**
 * Cấu hình theo vai tiến trình: worker / all giám sát + xử lý việc; web chỉ gửi.
 * Chỉ MỘT nơi cần giám sát; nhiều worker cùng giám sát vẫn an toàn (pg-boss tự
 * nhường nhau bằng khóa trong database).
 */
export function queueOptionsForRole(
  role: HubsellRole,
  env: NodeJS.ProcessEnv = process.env
): QueueRoleOptions {
  if (role === "web") return { max: WEB_POOL_MAX, supervise: false, consumes: false };
  const n = Number(env.QUEUE_POOL_MAX);
  const max = Number.isInteger(n) && n >= 1 && n <= 10 ? n : DEFAULT_WORKER_POOL_MAX;
  return { max, supervise: true, consumes: true };
}

/**
 * ĐƯỜNG TỰ PHÁT HÀNH HÓA ĐƠN (bước 5 lát 8, 03/10/2026):
 *   · legacy — vòng chung đi tuần tự qua mọi shop mỗi 15 phút, cờ `running` trong
 *     RAM (workers/invoice-auto-issue.ts).
 *   · lanes  — làn riêng từng shop thuê ở bảng invoice_lanes, các shop chạy song
 *     song, lưới quét 30 giây (workers/invoice-lanes.ts).
 * Lát 8 ĐƯA LÊN HAI LẦN: lần một mặc định còn legacy (migration + bảng lên trước,
 * worker đã có mã làn), lần hai đổi mặc định sang lanes. Đường lui: INVOICE_MODE=legacy.
 */
export type InvoiceMode = "lanes" | "legacy";
/**
 * Lần một (359f1cf, 03/10/2026 10:09) mặc định legacy — bảng invoice_lanes + mã làn
 * lên trước, prod không đổi hành vi. Lần hai (anh Trung đã duyệt kế hoạch hai lần
 * 03/10) đổi mặc định sang lanes. Đường lui: INVOICE_MODE=legacy ở worker.
 */
export const DEFAULT_INVOICE_MODE: InvoiceMode = "lanes";

export function invoiceMode(env: NodeJS.ProcessEnv = process.env): InvoiceMode {
  const raw = (env.INVOICE_MODE ?? "").trim().toLowerCase();
  return raw === "lanes" || raw === "legacy" ? raw : DEFAULT_INVOICE_MODE;
}

/**
 * Số SHOP được tự phát hành cùng lúc ở MỘT tiến trình worker. MẶC ĐỊNH TỰ CHỌN 2
 * (anh Trung chốt 01/10/2026, mục 3.8): khóa ứng dụng với nhà cung cấp là khóa
 * chung của Hubsell, nhiều shop bắn cùng lúc là dồn vào một hạn mức chưa có số.
 * Đổi bằng INVOICE_LANE_CONCURRENCY.
 */
export const DEFAULT_INVOICE_LANE_CONCURRENCY = 2;

export function invoiceLaneConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.INVOICE_LANE_CONCURRENCY);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : DEFAULT_INVOICE_LANE_CONCURRENCY;
}

/**
 * ĐƯỜNG XUẤT HÓA ĐƠN HÀNG LOẠT BẤM TAY (bước 5 lát 9, 03/10/2026):
 *   · inline — web gọi nhà cung cấp ngay trong request, tối đa 50 đơn (trước lát 9).
 *   · lane   — web chỉ ghi dòng invoice_requests + gửi tín hiệu rồi trả lời ngay;
 *     làn của shop ở worker phát hành lần lượt, giao diện hỏi tiến độ theo lô.
 * Lát 9 ĐƯA LÊN HAI LẦN: lần một mặc định inline (bảng + worker biết xử lý yêu cầu
 * lên trước, chưa ai gửi), lần hai đổi mặc định sang lane. Giao diện đọc cờ
 * `bulkViaLane` trong /invoice-queue để chọn đường nên lên Vercel lúc nào cũng được.
 * Đường lui: INVOICE_BULK_MODE=inline ở web.
 */
export type InvoiceBulkMode = "lane" | "inline";
/**
 * Lần một (564ff27, 03/10/2026 13:09) mặc định inline — bảng invoice_requests, hàng
 * đợi invoice.issue và worker biết xử lý yêu cầu lên trước, đã kiểm prod 13:11. Lần
 * hai đổi mặc định sang lane. Đường lui: INVOICE_BULK_MODE=inline ở web.
 */
export const DEFAULT_INVOICE_BULK_MODE: InvoiceBulkMode = "lane";

export function invoiceBulkMode(env: NodeJS.ProcessEnv = process.env): InvoiceBulkMode {
  const raw = (env.INVOICE_BULK_MODE ?? "").trim().toLowerCase();
  return raw === "lane" || raw === "inline" ? raw : DEFAULT_INVOICE_BULK_MODE;
}

/**
 * ĐƯỜNG XUẤT MỘT ĐƠN THEO MÃ + ĐIỀU CHỈNH TAY (bước 5 lát 10, 03/10/2026):
 *   · inline — web gọi nhà cung cấp ngay trong request (trước lát 10).
 *   · lane   — web ghi MỘT dòng invoice_requests, gọi làn của shop rồi CHỜ kết quả
 *     tối đa INVOICE_SINGLE_WAIT_SECONDS; câu trả lời giữ nguyên hình dạng cũ. Quá
 *     thời gian chờ (làn đang bận một lượt dài) thì trả 202 "đã nhận", kết quả về chuông.
 * Công tắc RIÊNG với INVOICE_BULK_MODE vì worker bản lát 9 chưa biết loại yêu cầu
 * ADJUST: lần một (mặc định inline) đưa worker biết xử lý lên trước, lần hai mới
 * đổi mặc định sang lane. Đường lui: INVOICE_SINGLE_MODE=inline ở web.
 */
export type InvoiceSingleMode = "lane" | "inline";
/**
 * Lần một (49b109d, 03/10/2026 13:38) mặc định inline — worker biết xử lý loại ADJUST
 * và ghi kết quả chi tiết lên trước, đã kiểm prod 13:40. Lần hai đổi mặc định sang
 * lane. Đường lui: INVOICE_SINGLE_MODE=inline ở web.
 */
export const DEFAULT_INVOICE_SINGLE_MODE: InvoiceSingleMode = "lane";

export function invoiceSingleMode(env: NodeJS.ProcessEnv = process.env): InvoiceSingleMode {
  const raw = (env.INVOICE_SINGLE_MODE ?? "").trim().toLowerCase();
  return raw === "lane" || raw === "inline" ? raw : DEFAULT_INVOICE_SINGLE_MODE;
}

/**
 * Web chờ kết quả một yêu cầu đơn lẻ tối đa chừng này giây. MẶC ĐỊNH TỰ CHỌN 25:
 * một tờ bình thường xong trong 1–4 giây (tín hiệu ~0,5 giây + một lệnh phát hành
 * 0,35–0,6 giây trên sandbox); 25 giây đủ cho một tờ gặp nhà cung cấp chậm mà vẫn
 * dưới mức trình duyệt / proxy cắt request. Đổi bằng INVOICE_SINGLE_WAIT_SECONDS.
 */
export const DEFAULT_INVOICE_SINGLE_WAIT_SECONDS = 25;

export function invoiceSingleWaitMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.INVOICE_SINGLE_WAIT_SECONDS);
  return (Number.isFinite(n) && n >= 1 && n <= 120 ? n : DEFAULT_INVOICE_SINGLE_WAIT_SECONDS) * 1000;
}

/**
 * ĐƯỜNG TỰ ĐIỀU CHỈNH KHI SÀN CHỐT HOÀN (bước 5 lát 11, 03/10/2026):
 *   · legacy — bắn một lệnh điều chỉnh chạy trong RAM đúng một lần lúc trạng thái hoàn
 *     chuyển vào nhóm đã chốt; hỏng (sàn chưa báo số, nhà cung cấp lỗi, worker đang
 *     deploy) là mất, chỉ còn nhãn "Cần điều chỉnh" cho chủ shop làm tay.
 *   · queue  — ghi một dòng invoice_requests (ADJUST, nguồn AUTO_RETURN); làn của shop
 *     làm và thử lại tới khi có kết luận.
 * Đưa lên HAI LẦN: lần một mặc định legacy (worker biết xử lý dòng AUTO_RETURN lên
 * trước — worker bản lát 10 gặp dòng chưa mang phạm vi sẽ hiểu là giảm TOÀN BỘ), lần
 * hai đổi mặc định sang queue. Đường lui: INVOICE_AUTO_ADJUST_MODE=legacy ở mọi tiến
 * trình chạy đồng bộ hoàn (worker, và web nếu có nút đồng bộ tay).
 */
export type InvoiceAutoAdjustMode = "queue" | "legacy";
export const DEFAULT_INVOICE_AUTO_ADJUST_MODE: InvoiceAutoAdjustMode = "legacy";

export function invoiceAutoAdjustMode(env: NodeJS.ProcessEnv = process.env): InvoiceAutoAdjustMode {
  const raw = (env.INVOICE_AUTO_ADJUST_MODE ?? "").trim().toLowerCase();
  return raw === "queue" || raw === "legacy" ? raw : DEFAULT_INVOICE_AUTO_ADJUST_MODE;
}

/**
 * Nhịp lưới quét yêu cầu bấm tay tới hạn, giây. Mặc định 5 (docs 4.6 B — bằng lưới
 * quét đẩy tồn): tín hiệu pg-boss không tới thì chủ shop chờ thêm nhiều nhất chừng
 * này. Câu quét đi theo chỉ mục riêng phần chỉ chứa dòng chờ. Đổi bằng
 * INVOICE_REQUEST_SWEEP_SECONDS.
 */
export const DEFAULT_INVOICE_REQUEST_SWEEP_SECONDS = 5;

export function invoiceRequestSweepSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.INVOICE_REQUEST_SWEEP_SECONDS);
  return Number.isFinite(n) && n >= 1 && n <= 3600 ? n : DEFAULT_INVOICE_REQUEST_SWEEP_SECONDS;
}
