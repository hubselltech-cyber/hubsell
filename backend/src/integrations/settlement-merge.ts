// ============================================================
// SAO KÊ CỦA ĐƠN = TỔNG MỌI DÒNG SÀN ĐÃ GHI CHO ĐƠN ĐÓ (dùng chung TikTok / Lazada)
//
// Dòng tiền của một đơn rải ở nhiều "mảnh" của sàn: dòng bán một ngày, dòng
// hoàn / điều chỉnh có thể nhiều tuần sau. TikTok chia mảnh theo BẢN KÊ
// (statement), Lazada theo NGÀY giao dịch. Lượt đối soát theo nhịp chỉ đọc 7
// ngày gần nhất, nên nó chỉ thấy MỘT PHẦN các mảnh của những đơn như vậy và
// KHÔNG được ghi đè sao kê bằng riêng phần nó thấy.
//
// SỰ CỐ 02/10/2026: trước đó lượt quét luôn ghi đè → 43 đơn TikTok ở 5 gian chỉ
// còn dòng hoàn, mất dòng bán, tiền quyết toán âm gần bằng giá bán (khoảng
// 11,55 triệu lỗ ảo). Lazada có cùng cách ghi đè, sửa cùng đợt.
//
// Mỗi sao kê lưu danh sách khóa các mảnh đã cộng vào nó (TikTok:
// TiktokOrderSettlement.statementIds; Lazada: LazadaOrderSettlement.lineDayKeys).
// Hàm dưới đây so danh sách đó với các mảnh lượt quét đang thấy.
// ============================================================

export interface SettlementWritePlan {
  /**
   * - "write": lượt này thấy đủ mọi mảnh đã biết → ghi từ các dòng đang có.
   * - "merge": có khóa MỚI, và có mảnh đã biết nằm ngoài lượt này (`missing`) →
   *   phải đọc lại các dòng nằm ngoài lượt rồi cộng chung mới ghi.
   * - "skip": không có gì mới, lượt này chỉ thấy một phần → sao kê đang lưu đã
   *   gồm phần đó; ghi là mất các dòng nằm ngoài lượt.
   */
  action: "write" | "merge" | "skip";
  /** Các mảnh đã biết mà lượt này không thấy. */
  missing: string[];
  /** Hợp của khóa đã biết và khóa đang thấy, đã sắp xếp. */
  all: string[];
}

/**
 * @param known   khóa các mảnh sao kê ĐANG LƯU được dựng từ đó
 * @param seen    khóa các mảnh lượt quét này thấy
 * @param pieceOf khóa → mảnh. TikTok: khóa chính là mã bản kê (bản kê đã chốt
 *   không đổi). Lazada: khóa = "ngày#số dòng", mảnh = ngày — cùng ngày mà số
 *   dòng đổi thì là khóa mới của mảnh cũ.
 */
export function planSettlementWrite(
  known: Iterable<string>,
  seen: Iterable<string>,
  pieceOf: (key: string) => string = (key) => key
): SettlementWritePlan {
  const knownKeys = new Set(known);
  const seenKeys = new Set(seen);
  const seenPieces = new Set([...seenKeys].map(pieceOf));
  const missing = [...new Set([...knownKeys].map(pieceOf))].filter((piece) => !seenPieces.has(piece));
  const all = [...new Set([...knownKeys, ...seenKeys])].sort();
  if (missing.length === 0) return { action: "write", missing, all };
  const hasNew = [...seenKeys].some((key) => !knownKeys.has(key));
  return { action: hasNew ? "merge" : "skip", missing, all };
}
