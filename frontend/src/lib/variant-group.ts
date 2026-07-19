import { normalizeText } from "./text";

/**
 * NHÓM CÁC PHÂN LOẠI CỦA CÙNG MỘT MẪU HÀNG
 *
 * Trong Hubsell, giá vốn được lưu trên SẢN PHẨM GỐC (Product.costPrice), còn
 * "size M / size L / size XL" của cùng một mẫu áo lại là những sản phẩm riêng
 * biệt, mỗi cái một dòng giá vốn. Chủ shop phải gõ đi gõ lại cùng một số.
 *
 * Không có trường "mẫu gốc" trong CSDL, nên ta suy ra bằng TÊN: cắt bỏ phần
 * đuôi chỉ phân loại để lấy tên mẫu, rồi gom các dòng cùng tên mẫu lại.
 *
 * Đây là suy đoán chứ không phải sự thật tuyệt đối, nên nó chỉ được dùng để
 * GỢI Ý — người dùng luôn thấy danh sách SKU sắp bị đổi và phải bấm xác nhận
 * trước khi ghi. Đoán sai thì cùng lắm là nút không hiện, không bao giờ âm
 * thầm sửa nhầm dữ liệu.
 */

// Đuôi có từ khoá phân loại rõ ràng: "… size M", "… - Màu đỏ", "… (cỡ 40)"
const LABELLED_SUFFIX =
  /[\s\-–—|,([]+(size|sz|cỡ|co|số|so|màu|mau|color|phân loại|phan loai)\s*[:\-]?\s*[\p{L}\p{N}.]+\s*[)\]]?$/iu;

// Đuôi là mã cỡ trần sau dấu ngăn cách: "… - XL", "… (M)", "… | 42"
const BARE_SIZE_SUFFIX = /[\s\-–—|,([]+(xxxl|xxl|xl|[smlx]|\d{1,3})\s*[)\]]?$/iu;

/** Tên mẫu gốc sau khi cắt đuôi phân loại. Không nhận ra thì trả lại nguyên tên. */
export function baseProductName(name: string): string {
  let base = name.trim();
  for (const pattern of [LABELLED_SUFFIX, BARE_SIZE_SUFFIX]) {
    const stripped = base.replace(pattern, "").trim();
    // Cắt xong mà còn quá ngắn thì coi như cắt nhầm, giữ nguyên tên cũ
    if (stripped.length >= 6 && stripped !== base) {
      base = stripped;
      break;
    }
  }
  return base;
}

/**
 * Phần đuôi phân biệt biến thể, lấy được bằng cách trừ tên mẫu khỏi tên đầy đủ.
 * "Áo thun cotton premium size M" → "size M".
 * Không tách được (tên trùng khít tên mẫu) thì trả về null để nơi gọi tự chọn
 * cách hiển thị khác, ví dụ dùng mã SKU.
 */
export function variantLabel(fullName: string): string | null {
  const base = baseProductName(fullName);
  if (base === fullName.trim()) return null;
  const rest = fullName.trim().slice(base.length).trim();
  // Bỏ các ký tự ngăn cách còn sót ở đầu: "- size M" → "size M"
  const cleaned = rest.replace(/^[\s\-–—|,([]+/, "").replace(/[)\]]+$/, "").trim();
  return cleaned || null;
}

/** Khoá gom nhóm — bỏ dấu, thường hoá để "Áo Thun" và "ao thun" về chung một mẫu. */
export function variantGroupKey(name: string): string {
  return normalizeText(baseProductName(name));
}

/**
 * Gom danh sách theo mẫu gốc.
 * Chỉ trả về những nhóm có từ 2 dòng trở lên — nhóm một mình thì không có gì
 * để "áp dụng hàng loạt" cả.
 */
export function groupVariants<T>(
  items: T[],
  getName: (item: T) => string
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = variantGroupKey(getName(item));
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  for (const [key, list] of groups) {
    if (list.length < 2) groups.delete(key);
  }
  return groups;
}
