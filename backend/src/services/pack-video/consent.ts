// ============================================================
// VIDEO ĐÓNG HÀNG — BƯỚC ĐỒNG Ý LẦN ĐẦU của chủ shop (26/11/2026, điều kiện mở cho khách B4 — thiết kế mục 30)
//
// Video có hình tem vận đơn (tên, số điện thoại, địa chỉ người mua) và lưu ở Cloudflare R2 ngoài Việt Nam. Chính sách
// bảo mật mục 13 hứa xin đồng ý khi thêm bên nhận dữ liệu → chủ shop phải bấm "Đồng ý và bắt đầu" MỘT lần trước khi
// tính năng chạy. Ghi vào đúng sổ đồng ý đang có (bảng TermsAcceptance, nguồn "pack_video", kèm bản Chính sách, IP,
// trình duyệt, giờ) — không thêm bảng / cột.
//   · Chỉ CHỦ SHOP đồng ý được; nhân viên chờ chủ shop.
//   · Tài khoản thí điểm (config PACK_VIDEO_PILOT_EMAILS) coi như đã đồng ý — đã dùng từ trước ngày có bước này.
//   · Đệm trong máy chỉ giữ câu trả lời "ĐÃ đồng ý" (không bao giờ đổi ngược) → mỗi chủ shop hỏi database một lần / tiến trình.
// ============================================================

import { PRIVACY_VERSION, TERMS_VERSION } from "../../lib/legal";
import { prisma } from "../../lib/prisma";
import { isPackVideoPilot } from "./access";

export const PACK_VIDEO_CONSENT_SOURCE = "pack_video";

const CONSENTED_CACHE_MAX = 50_000;
const consentedOwners = new Set<string>();

/** Chỉ cho test: quên đệm. */
export function forgetPackVideoConsents(): void {
  consentedOwners.clear();
}

export async function ownerPackVideoConsented(ownerId: string, ownerEmail: string | null | undefined): Promise<boolean> {
  if (isPackVideoPilot(ownerEmail)) return true;
  if (consentedOwners.has(ownerId)) return true;
  const row = await prisma.termsAcceptance.findFirst({
    where: { userId: ownerId, source: PACK_VIDEO_CONSENT_SOURCE },
    select: { id: true },
  });
  if (!row) return false;
  if (consentedOwners.size >= CONSENTED_CACHE_MAX) consentedOwners.clear();
  consentedOwners.add(ownerId);
  return true;
}

/** Ghi nhận chủ shop đồng ý. Gọi lại không sinh dòng thứ hai. */
export async function recordPackVideoConsent(
  ownerId: string,
  meta: { ip: string | null; userAgent: string | null }
): Promise<void> {
  const existing = await prisma.termsAcceptance.findFirst({
    where: { userId: ownerId, source: PACK_VIDEO_CONSENT_SOURCE },
    select: { id: true },
  });
  if (!existing) {
    await prisma.termsAcceptance.create({
      data: {
        userId: ownerId,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
        source: PACK_VIDEO_CONSENT_SOURCE,
        ip: meta.ip,
        userAgent: meta.userAgent ? meta.userAgent.slice(0, 512) : null,
      },
    });
  }
  consentedOwners.add(ownerId);
}
