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
//     worker kéo ngay lượt kế (poll 30 giây, trước 03/11 là 5').
//   · Xong → lastProductSyncAt = now, lịch kế = đêm sau 03:00–05:00 giờ VN
//     (rải ngẫu nhiên để 13 gian Shopee không cùng lúc đập get_model_list —
//     sự cố DarkMan 05/09 error_rate_limit khi kéo nguyên danh mục).
//   · Lỗi (sàn bận, token…) → productSyncError + thử lại sau 30'.
//   · Nút "Đồng bộ từ sàn" của khách cũng ghi lịch qua scheduleAfterProductSync
//     để worker không kéo lại ngay sau đó.
//   · Chạy tối đa MAX_PARALLEL gian cùng lúc (trước 03/11 tuần tự từng gian); nhận
//     gian bằng updateMany có điều kiện (nhiều worker không đụng nhau).
// Tắt: PRODUCT_CATALOG_SYNC_OFF=1.
//
// ★ 03/11/2026 — LÁT 3.7 GIAI ĐOẠN 3 (anh chốt làm trước 3.3): các nút "Đồng bộ từ sàn"
//   (Giá vốn, Liên kết SP, hướng dẫn), "Lấy sản phẩm mới từ sàn" (sao chép SP) và Nối nhanh
//   KHÔNG kéo danh mục trong request web nữa (web OOM 7 lần ngày 03/11 vì gian TikTok
//   ongbocute.vn ~621 SP). Web chỉ ghi `productSyncRequestedAt = nextProductSyncAt = now`
//   (requestProductSyncNow); worker kéo ở lượt poll kế rồi xóa mốc xin; trang/nút hỏi
//   `isCatalogPending` để báo "Đang kéo trong vài phút" và tự nạp lại khi xong.
//
// ★ 18/10/2026 — SAU MỖI LƯỢT KÉO THÀNH CÔNG: vá dòng đơn giá vốn 0 của gian mà lá
//   nay đã có giá hiệu lực (docs/MO-HINH-CAY-SAN-PHAM-SAN.md mục 9) — chính lượt kéo
//   danh mục là lúc lá xuất hiện, và nhịp đêm theo gian đã sẵn. Lỗi chỉ ghi log,
//   không làm hỏng lịch kéo. Tắt riêng: COST_ZERO_REPAIR_OFF=1.
// ============================================================

import { ChannelName } from "@prisma/client";
import { invalidateOwnerCostCaches, repairZeroCostLinesForChannel } from "../lib/cost-price";
import { prisma } from "../lib/prisma";
import { syncChannelProducts } from "../marketplace/product-sync";

/** 03/11/2026: 5' → 30 giây — nút bấm của khách chờ tối đa một nhịp này (30 giây từ 03/11 tối); truy vấn findFirst theo chỉ mục
 *  (status, nextProductSyncAt) nên rẻ. Anh Trung: chờ 5–6 phút "khó chịu hơn cả báo lỗi". */
const POLL_MS = 30 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;
/** Số gian kéo danh mục cùng lúc trong một worker. Tự chọn, chưa đo ngưỡng tải. */
export const MAX_PARALLEL = 3;
/** Lỗi → thử lại sau. */
const RETRY_MS = 30 * 60 * 1000;
/** Nhận gian = đẩy lịch ra xa để tiến trình khác không nhận trùng; xong ghi lịch thật. */
const CLAIM_MS = 60 * 60 * 1000;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
/** Khung đêm (giờ VN): bắt đầu 03:00, rải trong 120'. */
export const NIGHTLY_WINDOW = { startHour: 3, spreadMin: 120 } as const;

const ONLINE = [ChannelName.SHOPEE, ChannelName.LAZADA, ChannelName.TIKTOK];

/** Vừa kéo xong trong khoảng này → không kéo lại theo nút (giữ quota sàn; cùng số với sao chép SP 30/10). */
export const REQUEST_RECENT_MS = 2 * 60 * 1000;
/** Mốc xin kéo quá tuổi này = treo → trang thôi báo "đang kéo", xin lại được. = CLAIM_MS (60'): một mốc xin không
 *  được sống lâu hơn một lượt nhận việc; worker sập giữa chừng đã có recoverStrandedClaims lúc boot (03/11 16:00). */
export const REQUEST_STALE_MS = 60 * 60 * 1000;

export type ProductSyncRequestOutcome = "queued" | "already" | "recent" | "ineligible";

/** Câu phổ thông cho từng kết quả xin kéo — giao diện in thẳng, không nói worker/lịch. */
export const PRODUCT_SYNC_REQUEST_MESSAGE: Record<ProductSyncRequestOutcome, string> = {
  queued: "Đang kéo trong vài phút.",
  already: "Đang kéo trong vài phút.",
  recent: "Vừa kéo xong chưa tới 2 phút — danh sách đã là mới nhất.",
  ineligible: "Gian chưa có ủy quyền sàn hoặc đang ngủ đông — hãy Kết nối lại ở Kênh bán.",
};

export interface ProductSyncRequestInput {
  channelName: ChannelName;
  refreshToken: string | null;
  hibernatedAt: Date | null;
  lastProductSyncAt: Date | null;
  productSyncRequestedAt: Date | null;
}

/** Phần thuần của requestProductSyncNow — một gian xin kéo thì ra kết quả gì. */
export function classifyProductSyncRequest(ch: ProductSyncRequestInput, now: Date): ProductSyncRequestOutcome {
  if (!(ONLINE as ChannelName[]).includes(ch.channelName) || !ch.refreshToken || ch.hibernatedAt) return "ineligible";
  if (ch.productSyncRequestedAt && now.getTime() - ch.productSyncRequestedAt.getTime() < REQUEST_STALE_MS) {
    return "already";
  }
  if (ch.lastProductSyncAt && now.getTime() - ch.lastProductSyncAt.getTime() < REQUEST_RECENT_MS) return "recent";
  return "queued";
}

export interface ProductSyncRequestResult {
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  outcome: ProductSyncRequestOutcome;
  message: string;
}

/**
 * XIN KÉO danh mục cho các gian của chủ shop (bỏ trống channelIds = mọi gian online đang hoạt động).
 * Chỉ ghi `nextProductSyncAt = productSyncRequestedAt = now` cho gian "queued"; worker làm phần còn lại
 * ở lượt poll kế (≤ POLL_MS). Gian đang được worker kéo (đã nhận, chưa xong) mà bị xin: lượt đang chạy
 * xong sẽ đặt lại lịch đêm và xóa mốc xin — danh mục vừa kéo vẫn là mới, chấp nhận.
 */
export async function requestProductSyncNow(
  ownerId: string,
  channelIds?: string[]
): Promise<ProductSyncRequestResult[]> {
  const now = new Date();
  const channels = await prisma.channel.findMany({
    where: {
      userId: ownerId,
      status: "ACTIVE",
      channelName: { not: ChannelName.OFFLINE },
      ...(channelIds?.length ? { id: { in: channelIds } } : {}),
    },
    select: {
      id: true,
      channelName: true,
      shopName: true,
      refreshToken: true,
      hibernatedAt: true,
      lastProductSyncAt: true,
      productSyncRequestedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const results: ProductSyncRequestResult[] = channels.map((ch) => {
    const outcome = classifyProductSyncRequest(ch, now);
    return {
      channelId: ch.id,
      channelName: ch.channelName,
      shopName: ch.shopName,
      outcome,
      message: PRODUCT_SYNC_REQUEST_MESSAGE[outcome],
    };
  });
  const queuedIds = results.filter((r) => r.outcome === "queued").map((r) => r.channelId);
  if (queuedIds.length > 0) {
    await prisma.channel.updateMany({
      where: { id: { in: queuedIds } },
      data: { nextProductSyncAt: now, productSyncRequestedAt: now },
    });
  }
  return results;
}

export interface CatalogStateInput {
  createdAt: Date;
  lastProductSyncAt: Date | null;
  nextProductSyncAt: Date | null;
  productSyncError: string | null;
  productSyncRequestedAt: Date | null;
}

/**
 * Gian có đang "kéo danh mục" không (trang báo "Đang kéo trong vài phút"):
 *   · khách vừa xin kéo (mốc xin chưa quá REQUEST_STALE_MS) — kể cả gian đang có lỗi lần trước;
 *   · gian VỪA NỐI chưa kéo xong lần đầu, trong CLAIM_MS kể từ lúc tạo (luật 28/09, giữ nguyên).
 */
export function isCatalogPending(ch: CatalogStateInput, now: Date): boolean {
  if (ch.productSyncRequestedAt && now.getTime() - ch.productSyncRequestedAt.getTime() < REQUEST_STALE_MS) {
    return true;
  }
  return (
    ch.lastProductSyncAt === null &&
    ch.productSyncError === null &&
    ch.nextProductSyncAt !== null &&
    now.getTime() - ch.createdAt.getTime() < CLAIM_MS
  );
}

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
      // Xong hay lỗi đều xóa mốc xin kéo — trang thôi báo "Đang kéo", lỗi thì hiện productSyncError.
      data: ok
        ? { lastProductSyncAt: now, productSyncError: null, nextProductSyncAt: nextNightlySlot(now), productSyncRequestedAt: null }
        : { productSyncError: (error ?? "không rõ").slice(0, 500), nextProductSyncAt: new Date(now.getTime() + RETRY_MS), productSyncRequestedAt: null },
    })
    .catch(() => {});
}

export interface CatalogSyncState {
  id: string;
  channelName: ChannelName;
  shopName: string;
  lastProductSyncAt: Date | null;
  productSyncError: string | null;
  /** Đang kéo (xin kéo / gian mới) — xem isCatalogPending. */
  pending: boolean;
}

/**
 * Trạng thái kéo danh mục của mọi gian online đang hoạt động của chủ shop — một truy vấn,
 * luật "đang kéo" ở isCatalogPending. Trang Giá vốn hỏi theo nhịp trong lúc chờ; nút
 * "Đồng bộ từ sàn" dùng cùng endpoint để biết lượt mình xin đã xong chưa (và có lỗi không).
 */
export async function listCatalogSyncState(ownerId: string): Promise<CatalogSyncState[]> {
  const now = new Date();
  const rows = await prisma.channel.findMany({
    where: {
      userId: ownerId,
      status: "ACTIVE",
      refreshToken: { not: null },
      hibernatedAt: null,
      channelName: { in: ONLINE },
    },
    select: {
      id: true,
      channelName: true,
      shopName: true,
      createdAt: true,
      lastProductSyncAt: true,
      nextProductSyncAt: true,
      productSyncError: true,
      productSyncRequestedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    channelName: r.channelName,
    shopName: r.shopName,
    lastProductSyncAt: r.lastProductSyncAt,
    productSyncError: r.productSyncError,
    pending: isCatalogPending(r, now),
  }));
}

/**
 * Gian đang kéo danh mục (gian VỪA NỐI chưa xong lần đầu — luật 28/09 — hoặc khách vừa xin kéo,
 * 03/11). Trang Giá vốn dùng để báo "đang kéo" thay vì bảng trống.
 */
export async function findChannelsPendingCatalog(
  ownerId: string
): Promise<{ id: string; channelName: ChannelName; shopName: string }[]> {
  return (await listCatalogSyncState(ownerId))
    .filter((s) => s.pending)
    .map(({ id, channelName, shopName }) => ({ id, channelName, shopName }));
}

let started = false;
let running = false;
let stopping = false;
/** Các gian đang kéo dở trong tiến trình này — để trả lại hàng chờ khi nhận SIGTERM (deploy). */
const activeClaims = new Map<string, string>();

/**
 * ★ 03/11/2026 ~16:00 — SỰ CỐ: anh bấm Đồng bộ từ sàn, worker đang kéo dở thì Render deploy bản mới
 * (15:45:18) → gian đã "nhận" (nextProductSyncAt = now + CLAIM_MS) bị bỏ lại 60 phút, mốc xin còn
 * nguyên → trang treo "Đang kéo danh mục…" cả tiếng. Hai lớp sửa:
 *   · stopProductCatalogSync(): nhận SIGTERM → dừng sau gian đang dở, trả gian đó về hàng chờ
 *     (nextProductSyncAt = now) — tiến trình mới kéo lại ngay sau FIRST_RUN_DELAY.
 *   · recoverStrandedClaims() mỗi nhịp poll (cả SIGKILL/OOM không kịp trả): gian có mốc xin mà lịch kế
 *     đang nằm trong cửa sổ nhận việc (now < next ≤ now + CLAIM_MS) và đã nhận từ ≥ 90 giây trước
 *     (tiến trình cũ chắc chắn đã chết — Render cho 30 giây) → đặt lại now. Gian lịch đêm / thử lại
 *     30' không có mốc xin nên không bị đụng.
 *   · Gian khách bấm (có mốc xin) được nhận TRƯỚC gian lịch đêm / thử lại.
 */
export async function stopProductCatalogSync(): Promise<void> {
  stopping = true;
  const claims = [...activeClaims];
  if (claims.length === 0) return;
  const now = new Date();
  await Promise.all(
    claims.map(([id, shopName]) =>
      prisma.channel
        .updateMany({ where: { id, nextProductSyncAt: { gt: now } }, data: { nextProductSyncAt: now } })
        .then((r) => {
          if (r.count > 0) console.log(`[Catalog-sync] Tắt giữa chừng — trả gian "${shopName}" về hàng chờ`);
        })
        .catch((err) => console.error("[Catalog-sync] Không trả được gian đang dở:", (err as Error).message))
    )
  );
}

/** Tuổi tối thiểu của một lượt nhận để coi tiến trình giữ nó đã chết (Render SIGTERM→SIGKILL 30 giây). */
const STRANDED_MIN_AGE_MS = 90 * 1000;

/**
 * Trả gian bị bỏ rơi về hàng chờ: khách đã xin kéo, lịch đang nằm trong cửa sổ nhận việc, lượt nhận đã quá
 * STRANDED_MIN_AGE_MS và KHÔNG do tiến trình này đang kéo. Chạy MỖI nhịp poll, không chỉ lúc khởi động: 18:43
 * 03/11/2026 worker cũ nhận gian ngay trước khi bị thay, gian treo "Đang kéo" tới 60 phút (anh thấy). Có
 * nhiều worker thì gian của worker khác có thể bị kéo trùng một lượt: chỉ tốn lệnh đọc, không sai dữ liệu.
 */
export async function recoverStrandedClaims(): Promise<number> {
  const now = Date.now();
  const r = await prisma.channel.updateMany({
    where: {
      id: { notIn: [...activeClaims.keys()] },
      productSyncRequestedAt: { not: null },
      nextProductSyncAt: { gt: new Date(now), lte: new Date(now + CLAIM_MS - STRANDED_MIN_AGE_MS) },
    },
    data: { nextProductSyncAt: new Date(now) },
  });
  if (r.count > 0) console.log(`[Catalog-sync] Trả ${r.count} gian bị bỏ rơi về hàng chờ`);
  return r.count;
}

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
    `[Catalog-sync] BẬT — poll ${POLL_MS / 1000} giây, gian mới kéo ngay, làm mới đêm ${String(NIGHTLY_WINDOW.startHour).padStart(2, "0")}:00 giờ VN (rải ${NIGHTLY_WINDOW.spreadMin}'), tối đa ${MAX_PARALLEL} gian cùng lúc`
  );
}

/**
 * Bước vá sau lượt kéo danh mục một gian (mục 9 docs cây sản phẩm): dòng đơn giá vốn 0
 * mà lá nay đã có giá hiệu lực → nhận giá. Hai câu UPDATE phép bằng, chỉ dòng đang 0.
 * Vá > 0 → xóa đệm hòa vốn của chủ shop. Lỗi chỉ log. Export để test/chạy tay.
 */
export async function repairZeroCostLinesAfterSync(channel: {
  id: string;
  userId: string;
  shopName: string;
  channelName: ChannelName;
}): Promise<number> {
  if (process.env.COST_ZERO_REPAIR_OFF === "1") return 0;
  try {
    const r = await repairZeroCostLinesForChannel(prisma, channel.id);
    const total = r.byId + r.byCode;
    if (total > 0) {
      await invalidateOwnerCostCaches(channel.userId);
      console.log(
        `[Catalog-sync] "${channel.shopName}" (${channel.channelName}): vá ${total} dòng đơn giá vốn 0 của lá đã có giá (${r.byId} theo id, ${r.byCode} theo mã)`
      );
    }
    return total;
  } catch (err) {
    console.error(`[Catalog-sync] Lỗi vá dòng đơn giá vốn 0 "${channel.shopName}" (${channel.channelName}):`, (err as Error).message);
    return 0;
  }
}

/** Nhận một gian đến hạn: khách bấm trước (gian ít dòng trước), rồi tới lịch đêm / thử lại. Null = hết việc. */
async function claimNextDue() {
  for (;;) {
    const now = new Date();
    const dueWhere = {
      status: "ACTIVE" as const,
      refreshToken: { not: null },
      channelName: { in: ONLINE },
      nextProductSyncAt: { lte: now },
    };
    const due =
      (await prisma.channel.findFirst({
        where: { ...dueWhere, productSyncRequestedAt: { not: null } },
        orderBy: [{ channelProducts: { _count: "asc" } }, { productSyncRequestedAt: "asc" }],
      })) ??
      (await prisma.channel.findFirst({ where: dueWhere, orderBy: { nextProductSyncAt: "asc" } }));
    if (!due) return null;
    // Nhận gian: chỉ tiến trình đổi được lịch mới chạy (nhiều worker không đụng nhau).
    const claimed = await prisma.channel.updateMany({
      where: { id: due.id, nextProductSyncAt: due.nextProductSyncAt },
      data: { nextProductSyncAt: new Date(now.getTime() + CLAIM_MS) },
    });
    if (claimed.count === 1) return due;
  }
}

type DueChannel = NonNullable<Awaited<ReturnType<typeof claimNextDue>>>;

async function pullOne(due: DueChannel): Promise<boolean> {
  try {
    const r = await syncChannelProducts(due);
    await scheduleAfterProductSync(due.id, true);
    console.log(
      `[Catalog-sync] "${due.shopName}" (${due.channelName})${due.productSyncRequestedAt ? " theo nút bấm" : ""}: ${r.scanned} SP sàn, +${r.created} mới, ${r.updated} cập nhật, ${r.delisted} gỡ, ${r.deactivated} SKU kho tự Ngừng bán, ${r.costAutoFilled} tự điền giá vốn`
    );
    await repairZeroCostLinesAfterSync(due);
    return true;
  } catch (err) {
    const message = (err as Error).message;
    await scheduleAfterProductSync(due.id, false, message);
    console.error(
      `[Catalog-sync] Lỗi kéo danh mục "${due.shopName}" (${due.channelName}) — thử lại sau ${RETRY_MS / 60000}':`,
      message
    );
    return false;
  }
}

/**
 * Lấp các chỗ trống tới MAX_PARALLEL gian kéo cùng lúc (03/11/2026, anh thấy nút xoay lâu: 5 gian kéo lần
 * lượt mất ~4 phút, và một gian đang kéo lâu làm mọi nút bấm khác phải chờ). Một gian xong là lấp chỗ ngay.
 * Mỗi gian có hạn mức sàn riêng; trần 3 giữ tải DB và RAM worker trong tầm. Export để chạy tay/test.
 */
export async function runProductCatalogSync(): Promise<number> {
  if (running) return 0;
  running = true;
  const runs: Promise<boolean>[] = [];
  try {
    if (!stopping) await recoverStrandedClaims();
    while (!stopping && activeClaims.size < MAX_PARALLEL) {
      const due = await claimNextDue();
      if (!due) break;
      activeClaims.set(due.id, due.shopName);
      runs.push(
        pullOne(due).finally(() => {
          activeClaims.delete(due.id);
          if (!stopping) void runProductCatalogSync();
        })
      );
    }
  } catch (err) {
    console.error("[Catalog-sync] Lỗi vòng quét:", (err as Error).message);
  } finally {
    running = false;
  }
  return (await Promise.all(runs)).filter(Boolean).length;
}
