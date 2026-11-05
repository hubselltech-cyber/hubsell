/**
 * IN TEM MÃ VẠCH sản phẩm kho (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 6.4) — phần dùng
 * chung giữa hộp chọn tem (Tổng kho) và trang in (/print/product-labels).
 *
 * In bằng TRÌNH DUYỆT (cùng cách phiếu kho): hộp chọn ghi "lệnh in" vào localStorage rồi mở trang
 * in ở tab mới; trang in đọc lệnh, dựng tem đúng kích thước mm và gọi hộp in. Dữ liệu tem đi kèm
 * lệnh nên trang in không gọi thêm máy chủ.
 */

export interface LabelSize {
  key: string;
  label: string;
  hint: string;
  /** Khổ MỘT TRANG in (mm) — tem cuộn: mỗi hàng tem là một trang. */
  pageW: number;
  pageH: number;
  /** Kích thước một tem (mm). */
  labelW: number;
  labelH: number;
  cols: number;
  rows: number;
  /** Khe giữa hai tem cùng hàng và lề trang (mm). */
  gapX: number;
  marginX: number;
  marginY: number;
}

/**
 * Ba khổ có sẵn — do Hubsell TỰ CHỌN theo loại tem bán phổ biến, CHƯA in thử trên máy thật
 * (lệch lề thì chỉnh số ở đây):
 *   · 50 × 30: tem cuộn một tem mỗi hàng cho máy in nhiệt.
 *   · 35 × 22 ×3: tem cuộn ba tem mỗi hàng trên giấy 110 mm (2 khe 2 mm → 109 mm).
 *   · A4 65 tem: 5 cột × 13 hàng, tem 38,1 × 21,2 mm, lề trên 10,7 / lề bên 4,75 / khe ngang 2,5 mm
 *     (5×38,1 + 4×2,5 + 2×4,75 = 210; 13×21,2 + 2×10,7 = 297).
 */
export const LABEL_SIZES: LabelSize[] = [
  { key: "roll-50x30", label: "Tem cuộn 50 × 30 mm", hint: "1 tem mỗi hàng", pageW: 50, pageH: 30, labelW: 50, labelH: 30, cols: 1, rows: 1, gapX: 0, marginX: 0, marginY: 0 },
  { key: "roll-35x22x3", label: "Tem cuộn 35 × 22 mm", hint: "3 tem mỗi hàng, giấy 110 mm", pageW: 109, pageH: 22, labelW: 35, labelH: 22, cols: 3, rows: 1, gapX: 2, marginX: 0, marginY: 0 },
  { key: "a4-65", label: "Giấy A4, 65 tem", hint: "5 cột × 13 hàng, tem 38 × 21 mm", pageW: 210, pageH: 297, labelW: 38.1, labelH: 21.2, cols: 5, rows: 13, gapX: 2.5, marginX: 4.75, marginY: 10.7 },
];

export const DEFAULT_LABEL_SIZE = LABEL_SIZES[0].key;

/** Lề trong hai bên của một tem (mm) — trang in và phép tính bề rộng vạch dùng chung. */
export const LABEL_PADDING_X_MM = 1.5;

/**
 * Vạch mảnh nhất của mã vạch nên ≥ 0,25 mm: máy in tem nhiệt phổ biến là 203 dpi, một chấm in
 * 0,125 mm, vạch mảnh hơn 2 chấm thì in nhòe, máy quét khó đọc. Mã 13 số trên cả ba khổ có sẵn
 * đều đạt (0,28–0,42 mm); chỉ mã khách tự nhập quá dài mới chạm ngưỡng → hộp in CẢNH BÁO, không chặn.
 */
export const MIN_MODULE_MM = 0.25;

/** Bề rộng một mô-đun (mm) khi mã có `totalModules` mô-đun (gồm vùng trắng) in trên khổ tem đã chọn. */
export function barcodeModuleMm(totalModules: number, size: LabelSize): number {
  return (size.labelW - 2 * LABEL_PADDING_X_MM) / totalModules;
}

export function labelSizeOf(key: string | null | undefined): LabelSize {
  return LABEL_SIZES.find((s) => s.key === key) ?? LABEL_SIZES[0];
}

/** Trần số tem một lượt in — tự chọn: quá nhiều trang là trình duyệt dựng bản in rất chậm. */
export const MAX_LABELS_PER_JOB = 2000;

export interface LabelItem {
  skuCode: string;
  barcode: string;
  productName: string;
  variantName: string | null;
  /** Số tem in cho mã này. */
  quantity: number;
}

export interface LabelJob {
  sizeKey: string;
  items: LabelItem[];
  createdAt: number;
}

const JOB_KEY = "hubsell_label_job";
const SIZE_KEY = "hubsell_label_size";

export function saveLabelJob(job: LabelJob): boolean {
  try {
    localStorage.setItem(JOB_KEY, JSON.stringify(job));
    return true;
  } catch {
    return false;
  }
}

export function readLabelJob(): LabelJob | null {
  try {
    const raw = localStorage.getItem(JOB_KEY);
    if (!raw) return null;
    const job = JSON.parse(raw) as LabelJob;
    if (!job || !Array.isArray(job.items)) return null;
    return job;
  } catch {
    return null;
  }
}

/** Khổ tem khách chọn lần trước (nhớ theo trình duyệt). */
export function readSavedLabelSize(): string {
  try {
    return labelSizeOf(localStorage.getItem(SIZE_KEY)).key;
  } catch {
    return DEFAULT_LABEL_SIZE;
  }
}

export function saveLabelSize(key: string): void {
  try {
    localStorage.setItem(SIZE_KEY, key);
  } catch {
    /* trình duyệt chặn lưu — bỏ qua, chỉ mất phần "nhớ lần trước" */
  }
}

/** Trải danh sách mã thành từng tem theo số lượng. */
export function expandLabels(items: LabelItem[]): LabelItem[] {
  return items.flatMap((it) => Array.from({ length: Math.max(0, Math.floor(it.quantity)) }, () => it));
}

/** Chia tem thành từng trang in theo số tem mỗi trang của khổ đã chọn. */
export function paginateLabels<T>(labels: T[], size: LabelSize): T[][] {
  const perPage = size.cols * size.rows;
  const pages: T[][] = [];
  for (let i = 0; i < labels.length; i += perPage) pages.push(labels.slice(i, i + perPage));
  return pages;
}
