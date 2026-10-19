// ============================================================
// HỢP ĐỒNG "DỮ LIỆU + ĐẦY ĐỦ" CHO MỌI LƯỢT ĐỌC TỪ SÀN
// (docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md mục 6.3, lát 3.1 của giai đoạn 3 — 14/10/2026)
//
// Mọi hàm kéo dữ liệu từ sàn theo trang đều có chốt chặn số trang (phòng phân
// trang vô tận, sàn trả trang lặp…). Chạm chốt là CÒN DỮ LIỆU CHƯA ĐỌC; trước
// 29/09/2026 việc này im lặng, sau đó chỉ ghi log ở đồng bộ đơn. Từ 14/10 mọi
// kết quả đọc sàn phải mang cờ đầy đủ để trình biên dịch buộc nơi gọi biết:
//   · SyncCompleteness — kết quả lượt ĐỒNG BỘ (đọc + ghi): `pages` đã đọc,
//     `truncated` = dừng vì chạm chốt, phần còn lại chưa đọc.
//   · ReadCompleteness — kết quả lượt ĐỌC thuần (adapter danh mục):
//     `complete` = đã đọc hết; false thì KHÔNG được suy ra "sàn đã gỡ".
// Test `integrations/__tests__/sync-contract.test.ts` khóa bằng kiểu: hàm nào
// trả thiếu cờ thì `tsc` đỏ (Render cũng biên dịch test khi build).
//
// Nơi gọi xử lý thế nào: lát 3.2 (mốc nước từng gian) sẽ KHÔNG tiến mốc khi
// `truncated`; hiện tại worker ghi log "CHƯA ĐỦ" để đếm trên Render Logs.
// ============================================================

/** Kết quả một lượt đồng bộ có phân trang: đã đọc bao nhiêu trang, có dừng non không. */
export interface SyncCompleteness {
  /** Số lượt gọi danh sách đã thực hiện (mọi lát / cửa sổ cộng dồn). */
  pages: number;
  /** true = dừng vì chạm chốt chặn số trang; còn dữ liệu CHƯA đọc. */
  truncated: boolean;
  /**
   * update_time (giây Unix) CŨ NHẤT trong các dòng đã đọc — nguyên liệu cho mốc
   * nước (services/order-watermark.ts): bị cắt thì phần chưa đọc là phần cũ hơn
   * mốc này (ba sàn đều đọc mới nhất trước). undefined = không đọc được dòng nào
   * hoặc sàn không trả update_time.
   */
  oldestUpdateTime?: number;
  /**
   * Lượt đọc theo chiều CŨ → MỚI (TikTok từ 19/10/2026, sort update_time ASC) bị
   * cắt: mọi dòng có update_time ≤ mốc này ĐÃ đọc trọn, phần chưa đọc là phần
   * MỚI HƠN → mốc nước tiến tới đây dù chưa đủ (services/order-watermark.ts).
   * Chỉ đặt khi sàn trả đúng thứ tự tăng dần (adapter tự kiểm); undefined = như cũ.
   * Vì sao: đọc MỚI → CŨ rồi cắt thì phần đã đọc không bao giờ được ghi nhận —
   * gian > 2.500 biến động/cửa sổ (Siêu Thị 8686 TikTok 19/10) mỗi chu kỳ 2 lượt
   * đọc lại đúng 2.500 đơn ấy, mốc chỉ tiến 6–13 phút, không bao giờ đuổi kịp.
   */
  coveredUpToSec?: number;
}

/** Kết quả một lượt đọc thuần: đã đọc hết hay dừng non. */
export interface ReadCompleteness {
  complete: boolean;
}

/**
 * Một dòng log thống nhất cho lượt đọc chưa đủ — cùng từ khóa `CHƯA ĐỦ` để lọc
 * trên Render Logs (grep "CHƯA ĐỦ"). `what`: "đơn" / "yêu cầu hoàn" / "danh mục".
 */
export function incompleteReadMessage(
  channel: { channelName: string; shopName: string; id: string },
  what: string,
  r: SyncCompleteness & { fetched?: number; scanned?: number },
  mode: string
): string {
  const n = r.fetched ?? r.scanned;
  const rest =
    r.coveredUpToSec !== undefined
      ? `đã đọc trọn tới ${new Date(r.coveredUpToSec * 1000).toISOString()}, phần mới hơn lượt sau đọc tiếp`
      : "phần cũ hơn chưa đọc";
  return (
    `[Auto-sync] ${channel.channelName} "${channel.shopName}" (${channel.id}): lượt ${mode} ${what} CHƯA ĐỦ — ` +
    `dừng ở ${r.pages} trang${n !== undefined ? `, ${n} ${what === "đơn" ? "đơn" : "dòng"}` : ""}; ${rest}`
  );
}
