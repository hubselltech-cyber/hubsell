// ============================================================
// LÀN TỰ CHUẨN BỊ HÀNG (04/11/2026) — docs/TU-CHUAN-BI-HANG.md
//
// Làn "fulfill" của services/sync-lanes: nhặt các gian đã bật công tắc (dòng
// sync_cursors stream "auto-arrange"; "auto-arrange-shadow" = chỉ log). Mỗi lượt
// một gian: chọn đơn Chờ xử lý đủ điều kiện (lib/auto-arrange) → chạy ĐÚNG mẻ
// Chuẩn bị hàng của nút bấm tay (batch-runner, source AUTO) → phân loại lỗi
// từng đơn → hẹn lượt kế. Không giữ trạng thái ở biến tiến trình.
// Tắt cả làn: AUTO_ARRANGE_LANE=0. Tắt một gian: gạt công tắc (xóa dòng).
// ============================================================

import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { ShippingStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AUTO_ARRANGE, LANES, LEASE } from "../config/marketplace-read";
import { pgLeaseStore, runLane, type LeaseItem } from "../services/sync-lanes";
import {
  AUTO_ARRANGE_LANE,
  AUTO_ARRANGE_SHADOW_STREAM,
  AUTO_ARRANGE_STREAM,
  classifyArrangeFailure,
  isAuthFailure,
  isChannelWideFailure,
  jittered,
  selectAutoArrangeCandidates,
  type SkipReason,
} from "../lib/auto-arrange";
import { getFulfillmentAdapter } from "../services/fulfillment";
import { findLiveRunningBatches, runFulfillmentBatchNow, type BatchOrderRow } from "../services/fulfillment/batch-runner";
import { notify } from "../services/notifications";

/** Gian không còn chạy được (ngắt, ngủ đông, tắt công tắc) → hỏi lại sau 1 giờ, không gọi sàn. */
const SKIP_RECHECK_MS = 60 * 60_000;

const SKIP_LABEL: Record<SkipReason, string> = {
  unpaid: "chưa thanh toán",
  cancel_requested: "khách xin hủy",
  express: "hỏa tốc",
  blocked: "đã chặn",
  max_attempts: "quá số lần",
  tried_recently: "vừa thử",
  in_running_batch: "đang trong mẻ khác",
};

function describeSkipped(skipped: Record<SkipReason, number>): string {
  const parts = (Object.keys(skipped) as SkipReason[]).filter((k) => skipped[k] > 0).map((k) => `${SKIP_LABEL[k]} ${skipped[k]}`);
  return parts.length ? parts.join(", ") : "không";
}

export async function handleAutoArrangeItem(item: LeaseItem, _signal: AbortSignal): Promise<number> {
  const shadow = item.stream === AUTO_ARRANGE_SHADOW_STREAM;
  if (!shadow && item.stream !== AUTO_ARRANGE_STREAM) {
    console.warn(`[auto-arrange] luồng lạ ${item.stream} (${item.channelId}) — bỏ qua 1 giờ`);
    return SKIP_RECHECK_MS;
  }
  const channel = await prisma.channel.findUnique({ where: { id: item.channelId } });
  if (!channel) return SKIP_RECHECK_MS;
  const tag = `[auto-arrange] ${channel.channelName} "${channel.shopName}"${shadow ? " bóng" : ""}`;

  // Công tắc đã tắt mà dòng làn còn sót (ghi tay / lỗi giữa giao dịch) → tự dọn.
  if (!shadow && !channel.autoArrangeEnabledAt) {
    await prisma.syncCursor.deleteMany({ where: { channelId: channel.id, stream: AUTO_ARRANGE_STREAM } });
    console.warn(`${tag}: công tắc đã tắt, xóa dòng làn`);
    return SKIP_RECHECK_MS;
  }
  if (channel.status !== "ACTIVE" || channel.hibernatedAt) return SKIP_RECHECK_MS;
  const adapter = getFulfillmentAdapter(channel.channelName);
  if (!adapter || !adapter.supported) {
    console.warn(`${tag}: sàn chưa có bộ sắp xếp vận chuyển — bỏ qua 1 giờ`);
    return SKIP_RECHECK_MS;
  }

  const now = new Date();
  const maxPerRun = adapter.arrangeShipmentBatch ? AUTO_ARRANGE.MAX_PER_RUN : AUTO_ARRANGE.MAX_PER_RUN_SEQUENTIAL;
  // Chỉ mục một phần Order_auto_arrange_pending_idx (channelId, createdAt) WHERE PENDING.
  // Lọc thô ở DB, luật đầy đủ ở hàm thuần (một chỗ để test).
  const pending = await prisma.order.findMany({
    where: {
      channelId: channel.id,
      shippingStatus: ShippingStatus.PENDING,
      autoArrangeBlockedAt: null,
      autoArrangeAttempts: { lt: AUTO_ARRANGE.MAX_ATTEMPTS },
    },
    select: {
      id: true,
      orderCode: true,
      createdAt: true,
      paymentStatus: true,
      cancelRequestedAt: true,
      shippingCarrierName: true,
      autoArrangeTriedAt: true,
      autoArrangeAttempts: true,
      autoArrangeBlockedAt: true,
      trackingCode: true,
      platformPackageId: true,
    },
    orderBy: { createdAt: "asc" },
    // Đọc dư một ít so với trần lượt để biết "còn nữa" sau khi loại.
    take: maxPerRun * 2 + 50,
  });

  const running = await findLiveRunningBatches(channel.userId);
  const runningOrderIds = new Set(running.flatMap((b) => b.orderIds));
  const sel = selectAutoArrangeCandidates(pending, {
    now,
    runningOrderIds,
    maxAttempts: AUTO_ARRANGE.MAX_ATTEMPTS,
    retryAfterMs: AUTO_ARRANGE.INTERVAL_MS,
    maxPerRun,
  });
  const nextIdle = () => jittered(AUTO_ARRANGE.INTERVAL_MS, AUTO_ARRANGE.JITTER_MS);

  if (sel.ready.length === 0) {
    if (pending.length > 0) console.log(`${tag}: 0/${pending.length} đơn đủ điều kiện (${describeSkipped(sel.skipped)})`);
    return nextIdle();
  }

  if (shadow) {
    console.log(
      `${tag}: sẽ chuẩn bị ${sel.ready.length} đơn${sel.more ? " (còn nữa)" : ""} — ${sel.ready
        .slice(0, 10)
        .map((o) => o.orderCode)
        .join(", ")}${sel.ready.length > 10 ? "…" : ""}; bỏ qua: ${describeSkipped(sel.skipped)}`
    );
    return nextIdle();
  }

  // Đánh dấu "đã thử" TRƯỚC khi gọi sàn: worker chết giữa lượt thì các đơn này
  // không bị gọi lại ngay lượt sau (chờ INTERVAL), tránh "not eligible for rescheduling".
  const readyIds = sel.ready.map((o) => o.id);
  await prisma.order.updateMany({ where: { id: { in: readyIds } }, data: { autoArrangeTriedAt: now } });

  const rows: BatchOrderRow[] = sel.ready.map((o) => ({
    id: o.id,
    orderCode: o.orderCode,
    channelId: channel.id,
    channel,
    trackingCode: o.trackingCode,
    platformPackageId: o.platformPackageId,
  }));
  const snap = await runFulfillmentBatchNow({
    ownerId: channel.userId,
    groups: new Map([[channel.id, rows]]),
    choices: {}, // mặc định gian đã lưu khi bấm tay; chưa có → PICKUP như nút bấm tay
    skipped: [],
    source: "AUTO",
  });

  // Lỗi cả gian: không đánh dấu đơn (lượt sau sẽ thử lại cả lượt), hẹn gian lại.
  if (isChannelWideFailure(snap.failed, snap.total)) {
    const reason = snap.failed[0].reason;
    await prisma.order.updateMany({ where: { id: { in: readyIds } }, data: { autoArrangeTriedAt: null } });
    console.warn(`${tag}: lỗi cả gian, ${snap.total} đơn không gọi được — ${reason}`);
    return isAuthFailure(reason) ? AUTO_ARRANGE.AUTH_RETRY_MS : LEASE.ERROR_RETRY_MS;
  }

  const byCode = new Map(sel.ready.map((o) => [o.orderCode, o]));
  const retryIds: string[] = [];
  const blocked: { id: string; orderCode: string; reason: string }[] = [];
  for (const f of snap.failed) {
    const o = byCode.get(f.orderCode);
    if (!o) continue;
    const cls = classifyArrangeFailure(f.reason);
    if (cls === "retry") {
      // Lần cuối "chưa sẵn sàng" → chặn với lý do nói rõ số lần, không thử nữa.
      if (o.autoArrangeAttempts + 1 >= AUTO_ARRANGE.MAX_ATTEMPTS) {
        blocked.push({ id: o.id, orderCode: o.orderCode, reason: `Sàn báo chưa sẵn sàng sau ${AUTO_ARRANGE.MAX_ATTEMPTS} lần thử — ${f.reason}` });
      } else retryIds.push(o.id);
    } else {
      // "channel" lẻ tẻ (không phải cả gian) coi như lỗi riêng đơn để không treo mãi.
      blocked.push({ id: o.id, orderCode: o.orderCode, reason: f.reason });
    }
  }
  if (retryIds.length) {
    await prisma.order.updateMany({ where: { id: { in: retryIds } }, data: { autoArrangeAttempts: { increment: 1 } } });
  }
  for (const b of blocked) {
    await prisma.order.updateMany({
      where: { id: b.id, shippingStatus: ShippingStatus.PENDING },
      data: { autoArrangeBlockedAt: now, autoArrangeBlockedReason: b.reason.slice(0, 500), autoArrangeAttempts: { increment: 1 } },
    });
  }

  console.log(
    `${tag}: lượt ${snap.batchId} ${snap.confirmed}/${snap.total} sàn nhận, thử lại ${retryIds.length}, chặn ${blocked.length}` +
      `${sel.more ? ", còn nữa" : ""}; bỏ qua: ${describeSkipped(sel.skipped)}`
  );
  if (blocked.length) {
    const sample = blocked.slice(0, 3).map((b) => b.orderCode).join(", ");
    await notify(channel.userId, {
      type: "auto-arrange",
      title: `Tự chuẩn bị hàng: gian ${channel.shopName} có đơn cần làm tay`,
      body: `${blocked.length} đơn máy không chuẩn bị được (${sample}${blocked.length > 3 ? "…" : ""}). Mở Đơn hàng → Chờ xử lý, trỏ vào nhãn để xem lý do.`,
      link: "/orders?tab=pending",
    });
  }

  return sel.more ? 0 : nextIdle();
}

export function startAutoArrangeLane(): AbortController | null {
  if ((process.env.AUTO_ARRANGE_LANE ?? "1").trim() === "0") {
    console.log("[auto-arrange] AUTO_ARRANGE_LANE=0 — không chạy làn tự chuẩn bị hàng");
    return null;
  }
  const stop = new AbortController();
  const owner = `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
  const lane = AUTO_ARRANGE_LANE;
  console.log(`[auto-arrange] làn ${lane} × ${LANES.fulfill.concurrency} luồng, owner ${owner}`);
  void runLane({
    lane,
    concurrency: LANES.fulfill.concurrency,
    owner,
    store: pgLeaseStore,
    handle: handleAutoArrangeItem,
    stop: stop.signal,
    errorRetryMs: LEASE.ERROR_RETRY_MS,
  }).then((s) => console.log(`[auto-arrange] làn ${lane} dừng: ${s.runs} lượt, ${s.errors} lỗi, ${s.lost} mất thuê bao`));
  return stop;
}
