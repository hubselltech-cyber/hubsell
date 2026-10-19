// ============================================================
// CỬA SỔ TỰ CO — phần THUẦN của máy đọc con trỏ (N3, docs CUNG-HOA-LOP-GOI-SAN)
//
// Một (gian, luồng) có con trỏ `cursorAt` = "đã đọc TRỌN mọi dòng có mốc thời
// gian < cursorAt" và độ dài cửa sổ đã học `windowMs`. Mỗi lần đọc chọn cửa sổ
// [cursorAt, cursorAt + windowMs) cắt ở `now − settle`; đọc trọn trong ≤ K trang
// thì tiến con trỏ, không thì CO cửa sổ và đọc lại (đọc trùng vô hại vì upsert).
// Đọc trọn cửa sổ thì thứ tự sàn trả bên trong không quan trọng → không phụ
// thuộc thứ tự (Shopee không cho chọn, TikTok mặc định create_time tăng — H1).
// ============================================================

export interface WindowConfig {
  pagesPerWindow: number;
  minWindowMs: number;
  maxWindowMs: number;
  growBelowRatio: number;
  shrinkTargetRatio: number;
}

export interface TimeWindow {
  from: number;
  to: number;
}

/** Cửa sổ kế tiếp; null = đã đuổi kịp (con trỏ ≥ mốc cuối được phép). */
export function planWindow(cursorAt: number, windowMs: number, endLimit: number, cfg: WindowConfig): TimeWindow | null {
  if (cursorAt >= endLimit) return null;
  const len = clampWindow(windowMs, cfg);
  return { from: cursorAt, to: Math.min(cursorAt + len, endLimit) };
}

export function clampWindow(ms: number, cfg: WindowConfig): number {
  if (!Number.isFinite(ms) || ms <= 0) return cfg.minWindowMs;
  return Math.max(cfg.minWindowMs, Math.min(cfg.maxWindowMs, Math.floor(ms)));
}

/** Cửa sổ còn co được không (đã ở đáy thì phải đọc tiếp quá K, không được cắt). */
export function canShrink(win: TimeWindow, cfg: WindowConfig): boolean {
  return win.to - win.from > cfg.minWindowMs;
}

/**
 * Độ dài mới khi cửa sổ tràn K trang. Có tổng sàn báo (TikTok total_count,
 * Lazada countTotal) → co theo tỷ lệ cho vừa `shrinkTargetRatio` × K trang;
 * không có (Shopee chỉ có `more`) → chia đôi. Luôn nhỏ hơn cửa sổ cũ.
 */
export function shrinkWindow(
  win: TimeWindow,
  cfg: WindowConfig,
  hint?: { total: number; pageSize: number }
): number {
  const len = win.to - win.from;
  let next = Math.floor(len / 2);
  if (hint && hint.total > 0 && hint.pageSize > 0) {
    const fitRows = cfg.pagesPerWindow * hint.pageSize * cfg.shrinkTargetRatio;
    next = Math.min(next, Math.floor((len * fitRows) / hint.total));
  }
  return clampWindow(Math.min(next, len - 1), cfg);
}

/**
 * Độ dài sau khi đọc trọn cửa sổ bằng `pagesUsed` trang. Chỉ nới khi cửa sổ
 * đọc đủ độ dài đã học (không bị cắt ở mốc hiện tại) và dùng ít trang.
 */
export function growWindow(learnedMs: number, win: TimeWindow, pagesUsed: number, cfg: WindowConfig): number {
  const fullLength = win.to - win.from >= clampWindow(learnedMs, cfg);
  if (fullLength && pagesUsed <= Math.max(1, Math.floor(cfg.pagesPerWindow * cfg.growBelowRatio))) {
    return clampWindow(learnedMs * 2, cfg);
  }
  return clampWindow(learnedMs, cfg);
}

/** Tổng sàn báo đủ để biết trước cửa sổ sẽ tràn K trang (khỏi đọc phí K trang mới co). */
export function totalOverflows(total: number | undefined, pageSize: number, cfg: WindowConfig): boolean {
  return total != null && pageSize > 0 && Math.ceil(total / pageSize) > cfg.pagesPerWindow;
}
