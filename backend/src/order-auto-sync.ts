// ============================================================
// TỰ ĐỘNG ĐỒNG BỘ ĐA SÀN THEO NHỊP (polling) — LƯỚI AN TOÀN CẠNH WEBHOOK
//
// Phủ MỌI gian đang hoạt động, không ai phải bấm tay:
//   · ĐƠN HÀNG (Shopee + Lazada): quét mỗi nhịp (mặc định 10 phút, cửa sổ
//     2 ngày gần nhất, upsert idempotent — chạy lặp vô hại).
//   · ĐỐI SOÁT PHÍ THẬT (Lazada Finance API + Shopee Escrow API): chạy MỖI
//     GIỜ (mỗi SETTLE_EVERY_SWEEPS nhịp) với cửa sổ 7 ngày — sao kê đổi chậm,
//     quét dày chỉ tốn quota (10k call/ngày); backfill sâu 90 ngày vẫn dùng
//     nút "Đồng bộ đối soát" tay.
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
import {
  syncShopeePendingEscrowEstimates,
  syncShopeeSettlements,
} from "./integrations/shopee/settlements";
import { syncShopeeAdsSpend } from "./integrations/shopee/ads-spend";
import { isLazadaConfigured } from "./integrations/lazada/config";
import {
  syncLazadaOrders,
  syncLazadaSettlements,
} from "./integrations/lazada/service";

const DEFAULT_INTERVAL_MIN = 10;
/** Quét đơn tạo trong N ngày gần nhất — đủ phủ đơn mới + đổi trạng thái gần đây. */
const ORDERS_DAYS_BACK = 2;
/** Đối soát (Lazada + Shopee) chạy 1 lần mỗi N nhịp (10' × 6 = mỗi giờ). */
const SETTLE_EVERY_SWEEPS = 6;
/** Cửa sổ sao kê cho lượt đối soát tự động — đơn thường quyết toán trong vài ngày. */
const SETTLE_DAYS_BACK = 7;
/** Chạy lượt đầu sớm sau khi boot để không phải đợi trọn một nhịp. */
const FIRST_RUN_DELAY_MS = 15 * 1000;
/**
 * Giãn cách giữa hai gian liên tiếp trong một lượt quét (+ jitter ngẫu nhiên).
 * Nhiều shop cùng kết nối qua MỘT partner_id: bắn API cho cả chục shop trong
 * cùng một giây, đều tăm tắp mỗi nhịp, là pattern máy móc dễ lọt vào thuật toán
 * quét bất thường của sàn. Tuần tự + jitter làm nhịp gọi tự nhiên hơn, đổi lại
 * mỗi lượt quét dài thêm vài chục giây — vô hại với worker nền.
 */
const CHANNEL_STAGGER_BASE_MS = 2000;
const CHANNEL_STAGGER_JITTER_MS = 3000;

let started = false;
let running = false;
let sweepCount = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
    `[Auto-sync] BẬT — quét đơn Shopee+Lazada mỗi ${min} phút; đối soát phí Lazada+Shopee mỗi ${
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

      // --- Đối soát phí thật (Lazada + Shopee, theo nhịp giờ) ---
      if (settleSweep) {
        try {
          if (channel.channelName === ChannelName.LAZADA) {
            const s = await syncLazadaSettlements(channel, { daysBack: SETTLE_DAYS_BACK });
            if (s.ordersUpdated > 0) {
              console.log(
                `[Auto-sync] Đối soát Lazada "${channel.shopName}": ${s.ordersUpdated} đơn nhận số phí thật (${s.transactions} dòng sao kê)`
              );
            }
          } else if (channel.channelName === ChannelName.SHOPEE) {
            const s = await syncShopeeSettlements(channel, { daysBack: SETTLE_DAYS_BACK });
            if (s.ordersUpdated > 0) {
              console.log(
                `[Auto-sync] Đối soát Shopee "${channel.shopName}": ${s.ordersUpdated} đơn nhận số phí thật (${s.transactions} đơn giải ngân)`
              );
            }
            // Đơn CHƯA giải ngân: kéo số phí ƯỚC TÍNH của sàn để P&L real-time
            // (isSettled vẫn false — nhãn "chờ đối soát" giữ nguyên).
            const est = await syncShopeePendingEscrowEstimates(channel, {
              daysBack: SETTLE_DAYS_BACK,
            });
            if (est.updated > 0) {
              console.log(
                `[Auto-sync] Ước tính phí Shopee "${channel.shopName}": ${est.updated}/${est.scanned} đơn chờ đối soát nhận số tạm tính`
              );
            }
            // Chi phí quảng cáo theo ngày (Ads API) — lỗi riêng (thường là app
            // chưa được bật quyền Ads) không được chặn các luồng khác.
            try {
              const ads = await syncShopeeAdsSpend(channel, { daysBack: 30 });
              if (ads.daysUpserted > 0) {
                console.log(
                  `[Auto-sync] Chi phí Ads Shopee "${channel.shopName}": ${ads.daysUpserted} ngày chi tiêu`
                );
              }
            } catch (err) {
              console.error(
                `[Auto-sync] Lỗi sync Ads gian "${channel.shopName}" (app có thể chưa bật quyền Ads API):`,
                (err as Error).message
              );
            }
          }
        } catch (err) {
          console.error(
            `[Auto-sync] Lỗi đối soát gian "${channel.shopName}":`,
            (err as Error).message
          );
        }
      }

      // Giãn cách trước khi sang gian kế tiếp (gian cuối không cần chờ).
      if (channel !== channels[channels.length - 1]) {
        await sleep(CHANNEL_STAGGER_BASE_MS + Math.random() * CHANNEL_STAGGER_JITTER_MS);
      }
    }
  } catch (err) {
    console.error("[Auto-sync] Lỗi vòng quét:", err);
  } finally {
    running = false;
  }
}
