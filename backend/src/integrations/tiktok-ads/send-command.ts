// ============================================================
// TIKTOK ADS — GỬI LỆNH LOẠI / KHÔI PHỤC VIDEO: GHI SỔ TRƯỚC, GỌI SÀN SAU (A3, 18/09/2026)
//
// Nguyên tắc "viết phiếu chi trước rồi mới đưa tiền" (anh Trung duyệt 18/09). Trước đây cả lệnh tự động lẫn nút thủ
// công đều gọi TikTok XONG mới ghi AdsActionLog → sự cố rơi đúng khe đó (DB chập chờn, Render khởi động lại lúc deploy)
// thì video đã bị loại thật mà sổ trống: khách không biết ai loại, vì sao, không có danh sách để khôi phục, và Hubsell
// không có bằng chứng ("khách mất tiền lại đổ oan cho mình").
//
//   1. Tạo dòng sổ status SENDING với ĐỦ danh sách video + căn cứ. Tạo hỏng → dừng, KHÔNG gọi sàn.
//   2. Gọi sàn.
//   3. Cập nhật CHÍNH dòng đó thành SUCCESS / FAILED (+ lỗi). Cập nhật hỏng → dòng nằm lại SENDING, vẫn tra được.
//
// Dòng kẹt SENDING không được ĐOÁN kết quả: lượt chấm hằng ngày đối chiếu với trạng thái THẬT của từng video trên
// TikTok (reconcileSendingCommand) rồi mới chốt. referenceId unique của dòng ghi trước cũng là chỗ chặn gửi hai lần khi
// lượt chấm chạy lại trong ngày.
// ============================================================

import { prisma } from "../../lib/prisma";
import { VIDEO_ACTION_EXCLUDE, parseVideoActionReasons } from "./action-log";

/** Lệnh đã ghi sổ, đang / đã gửi lên TikTok nhưng CHƯA xác nhận được kết quả. */
export const VIDEO_STATUS_SENDING = "SENDING";
/** Sàn cần tới ~20 phút để đổi trạng thái video → dòng SENDING trẻ hơn mốc này chưa được đem ra đối chiếu. */
const RECONCILE_AFTER_MS = 30 * 60 * 1000;

export interface VideoCommandLog {
  channelId: string;
  adsCampaignId: string;
  action: string;
  mode: string;
  verdict: string;
  reasons: string;
  referenceId: string;
}

export type VideoCommandResult = { ok: true; logId: string } | { ok: false; logId: string; error: string };

/** Ghi sổ SENDING → gọi sàn → chốt SUCCESS / FAILED trên chính dòng đó. Ném lỗi CHỈ khi chưa ghi được sổ (lúc đó chưa gọi sàn). */
export async function sendVideoCommand(log: VideoCommandLog, send: () => Promise<void>): Promise<VideoCommandResult> {
  const row = await prisma.adsActionLog.create({ data: { ...log, status: VIDEO_STATUS_SENDING }, select: { id: true } });
  try {
    await send();
  } catch (err) {
    const error = (err as Error).message.slice(0, 1000);
    await prisma.adsActionLog.update({ where: { id: row.id }, data: { status: "FAILED", error } }).catch((e) => {
      console.error(`[TikTok Ads] Không chốt được dòng sổ ${row.id} (FAILED):`, (e as Error).message);
    });
    return { ok: false, logId: row.id, error };
  }
  // Sàn đã nhận. Chốt sổ hỏng thì dòng nằm lại SENDING (đủ video + căn cứ) — lượt chấm hôm sau đối chiếu và chốt.
  await prisma.adsActionLog.update({ where: { id: row.id }, data: { status: "SUCCESS" } }).catch((e) => {
    console.error(`[TikTok Ads] Sàn đã nhận lệnh nhưng không chốt được dòng sổ ${row.id}:`, (e as Error).message);
  });
  return { ok: true, logId: row.id };
}

/**
 * Chốt một dòng kẹt SENDING theo trạng thái THẬT trên TikTok. `liveIds` = video đang được sàn phân phối / học / chờ thử.
 * Lệnh LOẠI thành công ⇔ video KHÔNG còn trong nhóm đó; lệnh KHÔI PHỤC thành công ⇔ video CÓ trong nhóm đó. Thuần.
 */
export function reconcileSendingCommand(
  action: string,
  videoIds: string[],
  liveIds: Set<string>
): { status: "SUCCESS" | "FAILED"; note: string } {
  const removing = action === VIDEO_ACTION_EXCLUDE;
  const applied = videoIds.filter((id) => (removing ? !liveIds.has(id) : liveIds.has(id))).length;
  const verb = removing ? "loại" : "khôi phục";
  if (videoIds.length > 0 && applied === 0) {
    return {
      status: "FAILED",
      note: `Không xác nhận được kết quả lúc gửi; đối chiếu lại thì TikTok CHƯA ${verb} video nào của lệnh này.`,
    };
  }
  return {
    status: "SUCCESS",
    note:
      applied === videoIds.length
        ? `Không xác nhận được kết quả lúc gửi; đối chiếu lại thì TikTok ĐÃ ${verb} đủ ${applied} video.`
        : `Không xác nhận được kết quả lúc gửi; đối chiếu lại thì TikTok đã ${verb} ${applied}/${videoIds.length} video.`,
  };
}

/** Lượt chấm hằng ngày gọi sau khi đọc trạng thái video của chiến dịch: chốt các dòng SENDING đã đủ tuổi. Trả số dòng đã chốt. */
export async function reconcileSendingCommands(adsCampaignId: string, liveIds: Set<string>): Promise<number> {
  const stuck = await prisma.adsActionLog.findMany({
    where: { adsCampaignId, status: VIDEO_STATUS_SENDING, createdAt: { lt: new Date(Date.now() - RECONCILE_AFTER_MS) } },
    select: { id: true, action: true, reasons: true },
  });
  for (const l of stuck) {
    const ids = parseVideoActionReasons(l.reasons).videos.map((v) => v.videoId);
    const r = reconcileSendingCommand(l.action, ids, liveIds);
    await prisma.adsActionLog.update({ where: { id: l.id }, data: { status: r.status, error: r.note } });
    console.warn(`[TikTok Ads] Chốt dòng sổ kẹt SENDING ${l.id}: ${r.status} — ${r.note}`);
  }
  return stuck.length;
}
