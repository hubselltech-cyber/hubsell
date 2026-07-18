/// Chuẩn hoá chuỗi để tìm kiếm: bỏ dấu tiếng Việt + đưa về chữ thường.
/// Nhờ vậy gõ "ao thun" vẫn tìm ra "Áo thun", gõ "mu luoi" ra "Mũ lưỡi".
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // bỏ dấu thanh (huyền, sắc, hỏi, ngã, nặng…)
    .replace(/đ/g, "d");
}

/// Kiểm tra từ khoá có khớp với một trong các trường dữ liệu không
/// (đã bỏ dấu, không phân biệt hoa/thường).
export function matchesKeyword(
  keyword: string,
  ...fields: (string | null | undefined)[]
): boolean {
  const kw = normalizeText(keyword.trim());
  if (!kw) return true;
  return fields.some((f) => f && normalizeText(f).includes(kw));
}
