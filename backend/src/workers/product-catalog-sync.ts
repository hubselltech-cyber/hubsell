// ============================================================
// DANH MỤC SẢN PHẨM TỰ KÉO THEO GIAN — 28/09/2026
//
// Anh Trung 28/09: nối gian xong, bấm đồng bộ ở Kênh bán, vào Giá vốn thì trống —
// vì Kênh bán chỉ có Đồng bộ đơn / đối soát, danh mục sản phẩm chỉ về khi khách
// bấm "Đồng bộ từ sàn" ở trang Giá vốn / Liên kết SP, không có gì tự động.
// Anh chốt: GIAN VỪA NỐI LÀ WORKER TỰ KÉO DANH MỤC (mục 1); nút "Đồng bộ từ
// sàn" chạy nền + tiến độ (mục 2) và nút ở Kênh bán (mục 3) để hôm sau.
//
// Cơ chế (một cột lịch, giống nextFastSyncAt của đơn):
//   · Channel.nextProductSyncAt = now lúc TẠO gian (Shopee/Lazada/TikTok) →
//     worker kéo ngay lượt kế (poll 5').
//   · Xong → lastProductSyncAt = now, lịch kế = đêm sau 03:00–05:00 giờ VN
//     (rải ngẫu nhiên để 13 gian Shopee không cùng lúc đập get_model_list —
//     sự cố DarkMan 05/09 error_rate_limit khi kéo nguyên danh mục).
//   · Lỗi (sàn bận, token…) → productSyncError + thử lại sau 30'.
//   · Nút "Đồng bộ từ sàn" của khách cũng ghi lịch qua scheduleAfterProductSync
//     để worker không kéo lại ngay sau đó.
//   · Chạy TUẦN TỰ từng gian, tối đa MAX_PER_CYCLE gian mỗi lượt poll; nhận
//     gian bằng updateMany có điều kiện (nhiều worker không đụng nhau).
// Tắt: PRODUCT_CATALOG_SYNC_OFF=1.
// ============================================================

import { ChannelName } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { syncChannelProducts } from "../marketplace/product-sync";

const POLL_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;
/** Mỗi lượt poll kéo tối đa N gian (tuần tự) — gian mới nối vẫn được kéo trong ≤5'. */
const MAX_PER_CYCLE = 5;
/** Lỗi → thử lại sau. */
const RETRY_MS = 30 * 60 * 1000;
/** Nhận gian = đẩy lịch ra xa để tiến trình khác không nhận trùng; xong ghi lịch thật. */
const CLAIM_MS = 60 * 60 * 1000;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
/** Khung đêm (giờ VN): bắt đầu 03:00, rải trong 120'. */
export const NIGHTLY_WINDOW = { startHour: 3, spreadMin: 120 } as const;

const ONLINE = [ChannelName.SHOPEE, ChannelName.LAZADA, ChannelName.TIKTOK];

/**
 * Hàm thuần (test): mốc 03:00 giờ VN của NGÀY KẾ TIẾP + rand × 120'.
 * Luôn là ngày mai kể cả khi now < 03:00 (kéo xong lúc 01:00 thì 03:00 hôm nay
 * kéo lại là thừa).
 */
export function nextNightlySlot(now: Date, rand: number = Math.random()): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const dayStartVn = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + 1);
  const slotVn =
    dayStartVn +
    NIGHTLY_WINDOW.startHour * 60 * 60 * 1000 +
    Math.floor(Math.min(Math.max(rand, 0), 0.999999) * NIGHTLY_WINDOW.spreadMin) * 60 * 1000;
  return new Date(slotVn - VN_OFFSET_MS);
}

/** Ghi kết quả một lượt kéo danh mục (worker hoặc nút "Đồng bộ từ sàn") + lịch kế. */
export async function scheduleAfterProductSync(
  channelId: string,
  ok: boolean,
  error?: string
): Promise<void> {
  const now = new Date();
  await prisma.channel
    .update({
      where: { id: channelId },
      data: ok
        ? { lastProductSyncAt: now, productSyncError: null, nextProductSyncAt: nextNightlySlot(now) }
        : { productSyncError: (error ?? "không rõ").slice(0, 500), nextProductSyncAt: new Date(now.getTime() + RETRY_MS) },
    })
    .catch(() => {});
}

/**
 * Gian VỪA NỐI mà danh mục chưa kéo xong lần đầu — trang Giá vốn dùng để báo
 * "đang kéo danh mục" thay vì bảng trống (khách bấm "Nhập giá vốn ngay" ở hộp
 * chào sau ủy quyền thường tới trước lượt poll 5' của worker).
 * Chỉ tính trong CLAIM_MS kể từ lúc tạo gian: quá mốc đó worker đã coi lượt kéo
 * là treo, trang quay về dòng trống cũ (có nút "Đồng bộ từ sàn"). Lượt đầu LỖI
 * (productSyncError) cũng không tính — đừng bắt khách ngồi chờ thứ không tới.
 */
export async function findChannelsPendingFirstCatalog(
  ownerId: string
): Promise<{ id: string; channelName: ChannelName; shopName: string }[]> {
  return prisma.channel.findMany({
    where: {
      userId: ownerId,
      status: "ACTIVE",
      refreshToken: { not: null },
      channelName: { in: ONLINE },
      lastProductSyncAt: null,
      productSyncError: null,
      nextProductSyncAt: { not: null },
      createdAt: { gte: new Date(Date.now() - CLAIM_MS) },
    },
    select: { id: true, channelName: true, shopName: true },
    orderBy: { createdAt: "asc" },
  });
}

let started = false;
let running = false;

export function startProductCatalogSyncWorker(): void {
  if (started) return;
  started = true;
  if (process.env.PRODUCT_CATALOG_SYNC_OFF === "1") {
    console.log("[Catalog-sync] TẮT (PRODUCT_CATALOG_SYNC_OFF=1)");
    return;
  }
  setTimeout(() => void runProductCatalogSync(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runProductCatalogSync(), POLL_MS).unref();
  console.log(
    `[Catalog-sync] BẬT — poll ${POLL_MS / 60000}', gian mới kéo ngay, làm mới đêm ${String(NIGHTLY_WINDOW.startHour).padStart(2, "0")}:00 giờ VN (rải ${NIGHTLY_WINDOW.spreadMin}'), tối đa ${MAX_PER_CYCLE} gian/lượt`
  );
}

/** Một lượt poll: nhận + kéo tuần tự tới MAX_PER_CYCLE gian đến hạn. Export để chạy tay/test. */
export async function runProductCatalogSync(): Promise<number> {
  if (running) return 0;
  running = true;
  let done = 0;
  try {
    for (let i = 0; i < MAX_PER_CYCLE; i++) {
      const now = new Date();
      const due = await prisma.channel.findFirst({
        where: {
          status: "ACTIVE",
          refreshToken: { not: null },
          channelName: { in: ONLINE },
          nextProductSyncAt: { lte: now },
        },
        orderBy: { nextProductSyncAt: "asc" },
      });
      if (!due) break;
      // Nhận gian: chỉ tiến trình đổi được lịch mới chạy (nhiều worker không đụng nhau).
      const claimed = await prisma.channel.updateMany({
        where: { id: due.id, nextProductSyncAt: due.nextProductSyncAt },
        data: { nextProductSyncAt: new Date(now.getTime() + CLAIM_MS) },
      });
      if (claimed.count === 0) continue;

      try {
        const r = await syncChannelProducts(due);
        await scheduleAfterProductSync(due.id, true);
        done++;
        console.log(
          `[Catalog-sync] "${due.shopName}" (${due.channelName}): ${r.scanned} SP sàn, +${r.created} mới, ${r.updated} cập nhật, ${r.delisted} gỡ, ${r.costAutoFilled} tự điền giá vốn`
        );
      } catch (err) {
        const message = (err as Error).message;
        await scheduleAfterProductSync(due.id, false, message);
        console.error(
          `[Catalog-sync] Lỗi kéo danh mục "${due.shopName}" (${due.channelName}) — thử lại sau ${RETRY_MS / 60000}':`,
          message
        );
      }
    }
  } catch (err) {
    console.error("[Catalog-sync] Lỗi vòng quét:", (err as Error).message);
  } finally {
    running = false;
  }
  return done;
}
