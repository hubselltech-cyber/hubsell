// ============================================================
// CRON REFRESH TOKEN SHOPEE — LƯỚI AN TOÀN CHO MULTI-SHOP
//
// Chiến lược token 2 tầng:
//   1) LAZY (chính)  : getValidShopeeAccessToken() tự refresh ngay trước lượt
//      gọi API khi token còn <5 phút — shop có traffic không bao giờ cần cron.
//   2) CRON (lưới)   : worker này quét DB theo nhịp, bắt các gian ACTIVE mà
//      access_token sắp/đã hết hạn nhưng KHÔNG có traffic để kích lazy-refresh
//      (auto-sync tắt, shop vắng đơn...). Giữ refresh_token được rotate đều
//      trong vòng đời 30 ngày — shop bỏ bê 1 tháng vẫn không phải uỷ quyền lại.
//
// KHÔNG refresh ồ ạt theo lịch cứng: chỉ đụng token thực sự sắp hết hạn, chạy
// TUẦN TỰ từng shop + giãn cách ngẫu nhiên (jitter) — tránh vẽ ra pattern burst
// đều tăm tắp cho thuật toán quét bất thường phía Shopee.
//
// Cấu hình: TOKEN_REFRESH_MINUTES (mặc định 30; "0" = tắt).
// ============================================================

import { ChannelName } from "@prisma/client";
import { prisma } from "./prisma";
import { isShopeeConfigured } from "./integrations/shopee/config";
import { getValidShopeeAccessToken } from "./integrations/shopee/service";

const DEFAULT_INTERVAL_MIN = 30;
/** Coi là "sắp hết hạn" khi access_token còn dưới ngưỡng này. */
const EXPIRING_SOON_MS = 20 * 60 * 1000;
/** Nghỉ nền giữa hai shop liên tiếp (cộng thêm jitter ngẫu nhiên bên dưới). */
const STAGGER_BASE_MS = 2000;
const STAGGER_JITTER_MS = 3000;
/** Chạy lượt đầu sớm sau boot — restart không làm shop nào lỡ nhịp refresh. */
const FIRST_RUN_DELAY_MS = 20 * 1000;

let started = false;
let running = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Khởi động worker (gọi 1 lần từ index.ts — KHÔNG gọi trong test). */
export function startTokenRefreshWorker(): void {
  if (started) return;
  started = true;

  const min = Number(process.env.TOKEN_REFRESH_MINUTES ?? DEFAULT_INTERVAL_MIN);
  if (!Number.isFinite(min) || min <= 0) {
    console.log("[Token-refresh] TẮT (TOKEN_REFRESH_MINUTES=0)");
    return;
  }

  setTimeout(() => void runOnce(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runOnce(), min * 60 * 1000).unref();
  console.log(`[Token-refresh] BẬT — quét token Shopee sắp hết hạn mỗi ${min} phút`);
}

/** Một lượt quét. Chống chạy chồng bằng cờ `running` (giống order-auto-sync). */
export async function runOnce(): Promise<void> {
  if (running) return;
  running = true;

  try {
    if (!isShopeeConfigured()) return;

    const now = new Date();
    const soon = new Date(now.getTime() + EXPIRING_SOON_MS);

    // Lọc NGAY TRONG QUERY: chỉ lôi về đúng các gian cần đụng tới, mỗi gian một
    // bản ghi token riêng — không đọc cả bảng rồi lọc trong RAM.
    const channels = await prisma.channel.findMany({
      where: {
        channelName: ChannelName.SHOPEE,
        status: "ACTIVE",
        refreshToken: { not: null },
        externalShopId: { not: null },
        OR: [{ accessTokenExpireAt: null }, { accessTokenExpireAt: { lt: soon } }],
      },
      orderBy: { accessTokenExpireAt: "asc" }, // gian gấp nhất refresh trước
    });
    if (channels.length === 0) return;

    for (const channel of channels) {
      // refresh_token đã chết → refresh chắc chắn fail, gọi chỉ tốn quota và vẽ
      // thêm lỗi auth về phía Shopee. Đánh dấu DISCONNECTED để UI nhắc chủ shop
      // uỷ quyền lại (không xoá token — đồng bộ với xử lý webhook code 5).
      const refreshExp = channel.refreshTokenExpireAt?.getTime() ?? 0;
      if (refreshExp && refreshExp < Date.now()) {
        await prisma.channel.update({
          where: { id: channel.id },
          data: { status: "DISCONNECTED", disconnectedAt: new Date() },
        });
        console.warn(
          `[Token-refresh] Gian "${channel.shopName}" (shop ${channel.externalShopId}) hết hạn uỷ quyền → DISCONNECTED, cần kết nối lại`
        );
        continue;
      }

      try {
        // Dùng CHUNG đường refresh với luồng lazy → chung mutex per-shop, không
        // bao giờ đua rotate refresh_token với webhook/sync đang chạy. Truyền
        // ngưỡng TTL của cron để refresh CHỦ ĐỘNG (mặc định 5' của luồng API
        // sẽ bỏ qua token còn 5-20 phút mà cron đã lôi về).
        await getValidShopeeAccessToken(channel, EXPIRING_SOON_MS);
        console.log(
          `[Token-refresh] Đã làm mới token gian "${channel.shopName}" (shop ${channel.externalShopId})`
        );
      } catch (err) {
        // Lỗi một gian (mạng, Shopee chập chờn) không được chặn gian sau.
        console.error(
          `[Token-refresh] Lỗi refresh gian "${channel.shopName}":`,
          (err as Error).message
        );
      }

      // Giãn cách + jitter giữa các shop — không bắn refresh đồng loạt.
      await sleep(STAGGER_BASE_MS + Math.random() * STAGGER_JITTER_MS);
    }
  } catch (err) {
    console.error("[Token-refresh] Lỗi vòng quét:", err);
  } finally {
    running = false;
  }
}
