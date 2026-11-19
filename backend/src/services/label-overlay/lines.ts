// Kiểu + gom dòng chữ của lớp chèn — tách riêng để luồng phụ đọc PDF (read-page.ts) và
// luồng chính (locate.ts) cùng dùng mà không nạp chéo nhau.

export interface PageShape {
  width: number;
  height: number;
  pageCount: number;
  /** Số mẩu chữ đọc được ở trang đầu — 0 nghĩa là tệp không có lớp chữ. */
  textItems: number;
}

export interface TextLine {
  text: string;
  /** Đường gốc của dòng (pt từ đáy). */
  y: number;
  /** Chiều cao chữ lớn nhất trong dòng. */
  height: number;
}

/** Gom các mẩu chữ cùng dòng (lệch đường gốc ≤ 2 pt), nối theo chiều ngang. */
export function groupLines(items: { str: string; x: number; y: number; height: number }[]): TextLine[] {
  const sorted = [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: (TextLine & { parts: { x: number; str: string }[] })[] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 2);
    if (line) {
      line.parts.push({ x: it.x, str: it.str });
      line.height = Math.max(line.height, it.height);
    } else {
      lines.push({ text: "", y: it.y, height: it.height, parts: [{ x: it.x, str: it.str }] });
    }
  }
  return lines.map((l) => ({
    y: l.y,
    height: l.height,
    text: l.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  }));
}
