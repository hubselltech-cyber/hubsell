// ============================================================
// WORKER CHỐT PHÍ VƯỢT TRẦN ĐƠN — từ 06:00 mùng 2 giờ VN chốt tháng TRƯỚC cho mọi chủ
// shop bằng MỘT câu INSERT … SELECT (services/plan-overage.ts → closeMonthOverage).
//
// Vì sao mùng 2 chứ không phải nửa đêm mùng 1 (em tự chọn 11/11/2026): cho đơn cuối tháng
// về trễ một ngày kịp vào số; số đã chốt là cuối cùng, đơn về sau nữa không tính thêm.
// Nhịp: mỗi giờ thử một lần trong suốt tháng — câu chốt tự bỏ qua chủ shop đã có phiếu
// (NOT EXISTS trước khi đếm đơn) nên lượt thừa gần như không tốn gì, còn worker có ngừng
// vài ngày thì bật lại là tự chốt bù. Hai worker chạy song song vô hại (unique + ON
// CONFLICT DO NOTHING; phiếu chỉ được báo bởi bên thật sự chèn được dòng).
// Tắt: env PLAN_OVERAGE_CLOSE_OFF=1 (đường lui — phiếu đã sinh giữ nguyên).
// Báo khách: chuông trong app (popup + dải nhắc ở web tự hiện theo phiếu). Thư cho khách
// khi có phiếu chưa làm — chờ anh chọn kênh.
// ============================================================

import { mailHq } from "../services/hq-mail";
import { notify } from "../services/notifications";
import {
  OVERAGE_DUE_DAY,
  OVERAGE_FIRST_MONTH,
  closeMonthOverage,
  monthLabel,
  vnPreviousMonthKey,
} from "../services/plan-overage";

const FIRST_RUN_DELAY_MS = 7 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
/** Chốt từ 06:00 ngày này (giờ VN) của tháng sau. */
const OVERAGE_CLOSE_DAY = 2;
const OVERAGE_CLOSE_HOUR = 6;

let started = false;
let running = false;

/** Đã tới giờ chốt tháng trước chưa (giờ VN). */
export function overageCloseDue(now: Date): boolean {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const day = vn.getUTCDate();
  return day > OVERAGE_CLOSE_DAY || (day === OVERAGE_CLOSE_DAY && vn.getUTCHours() >= OVERAGE_CLOSE_HOUR);
}

export async function runPlanOverageClose(now: Date = new Date()): Promise<void> {
  if (running || !overageCloseDue(now)) return;
  running = true;
  try {
    const month = vnPreviousMonthKey(now);
    if (month < OVERAGE_FIRST_MONTH) return; // chưa có tháng nào thuộc diện tính phí vượt
    const { created, open } = await closeMonthOverage(month, now);
    if (created === 0) return;
    const label = monthLabel(month);
    console.log(`[plan-overage] Chốt tháng ${label}: ${created} chủ shop, ${open.length} phiếu phải trả`);
    // Báo khách theo lô 20 — chuông trong app, một nút trả ở trang Gói dịch vụ.
    for (let i = 0; i < open.length; i += 20) {
      await Promise.allSettled(
        open.slice(i, i + 20).map((c) =>
          notify(c.ownerId, {
            type: "plan_quota",
            title: `Tháng ${label} vượt ${c.overOrders.toLocaleString("vi-VN")} đơn — ${c.amount.toLocaleString("vi-VN")} ₫`,
            body: `Gói ${c.planName}: ${c.ordersCounted.toLocaleString("vi-VN")} đơn / ${c.orderCap.toLocaleString("vi-VN")} đơn của gói. Phần vượt ${c.overOrders.toLocaleString("vi-VN")} đơn × ${c.unitPrice.toLocaleString("vi-VN")} ₫ = ${c.amount.toLocaleString("vi-VN")} ₫, thanh toán trước hết ngày mùng ${OVERAGE_DUE_DAY}. Mọi tính năng vẫn dùng bình thường.`,
            link: "/settings/plan",
          })
        )
      );
    }
    if (open.length > 0) {
      const total = open.reduce((s, c) => s + c.amount, 0);
      void mailHq({
        subject: `[Hubsell] Phí vượt tháng ${label}: ${open.length} phiếu — ${total.toLocaleString("vi-VN")}₫`,
        html: `<p>Đã chốt phí vượt trần đơn tháng ${label}: <b>${open.length}</b> khách phải trả, tổng <b>${total.toLocaleString("vi-VN")}₫</b>. Hạn hết mùng ${OVERAGE_DUE_DAY}, quá hạn chưa trả thì khóa tính năng nâng cao.</p><p>Xem danh sách + Miễn / Ghi nhận ở HQ → Gói dịch vụ.</p>`,
      });
    }
  } catch (err) {
    console.error("[plan-overage] Lỗi lượt chốt:", (err as Error).message);
  } finally {
    running = false;
  }
}

export function startPlanOverageCloseWorker(): void {
  if (started) return;
  started = true;
  if (process.env.PLAN_OVERAGE_CLOSE_OFF === "1") {
    console.log("[plan-overage] TẮT chốt phí vượt (PLAN_OVERAGE_CLOSE_OFF=1)");
    return;
  }
  setTimeout(() => void runPlanOverageClose(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runPlanOverageClose(), INTERVAL_MS).unref();
  console.log(
    `[plan-overage] BẬT — từ ${OVERAGE_CLOSE_HOUR}:00 mùng ${OVERAGE_CLOSE_DAY} hằng tháng chốt phí vượt trần đơn tháng trước (thử mỗi giờ)`
  );
}
