import type { PackingScanResponse } from "../types/api";
// Chỉ lấy KIỂU: tệp này phải chạy được bằng node (test), không được kéo expo-audio vào.
import type { ScanSound } from "./scan-sounds";

/**
 * QUÉT ĐÓNG GÓI — kết quả máy chủ → màn báo + âm + rung (05/11/2026). Hàm thuần để test
 * được bằng node và để một chỗ duy nhất quyết "kêu tiếng gì, giữ bao lâu".
 *
 * Anh Trung chốt: KHÔNG popup nút bấm — chỉ âm thanh + màn báo tự tắt, seller quét nhanh;
 * đơn hủy và đơn không hủy phải nghe ra khác nhau. Người gói nhìn kiện chứ không nhìn
 * màn hình nên ÂM là kênh chính, màn là kênh phụ.
 *
 * Bảng (docs/MOBILE-DAI-TU-DON-HANG-KHO.md mục 3):
 *   ghi được                    xanh   ting-ting          0,8 s
 *   ghi được + khách xin hủy    vàng   rè trầm            2,5 s   (để riêng kiện)
 *   đã quét rồi                 vàng   boop-boop          1,2 s
 *   ĐƠN ĐÃ HỦY                  đỏ     còi hai tông riêng 2,5 s   (bỏ kiện lại)
 *   chặn khác / không thấy mã   đỏ     rè trầm            2 s
 *   mất mạng                    đỏ     rè trầm            2 s     (kiện CHƯA ghi)
 * Thời lượng là mặc định tự chọn, chỉnh sau khi anh thử tay.
 */

export type PackFlashKind =
  /** Ghi được. */
  | "ok"
  /** Ghi được nhưng phải để ý (khách đang xin hủy). */
  | "caution"
  /** Kiện này đã quét trước đó. */
  | "dup"
  /** ĐƠN ĐÃ HỦY — bỏ kiện lại. */
  | "cancelled"
  /** Máy chủ nhận ra đơn nhưng không cho đưa ship (chưa chuẩn bị hàng, đã giao, đã lên biên bản). */
  | "blocked"
  /** Không ghi được: không thấy đơn, mã khớp nhiều đơn, mất mạng. */
  | "failed";

export type PackHaptic = "success" | "warning" | "error" | "errorTwice";
export type PackCounter = "packed" | "cancelled" | "failed";

export interface PackFlash {
  kind: PackFlashKind;
  /** Dòng to nhất trên màn báo. */
  title: string;
  /** Mã đơn (hoặc mã vừa quét khi không ra đơn). */
  code: string;
  /** Gian · hãng vận chuyển — chỉ có khi ra đơn. */
  meta: string | null;
  /** Câu giải thích / việc cần làm. */
  detail: string | null;
  sound: ScanSound;
  haptic: PackHaptic;
  /** Màn báo tự tắt sau chừng này. */
  holdMs: number;
  /** Ô đếm ở dải đáy được cộng 1; null = không đếm (quét trùng). */
  counter: PackCounter | null;
  /** Chữ ngắn cho dòng "Vừa quét" ở dải đáy. */
  short: string;
}

function hhmm(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Máy chủ trả 200: đã nhận ra đơn. `again` = kiện này đã được quét trong phiên rồi
 * (12/11/2026, anh Trung: "quét lần 2 phải hiện lên là đã quét trùng") — đơn hủy vẫn
 * kêu còi hủy (việc phải làm không đổi) nhưng nói rõ là quét lại.
 */
export function flashOfResponse(res: PackingScanResponse, again = false): PackFlash {
  const o = res.order;
  const code = o.orderCode;
  const meta = [o.channel.shopName, o.carrierLabel].filter(Boolean).join(" · ") || null;

  if (res.result === "REJECTED") {
    if (res.reason === "CANCELLED") {
      return {
        kind: "cancelled",
        title: "ĐƠN ĐÃ HỦY",
        code,
        meta,
        detail: again ? "Kiện này đã quét rồi — vẫn bỏ lại, không đưa ship" : "Bỏ kiện lại — không đưa ship",
        sound: "cancelled",
        haptic: "errorTwice",
        holdMs: 2500,
        counter: "cancelled",
        short: again ? "ĐƠN ĐÃ HỦY, đã quét rồi — bỏ kiện lại" : "ĐƠN ĐÃ HỦY, bỏ kiện lại",
      };
    }
    return {
      kind: "blocked",
      title: "KHÔNG ĐƯA SHIP",
      code,
      meta,
      detail: res.reasonText ?? "Đơn này không đóng gói được",
      sound: "error",
      haptic: "error",
      holdMs: 2000,
      counter: "failed",
      short: res.reasonText ?? "không đóng gói được",
    };
  }

  // Khách đang xin hủy: máy chủ vẫn ghi (cảnh báo, không khóa cứng) nhưng người gói phải
  // dừng tay — cùng luật với màn quét xem đơn (anh Trung chốt 23/10: kêu tiếng lỗi + rung mạnh).
  const cancelAsked = res.warnings.includes("CANCEL_REQUESTED");

  if (res.result === "ALREADY_PACKED") {
    const at = hhmm(o.packingDoneAt);
    return {
      kind: "dup",
      title: "KIỆN NÀY ĐÃ QUÉT RỒI",
      code,
      meta,
      detail: cancelAsked
        ? "Khách đang xin hủy đơn này — để riêng kiện, chờ shop trả lời sàn"
        : at
          ? `Đã quét lúc ${at}`
          : null,
      sound: "duplicate",
      haptic: "warning",
      holdMs: cancelAsked ? 2500 : 1200,
      counter: null,
      short: at ? `đã quét lúc ${at}` : "đã quét rồi",
    };
  }

  if (cancelAsked) {
    return {
      kind: "caution",
      title: "KHÁCH ĐANG XIN HỦY",
      code,
      meta,
      detail: "Đã ghi đóng gói. Để riêng kiện này, chờ shop trả lời sàn",
      sound: "error",
      haptic: "error",
      holdMs: 2500,
      counter: "packed",
      short: "đã ghi · khách đang xin hủy, để riêng",
    };
  }

  // Lưu ý nhẹ (chưa in phiếu trên Hubsell / sàn đã báo Đang giao): vẫn là "ghi được",
  // tiếng ting-ting, chỉ thêm một dòng chữ và giữ màn lâu hơn chút cho kịp đọc.
  const note = res.warningTexts[0] ?? null;
  return {
    kind: "ok",
    title: "ĐÃ ĐÓNG GÓI",
    code,
    meta,
    detail: note,
    sound: "success",
    haptic: "success",
    holdMs: note ? 1500 : 800,
    counter: "packed",
    short: note ? `đã ghi · ${note}` : "đã ghi",
  };
}

/** Lỗi nào coi là "chưa tới được máy chủ" → kiện CHƯA ghi, nên thử lại. */
export function isNetworkFailure(status: number): boolean {
  return status === 0 || status === 408 || status >= 500;
}

/** Lượt gọi hỏng: không thấy đơn (404), khớp nhiều đơn (409), mất mạng, lỗi khác. */
export function flashOfError(scanned: string, status: number, message: string): PackFlash {
  const base = {
    kind: "failed" as const,
    code: scanned,
    meta: null,
    sound: "error" as const,
    haptic: "error" as const,
    holdMs: 2000,
    counter: "failed" as const,
  };
  if (isNetworkFailure(status)) {
    return {
      ...base,
      title: "CHƯA GHI ĐƯỢC",
      detail: "Mất kết nối máy chủ — kiện này CHƯA được ghi. Giữ kiện trong khung, máy tự thử lại.",
      short: "CHƯA ghi — mất kết nối",
    };
  }
  if (status === 404) {
    return {
      ...base,
      title: "KHÔNG THẤY ĐƠN",
      detail: "Tem của đơn vị khác, hoặc đơn chưa về Hubsell",
      short: "không thấy đơn",
    };
  }
  if (status === 409) {
    return {
      ...base,
      title: "MÃ KHỚP NHIỀU ĐƠN",
      detail: "Quét lại đúng mã vận đơn trên tem, hoặc gõ thêm ký tự",
      short: "mã khớp nhiều đơn",
    };
  }
  return { ...base, title: "KHÔNG GHI ĐƯỢC", detail: message, short: message };
}
