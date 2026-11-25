// ============================================================
// WORKER DỌN VIDEO ĐÓNG HÀNG (lát W5, 18/11/2026 — docs/VIDEO-DONG-HANG-THIET-KE.md mục 19.4–19.6)
//
// Mỗi 6 giờ, theo thứ tự:
//   1. gộp giờ đã quay theo ngày (pack_usage_daily) — PHẢI chạy trước mọi việc bỏ mảnh tháng;
//   2. gán hạn giữ cho video đã lưu chưa có hạn (luật L1–L6 theo trạng thái đơn);
//   3. video tới hạn: CHẠY BÓNG mặc định — chỉ đếm "sẽ xóa", KHÔNG xóa tệp nào trên R2.
//      Xóa thật chỉ khi env PACK_VIDEO_DELETE_ENABLED=1 (sau một tuần chạy bóng + anh duyệt).
//   4. lượt tải lên dở dang quá 7 ngày: cùng công tắc — chạy bóng chỉ đếm, bật thì hủy lượt tải + xóa mảnh.
// Nhịp 6 giờ là SỐ TỰ CHỌN: luật tính bằng ngày. Lượt đầu 10 phút sau khi bật (không chen lúc khởi động).
// Tắt cả worker bằng PACK_VIDEO_JANITOR_OFF=1. Mọi trạng thái nghiệp vụ (mốc gộp, con trỏ gán hạn) nằm ở
// database (maintenance_jobs); biến cấp tệp chỉ là cờ chống chạy chồng (test no-module-state).
// ============================================================

import { isR2Configured, getR2Storage } from "../integrations/r2/client";
import { assignRetention, processDueVideos, sweepStalePending } from "../services/pack-video/retention";
import { rollUpUsageDaily } from "../services/pack-video/usage-daily";
import { packVideoDeleteEnabled } from "../config/pack-video";

const FIRST_RUN_DELAY_MS = 10 * 60 * 1000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

let started = false;
let running = false;

const janitorOff = () => process.env.PACK_VIDEO_JANITOR_OFF === "1";

export async function runPackVideoJanitor(now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const usage = await rollUpUsageDaily(now);
    console.log(`[pack-video-janitor] Gộp giờ theo ngày tới ${usage.watermark}: ghi ${usage.rows} dòng`);

    const assigned = await assignRetention({ now: () => now });
    console.log(
      `[pack-video-janitor] Gán hạn: đọc ${assigned.scanned} · có hạn ${JSON.stringify(assigned.assigned)} · giữ ${JSON.stringify(assigned.held)} · chờ ${assigned.waiting}`
    );

    const deleteEnabled = packVideoDeleteEnabled();
    const due = await processDueVideos({
      now: () => now,
      deleteEnabled,
      storage: deleteEnabled && isR2Configured() ? getR2Storage : undefined,
    });
    const moved = `khớp lại được đơn ${due.rematched} · gỡ hạn vì phải giữ ${due.blockedAtDue} · dời hạn ${due.postponed}`;
    console.log(
      due.shadow
        ? `[pack-video-janitor] CHẠY BÓNG — tới hạn ${due.scanned}: SẼ xóa ${due.wouldDelete} · ${moved} (không xóa tệp nào)`
        : `[pack-video-janitor] XÓA THẬT — tới hạn ${due.scanned}: đã xóa ${due.deleted} · ${moved} · lỗi ${due.errors}`
    );

    const stale = await sweepStalePending({
      now: () => now,
      deleteEnabled,
      storage: deleteEnabled && isR2Configured() ? getR2Storage : undefined,
    });
    if (stale.found > 0) {
      console.log(
        stale.shadow
          ? `[pack-video-janitor] CHẠY BÓNG — lượt tải dở quá hạn: SẼ dọn ${stale.found}`
          : `[pack-video-janitor] Lượt tải dở quá hạn: đã dọn ${stale.cleared}/${stale.found} · lỗi ${stale.errors}`
      );
    }
  } catch (err) {
    console.error("[pack-video-janitor] Lỗi lượt dọn:", (err as Error).message);
  } finally {
    running = false;
  }
}

export function startPackVideoJanitorWorker(): void {
  if (started) return;
  started = true;
  if (janitorOff()) {
    console.log("[pack-video-janitor] TẮT (PACK_VIDEO_JANITOR_OFF=1)");
    return;
  }
  setTimeout(() => void runPackVideoJanitor(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runPackVideoJanitor(), INTERVAL_MS).unref();
  console.log(
    `[pack-video-janitor] BẬT — mỗi ${INTERVAL_MS / 3_600_000}h: gộp giờ theo ngày + gán hạn giữ + ${packVideoDeleteEnabled() ? "XÓA THẬT video tới hạn" : "CHẠY BÓNG (không xóa tệp)"}`
  );
}
