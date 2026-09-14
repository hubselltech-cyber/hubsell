// ============================================================
// CỜ NGUỒN DỪNG CỦA TRỢ LÝ QUẢNG CÁO — dùng chung Shopee + Lazada
//
// Sự cố 14/09/2026: Trợ lý (mode live) tạm dừng campaign ANO đang lời lúc 07:05
// mà seller không được báo, và Hubsell không phân biệt nổi "Tạm dừng" do mình
// hay do người. Máy trạng thái anh Trung chốt cùng ngày:
//
//   Hubsell dừng   → AdsCampaign.hubsellPausedAt ≠ null (kèm log + cửa sổ luật)
//                    → máy CHỈ được bật lại khi ROAS cửa sổ đó đạt lại.
//   Người dừng     → không cờ → máy KHÔNG BAO GIỜ bật lại, dù ROAS ra sao.
//   Người bật lại  → sync thấy campaign chạy trong khi cờ còn → xóa cờ,
//                    cycle + 1 = VÁN MỚI: máy đủ quyền như campaign mới
//                    (vi phạm thì tắt lại, kể cả cùng ngày).
//
// Nguồn sự thật là SỔ HÀNH ĐỘNG của chính Hubsell (Shopee không có API cho
// biết ai tắt) + trạng thái sàn trả về mỗi lượt đồng bộ. Kẽ hở duy nhất:
// người tắt rồi bật trong vòng một nhịp đồng bộ thì Hubsell không thấy.
// ============================================================

import { prisma } from "../../lib/prisma";

export interface ReconcileResult {
  /** Số campaign người đã bật lại trên sàn sau khi Hubsell dừng (cờ đã xóa). */
  overridden: number;
}

/**
 * Gọi NGAY SAU mỗi lượt upsert trạng thái campaign từ sàn (xung + lịch sử,
 * cả hai sàn): campaign còn cờ Hubsell mà sàn báo đang chạy = người đã bật
 * lại → xóa cờ, mở ván mới, ghi sổ + nhật ký vận hành. Không gọi sàn.
 */
export async function reconcileHubsellPauseFlags(channelId: string): Promise<ReconcileResult> {
  const resumedByHuman = await prisma.adsCampaign.findMany({
    where: { channelId, hubsellPausedAt: { not: null }, status: "ongoing" },
    select: {
      id: true,
      name: true,
      campaignId: true,
      hubsellPauseLogId: true,
      hubsellPauseCycle: true,
      channel: { select: { userId: true, shopName: true } },
    },
  });
  for (const row of resumedByHuman) {
    await clearHubsellPauseFlag(row.id, row.hubsellPauseCycle);
    if (row.hubsellPauseLogId) {
      await prisma.adsActionLog.updateMany({
        where: { id: row.hubsellPauseLogId, status: "SUCCESS" },
        data: { status: "OVERRIDDEN" },
      });
    }
    await prisma.opsActivity.create({
      data: {
        ownerId: row.channel.userId,
        tag: "ads",
        message: `↩️ Chiến dịch "${row.name || `#${row.campaignId}`}" (gian "${row.channel.shopName}") đã được bật lại trên Seller Center sau khi Trợ lý tạm dừng — Trợ lý coi là ván mới, tiếp tục theo dõi theo luật.`,
      },
    });
  }
  return { overridden: resumedByHuman.length };
}

/** Xóa cờ + mở ván mới (dùng chung cho người bật lại, máy bật lại, seller bấm Bật lại trong Hubsell). */
export async function clearHubsellPauseFlag(
  rowId: string,
  currentCycle: number,
  extra: { status?: string; hubsellResumedOn?: string } = {}
): Promise<void> {
  await prisma.adsCampaign.update({
    where: { id: rowId },
    data: {
      hubsellPausedAt: null,
      hubsellPauseLogId: null,
      hubsellPauseWindow: "",
      hubsellPauseCycle: currentCycle + 1,
      ...(extra.status ? { status: extra.status } : {}),
      ...(extra.hubsellResumedOn !== undefined ? { hubsellResumedOn: extra.hubsellResumedOn } : {}),
    },
  });
}
