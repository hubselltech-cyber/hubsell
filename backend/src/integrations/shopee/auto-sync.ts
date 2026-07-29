// ============================================================
// TỰ ĐỘNG ĐỒNG BỘ ĐƠN SHOPEE THEO NHỊP (polling) — LƯỚI AN TOÀN CẠNH WEBHOOK
//
// Webhook (Live Push) là đường realtime, nhưng: (1) sandbox KHÔNG auto-push
// sự kiện test order — push tự động chỉ chạy khi app Go-Live; (2) kể cả khi
// live, push có thể rớt (mạng, retry cạn). Worker này quét đơn mới theo nhịp
// cho MỌI gian Shopee đang hoạt động — đơn luôn tự về, chậm nhất một nhịp,
// không ai phải bấm "Đồng bộ đơn" tay.
//
// Nhẹ ký: mỗi lượt chỉ kéo cửa sổ DAYS_BACK ngày gần nhất (1 lần get_order_list
// mỗi gian), upsert idempotent theo (channelId, order_sn) nên chạy lặp vô hại.
// CỐ Ý không đụng tồn kho (giống đồng bộ lô) — trừ/hoàn kho realtime là việc
// của webhook.
//
// Cấu hình: SHOPEE_AUTO_SYNC_MINUTES (mặc định 10; "0" = tắt).
// ============================================================

import { ChannelName } from "@prisma/client";
import { prisma } from "../../prisma";
import { isShopeeConfigured } from "./config";
import { syncShopeeOrders } from "./service";

const DEFAULT_INTERVAL_MIN = 10;
/** Quét đơn tạo trong N ngày gần nhất — đủ phủ đơn mới + đổi trạng thái gần đây. */
const DAYS_BACK = 2;
/** Chạy lượt đầu sớm sau khi boot để không phải đợi trọn một nhịp. */
const FIRST_RUN_DELAY_MS = 15 * 1000;

let started = false;
let running = false;

/**
 * Khởi động worker (gọi 1 lần từ index.ts — KHÔNG gọi trong test, kẻo test
 * gọi API sàn thật). Timer unref để không giữ process sống khi server tắt.
 */
export function startShopeeOrderAutoSync(): void {
  if (started) return;
  started = true;

  const min = Number(process.env.SHOPEE_AUTO_SYNC_MINUTES ?? DEFAULT_INTERVAL_MIN);
  if (!Number.isFinite(min) || min <= 0) {
    console.log("[Auto-sync Shopee] TẮT (SHOPEE_AUTO_SYNC_MINUTES=0)");
    return;
  }

  setTimeout(() => void runOnce(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runOnce(), min * 60 * 1000).unref();
  console.log(`[Auto-sync Shopee] BẬT — tự quét đơn mỗi ${min} phút cho các gian đang hoạt động`);
}

/** Một lượt quét tất cả gian Shopee ACTIVE. Chống chạy chồng bằng cờ `running`. */
async function runOnce(): Promise<void> {
  if (running || !isShopeeConfigured()) return;
  running = true;
  try {
    const channels = await prisma.channel.findMany({
      where: {
        channelName: ChannelName.SHOPEE,
        status: "ACTIVE",
        refreshToken: { not: null },
      },
    });

    for (const channel of channels) {
      try {
        const r = await syncShopeeOrders(channel, { daysBack: DAYS_BACK });
        // Chỉ log khi có gì đáng nói — nhịp 10' mà log mọi lượt sẽ ngập console.
        if (r.created > 0) {
          console.log(
            `[Auto-sync Shopee] Gian "${channel.shopName}": +${r.created} đơn mới (quét ${r.fetched} đơn, ${r.updated} cập nhật)`
          );
        }
      } catch (err) {
        // Lỗi một gian (token hết hạn, sàn chập chờn) không được chặn gian khác.
        console.error(
          `[Auto-sync Shopee] Lỗi gian "${channel.shopName}":`,
          (err as Error).message
        );
      }
    }
  } catch (err) {
    console.error("[Auto-sync Shopee] Lỗi vòng quét:", err);
  } finally {
    running = false;
  }
}
