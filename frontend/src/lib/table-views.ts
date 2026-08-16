/**
 * LƯU "CHẾ ĐỘ XEM" CỦA BẢNG DỮ LIỆU (Tầng 2 kế hoạch UI).
 *
 * Hai lớp lưu, cùng khóa theo `tableId`:
 * 1. AUTO-STATE — cột đang ẩn/ghim hiện tại, tự lưu mỗi lần đổi: người dùng
 *    chỉnh cột một lần là mọi phiên sau giữ nguyên, không cần bấm lưu.
 * 2. SAVED VIEWS — ảnh chụp ĐẶT TÊN gồm cột + bộ lọc riêng của trang
 *    (`extras` do trang tự đóng gói/áp lại), kiểu "chế độ xem" của ERP.
 *
 * Lưu localStorage (theo máy/trình duyệt) — đủ tốt khi chưa thương mại hóa;
 * sau này muốn theo tài khoản thì thay hai hàm load/save bằng API, giao diện
 * không phải đổi.
 */

export interface TableColumnState {
  /** map columnId -> false là ẩn (thiếu = hiện, khớp VisibilityState tanstack) */
  columnVisibility: Record<string, boolean>;
  columnPinning: { left?: string[]; right?: string[] };
}

export interface SavedTableView {
  name: string;
  columns: TableColumnState;
  /** Bộ lọc riêng của trang (tab, kênh, từ khóa…) — trang tự hiểu nội dung. */
  extras?: Record<string, unknown>;
}

const AUTO_KEY = (tableId: string) => `hubsell-table-state:${tableId}`;
const VIEWS_KEY = (tableId: string) => `hubsell-table-views:${tableId}`;

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // dữ liệu rác thì coi như chưa lưu, không làm vỡ bảng
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage đầy/bị chặn — mất tính năng nhớ cột, bảng vẫn chạy
  }
}

export function loadAutoState(tableId: string): TableColumnState | null {
  return read<TableColumnState>(AUTO_KEY(tableId));
}

export function saveAutoState(tableId: string, state: TableColumnState) {
  write(AUTO_KEY(tableId), state);
}

export function loadViews(tableId: string): SavedTableView[] {
  return read<SavedTableView[]>(VIEWS_KEY(tableId)) ?? [];
}

/** Lưu/đè một view theo tên (tên trùng = cập nhật). Trả về danh sách mới. */
export function upsertView(
  tableId: string,
  view: SavedTableView
): SavedTableView[] {
  const views = loadViews(tableId).filter((v) => v.name !== view.name);
  views.push(view);
  write(VIEWS_KEY(tableId), views);
  return views;
}

export function deleteView(tableId: string, name: string): SavedTableView[] {
  const views = loadViews(tableId).filter((v) => v.name !== name);
  write(VIEWS_KEY(tableId), views);
  return views;
}
