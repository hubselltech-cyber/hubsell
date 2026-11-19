// ============================================================
// GHÉP TỆP TỪ CÁC LẦN GHI — hàm thuần.
//
// Bộ ghép MP4 (mediabunny) ghi tệp bằng các lệnh "ghi N byte tại vị trí P". Phần lớn nối đuôi nhau, nhưng lúc
// kết thúc nó quay lại sửa vài byte ở đầu tệp (cỡ khối mdat) rồi viết `moov` ở CUỐI. Hàng chờ bền lưu MỖI lần
// ghi thành một mảnh riêng trên ổ (mảnh nào ghi xong là nằm chắc trên ổ ngay, một mảnh ghi hỏng không kéo hỏng
// các mảnh trước). Lúc gửi, tệp hoàn chỉnh = các mảnh chồng lên nhau theo thứ tự ghi: mảnh ghi SAU đè mảnh
// ghi trước ở vùng trùng.
//
// Hàm dưới đổi danh sách mảnh (theo thứ tự ghi) thành danh sách ĐOẠN liền nhau phủ kín [0, tổng cỡ) — mỗi đoạn
// lấy từ đúng một mảnh. Người gọi chỉ việc cắt từng đoạn rồi nối lại.
// ============================================================

/** Một lần ghi: `length` byte tại vị trí `position` của tệp. Thứ tự trong mảng = thứ tự ghi. */
export interface OverlayPiece {
  position: number;
  length: number;
}

/** Một đoạn của tệp hoàn chỉnh: lấy `length` byte từ byte thứ `offset` của mảnh số `piece`. */
export interface OverlaySegment {
  piece: number;
  offset: number;
  length: number;
}

export interface OverlayPlan {
  totalBytes: number;
  segments: OverlaySegment[];
  /** Vùng [from, to) chưa từng được ghi — tệp hỏng nếu có. */
  gaps: { from: number; to: number }[];
}

/** Dựng kế hoạch ghép. Độ phức tạp O(n²) ở ca xấu nhất; thực tế mỗi clip vài chục tới vài trăm mảnh. */
export function planOverlay(pieces: readonly OverlayPiece[]): OverlayPlan {
  // Danh sách đoạn hiện có, luôn xếp theo vị trí trong tệp và không chồng nhau.
  let placed: { from: number; to: number; piece: number; offset: number }[] = [];
  pieces.forEach((p, index) => {
    if (!(p.length > 0) || !(p.position >= 0)) return;
    const from = p.position;
    const to = p.position + p.length;
    const next: typeof placed = [];
    for (const seg of placed) {
      if (seg.to <= from || seg.from >= to) {
        next.push(seg); // không đụng mảnh mới
        continue;
      }
      // Phần bên trái và bên phải của đoạn cũ còn lộ ra ngoài mảnh mới thì giữ lại.
      if (seg.from < from) next.push({ from: seg.from, to: from, piece: seg.piece, offset: seg.offset });
      if (seg.to > to) next.push({ from: to, to: seg.to, piece: seg.piece, offset: seg.offset + (to - seg.from) });
    }
    next.push({ from, to, piece: index, offset: 0 });
    next.sort((a, b) => a.from - b.from);
    placed = next;
  });

  const segments: OverlaySegment[] = [];
  const gaps: { from: number; to: number }[] = [];
  let cursor = 0;
  for (const seg of placed) {
    if (seg.from > cursor) gaps.push({ from: cursor, to: seg.from });
    const last = segments[segments.length - 1];
    // Hai đoạn liền nhau của cùng một mảnh thì gộp (xảy ra khi mảnh đè nằm gọn rồi lại bị đè tiếp).
    if (last && last.piece === seg.piece && last.offset + last.length === seg.offset && seg.from === cursor) {
      last.length += seg.to - seg.from;
    } else {
      segments.push({ piece: seg.piece, offset: seg.offset, length: seg.to - seg.from });
    }
    cursor = seg.to;
  }
  return { totalBytes: cursor, segments, gaps };
}
