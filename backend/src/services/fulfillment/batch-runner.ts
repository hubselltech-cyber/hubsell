// ============================================================
// LƯỢT CHUẨN BỊ HÀNG CHẠY NỀN (14/10/2026)
//
// Trước: POST /bulk/confirm gọi sàn từng đơn trong MỘT request đồng bộ → mẻ
// 58 đơn kéo 1,5–3 phút, request bị cắt, Node vẫn chạy tiếp, giao diện lệch DB
// (sự cố 09/09). Nay route chỉ tạo dòng FulfillmentBatch rồi trả batchId; hàm
// này chạy tiếp trong tiến trình web, ghi tiến độ `done` để giao diện hỏi.
//
// Vì sao KHÔNG đưa vào pg-boss: việc dài (1–3 phút) chặn cả hàng đợi (bẫy đã
// ghi 10/2026); người dùng đang đứng chờ nên chạy ngay tại tiến trình nhận
// request là đúng. Máy chủ chết giữa chừng: đơn sàn đã nhận vẫn PROCESSED trong
// Order (ghi ngay sau mỗi nhóm), chỉ dòng batch treo RUNNING → đọc lại quá
// STALE_MS coi là FAILED, giao diện bảo tải lại danh sách.
//
// Trong một gian: adapter có arrangeShipmentBatch (Shopee mass API, TikTok
// Batch Ship) thì gọi theo mẻ; không có (Lazada) thì từng đơn như cũ. Các gian
// chạy song song với nhau.
// ============================================================

import type { Channel } from "@prisma/client";
import { ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { carrierFromName } from "../shipping";
import { getFulfillmentAdapter } from "./index";
import { readFulfillDefaults, type ArrangeResult, type FulfillChoice, type FulfillOrderRef } from "./types";

/**
 * Dòng RUNNING không được cập nhật quá lâu = tiến trình đã chết giữa chừng.
 * Cùng ngưỡng này quyết định lượt nào còn "sống" khi chặn lượt mới chồng lên
 * (findLiveRunningBatches) — hai nơi phải cùng một số, nếu không lượt bị
 * getFulfillmentBatch coi là chết vẫn giữ đơn, hoặc ngược lại.
 */
export const STALE_MS = 3 * 60_000;
/**
 * Nhịp tim: đang chạy thì chạm updatedAt đều đặn kể cả khi chưa có đơn nào xong
 * (15/10 — một lượt gọi sàn kéo dài, vd Shopee mass_ship_order + lùi về từng
 * đơn cho nhóm lỗi, có thể im lặng quá STALE_MS; không có nhịp tim thì
 * getFulfillmentBatch đánh FAILED oan một lượt vẫn đang chạy và giao diện báo
 * "máy chủ khởi động lại" trong khi sàn đang nhận đơn).
 */
const HEARTBEAT_MS = 30_000;
/** Ghi tiến độ xuống DB tối đa mỗi khoảng này (tránh 50 UPDATE cho 50 đơn). */
const PROGRESS_WRITE_MS = 1000;
/** Nhịp giữa hai đơn cùng gian khi phải đi đường từng đơn. */
const ARRANGE_GAP_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BatchOrderRow {
  id: string;
  orderCode: string;
  channelId: string;
  channel: Channel;
  trackingCode: string | null;
  platformPackageId: string | null;
}

export interface BatchStartParams {
  ownerId: string;
  /** Đơn sẵn sàng gọi sàn, gom theo gian. */
  groups: Map<string, BatchOrderRow[]>;
  /** Lựa chọn pickup/dropoff theo gian từ hộp thoại. */
  choices: Record<string, FulfillChoice>;
  /** Đơn loại trước khi gọi sàn (chưa thanh toán, đã rời Chờ xử lý…). */
  skipped: { orderCode: string; reason: string }[];
}

export interface BatchSnapshot {
  batchId: string;
  status: "RUNNING" | "DONE" | "FAILED";
  total: number;
  done: number;
  confirmed: number;
  confirmedIds: string[];
  skipped: { orderCode: string; reason: string }[];
  failed: { orderCode: string; reason: string }[];
  notes: { orderCode: string; note: string }[];
  error: string | null;
}

function toRef(o: BatchOrderRow): FulfillOrderRef {
  return { id: o.id, orderCode: o.orderCode, trackingCode: o.trackingCode, platformPackageId: o.platformPackageId };
}

/** Tạo dòng batch rồi chạy nền; trả về ngay để route phản hồi. */
export async function startFulfillmentBatch(params: BatchStartParams): Promise<{ batchId: string; total: number }> {
  const total = [...params.groups.values()].reduce((s, g) => s + g.length, 0);
  // orderIds: đơn thật sự đem đi gọi sàn — lượt sau đọc để không gọi lại đơn
  // đang được lượt này xử lý (sự cố bấm 2 lần 30 đơn Shopee 15/10).
  const orderIds = [...params.groups.values()].flatMap((g) => g.map((o) => o.id));
  const row = await prisma.fulfillmentBatch.create({
    data: { ownerId: params.ownerId, total, orderIds, skipped: params.skipped },
    select: { id: true },
  });
  // Cố ý không await: request trả batchId ngay, việc gọi sàn chạy tiếp.
  void runBatchWithHeartbeat(row.id, params).catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[fulfillment.batch] ${row.id} lỗi ngoài dự kiến:`, message);
    await prisma.fulfillmentBatch
      .update({ where: { id: row.id }, data: { status: "FAILED", error: message, finishedAt: new Date() } })
      .catch(() => undefined);
  });
  return { batchId: row.id, total };
}

/** Chạy lượt + nhịp tim; dừng nhịp tim dù lượt xong hay ném lỗi. */
async function runBatchWithHeartbeat(batchId: string, params: BatchStartParams): Promise<void> {
  const timer = setInterval(() => {
    // Chỉ chạm updatedAt (Prisma @updatedAt) — `done` do flushProgress ghi.
    void prisma.fulfillmentBatch
      .updateMany({ where: { id: batchId, status: "RUNNING" }, data: { updatedAt: new Date() } })
      .catch(() => undefined);
  }, HEARTBEAT_MS);
  try {
    await runBatch(batchId, params);
  } finally {
    clearInterval(timer);
  }
}

async function runBatch(batchId: string, params: BatchStartParams): Promise<void> {
  const confirmedIds: string[] = [];
  const failed: { orderCode: string; reason: string }[] = [];
  const notes: { orderCode: string; note: string }[] = [];
  /** Số đơn đã có kết quả theo từng gian (gian chạy song song → cộng dồn). */
  const doneByChannel = new Map<string, number>();
  let lastWrite = 0;
  let writing: Promise<unknown> | null = null;

  const flushProgress = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < PROGRESS_WRITE_MS) return;
    lastWrite = now;
    const done = [...doneByChannel.values()].reduce((s, n) => s + n, 0);
    // Không chồng hai UPDATE lên nhau; lượt sau đợi lượt trước.
    writing = (writing ?? Promise.resolve()).then(() =>
      prisma.fulfillmentBatch.update({ where: { id: batchId }, data: { done } }).catch(() => undefined)
    );
    await writing;
  };

  const markProcessed = async (
    id: string,
    extra: { trackingCode?: string | null; platformPackageId?: string | null; carrierName?: string | null } = {}
  ) => {
    // Hãng sàn gán lúc sắp xếp (Lazada/TikTok trả ngay) — ghi luôn để phiếu
    // xuất hàng in ngay sau đó không bị "Chưa gán"; sync sau vẫn đè.
    const carrier = extra.carrierName ? carrierFromName(extra.carrierName) : null;
    await prisma.order.update({
      where: { id },
      data: {
        shippingStatus: ShippingStatus.PROCESSED,
        packedAt: new Date(),
        ...(extra.trackingCode ? { trackingCode: extra.trackingCode } : {}),
        ...(extra.platformPackageId ? { platformPackageId: extra.platformPackageId } : {}),
        ...(extra.carrierName ? { shippingCarrierName: extra.carrierName } : {}),
        ...(carrier ? { carrier } : {}),
      },
    });
    confirmedIds.push(id);
  };

  const applyResult = async (o: BatchOrderRow, r: ArrangeResult) => {
    if (r.ok) {
      await markProcessed(o.id, {
        trackingCode: r.trackingCode,
        platformPackageId: r.packageId,
        carrierName: r.carrierName,
      });
      if (r.note) notes.push({ orderCode: o.orderCode, note: r.note });
    } else {
      failed.push({ orderCode: o.orderCode, reason: r.error ?? "Sàn từ chối" });
    }
  };

  await Promise.all(
    [...params.groups.entries()].map(async ([channelId, list]) => {
      const channel = list[0].channel;
      const adapter = getFulfillmentAdapter(channel.channelName);
      const setDone = (n: number) => {
        doneByChannel.set(channelId, Math.min(n, list.length));
        void flushProgress();
      };
      try {
        if (!adapter) {
          for (const [i, o] of list.entries()) {
            await markProcessed(o.id);
            setDone(i + 1);
          }
          return;
        }
        if (!adapter.supported) {
          const r = await adapter.arrangeShipment(channel, toRef(list[0]), { method: "PICKUP" });
          for (const o of list) failed.push({ orderCode: o.orderCode, reason: r.error ?? "Sàn chưa hỗ trợ" });
          setDone(list.length);
          return;
        }
        const choice: FulfillChoice =
          params.choices[channel.id] ?? readFulfillDefaults(channel.fulfillmentSettings) ?? { method: "PICKUP" };
        if (params.choices[channel.id]) {
          // Lưu mặc định (bỏ khung giờ — đổi theo ngày)
          await prisma.channel.update({
            where: { id: channel.id },
            data: {
              fulfillmentSettings: {
                method: choice.method,
                ...(choice.addressId ? { addressId: choice.addressId } : {}),
                ...(choice.branchId ? { branchId: choice.branchId } : {}),
              },
            },
          });
        }
        if (adapter.arrangeShipmentBatch) {
          const results = await adapter.arrangeShipmentBatch(channel, list.map(toRef), choice, setDone);
          for (const o of list) {
            const r = results.get(o.id) ?? { ok: false, error: "Sàn không trả kết quả cho đơn này" };
            await applyResult(o, r);
          }
          setDone(list.length);
          return;
        }
        // Đường từng đơn (Lazada): nhịp nhỏ giữa hai đơn cùng gian để không dồn rate-limit.
        for (const [idx, o] of list.entries()) {
          if (idx > 0) await sleep(ARRANGE_GAP_MS);
          const r = await adapter.arrangeShipment(channel, toRef(o), choice);
          await applyResult(o, r);
          setDone(idx + 1);
        }
      } catch (err) {
        // Lỗi cả gian (token hỏng, DB…) — đơn chưa có kết quả ghi lý do chung,
        // gian khác vẫn chạy.
        const reason = err instanceof Error ? err.message : "Lỗi không rõ khi gọi sàn";
        console.error(`[fulfillment.batch] ${batchId} gian "${channel.shopName}" lỗi:`, reason);
        const settled = new Set([...confirmedIds, ...failed.map((f) => f.orderCode)]);
        for (const o of list) {
          if (!settled.has(o.id) && !settled.has(o.orderCode)) failed.push({ orderCode: o.orderCode, reason });
        }
        setDone(list.length);
      }
    })
  );

  await writing; // đợi UPDATE tiến độ cuối cùng để không ghi đè kết quả
  await prisma.fulfillmentBatch.update({
    where: { id: batchId },
    data: {
      status: "DONE",
      done: [...params.groups.values()].reduce((s, g) => s + g.length, 0),
      confirmedIds,
      failed,
      notes,
      finishedAt: new Date(),
    },
  });
}

/** Một lượt RUNNING còn sống của chủ shop — đầu vào cho splitByRunningBatches. */
export interface LiveRunningBatch {
  id: string;
  total: number;
  orderIds: string[];
}

/**
 * Các lượt RUNNING của chủ shop còn được chạm updatedAt trong STALE_MS (nhịp
 * tim 30 s + tiến độ) — lượt im lặng lâu hơn coi như đã chết, không giữ đơn.
 * Đi qua chỉ mục riêng phần fulfillment_batches_running_owner_idx; lúc bình
 * thường 0–2 dòng.
 */
export async function findLiveRunningBatches(ownerId: string): Promise<LiveRunningBatch[]> {
  const rows = await prisma.fulfillmentBatch.findMany({
    where: { ownerId, status: "RUNNING", updatedAt: { gt: new Date(Date.now() - STALE_MS) } },
    select: { id: true, total: true, orderIds: true },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    total: r.total,
    orderIds: Array.isArray(r.orderIds) ? r.orderIds.filter((x): x is string => typeof x === "string") : [],
  }));
}

/** Ảnh chụp tiến độ/kết quả cho giao diện; null = không có hoặc không thuộc chủ shop. */
export async function getFulfillmentBatch(batchId: string, ownerId: string): Promise<BatchSnapshot | null> {
  const row = await prisma.fulfillmentBatch.findFirst({ where: { id: batchId, ownerId } });
  if (!row) return null;
  let status = row.status as BatchSnapshot["status"];
  let error = row.error;
  if (status === "RUNNING" && Date.now() - row.updatedAt.getTime() > STALE_MS) {
    status = "FAILED";
    error = "Máy chủ khởi động lại giữa chừng — tải lại danh sách đơn để xem đơn nào đã được sàn nhận";
    await prisma.fulfillmentBatch
      .update({ where: { id: batchId }, data: { status: "FAILED", error, finishedAt: new Date() } })
      .catch(() => undefined);
  }
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const confirmedIds = arr<string>(row.confirmedIds);
  return {
    batchId: row.id,
    status,
    total: row.total,
    done: status === "RUNNING" ? row.done : row.total,
    confirmed: confirmedIds.length,
    confirmedIds,
    skipped: arr(row.skipped),
    failed: arr(row.failed),
    notes: arr(row.notes),
    error,
  };
}
