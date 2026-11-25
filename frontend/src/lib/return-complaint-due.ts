// ============================================================
// Ô "HẠN KHIẾU NẠI" của đơn hoàn — hàm THUẦN dựng nhãn từ hạn máy chủ trả.
// docs/HAN-KHIEU-NAI-DON-HOAN.md mục 14.5 + 15.2. Máy chủ quyết HẠN (backend lib/return-complaint-due.ts);
// tệp này chỉ quyết CÁCH NÓI: đếm ngược, sắc thái, chữ "dự kiến" / "ước tính", ý trong ô chi tiết.
// Ô vẽ ở components/shared/complaint-due-cell.tsx — dùng cho Đối soát đơn hoàn + tab Đơn hoàn (Video đóng hàng).
// ============================================================

import type { ChannelName, ReturnComplaintDue } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

/**
 * Sắc thái của ô (thiết kế lại 25/11/2026, docs mục 14.5):
 *   urgent  — hạn đã có căn cứ, còn ≤ 24 giờ: viên nền hồng + đồng hồ (không chỉ dựa vào màu chữ);
 *   red     — hạn TẠM của sàn còn ≤ 24 giờ: chữ đỏ, không viên (kiện chưa về, hạn còn có thể đổi);
 *   orange  — hạn DÀI (kiện giao thất bại 7 / 40 ngày) còn ≤ 48 giờ. Kiện khách trả KHÔNG có bậc cam:
 *             hạn sinh ra đã là 48 giờ, tô cam thì dòng nào cũng cam;
 *   normal  — còn hạn, chưa gấp;  soft — hạn tạm, chưa gấp;
 *   overdue / muted / faint — quá hạn / chưa tính, chưa rõ / không cần.
 */
export type ComplaintDueTone = "urgent" | "red" | "orange" | "normal" | "soft" | "overdue" | "muted" | "faint";

export interface ComplaintDueLabel {
  /** Dòng chính: "Còn 1 ngày 4 giờ" / "Quá hạn 3 giờ" / "Chưa tính · chờ kiện về" / "Không cần" / "Chưa rõ". */
  main: string;
  /** Dòng phụ: "hết 14:30 ngày mai" / "dự kiến · hết 23:59 ngày mai" / "ước tính · hết 00:10 T6 27/11". */
  sub: string | null;
  tone: ComplaintDueTone;
  /** Hạn ước tính từ giờ kho quét — hạn thật có thể sớm hơn; ô gạch chân chấm dòng chính. */
  estimate: boolean;
  /** Ý trong ô chi tiết (rê / bấm) — mỗi dữ kiện một dòng. */
  points: string[];
}

/** "1 ngày 4 giờ" / "5 giờ 20 phút" / "35 phút" — làm tròn XUỐNG để không hứa dư thời gian. */
export function formatSpan(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / MIN_MS));
  const days = Math.floor(totalMin / (24 * 60));
  const hours = Math.floor((totalMin % (24 * 60)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days} ngày ${hours} giờ` : `${days} ngày`;
  if (hours > 0) return mins > 0 ? `${hours} giờ ${mins} phút` : `${hours} giờ`;
  return `${Math.max(1, mins)} phút`;
}

const VN_OFFSET_MS = 7 * HOUR_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** Số ngày lịch (giờ Việt Nam) kể từ 01/01/1970 — để so "hôm nay / ngày mai". */
function vnDayIndex(ms: number): number {
  return Math.floor((ms + VN_OFFSET_MS) / DAY_MS);
}

/**
 * "14:30 hôm nay" / "05:40 ngày mai" / "16:10 T6 27/11" / "10:10 03/10" theo giờ Việt Nam.
 * Trong 6 ngày quanh hôm nay thì kèm thứ (đỡ phải nhẩm "27/11 là mai hay mốt"); xa hơn chỉ ghi ngày.
 */
function formatDueAt(iso: string, nowMs: number): string {
  const ms = new Date(iso).getTime();
  const vn = new Date(ms + VN_OFFSET_MS);
  const two = (n: number) => String(n).padStart(2, "0");
  const time = `${two(vn.getUTCHours())}:${two(vn.getUTCMinutes())}`;
  const date = `${two(vn.getUTCDate())}/${two(vn.getUTCMonth() + 1)}`;
  const diff = vnDayIndex(ms) - vnDayIndex(nowMs);
  if (diff === 0) return `${time} hôm nay`;
  if (diff === 1) return `${time} ngày mai`;
  if (diff === -1) return `${time} hôm qua`;
  if (Math.abs(diff) <= 6) return `${time} ${WEEKDAYS[vn.getUTCDay()]} ${date}`;
  return `${time} ${date}`;
}

function windowLabel(hours: number): string {
  return hours % 24 === 0 ? `${hours / 24} ngày` : `${hours} giờ`;
}

/** Số giờ luật hiện cho khách — hạn sàn trả với kiện khách trả là 2 ngày (cả 3 sàn). */
function windowOf(due: Extract<ReturnComplaintDue, { state: "DUE" }>): number | null {
  if (due.windowHours != null) return due.windowHours;
  return due.failedDelivery ? null : 48;
}

export function complaintDueLabel(
  due: ReturnComplaintDue,
  platform: ChannelName,
  nowMs: number
): ComplaintDueLabel {
  const san = CHANNEL_META[platform]?.label ?? platform;
  const loai = due.failedDelivery ? "kiện giao thất bại" : "khách trả hàng";

  if (due.state === "NOT_NEEDED") {
    return {
      main: "Không cần",
      sub: null,
      tone: "faint",
      estimate: false,
      points: ["Ca hoàn đã xong (đã nhập kho / đã được đền / đã xóa sổ)."],
    };
  }
  if (due.state === "NOT_STARTED") {
    return {
      main: "Chưa tính · chờ kiện về",
      sub: null,
      tone: "muted",
      estimate: false,
      points: [`${san} · ${loai}: hạn bắt đầu tính từ lúc kiện về tới shop.`, "Kiện chưa về, sàn chưa cho hạn."],
    };
  }
  if (due.state === "UNKNOWN") {
    return {
      main: "Chưa rõ",
      sub: null,
      tone: "muted",
      estimate: false,
      points: ["Thiếu mốc kiện về, Hubsell không đoán hạn.", `Xem hạn trực tiếp trên trang người bán ${san}.`],
    };
  }

  const left = new Date(due.dueAt).getTime() - nowMs;
  const at = formatDueAt(due.dueAt, nowMs);
  const win = windowOf(due);
  const provisional = due.source === "platform_provisional";
  const estimate = due.source === "estimate";
  // Tên sàn + số ngày luật nằm ở đây (ô chi tiết) — dòng phụ của ô chỉ còn mốc giờ.
  const points: string[] = [`${san} · ${loai}${win != null ? ` · ${windowLabel(win)} kể từ lúc kiện về` : ""}`];
  if (due.source === "platform") points.push(`Hạn ${at} — do ${san} trả về.`);
  if (provisional) {
    points.push(`Hạn TẠM ${at} — ${san} tính theo ngày nhận hàng hoàn dự kiến.`, "Kiện về tới shop thì sàn đặt lại hạn chính thức.");
  }
  if (due.source === "rule") points.push(`Hạn ${at} — Hubsell tính theo luật từ lúc sàn báo kiện về.`);
  if (estimate) {
    points.push(
      `Hạn ước tính ${at} — tính từ lúc kho quét nhận kiện.`,
      "Kiện thường về trước lúc kho quét → hạn thật trên sàn có thể SỚM hơn."
    );
  }
  if (!due.failedDelivery && (platform === "TIKTOK" || platform === "LAZADA")) {
    points.push(`${san} còn cửa khiếu nại 7 ngày (tráo / thiếu / hỏng hàng) — hạn trên là hạn kiểm hàng, đến trước.`);
  }
  const prefix = provisional ? "dự kiến · " : estimate ? "ước tính · " : "";

  if (left <= 0) {
    return { main: `Quá hạn ${formatSpan(-left)}`, sub: `${prefix}hết ${at}`, tone: "overdue", estimate, points };
  }
  const tone: ComplaintDueTone =
    left <= 24 * HOUR_MS
      ? provisional
        ? "red"
        : "urgent"
      : provisional
        ? "soft"
        : due.failedDelivery && left <= 48 * HOUR_MS
          ? "orange"
          : "normal";
  return { main: `Còn ${formatSpan(left)}`, sub: `${prefix}hết ${at}`, tone, estimate, points };
}
