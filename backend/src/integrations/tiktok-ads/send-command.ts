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
import { VIDEO_ACTION_EXCLUDE, VIDEO_ACTION_RESTORE, VIDEO_VERDICT_MANUAL, parseVideoActionReasons } from "./action-log";

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

/**
 * Chiến dịch có dòng sổ nào ĐANG CHỜ SOI không (kẹt SENDING đủ tuổi, hoặc lệnh loại SUCCESS chưa soi)? Cả hai phép soi đều kết
 * luận dựa trên việc video VẮNG MẶT khỏi báo cáo — mà báo cáo video của TikTok thỉnh thoảng trả THIẾU dòng (probe 18/09/2026:
 * 3/12 lần gọi cùng tham số thiếu cùng một video) → lượt chấm chỉ tốn thêm một lần đọc xác nhận khi thật sự có gì để soi.
 */
export async function hasCommandsToCheck(adsCampaignId: string): Promise<boolean> {
  const n = await prisma.adsActionLog.count({
    where: {
      adsCampaignId,
      createdAt: { lt: new Date(Date.now() - RECONCILE_AFTER_MS) },
      OR: [{ status: VIDEO_STATUS_SENDING }, { action: VIDEO_ACTION_EXCLUDE, mode: "live", status: "SUCCESS", error: null }],
    },
  });
  return n > 0;
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

// ------------------------------------------------------------
// B7 — KIỂM LỆNH ĐÃ NGẤM CHƯA. creative/update trả "OK" cho CẢ lệnh, không trả kết quả từng video → sàn từ chối ngầm
// một video thì sổ vẫn SUCCESS. Lượt chấm hằng ngày soi lại mỗi lệnh LOẠI đã SUCCESS đúng MỘT lần (ghi chú vào cột
// error của chính dòng đó = dấu đã soi; dòng được chốt từ SENDING đã đối chiếu rồi nên cũng có ghi chú, không soi lại).
// Tuổi tối thiểu dùng chung mốc RECONCILE_AFTER_MS. Lệnh KHÔI PHỤC không soi: video vừa khôi phục có thể bị TikTok tự
// ngừng phân phối (nhóm Hubsell không đọc) → dễ báo nhầm.
// ------------------------------------------------------------

export interface SoakCheck {
  /** Video của lệnh mà sàn VẪN đang phân phối, và không phải do chủ shop khôi phục lại trên Hubsell. */
  notApplied: string[];
  note: string;
}

/** Thuần. `restoredIds` = video chủ shop đã khôi phục trên Hubsell SAU lệnh này (đang phân phối là đúng, không tính). */
export function soakCheckExclude(videoIds: string[], liveIds: Set<string>, restoredIds: Set<string>, checkedOn: string): SoakCheck {
  const day = `${checkedOn.slice(8, 10)}/${checkedOn.slice(5, 7)}`;
  const restored = videoIds.filter((id) => liveIds.has(id) && restoredIds.has(id)).length;
  const notApplied = videoIds.filter((id) => liveIds.has(id) && !restoredIds.has(id));
  const restoredTxt = restored > 0 ? ` (${restored} video đã được khôi phục lại trên Hubsell)` : "";
  if (notApplied.length === 0) {
    return { notApplied, note: `Kiểm lại ${day}: TikTok đã ngừng phân phối đủ ${videoIds.length - restored} video của lệnh${restoredTxt}.` };
  }
  return {
    notApplied,
    note:
      `Kiểm lại ${day}: ${notApplied.length}/${videoIds.length} video VẪN đang được TikTok phân phối — sàn không áp dụng lệnh cho các video này, ` +
      `hoặc video đã được khôi phục từ nơi khác (Seller Center / TikTok Ads Manager): ${notApplied.map((id) => `#${id}`).join(" ")}${restoredTxt}.`,
  };
}

export interface SoakCheckResult {
  logId: string;
  auto: boolean;
  notApplied: string[];
}

/** Lượt chấm hằng ngày gọi sau khi đọc trạng thái video: soi các lệnh loại SUCCESS chưa soi. Trả các lệnh CÓ video không ngấm. */
export async function soakCheckCommands(adsCampaignId: string, liveIds: Set<string>, today: string): Promise<SoakCheckResult[]> {
  const rows = await prisma.adsActionLog.findMany({
    where: {
      adsCampaignId,
      action: VIDEO_ACTION_EXCLUDE,
      mode: "live",
      status: "SUCCESS",
      error: null,
      createdAt: { lt: new Date(Date.now() - RECONCILE_AFTER_MS) },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, verdict: true, reasons: true, createdAt: true },
  });
  const out: SoakCheckResult[] = [];
  for (const l of rows) {
    const ids = parseVideoActionReasons(l.reasons).videos.map((v) => v.videoId);
    // Chủ shop khôi phục lại trên Hubsell sau lệnh này: đọc từ CHÍNH sổ lệnh (đủ cả lệnh cũ trước khi có mốc restoredByUserAt).
    const restores = await prisma.adsActionLog.findMany({
      where: { adsCampaignId, action: VIDEO_ACTION_RESTORE, status: { in: ["SUCCESS", VIDEO_STATUS_SENDING] }, createdAt: { gt: l.createdAt } },
      select: { reasons: true },
    });
    const restoredIds = new Set(restores.flatMap((x) => parseVideoActionReasons(x.reasons).videos.map((v) => v.videoId)));
    const r = soakCheckExclude(ids, liveIds, restoredIds, today);
    await prisma.adsActionLog.update({ where: { id: l.id }, data: { error: r.note.slice(0, 1000) } });
    if (r.notApplied.length > 0) out.push({ logId: l.id, auto: l.verdict !== VIDEO_VERDICT_MANUAL, notApplied: r.notApplied });
  }
  return out;
}
