// ============================================================
// BÁO CÁO TUẦN TỰ ĐỘNG — sáng THỨ 2 đẩy qua chuông thông báo.
//
// "Chủ shop chưa kịp hỏi đã có báo cáo chờ sẵn": mỗi sáng thứ 2 (từ 8h giờ
// VN), worker dựng báo cáo TUẦN TRƯỚC trọn vẹn (thứ 2 → chủ nhật) cho từng
// chủ shop có gian hàng rồi notify() — ghi DB + đẩy SSE, bấm thông báo là
// deep-link ?assistant=… mở bong bóng Trợ lý với đúng bản báo cáo đầy đủ
// (bảng số + biểu đồ), số liệu CÙNG MỘT NGUỒN buildPeriodReport với chat.
//
// Idempotent theo tuần: đã có Notification type=weekly-report tạo từ 00:00
// thứ 2 tuần này thì thôi — quét lại/restart không bắn trùng. Lỗi của một
// shop không chặn shop khác (báo cáo là tiện ích, không phải nghiệp vụ).
//
// Tắt bằng env WEEKLY_REPORT_OFF=1 (mặc định bật).
// ============================================================

import { prisma } from "../lib/prisma";
import { notify } from "../services/notifications";
import { businessDayStart, BUSINESS_TZ_OFFSET_MS } from "../lib/date-range";
import { buildPeriodReport, fmtDayLabel, lastWeekRange } from "../routes/assistant";

/** Giờ VN sớm nhất trong ngày thứ 2 được phép gửi. */
const SEND_FROM_HOUR_VN = 8;
/** Nhịp kiểm tra điều kiện gửi. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** Lượt đầu sau boot — nhường sync/webhook nóng máy trước. */
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
/** Giãn cách giữa hai shop — mỗi báo cáo là một lượt tính P&L. */
const PER_OWNER_PAUSE_MS = 500;

let started = false;
let running = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Khởi động worker (gọi 1 lần từ index.ts — KHÔNG gọi trong test). */
export function startWeeklyReportWorker(): void {
  if (started) return;
  started = true;

  if (process.env.WEEKLY_REPORT_OFF === "1") {
    console.log("[Weekly-report] TẮT (WEEKLY_REPORT_OFF=1)");
    return;
  }

  setTimeout(() => void runWeeklyReports(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runWeeklyReports(), CHECK_INTERVAL_MS).unref();
  console.log(
    `[Weekly-report] BẬT — sáng thứ 2 (từ ${SEND_FROM_HOUR_VN}h VN) đẩy báo cáo tuần trước qua chuông`
  );
}

/**
 * Một lượt quét. `force` bỏ qua điều kiện thứ 2/giờ (chỉ dùng test tay qua
 * script — idempotency theo tuần vẫn giữ nguyên).
 */
export async function runWeeklyReports(force = false): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const vn = new Date(now.getTime() + BUSINESS_TZ_OFFSET_MS);
    if (!force && (vn.getUTCDay() !== 1 || vn.getUTCHours() < SEND_FROM_HOUR_VN)) {
      return;
    }

    const week = lastWeekRange(now);
    const weekLabel = `${fmtDayLabel(week.gte)}–${fmtDayLabel(week.lte)}`;
    // Mốc idempotency: từ 00:00 (VN) của ngày chạy — thứ 2 thì chính là đầu
    // tuần này, mỗi tuần chỉ một bản.
    const sentSince = businessDayStart(now);

    // Mỗi chủ shop có ít nhất một gian hàng nhận một bản báo cáo.
    const owners = await prisma.channel.findMany({
      distinct: ["userId"],
      select: { userId: true },
    });

    for (const { userId } of owners) {
      try {
        const already = await prisma.notification.findFirst({
          where: { ownerId: userId, type: "weekly-report", createdAt: { gte: sentSince } },
          select: { id: true },
        });
        if (already) continue;

        const report = await buildPeriodReport(
          userId,
          { userId },
          week,
          `Tuần trước (${weekLabel})`
        );
        await notify(userId, {
          type: "weekly-report",
          title: `📊 Báo cáo tuần ${weekLabel}`,
          body: report.text.replace(/^📊 /, ""),
          // Bấm thông báo → về Tổng quan, widget Trợ lý đọc query param này
          // rồi tự mở + hỏi đúng câu, hiện bản báo cáo đầy đủ kèm biểu đồ.
          link: `/?assistant=${encodeURIComponent("Báo cáo tuần trước")}`,
        });
      } catch (err) {
        console.error(
          `[Weekly-report] Lỗi dựng báo cáo cho owner ${userId}:`,
          (err as Error).message
        );
      }
      await sleep(PER_OWNER_PAUSE_MS);
    }
  } catch (err) {
    console.error("[Weekly-report] Lỗi vòng quét:", err);
  } finally {
    running = false;
  }
}
