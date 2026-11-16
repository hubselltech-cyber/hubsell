// ============================================================
// VIDEO ĐÓNG HÀNG — SỐ GIỜ QUAY: đã mua · đã quay · còn lại
// (16/11/2026, docs/VIDEO-DONG-HANG-THIET-KE.md mục 11)
//
// Anh Trung 16/11: "thiếu thống kê số giờ còn lại (ví dụ khách mua 1000 giờ, đã quay 400 thì còn
// lại 600) và cả nút mua thêm giờ quay". Cách bán anh chốt 14/11: bán GÓI THEO GIỜ, hết giờ thì dừng.
//
//   đã mua   = Σ seconds của sổ pack_hour_grants (chỉ chèn, không sửa — dựng lại được từ đầu)
//   đã quay  = Σ thời lượng các video ĐÃ LƯU: STORED + DELETED
//   còn lại  = đã mua − đã quay   (ĐƯỢC ÂM: video quay dở lúc hết giờ vẫn quay nốt, phần lố trừ
//              vào lần mua sau — anh chốt 14/11)
//
// Vì sao tính cả DELETED: video hết hạn bị xóa thì giờ quay ĐÃ DÙNG vẫn là đã dùng. PENDING (quay
// xong chưa tải lên) và LOST chưa tính — giờ chỉ tính khi video nằm an toàn trên kho.
//
// ⚠️ "Đã quay" đang cộng TRỰC TIẾP từ pack_videos. Trước khi làm việc bỏ mảnh tháng cũ (lát xóa)
// PHẢI có bảng gộp theo ngày, nếu không bỏ mảnh là số giờ đã quay tụt theo.
//
// CHƯA có ở đây: chặn mở video mới khi hết giờ. Bản thí điểm chưa bán giờ nên chưa chặn; khi mở
// bán thì chặn ở beginUpload bằng chính hàm getHoursBalance() này.
// ============================================================

import { randomUUID } from "node:crypto";
import { PACK_VIDEO_HOUR_PACKAGES, PACK_VIDEO_HOUR_SALES_OPEN } from "../../config/pack-video";
import { prisma } from "../../lib/prisma";

export const HOUR_GRANT_KINDS = ["PURCHASE", "GRANT", "ADJUST"] as const;
export type HourGrantKind = (typeof HOUR_GRANT_KINDS)[number];

/** Trạng thái video được tính là "đã dùng giờ". */
const COUNTED_STATUSES = ["STORED", "DELETED"] as const;

export interface HoursBalance {
  purchasedSeconds: number;
  usedSeconds: number;
  /** Có thể âm (xem chú thích đầu tệp). */
  remainingSeconds: number;
}

export interface HoursOverview extends HoursBalance {
  /** false = chưa mở bán: web chỉ hiện gói, không có bước thanh toán. */
  salesOpen: boolean;
  /** Các gói giờ; priceVnd = null khi giá chưa được chốt. */
  packages: { hours: number; priceVnd: number | null }[];
}

/** Phép tính thuần — tách riêng để test không cần database. */
export function computeBalance(purchasedSeconds: number, usedSeconds: number): HoursBalance {
  return { purchasedSeconds, usedSeconds, remainingSeconds: purchasedSeconds - usedSeconds };
}

export async function getHoursBalance(ownerId: string): Promise<HoursBalance> {
  const [granted, used] = await Promise.all([
    prisma.packHourGrant.aggregate({ where: { ownerId }, _sum: { seconds: true } }),
    prisma.packVideo.aggregate({
      where: { ownerId, status: { in: [...COUNTED_STATUSES] } },
      _sum: { durationSec: true },
    }),
  ]);
  return computeBalance(granted._sum.seconds ?? 0, used._sum.durationSec ?? 0);
}

export async function getHoursOverview(ownerId: string): Promise<HoursOverview> {
  return {
    ...(await getHoursBalance(ownerId)),
    salesOpen: PACK_VIDEO_HOUR_SALES_OPEN,
    packages: PACK_VIDEO_HOUR_PACKAGES.map((p) => ({ hours: p.hours, priceVnd: p.priceVnd })),
  };
}

export interface GrantHoursInput {
  ownerId: string;
  /** Dương = cộng giờ, âm = điều chỉnh giảm. Không nhận 0, không nhận số lẻ. */
  seconds: number;
  kind: HourGrantKind;
  note?: string | null;
  createdById?: string | null;
}

/** Ghi MỘT dòng vào sổ giờ. Chỉ chèn — sửa sai bằng một dòng ADJUST ngược dấu, không sửa dòng cũ. */
export async function grantHours(input: GrantHoursInput): Promise<{ id: string }> {
  if (!Number.isInteger(input.seconds) || input.seconds === 0) {
    throw new Error("Số giây phải là số nguyên khác 0");
  }
  if (!HOUR_GRANT_KINDS.includes(input.kind)) throw new Error(`Loại không hợp lệ: ${input.kind}`);
  const row = await prisma.packHourGrant.create({
    data: {
      id: randomUUID(),
      ownerId: input.ownerId,
      seconds: input.seconds,
      kind: input.kind,
      note: input.note?.trim() || null,
      createdById: input.createdById ?? null,
    },
    select: { id: true },
  });
  return row;
}
