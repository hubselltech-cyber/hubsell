// ============================================================
// Ô "HẠN KHIẾU NẠI" của đơn hoàn — hàm THUẦN dựng nhãn từ hạn máy chủ trả (lát 2, 25/11/2026).
// docs/HAN-KHIEU-NAI-DON-HOAN.md mục 3.1 + mục 10. Máy chủ quyết HẠN (backend lib/return-complaint-due.ts);
// tệp này chỉ quyết CÁCH NÓI: đếm ngược, màu, chữ "dự kiến" / "ước tính", ý trong ô chi tiết.
// ============================================================

import type { ChannelName, PackVideoReturnComplaintDue } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

export type ComplaintDueTone = "red" | "orange" | "normal" | "overdue" | "muted" | "faint";

export interface ComplaintDueLabel {
  /** Dòng chính: "Còn 1 ngày 4 giờ" / "Quá hạn 3 giờ" / "Chưa tính" / "Không cần" / "Chưa rõ". */
  main: string;
  /** Dòng phụ: "đến 14:30 25/11 · Shopee 2 ngày". */
  sub: string | null;
  tone: ComplaintDueTone;
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

/** "14:30 25/11" theo giờ Việt Nam. */
export function formatDueAt(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("day")}/${get("month")}`;
}

function windowLabel(hours: number): string {
  return hours % 24 === 0 ? `${hours / 24} ngày` : `${hours} giờ`;
}

/** Số giờ luật hiện cho khách — hạn sàn trả với kiện khách trả là 2 ngày (cả 3 sàn). */
function windowOf(due: Extract<PackVideoReturnComplaintDue, { state: "DUE" }>): number | null {
  if (due.windowHours != null) return due.windowHours;
  return due.failedDelivery ? null : 48;
}

export function complaintDueLabel(
  due: PackVideoReturnComplaintDue,
  platform: ChannelName,
  nowMs: number
): ComplaintDueLabel {
  const san = CHANNEL_META[platform]?.label ?? platform;
  const loai = due.failedDelivery ? "kiện giao thất bại" : "khách trả hàng";

  if (due.state === "NOT_NEEDED") {
    return { main: "Không cần", sub: null, tone: "faint", points: ["Ca hoàn đã xong (đã nhập kho / đã được đền / đã xóa sổ)."] };
  }
  if (due.state === "NOT_STARTED") {
    return {
      main: "Chưa tính",
      sub: "chờ kiện về",
      tone: "muted",
      points: [`${san} · ${loai}: hạn bắt đầu tính từ lúc kiện về tới shop.`, "Kiện chưa về, sàn chưa cho hạn."],
    };
  }
  if (due.state === "UNKNOWN") {
    return {
      main: "Chưa rõ",
      sub: null,
      tone: "muted",
      points: ["Thiếu mốc kiện về, Hubsell không đoán hạn.", `Xem hạn trực tiếp trên trang người bán ${san}.`],
    };
  }

  const left = new Date(due.dueAt).getTime() - nowMs;
  const at = formatDueAt(due.dueAt);
  const win = windowOf(due);
  const rulePoint = `${san} · ${loai}${win != null ? ` · ${windowLabel(win)} kể từ lúc kiện về` : ""}`;
  const points: string[] = [rulePoint];
  // Dòng phụ ngắn (ô không xuống dòng) — chi tiết nằm trong ô rê / bấm.
  let sub = `đến ${at} · ${san}${win != null ? ` ${windowLabel(win)}` : ""}`;
  if (due.source === "platform") points.push(`Hạn ${at} — do ${san} trả về.`);
  if (due.source === "platform_provisional") {
    sub = `dự kiến đến ${at} · ${san}`;
    points.push(`Hạn TẠM ${at} — ${san} tính theo ngày nhận hàng hoàn dự kiến.`, "Kiện về tới shop thì sàn đặt lại hạn chính thức.");
  }
  if (due.source === "rule") points.push(`Hạn ${at} — Hubsell tính theo luật từ lúc sàn báo kiện về.`);
  if (due.source === "estimate") {
    sub = `ước tính đến ${at}`;
    points.push(
      `Hạn ước tính ${at} — tính từ lúc kho quét nhận kiện.`,
      "Kiện thường về trước lúc kho quét → hạn thật trên sàn có thể SỚM hơn."
    );
  }
  if (!due.failedDelivery && (platform === "TIKTOK" || platform === "LAZADA")) {
    points.push(`${san} còn cửa khiếu nại 7 ngày (tráo / thiếu / hỏng hàng) — hạn trên là hạn kiểm hàng, đến trước.`);
  }

  if (left <= 0) {
    return { main: `Quá hạn ${formatSpan(-left)}`, sub: `hết lúc ${at}`, tone: "overdue", points };
  }
  const tone: ComplaintDueTone = left <= 24 * HOUR_MS ? "red" : left <= 48 * HOUR_MS ? "orange" : "normal";
  return { main: `Còn ${formatSpan(left)}`, sub, tone, points };
}
