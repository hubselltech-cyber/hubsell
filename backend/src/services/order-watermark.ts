// ============================================================
// MỐC NƯỚC QUÉT ĐƠN THEO GIAN — logic thuần, KHÔNG DB
// (lát 3.2 giai đoạn 3, docs/DONG-BO-GIAI-DOAN-3.md mục 2 — anh Trung chốt 14/10/2026)
//
// Trước: worker quét đơn có biến động trong cửa sổ CỨNG 2 ngày (trục update_time).
// Lượt bị cắt (chạm trần trang) thì phần cũ hơn trong 2 ngày đó mất hẳn; gian lỗi
// hoặc worker chết quá 2 ngày thì khoảng đó không bao giờ được quét lại.
//
// Nay mỗi gian giữ hai mốc trên Channel:
//   ordersWatermarkAt     — mọi đơn có update_time ≤ mốc này ĐÃ đọc đầy đủ;
//   ordersCatchupBeforeAt — khác NULL = lượt trước bị cắt, lượt sau phải vét
//                           phần CŨ HƠN mốc này trước khi tiến mốc nước.
// Mỗi lượt: đọc [mốc − OVERLAP, now0] (hoặc tới mốc vét khi đang vét dở);
// đủ → tiến mốc; cắt → giữ mốc, ghi mốc vét = update_time cũ nhất đã đọc (ba
// sàn đều đọc MỚI NHẤT TRƯỚC nên phần chưa đọc là phần cũ hơn); lỗi → không đụng.
// Trần trang giữ nguyên: mất dữ liệu đổi thành TRỄ, đo bằng now − ordersWatermarkAt.
// Webhook vẫn là đường chính; mốc nước là lưới an toàn.
// ============================================================

import { HISTORY_BACKFILL_DAYS } from "./sync-schedule";

/**
 * Chồng lấn đọc lại (giây). 30 phút là MẶC ĐỊNH TỰ CHỌN (chưa có nguồn từ sàn):
 * đủ che update_time sàn ghi trễ và lệch đồng hồ hai bên; giá = đọc lại tối đa
 * 30 phút đơn mỗi lượt, đơn không đổi thì không ghi (lát A 12/10). Không phải độ
 * trễ với khách — webhook và nhịp quét không đổi.
 */
export const WATERMARK_OVERLAP_SEC = 30 * 60;
/** Cửa sổ khi chưa có mốc (gian cũ sau deploy, gian mới) — đúng như trước 14/10. */
export const WATERMARK_DEFAULT_DAYS = 2;
/** Không quét xa hơn mốc này: xa hơn là việc của nạp lịch sử, không phải quét. */
export const WATERMARK_FLOOR_DAYS = HISTORY_BACKFILL_DAYS;

/** Hai cột mốc nước của gian (Channel). */
export interface WatermarkState {
  ordersWatermarkAt: Date | null;
  ordersCatchupBeforeAt: Date | null;
}

export type OrderWindowMode =
  /** Đường lui ORDER_SYNC_WINDOW=fixed: cửa sổ 2 ngày như cũ, không đọc / ghi cột. */
  | "fixed"
  /** Chưa có mốc: đọc 2 ngày, đủ thì đặt mốc. */
  | "fresh"
  /** Có mốc: đọc từ mốc − OVERLAP tới now0. */
  | "advance"
  /** Lượt trước bị cắt: vét phần cũ hơn mốc vét. */
  | "catchup";

export interface OrderWindowPlan {
  mode: OrderWindowMode;
  /** Giây Unix, hai đầu đóng (sàn nào dùng "<" thì tự cộng 1). */
  fromSec: number;
  toSec: number;
  /**
   * Mốc nước TRƯỚC lượt (giây). Lượt cắt đọc CŨ → MỚI phải đọc QUA mốc này thì
   * mới gọi là tiến; adapter dùng để đọc thêm trang khi cụm biến động trong 30'
   * chồng lấn vượt trần trang (21/10/2026 Bella Look: mốc kẹt 11 giờ dù lượt OK).
   */
  watermarkSec?: number;
}

/** Cửa sổ đọc của lượt này. `now0Ms` = thời điểm BẮT ĐẦU gọi sàn. */
export function planOrderWindow(
  ch: WatermarkState,
  now0Ms: number,
  env: string | undefined = process.env.ORDER_SYNC_WINDOW
): OrderWindowPlan {
  const now0 = Math.floor(now0Ms / 1000);
  const defaultFrom = now0 - WATERMARK_DEFAULT_DAYS * 86_400;
  if (env?.trim().toLowerCase() === "fixed") return { mode: "fixed", fromSec: defaultFrom, toSec: now0 };

  const wm = ch.ordersWatermarkAt ? Math.floor(ch.ordersWatermarkAt.getTime() / 1000) : null;
  const floor = now0 - WATERMARK_FLOOR_DAYS * 86_400;
  const fromSec = wm === null ? defaultFrom : Math.max(wm - WATERMARK_OVERLAP_SEC, floor);

  const catchup = ch.ordersCatchupBeforeAt ? Math.floor(ch.ordersCatchupBeforeAt.getTime() / 1000) : null;
  const prev = wm === null ? {} : { watermarkSec: wm };
  // Mốc vét nằm ngoài cửa sổ (cũ hơn sàn dưới, hoặc hỏng) → bỏ, quét thường.
  if (catchup !== null && catchup > fromSec && catchup <= now0) {
    return { mode: "catchup", fromSec, toSec: catchup, ...prev };
  }
  return { mode: wm === null ? "fresh" : "advance", fromSec, toSec: now0, ...prev };
}

/** Kết quả lượt đọc mà mốc nước cần: có bị cắt không, update_time cũ nhất đã đọc (giây). */
export interface WindowReadOutcome {
  truncated: boolean;
  oldestUpdateTime?: number;
  /** Đọc CŨ → MỚI bị cắt: đã đọc trọn tới mốc này (integrations/sync-contract.ts). */
  coveredUpToSec?: number;
}

export interface WatermarkWrite {
  ordersWatermarkAt?: Date;
  ordersCatchupBeforeAt?: Date | null;
}

/**
 * Hai cột cần ghi sau một lượt đọc KHÔNG LỖI. null = không ghi gì (đường lui
 * fixed). Lượt lỗi: nơi gọi không gọi hàm này.
 */
export function nextWatermark(plan: OrderWindowPlan, r: WindowReadOutcome): WatermarkWrite | null {
  if (plan.mode === "fixed") return null;
  if (!r.truncated) {
    // Đủ: vét xong thì mốc = mốc vét (phần [mốc vét, now0] lượt sau đọc lại qua
    // OVERLAP — đọc trùng, không mất); lượt thường thì mốc = now0 của lượt.
    return { ordersWatermarkAt: new Date(plan.toSec * 1000), ordersCatchupBeforeAt: null };
  }
  // Cắt nhưng đọc theo chiều CŨ → MỚI (TikTok 19/10/2026): phần đã đọc là trọn
  // [from, covered] → ghi nhận ngay, lượt sau đọc tiếp từ covered − OVERLAP.
  // Không có mốc vét: phần chưa đọc là phần MỚI hơn, lượt thường tự đọc tới.
  // Trước đó (đọc MỚI → CŨ + mốc vét) gian > trần/cửa sổ mỗi chu kỳ 2 lượt chỉ
  // tiến bằng phần dôi ra ngoài 2.500 đơn (6–13 phút) — log 8686 19/10 14:08–14:53.
  const covered = r.coveredUpToSec;
  if (covered !== undefined && covered > plan.fromSec && covered <= plan.toSec) {
    // KHÔNG LÙI MỐC (21/10/2026): phần đã đọc trọn nằm trong 30' chồng lấn trước
    // mốc cũ (cụm biến động > trần trang) thì giữ mốc — ghi "covered" sẽ kéo mốc
    // lùi và lượt sau đọc lại y hệt. Để lượt đọc tự nới trang qua cụm (adapter);
    // không qua được thì mốc đứng, log "mốc KHÔNG tiến" cho HQ/log thấy.
    if (plan.watermarkSec !== undefined && covered <= plan.watermarkSec) {
      return { ordersCatchupBeforeAt: null };
    }
    return { ordersWatermarkAt: new Date(covered * 1000), ordersCatchupBeforeAt: null };
  }
  // Cắt: giữ mốc nước. Mốc vét = update_time cũ nhất đã đọc, chỉ khi nó còn nằm
  // trong cửa sổ — sàn trả dòng ngoài cửa sổ (bỏ qua bộ lọc) hoặc không có
  // update_time thì không có gì để vét theo, bỏ mốc vét và để lượt sau quét lại.
  const oldest = r.oldestUpdateTime;
  if (oldest !== undefined && oldest > plan.fromSec && oldest <= plan.toSec) {
    return { ordersCatchupBeforeAt: new Date(oldest * 1000) };
  }
  return { ordersCatchupBeforeAt: null };
}

/** Một dòng log khi mốc nước không tiến bình thường (vét dở / bị cắt) — lượt thường im lặng. */
export function watermarkLogLine(
  channel: { channelName: string; shopName: string },
  plan: OrderWindowPlan,
  write: WatermarkWrite | null
): string | null {
  if (!write || plan.mode === "fixed") return null;
  const iso = (sec: number) => new Date(sec * 1000).toISOString();
  if (write.ordersCatchupBeforeAt) {
    return `[Auto-sync] ${channel.channelName} "${channel.shopName}": mốc nước giữ nguyên, lượt sau vét tiếp từ ${iso(plan.fromSec)} tới ${write.ordersCatchupBeforeAt.toISOString()}`;
  }
  if (plan.mode === "catchup") {
    return `[Auto-sync] ${channel.channelName} "${channel.shopName}": vét xong ${iso(plan.fromSec)} → ${iso(plan.toSec)}, mốc nước = ${iso(plan.toSec)}`;
  }
  // Đọc cũ → mới bị cắt: mốc tiến tới phần đã đọc trọn, chưa tới now0.
  const wmSec = write.ordersWatermarkAt ? Math.floor(write.ordersWatermarkAt.getTime() / 1000) : null;
  if (wmSec !== null && wmSec < plan.toSec) {
    return `[Auto-sync] ${channel.channelName} "${channel.shopName}": lượt bị cắt, đã đọc trọn ${iso(plan.fromSec)} → ${iso(wmSec)}, mốc nước = ${iso(wmSec)}, lượt sau đọc tiếp phần mới hơn`;
  }
  // Cắt mà không ghi được gì: mốc đứng yên — trước 21/10 im lặng nên Bella Look kẹt
  // 11 giờ không ai thấy (HQ chỉ báo "trễ", SQL lastSyncError trống).
  if (wmSec === null && write.ordersCatchupBeforeAt === null && plan.watermarkSec !== undefined) {
    return `[Auto-sync] ${channel.channelName} "${channel.shopName}": lượt bị cắt mà mốc nước KHÔNG tiến (vẫn ${iso(plan.watermarkSec)}) — phần đọc trọn chưa qua mốc cũ (cụm biến động > trần trang trong ${WATERMARK_OVERLAP_SEC / 60}' chồng lấn), sàn trả không tăng dần, hoặc dòng ngoài cửa sổ — xem dòng CHƯA ĐỦ / [TikTok] cùng gian`;
  }
  return null;
}
