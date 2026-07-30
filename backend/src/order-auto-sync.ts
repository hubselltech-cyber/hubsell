// ============================================================
// TỰ ĐỘNG ĐỒNG BỘ ĐA SÀN THEO NHỊP (polling) — LƯỚI AN TOÀN CẠNH WEBHOOK
//
// Phủ MỌI gian đang hoạt động, không ai phải bấm tay:
//   · ĐƠN HÀNG (Shopee + Lazada): quét mỗi nhịp (mặc định 10 phút, cửa sổ
//     2 ngày gần nhất, upsert idempotent — chạy lặp vô hại).
//   · ĐỐI SOÁT PHÍ THẬT (Lazada Finance API): chạy MỖI GIỜ (mỗi
//     SETTLE_EVERY_SWEEPS nhịp) với cửa sổ 7 ngày — sao kê đổi chậm, quét
//     dày chỉ tốn quota (10k call/ngày); backfill sâu 90 ngày vẫn dùng nút
//     "Đồng bộ đối soát" tay.
//
// TikTok cố ý đứng ngoài: gian hiện tại là mock sandbox không token, webhook
// TikTok thật đã có đường riêng — thêm vào đây khi nối shop TikTok thật.
//
// Cấu hình: AUTO_SYNC_MINUTES (ưu tiên) hoặc SHOPEE_AUTO_SYNC_MINUTES (tương
// thích cũ). Mặc định 10; "0" = tắt toàn bộ.
// ============================================================

import { ChannelName } from "@prisma/client";
import { prisma } from "./prisma";
import { isShopeeConfigured } from "./integrations/shopee/config";
import { syncShopeeOrders } from "./integrations/shopee/service";
import { isLazadaConfigured } from "./integrations/lazada/config";
import {
  syncLazadaOrders,
  syncLazadaSettlements,
} from "./integrations/lazada/service";

const DEFAULT_INTERVAL_MIN = 10;
/** Quét đơn tạo trong N ngày gần nhất — đủ phủ đơn mới + đổi trạng thái gần đây. */
const ORDERS_DAYS_BACK = 2;
/** Đối soát Lazada chạy 1 lần mỗi N nhịp (10' × 6 = mỗi giờ). */
const SETTLE_EVERY_SWEEPS = 6;
/** Cửa sổ sao kê cho lượt đối soát tự động — đơn thường quyết toán trong vài ngày. */
const SETTLE_DAYS_BACK = 7;
/** Chạy lượt đầu sớm sau khi boot để không phải đợi trọn một nhịp. */
const FIRST_RUN_DELAY_MS = 15 * 1000;

let started = false;
let running = false;
let sweepCount = 0;

/**
 * Khởi động worker (gọi 1 lần từ index.ts — KHÔNG gọi trong test, kẻo test
 * gọi API sàn thật). Timer unref để không giữ process sống khi server tắt.
 */
export function startOrderAutoSync(): void {
  if (started) return;
  started = true;

  const min = Number(
    process.env.AUTO_SYNC_MINUTES ??
      process.env.SHOPEE_AUTO_SYNC_MINUTES ??
      DEFAULT_INTERVAL_MIN
  );
  if (!Number.isFinite(min) || min <= 0) {
    console.log("[Auto-sync] TẮT (AUTO_SYNC_MINUTES=0)");
    return;
  }

  setTimeout(() => void runOnce(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runOnce(), min * 60 * 1000).unref();
  console.log(
    `[Auto-sync] BẬT — quét đơn Shopee+Lazada mỗi ${min} phút; đối soát phí Lazada mỗi ${
      min * SETTLE_EVERY_SWEEPS
    } phút`
  );
}

/** Một lượt quét tất cả gian ACTIVE. Chống chạy chồng bằng cờ `running`. */
async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  sweepCount++;
  // Lượt đầu sau boot chạy CẢ đối soát — restart giữa đêm không làm trễ nhịp giờ.
  const settleSweep = sweepCount === 1 || sweepCount % SETTLE_EVERY_SWEEPS === 0;

  try {
    const channels = await prisma.channel.findMany({
      where: {
        channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] },
        status: "ACTIVE",
        refreshToken: { not: null },
      },
    });

    for (const channel of channels) {
      // --- Đơn hàng ---
      try {
        if (channel.channelName === ChannelName.SHOPEE) {
          if (!isShopeeConfigured()) continue;
          const r = await syncShopeeOrders(channel, { daysBack: ORDERS_DAYS_BACK });
          if (r.created > 0) {
            console.log(
              `[Auto-sync] Shopee "${channel.shopName}": +${r.created} đơn mới (${r.updated} cập nhật)`
            );
          }
        } else {
          if (!isLazadaConfigured()) continue;
          const r = await syncLazadaOrders(channel, { daysBack: ORDERS_DAYS_BACK });
          if (r.created > 0) {
            console.log(
              `[Auto-sync] Lazada "${channel.shopName}": +${r.created} đơn mới (${r.updated} cập nhật)`
            );
          }
        }
      } catch (err) {
        // Lỗi một gian (token hết hạn, sàn chập chờn) không được chặn gian khác.
        console.error(
          `[Auto-sync] Lỗi đồng bộ đơn gian "${channel.shopName}":`,
          (err as Error).message
        );
      }

      // --- Đối soát phí thật (Lazada, theo nhịp giờ) ---
      if (settleSweep && channel.channelName === ChannelName.LAZADA) {
        try {
          const s = await syncLazadaSettlements(channel, { daysBack: SETTLE_DAYS_BACK });
          if (s.ordersUpdated > 0) {
            console.log(
              `[Auto-sync] Đối soát Lazada "${channel.shopName}": ${s.ordersUpdated} đơn nhận số phí thật (${s.transactions} dòng sao kê)`
            );
          }
        } catch (err) {
          console.error(
            `[Auto-sync] Lỗi đối soát gian "${channel.shopName}":`,
            (err as Error).message
          );
        }
      }
    }
  } catch (err) {
    console.error("[Auto-sync] Lỗi vòng quét:", err);
  } finally {
    running = false;
  }
}
