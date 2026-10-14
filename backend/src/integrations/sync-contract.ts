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
  return (
    `[Auto-sync] ${channel.channelName} "${channel.shopName}" (${channel.id}): lượt ${mode} ${what} CHƯA ĐỦ — ` +
    `dừng ở ${r.pages} trang${n !== undefined ? `, ${n} ${what === "đơn" ? "đơn" : "dòng"}` : ""}; phần cũ hơn chưa đọc`
  );
}
