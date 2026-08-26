// ============================================================
// TỰ ĐỘNG ĐỒNG BỘ ĐA SÀN THEO NHỊP (polling) — LƯỚI AN TOÀN CẠNH WEBHOOK
//
// Phủ MỌI gian đang hoạt động, không ai phải bấm tay:
//   · ĐƠN HÀNG (Shopee + Lazada): quét mỗi nhịp (mặc định 10 phút, cửa sổ
//     2 ngày gần nhất, upsert idempotent — chạy lặp vô hại).
//   · PHÍ ƯỚC TÍNH Shopee (đơn chờ đối soát): MỖI NHỊP với cửa sổ hẹp — P&L
//     đơn mới có phí tạm tính trong ≤1 nhịp (webhook còn kéo ngay khi có sự
//     kiện đơn); nhịp giờ mở rộng cửa sổ vét đơn tồn.
//   · ĐỐI SOÁT PHÍ THẬT (Lazada Finance API + Shopee Escrow API): chạy MỖI
//     GIỜ (mỗi SETTLE_EVERY_SWEEPS nhịp) với cửa sổ 7 ngày — sao kê đổi chậm,
//     quét dày chỉ tốn quota (10k call/ngày); backfill sâu 90 ngày vẫn dùng
//     nút "Đồng bộ đối soát" tay.
//   · ĐỢT CHI TIỀN VỀ BANK (Shopee rút ví + Lazada payout, từ 08/08): cùng
//     nhịp giờ, cửa sổ 30 ngày → WalletWithdrawal (SYNC) — cột "Doanh thu về
//     Ngân hàng" của bảng Phân bổ dòng tiền tự động, hết bấm tay.
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
import { syncShopeeAdsCampaigns } from "./integrations/shopee/ads-campaigns";
import { syncLazadaAdsCampaigns } from "./integrations/lazada/ads-campaigns";
import { runAdsAutoExecute } from "./integrations/shopee/ads-auto-execute";
import { syncShopeeWithdrawals } from "./integrations/shopee/wallet";
import {
  backfillShopeeTrackingCodes,
  syncShopeeReturns,
} from "./integrations/shopee/returns-sync";
import { syncShopeeBuyerInvoiceRequests } from "./integrations/shopee/buyer-invoice";
import {
  refreshShopeeDeliveryFailOutcomes,
  scanShopeeDeliveryFails,
} from "./integrations/shopee/delivery-fail";
import { isLazadaConfigured } from "./integrations/lazada/config";
import {
  syncLazadaOrders,
  syncLazadaSettlements,
} from "./integrations/lazada/service";
import { syncLazadaPayouts } from "./integrations/lazada/payouts";
import { syncLazadaReturns } from "./integrations/lazada/returns-sync";

const DEFAULT_INTERVAL_MIN = 10;
/**
 * Quét đơn có BIẾN ĐỘNG trong N ngày gần nhất (trục update_time, từ 09/08).
 * Trục update phủ cả đơn mới tạo LẪN đơn cũ vừa đổi trạng thái — đặc biệt đơn
 * tạo 1-3 tuần trước mà sàn vừa báo HOÀN, thứ trục create_time cũ bỏ sót khiến
 * trang Đối soát đơn hoàn phải chờ người bấm đồng bộ tay 90 ngày.
 */
const ORDERS_DAYS_BACK = 2;
/**
 * Cửa sổ quét YÊU CẦU HOÀN Shopee (Returns API, trục update_time). Yêu cầu hoàn
 * trên đơn COMPLETED không đổi order_status nên quét đơn ở trên KHÔNG thấy —
 * đây là luồng duy nhất bắt được chúng. Mỗi nhịp quét hẹp; nhịp giờ quét sâu
 * hơn để vét yêu cầu đổi trạng thái muộn (thêm tracking, bị hủy...).
 */
const RETURNS_DAYS_BACK = 2;
const RETURNS_DAYS_BACK_DEEP = 7;
/** Mỗi nhịp điền tối đa N mã vận đơn chiều đi còn trống (get_tracking_number). */
const TRACKING_BACKFILL_PER_SWEEP = 30;
/** Đối soát (Lazada + Shopee) chạy 1 lần mỗi N nhịp (10' × 6 = mỗi giờ). */
const SETTLE_EVERY_SWEEPS = 6;
/** Cửa sổ sao kê cho lượt đối soát tự động — đơn thường quyết toán trong vài ngày. */
const SETTLE_DAYS_BACK = 7;
/**
 * Cửa sổ quét ĐỢT CHI TIỀN về bank (Shopee rút ví / Lazada payout) — payout
 * chốt theo tuần và trạng thái có thể đổi muộn (unpaid → paid), nên quét rộng
 * 30 ngày; upsert idempotent theo (channelId, externalTxnId) nên quét lặp vô hại.
 */
const PAYOUT_DAYS_BACK = 30;
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
          const r = await syncShopeeOrders(channel, {
            daysBack: ORDERS_DAYS_BACK,
            timeRangeField: "update_time",
          });
          if (r.created > 0) {
            console.log(
              `[Auto-sync] Shopee "${channel.shopName}": +${r.created} đơn mới (${r.updated} cập nhật)`
            );
          }
        } else {
          if (!isLazadaConfigured()) continue;
          const r = await syncLazadaOrders(channel, {
            daysBack: ORDERS_DAYS_BACK,
            byUpdateTime: true,
          });
          if (r.created > 0) {
            console.log(
              `[Auto-sync] Lazada "${channel.shopName}": +${r.created} đơn mới (${r.updated} cập nhật)`
            );
          }
        }
        // Đồng bộ đơn OK → reset bộ đếm lỗi (nguồn cảnh báo "sàn trễ đồng bộ"
        // tự đóng). Best-effort: lỗi ghi bookkeeping không được chặn vòng quét.
        await prisma.channel
          .update({
            where: { id: channel.id },
            data: { lastSyncAt: new Date(), lastSyncError: null, syncFailCount: 0 },
          })
          .catch(() => {});
      } catch (err) {
        // Lỗi một gian (token hết hạn, sàn chập chờn) không được chặn gian khác.
        const message = (err as Error).message;
        console.error(`[Auto-sync] Lỗi đồng bộ đơn gian "${channel.shopName}":`, message);
        // Đếm nhịp lỗi LIÊN TIẾP — detector Trung tâm điều hành báo khi ≥ 3.
        await prisma.channel
          .update({
            where: { id: channel.id },
            data: { lastSyncError: message, syncFailCount: { increment: 1 } },
          })
          .catch(() => {});
      }

      // --- Phí ƯỚC TÍNH Shopee cho đơn chờ đối soát: chạy MỖI NHỊP (không chờ
      // nhịp giờ như trước — chủ shop 06/08: phí đơn mới hiện chậm) nhưng cửa
      // sổ hẹp bằng cửa sổ quét đơn; đơn tồn cũ hơn đã có lượt đối soát mỗi giờ
      // (SETTLE_DAYS_BACK ngày) vét. isSettled vẫn false — giữ nhãn "chờ đối soát".
      if (channel.channelName === ChannelName.SHOPEE && isShopeeConfigured()) {
        try {
          const est = await syncShopeePendingEscrowEstimates(channel, {
            daysBack: settleSweep ? SETTLE_DAYS_BACK : ORDERS_DAYS_BACK,
          });
          if (est.updated > 0) {
            console.log(
              `[Auto-sync] Ước tính phí Shopee "${channel.shopName}": ${est.updated}/${est.scanned} đơn chờ đối soát nhận số tạm tính`
            );
          }
        } catch (err) {
          console.error(
            `[Auto-sync] Lỗi ước tính phí gian "${channel.shopName}":`,
            (err as Error).message
          );
        }
      }

      // --- ĐƠN HOÀN Lazada (Reverse Order API) — cùng nhịp với Shopee bên
      // dưới: đọc số của sàn (giải pháp hoàn, tiền hoàn, SKU trả, tracking
      // chiều hoàn) cho Lãi/Lỗ + danh sách kho. Lỗi riêng không chặn luồng khác.
      if (channel.channelName === ChannelName.LAZADA && isLazadaConfigured()) {
        try {
          const ret = await syncLazadaReturns(channel, {
            daysBack: settleSweep ? RETURNS_DAYS_BACK_DEEP : RETURNS_DAYS_BACK,
          });
          if (ret.flagged > 0 || ret.unflagged > 0 || ret.itemsUpdated > 0) {
            console.log(
              `[Auto-sync] Đơn hoàn Lazada "${channel.shopName}": +${ret.flagged} chờ về tay, ${ret.unflagged} hạ cờ, ${ret.itemsUpdated} dòng SKU trả (${ret.scanned} yêu cầu)`
            );
          }
        } catch (err) {
          console.error(
            `[Auto-sync] Lỗi quét đơn hoàn Lazada "${channel.shopName}":`,
            (err as Error).message
          );
        }
      }

      // --- ĐƠN HOÀN Shopee (Returns API) — chạy MỖI NHỊP để trang Đối soát
      // đơn hoàn gần real-time không cần ai bấm tay. Đây là nguồn duy nhất
      // thấy yêu cầu Trả hàng/Hoàn tiền trên đơn đã COMPLETED, kèm mã vận đơn
      // CHIỀU HOÀN cho kho quét. Lỗi riêng không chặn các luồng khác.
      if (channel.channelName === ChannelName.SHOPEE && isShopeeConfigured()) {
        try {
          const ret = await syncShopeeReturns(channel, {
            daysBack: settleSweep ? RETURNS_DAYS_BACK_DEEP : RETURNS_DAYS_BACK,
          });
          if (ret.flagged > 0 || ret.unflagged > 0 || ret.trackingSaved > 0) {
            console.log(
              `[Auto-sync] Đơn hoàn Shopee "${channel.shopName}": +${ret.flagged} chờ về tay, ${ret.unflagged} hạ cờ (yêu cầu hủy), ${ret.trackingSaved} mã vận đơn hoàn, ${ret.ordersFetched} đơn cũ kéo mới`
            );
          }
        } catch (err) {
          console.error(
            `[Auto-sync] Lỗi quét đơn hoàn Shopee "${channel.shopName}":`,
            (err as Error).message
          );
        }
        // Điền dần mã vận đơn CHIỀU ĐI còn trống (đơn cũ trước bản vá này) —
        // có tiết chế quota, ưu tiên đơn mới; kho quét kiện quay đầu cần mã này.
        try {
          const bf = await backfillShopeeTrackingCodes(channel, {
            limit: TRACKING_BACKFILL_PER_SWEEP,
          });
          if (bf.saved > 0) {
            console.log(
              `[Auto-sync] Vận đơn Shopee "${channel.shopName}": điền ${bf.saved}/${bf.checked} mã còn trống`
            );
          }
        } catch (err) {
          console.error(
            `[Auto-sync] Lỗi backfill vận đơn Shopee "${channel.shopName}":`,
            (err as Error).message
          );
        }
        // KHÁCH YÊU CẦU XUẤT HÓA ĐƠN (24/08): đơn vừa ĐÃ GIAO → hỏi
        // get_buyer_invoice_info lưu thông tin người mua TRƯỚC khi Shopee ẩn
        // (30 ngày). Gian chưa được mở tính năng → module tự backoff 24h.
        try {
          const inv = await syncShopeeBuyerInvoiceRequests(channel);
          if (inv.requested > 0 || inv.maskedRetry > 0) {
            console.log(
              `[Auto-sync] Yêu cầu hóa đơn Shopee "${channel.shopName}": +${inv.requested} đơn khách cần hóa đơn, ${inv.none} không yêu cầu, ${inv.maskedRetry} còn che (${inv.scanned} đơn hỏi)`
            );
          }
        } catch (err) {
          console.error(
            `[Auto-sync] Lỗi kéo yêu cầu hóa đơn Shopee "${channel.shopName}" (shop có thể chưa được mở tính năng):`,
            (err as Error).message
          );
        }
        // CỨU ĐƠN GIAO THẤT BẠI — chuyển từ nhịp giờ sang MỖI NHỊP (26/08,
        // anh Trung chốt "phải real-time — chậm là bị hoàn ngay"; probe 25/08
        // có kiện quay đầu 28 phút sau lượt giao hỏng). Tiết chế nằm trong
        // scanShopeeDeliveryFails (cooldown 20'/đơn + trần 200 đơn/lượt).
        // Đếm lượt giao thất bại trong get_tracking_info (mẫu chữ description
        // — enum docs không có thật trên production VN), chạm ngưỡng →
        // chuông + (tuỳ config) auto-chat. Lỗi riêng không chặn luồng khác.
        try {
          const df = await scanShopeeDeliveryFails(channel);
          if (df.noticed > 0) {
            console.log(
              `[Auto-sync] Giao thất bại Shopee "${channel.shopName}": +${df.noticed} đơn chạm ngưỡng (${df.chatSent} đã nhắn khách, ${df.chatFailed} sàn từ chối, ${df.chatSkipped} bỏ qua) / ${df.scanned} đơn quét`
            );
          }
        } catch (err) {
          console.error(
            `[Auto-sync] Lỗi quét giao thất bại gian "${channel.shopName}":`,
            (err as Error).message
          );
        }
        // CHỐT KẾT QUẢ các đơn đã cảnh báo (26/08 — probe: 8/12 notice đã có
        // kết quả trên sàn mà thẻ Cứu được/Mất đơn vẫn 0-0 vì Order nằm
        // TO_CONFIRM_RECEIVE/SHIPPED). Tiết chế 6h/notice nằm trong hàm.
        try {
          const oc = await refreshShopeeDeliveryFailOutcomes(channel);
          if (oc.saved > 0 || oc.lost > 0) {
            console.log(
              `[Auto-sync] Kết quả cứu đơn Shopee "${channel.shopName}": +${oc.saved} cứu được, +${oc.lost} mất đơn (${oc.checked} đơn hỏi tracking)`
            );
          }
        } catch (err) {
          console.error(
            `[Auto-sync] Lỗi chốt kết quả cứu đơn gian "${channel.shopName}":`,
            (err as Error).message
          );
        }
      }

      // --- Đối soát phí thật (Lazada + Shopee, theo nhịp giờ) ---
      if (settleSweep) {
        try {
          if (channel.channelName === ChannelName.LAZADA) {
            // Bọc try riêng (25/08, cùng lý do nhánh Shopee): đối soát lỗi
            // không được nuốt payout + campaign + auto-execute đứng sau.
            try {
              const s = await syncLazadaSettlements(channel, { daysBack: SETTLE_DAYS_BACK });
              if (s.ordersUpdated > 0) {
                console.log(
                  `[Auto-sync] Đối soát Lazada "${channel.shopName}": ${s.ordersUpdated} đơn nhận số phí thật (${s.transactions} dòng sao kê)`
                );
              }
            } catch (err) {
              console.error(
                `[Auto-sync] Lỗi đối soát Lazada "${channel.shopName}":`,
                (err as Error).message
              );
            }
            // Đợt CHI TIỀN về bank (payout theo kỳ sao kê) → WalletWithdrawal.
            // Lỗi riêng không được chặn các luồng khác (cùng luật với Ads).
            try {
              const po = await syncLazadaPayouts(channel, {
                daysBack: PAYOUT_DAYS_BACK,
              });
              if (po.created > 0 || po.updated > 0) {
                console.log(
                  `[Auto-sync] Payout Lazada "${channel.shopName}": +${po.created} đợt mới, ${po.updated} cập nhật`
                );
              }
            } catch (err) {
              console.error(
                `[Auto-sync] Lỗi sync payout Lazada "${channel.shopName}":`,
                (err as Error).message
              );
            }
            // Chiến dịch quảng cáo + hiệu suất ngày (Trợ lý quảng cáo Lazada
            // GĐ1, read-only Sponsored Solutions) — lỗi riêng không chặn luồng.
            try {
              const camp = await syncLazadaAdsCampaigns(channel, { daysBack: 30 });
              if (camp.campaignsUpserted > 0) {
                console.log(
                  `[Auto-sync] Campaign Ads Lazada "${channel.shopName}": ${camp.campaignsUpserted} chiến dịch, ${camp.perfDaysUpserted} dòng hiệu suất ngày`
                );
              }
            } catch (err) {
              console.error(
                `[Auto-sync] Lỗi sync campaign Ads Lazada "${channel.shopName}":`,
                (err as Error).message
              );
            }
            // GĐ3 Lazada — Trợ lý tự thực thi (mặc định OFF; cùng executor và
            // quy trình bật live với Shopee). Chạy SAU sync campaign; lỗi riêng
            // không chặn luồng khác.
            try {
              const act = await runAdsAutoExecute(channel);
              if (act.mode !== "off" && (act.planned || act.executed || act.failed)) {
                console.log(
                  `[Auto-sync] Trợ lý Ads Lazada "${channel.shopName}" (${act.mode}): ${act.planned} diễn tập, ${act.executed} tạm dừng thật, ${act.failed} lỗi, ${act.skippedDone} đã làm hôm nay, ${act.skippedQuota} chạm quota`
                );
              }
            } catch (err) {
              console.error(
                `[Auto-sync] Lỗi Trợ lý tự thực thi Lazada "${channel.shopName}":`,
                (err as Error).message
              );
            }
          } else if (channel.channelName === ChannelName.SHOPEE) {
            // Bọc try riêng (25/08): trước đây đối soát ném lỗi là NUỐT luôn
            // các luồng đứng sau trong khối nhịp giờ — gồm cả quét cứu đơn
            // giao thất bại. Lỗi đối soát không được chặn cảnh báo cứu đơn.
            try {
              const s = await syncShopeeSettlements(channel, { daysBack: SETTLE_DAYS_BACK });
              if (s.ordersUpdated > 0) {
                console.log(
                  `[Auto-sync] Đối soát Shopee "${channel.shopName}": ${s.ordersUpdated} đơn nhận số phí thật (${s.transactions} đơn giải ngân)`
                );
              }
            } catch (err) {
              console.error(
                `[Auto-sync] Lỗi đối soát Shopee "${channel.shopName}":`,
                (err as Error).message
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
            // Chiến dịch quảng cáo + hiệu suất ngày (Trợ lý quảng cáo GĐ1,
            // read-only) — lỗi riêng không được chặn các luồng khác.
            try {
              const camp = await syncShopeeAdsCampaigns(channel, { daysBack: 30 });
              if (camp.campaignsUpserted > 0) {
                console.log(
                  `[Auto-sync] Campaign Ads Shopee "${channel.shopName}": ${camp.campaignsUpserted} chiến dịch, ${camp.perfDaysUpserted} dòng hiệu suất ngày`
                );
              }
            } catch (err) {
              console.error(
                `[Auto-sync] Lỗi sync campaign Ads gian "${channel.shopName}" (app có thể chưa bật quyền Ads API):`,
                (err as Error).message
              );
            }
            // GĐ3 — Trợ lý tự thực thi (mặc định OFF; dry_run = diễn tập ghi
            // sổ; live chỉ bật sau probe). Chạy SAU sync campaign để đánh giá
            // trên số mới nhất; lỗi riêng không chặn luồng khác.
            try {
              const act = await runAdsAutoExecute(channel);
              if (act.mode !== "off" && (act.planned || act.executed || act.failed)) {
                console.log(
                  `[Auto-sync] Trợ lý Ads "${channel.shopName}" (${act.mode}): ${act.planned} diễn tập, ${act.executed} tạm dừng thật, ${act.failed} lỗi, ${act.skippedDone} đã làm hôm nay, ${act.skippedQuota} chạm quota`
                );
              }
            } catch (err) {
              console.error(
                `[Auto-sync] Lỗi Trợ lý tự thực thi gian "${channel.shopName}":`,
                (err as Error).message
              );
            }
            // Lệnh RÚT VÍ về bank (get_wallet_transaction_list, read-only) →
            // WalletWithdrawal. Lỗi riêng (app chưa bật quyền Payment/ví) không
            // được chặn các luồng khác.
            try {
              const wd = await syncShopeeWithdrawals(channel, {
                daysBack: PAYOUT_DAYS_BACK,
              });
              if (wd.created > 0 || wd.updated > 0) {
                console.log(
                  `[Auto-sync] Rút ví Shopee "${channel.shopName}": +${wd.created} lệnh mới, ${wd.updated} cập nhật`
                );
              }
            } catch (err) {
              console.error(
                `[Auto-sync] Lỗi sync rút ví Shopee "${channel.shopName}" (app có thể chưa bật quyền ví):`,
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
