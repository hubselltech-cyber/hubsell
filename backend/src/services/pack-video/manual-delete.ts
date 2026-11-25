// ============================================================
// VIDEO ĐÓNG HÀNG — CHỦ SHOP TỰ XÓA MỘT VIDEO (26/11/2026, lỗ hổng G8 của thiết kế mục 31.3)
//
// Trước đây video chỉ rời kho khi luật tự xóa tới hạn; khách muốn bỏ sớm (quay nhầm, lộ thông tin) phải nhờ
// Hubsell. Nay chủ shop tự xóa được TỪNG video đã lưu:
//   · chỉ CHỦ SHOP (route chặn bằng requireManage) — nhân viên không xóa được, kể cả video chính mình quay;
//   · chỉ video đã lên kho (STORED). Video đang chờ tải lên do máy quay tự gửi tiếp, quá 7 ngày thì worker dọn;
//   · xóa tệp trên R2 TRƯỚC (ngoài giao dịch database) rồi mới đánh dấu DELETED + lý do "MANUAL" — R2 lỗi thì
//     dòng sổ giữ nguyên, khách bấm lại được; không bao giờ có dòng "còn lưu" mà tệp đã mất do bước này;
//   · giờ đã quay KHÔNG cộng lại: sổ giờ tính cả video DELETED (services/pack-video/hours.ts);
//   · không phụ thuộc công tắc PACK_VIDEO_DELETE_ENABLED — đó là công tắc của luật TỰ xóa, còn đây là lệnh
//     của chính chủ dữ liệu. Dòng đã xóa hiện ở tab Lịch sử xóa với lý do "Chủ shop tự xóa".
// Không khôi phục được — hộp xác nhận trên web nói rõ, và cảnh báo thêm khi đơn đang có hoàn.
// ============================================================

import { getR2Storage } from "../../integrations/r2/client";
import { keyBelongsToOwner } from "../../lib/pack-video-key";
import { prisma } from "../../lib/prisma";
import { PackVideoError, type PackVideoDeps } from "./upload";

/** Mã lý do ghi vào cột deleteRule — web đổi ra "Chủ shop tự xóa" (frontend lib/pack-video.ts). */
export const MANUAL_DELETE_RULE = "MANUAL";

export async function deleteVideoByOwner(
  ownerId: string,
  id: string,
  deps: PackVideoDeps = {}
): Promise<{ id: string; status: "DELETED" }> {
  const row = await prisma.packVideo.findFirst({
    where: { ownerId, id },
    select: { recordedDate: true, id: true, ownerId: true, objectKey: true, status: true },
  });
  if (!row) throw new PackVideoError(404, "NOT_FOUND", "Không tìm thấy video");
  // Bấm hai lần / hai tab cùng xóa: lần sau coi như đã xong, không báo lỗi.
  if (row.status === "DELETED") return { id: row.id, status: "DELETED" };
  if (row.status !== "STORED") {
    throw new PackVideoError(409, "NOT_STORED", "Video này chưa tải lên xong nên chưa xóa được");
  }
  if (!keyBelongsToOwner(row.objectKey, row.ownerId)) {
    throw new PackVideoError(500, "KEY_MISMATCH", "Đường dẫn tệp không khớp chủ shop");
  }

  const storage = deps.storage ?? getR2Storage();
  await storage.remove(row.objectKey); // NGOÀI giao dịch database; tệp đã mất sẵn (404) cũng coi là xong

  const now = (deps.now ?? (() => new Date()))();
  await prisma.packVideo.updateMany({
    where: { recordedDate: row.recordedDate, id: row.id, ownerId, status: "STORED" },
    data: { status: "DELETED", deletedAt: now, deleteRule: MANUAL_DELETE_RULE, deleteAfter: null, holdReason: null },
  });
  return { id: row.id, status: "DELETED" };
}
