// ============================================================
// WORKER LÀN ĐỌC SÀN (Pha C lát 1 — "đọc bóng đơn", docs/CUNG-HOA-LOP-GOI-SAN.md 5c)
//
// Chạy làn "orders" của lớp đọc sàn mới (services/sync-lanes) — nhặt các
// (gian, luồng) đã GHI DANH trong `sync_cursors`. Lát 1 chỉ có luồng
// `orders-shadow`: đọc danh sách đơn qua cổng gọi sàn + máy đọc con trỏ, ghi
// bảng bóng, KHÔNG đụng Order. Gian chưa ghi danh → không có dòng → làn chỉ hỏi
// DB mỗi LANE_IDLE_POLL_MS (một SELECT nhỏ). Tắt cả worker: READ_LANES=0.
// Tắt một gian: xóa dòng sync_cursors của gian (hoặc scripts/shadow-enroll.ts --off).
//
// Không giữ trạng thái nghiệp vụ ở biến cấp module (test no-module-state):
// con trỏ, thuê bao, lùi đều trong DB.
// ============================================================

import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma";
import { LANES, LEASE } from "../config/marketplace-read";
import { pgLeaseStore, runLane, type LeaseItem } from "../services/sync-lanes";
import { prismaCursorStore, readByCursor } from "../services/cursor-reader";
import { isGatewayDefer } from "../services/marketplace-gateway";
import { SHADOW_STREAM, shadowOrderSpec } from "../integrations/order-read-adapters";

/** 429 lùi ngắn hơn ngưỡng này → chờ rồi đọc lại đúng trang; dài hơn → trả việc cho làn hẹn lại. TỰ CHỌN 30 s. */
const INLINE_RETRY_MAX_MS = 30_000;
/** Gian không còn đọc được (ngắt, ngủ đông, sàn lạ) → hỏi lại sau 1 giờ, không gọi sàn. */
const SKIP_RECHECK_MS = 60 * 60_000;

export async function handleReadItem(item: LeaseItem, signal: AbortSignal): Promise<number> {
  if (item.stream !== SHADOW_STREAM) {
    console.warn(`[read-lanes] luồng chưa hỗ trợ ${item.stream} (${item.channelId}) — bỏ qua 1 giờ`);
    return SKIP_RECHECK_MS;
  }
  const channel = await prisma.channel.findUnique({ where: { id: item.channelId } });
  if (!channel || channel.status !== "ACTIVE" || channel.hibernatedAt) return SKIP_RECHECK_MS;

  const spec = shadowOrderSpec(channel);
  const r = await readByCursor(spec, prismaCursorStore, {
    signal,
    retryDelay: (err) => (isGatewayDefer(err) && err.waitMs <= INLINE_RETRY_MAX_MS ? err.waitMs : null),
  });
  const lagMin = Math.round(r.lagMs / 60_000);
  if (r.status !== "caught_up" || r.shrinks || r.floorOverflows || r.unstableRereads || r.pageRetries) {
    console.log(
      `[read-lanes] ${channel.channelName} "${channel.shopName}" ${item.stream}: ${r.status}, ${r.pages} trang / ${r.rows} dòng, ` +
        `${r.windowsCompleted} cửa sổ, co ${r.shrinks}, đáy tràn ${r.floorOverflows}, đọc lại ${r.unstableRereads}, trang thử lại ${r.pageRetries}, ` +
        `cửa sổ học ${Math.round(r.windowMs / 60_000)}', trễ ${lagMin}'`
    );
  }
  if (r.status === "caught_up") return LEASE.CAUGHT_UP_RECHECK_MS;
  return 0; // hết ngân sách / bị hủy → tới hạn lại ngay, xếp sau gian chờ lâu hơn
}

export function startReadLanes(): AbortController | null {
  if ((process.env.READ_LANES ?? "1").trim() === "0") {
    console.log("[read-lanes] READ_LANES=0 — không chạy làn đọc sàn mới");
    return null;
  }
  const stop = new AbortController();
  const owner = `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
  const lane = "orders";
  console.log(`[read-lanes] làn ${lane} × ${LANES[lane].concurrency} luồng, owner ${owner}`);
  void runLane({
    lane,
    concurrency: LANES[lane].concurrency,
    owner,
    store: pgLeaseStore,
    handle: handleReadItem,
    stop: stop.signal,
  }).then((s) => console.log(`[read-lanes] làn ${lane} dừng: ${s.runs} lượt, ${s.errors} lỗi, ${s.lost} mất thuê bao`));
  return stop;
}
