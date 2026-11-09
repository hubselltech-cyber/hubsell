/**
 * LUẬT + BẢN NHÁP của trang Kiểm kê (`/products/stocktake`) — phần không dính giao diện.
 * Chi tiết thiết kế: docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 9.
 */
import type { StocktakeRow } from "@/lib/api";

/** Số đang gõ ở từng ô đếm, theo productId. Chuỗi để giữ đúng thứ khách gõ (kể cả ô đang sai). */
export type StocktakeCounts = Record<string, string>;

/**
 * Mã vạch bán lẻ ngắn nhất là EAN-8 (8 chữ số); mã vạch quản lý của Hubsell 13 số.
 * Một mã kho không thể tồn ≥ 10 triệu cái, nên dãy ≥ 8 chữ số ở ô đếm = mã quét nhầm chỗ.
 */
export const SCAN_CODE_RE = /^\d{8,}$/;

/** Trần số đếm — PHẢI khớp `STOCKTAKE_COUNT_MAX` ở backend/src/routes/inventory.ts. */
const COUNT_MAX = 9_999_999;

/** Số mã tối đa mỗi lần gọi Chốt — PHẢI khớp `STOCKTAKE_MAX` ở backend/src/routes/inventory.ts. */
export const STOCKTAKE_SUBMIT_CHUNK = 500;

// 20 / 50 / 100 dòng/trang — chuẩn bảng số liệu của app; nhớ lựa chọn theo trình duyệt.
// Mặc định 50 (tự chọn): kiểm kê đọc liền một mạch theo kệ, 20 dòng thì lật trang quá dày.
export const STOCKTAKE_PAGE_SIZES = [20, 50, 100];
export const STOCKTAKE_PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_KEY = "hubsell_stocktake_page_size";

/** Số đếm hợp lệ (nguyên, 0 … trần) hoặc null khi ô trống / sai. */
export function validCount(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= COUNT_MAX ? n : null;
}

/** Ô đã có số đếm (đúng hay sai) — khác ô còn trống. */
export function isCounted(counts: StocktakeCounts, productId: string): boolean {
  return counts[productId] !== undefined && counts[productId] !== "";
}

// ---------- Bản nháp trong trình duyệt, theo vị trí ("all" = shop không dùng vị trí) ----------

function draftKey(locationId: string) {
  return `hubsell_stocktake_draft_${locationId || "all"}`;
}
/** Dòng THÊM BẰNG QUÉT (mã ngoài phiếu) — lưu riêng để tải lại trang không mất. */
function extraKey(locationId: string) {
  return `hubsell_stocktake_extra_${locationId || "all"}`;
}

/** Khóa định danh bản nháp của một vị trí — trang dùng để biết nháp nào đã nạp xong. */
export function stocktakeDraftId(locationId: string): string {
  return draftKey(locationId);
}

export function readStocktakeDraft(locationId: string): { counts: StocktakeCounts; extraRows: StocktakeRow[] } {
  let counts: StocktakeCounts = {};
  let extraRows: StocktakeRow[] = [];
  try {
    const c: unknown = JSON.parse(localStorage.getItem(draftKey(locationId)) ?? "{}");
    if (c && typeof c === "object" && !Array.isArray(c)) counts = c as StocktakeCounts;
    const raw: unknown = JSON.parse(localStorage.getItem(extraKey(locationId)) ?? "[]");
    if (Array.isArray(raw)) {
      extraRows = raw
        .filter(
          (x): x is StocktakeRow =>
            !!x && typeof x.productId === "string" && typeof x.skuCode === "string" && typeof x.productName === "string"
        )
        .map((x) => ({
          productId: x.productId,
          skuCode: x.skuCode,
          barcode: typeof x.barcode === "string" ? x.barcode : null,
          productName: x.productName,
          isActive: x.isActive !== false,
          book: Number.isInteger(x.book) ? x.book : 0,
        }));
    }
  } catch {
    // dữ liệu hỏng / bị chặn — coi như chưa có nháp
  }
  return { counts, extraRows };
}

/** Ghi nháp. `extraRows` rỗng thì xóa hẳn khóa dòng thêm. Trình duyệt chặn lưu thì bỏ qua. */
export function writeStocktakeDraft(locationId: string, counts: StocktakeCounts, extraRows: StocktakeRow[]): void {
  try {
    localStorage.setItem(draftKey(locationId), JSON.stringify(counts));
    if (extraRows.length) localStorage.setItem(extraKey(locationId), JSON.stringify(extraRows));
    else localStorage.removeItem(extraKey(locationId));
  } catch {
    // bị chặn — bỏ qua
  }
}

export function clearStocktakeDraft(locationId: string): void {
  try {
    localStorage.removeItem(draftKey(locationId));
    localStorage.removeItem(extraKey(locationId));
  } catch {
    // bị chặn — bỏ qua
  }
}

export function readStocktakePageSize(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return STOCKTAKE_PAGE_SIZES.includes(n) ? n : STOCKTAKE_PAGE_SIZE_DEFAULT;
  } catch {
    return STOCKTAKE_PAGE_SIZE_DEFAULT;
  }
}

export function writeStocktakePageSize(n: number): void {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(n));
  } catch {
    // bị chặn — bỏ qua
  }
}
