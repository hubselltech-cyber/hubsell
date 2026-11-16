// ============================================================
// NHẬT KÝ của màn quay — anh Trung 16/11/2026: "giữ lại cả nhật ký nữa nhé. Khá cần".
//
// Ghi bằng tiếng Việt cho người đóng hàng đọc: giờ · việc (bật camera, đọc được tem, mở / cắt / lưu clip,
// tải lên xong, tem đã quay rồi, mất camera, camera có lại, lỗi + lý do).
// Giữ nhật ký của HÔM NAY trong localStorage để tải lại trang không mất dấu vết — bài học 16/11: lỗi mở
// camera xảy ra, anh tải lại trang là mất hết, phải tái hiện lại mới tìm được gốc.
// Sống ở cấp module (không theo màn hình) nên rời màn quay rồi quay lại nhật ký vẫn còn.
// ============================================================

import type { LogLevel } from "./types";

export interface JournalEntry {
  id: number;
  /** Mili giây (Date.now()). */
  at: number;
  level: LogLevel;
  text: string;
}

const MAX_ENTRIES = 500;
const KEY_PREFIX = "hubsell.packVideo.journal.";

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

let entries: JournalEntry[] = [];
let loadedDay: string | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function storageKey(day: string): string {
  return KEY_PREFIX + day;
}

/** Nạp nhật ký hôm nay từ localStorage (một lần mỗi ngày) và dọn nhật ký các ngày cũ. */
function ensureLoaded(): void {
  if (typeof window === "undefined") return;
  const today = dayKey(new Date());
  if (loadedDay === today) return;
  loadedDay = today;
  entries = [];
  try {
    const raw = window.localStorage.getItem(storageKey(today));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      entries = parsed
        .filter(
          (e): e is JournalEntry =>
            !!e && typeof e.at === "number" && typeof e.text === "string" && typeof e.level === "string"
        )
        .slice(-MAX_ENTRIES)
        .map((e, i) => ({ ...e, id: i + 1 }));
    }
    seq = entries.length;
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(KEY_PREFIX) && key !== storageKey(today)) window.localStorage.removeItem(key);
    }
  } catch {
    // trình duyệt chặn localStorage → nhật ký chỉ sống trong phiên này
  }
}

function persist(): void {
  if (typeof window === "undefined" || !loadedDay) return;
  try {
    window.localStorage.setItem(storageKey(loadedDay), JSON.stringify(entries));
  } catch {
    // đầy bộ nhớ / bị chặn → bỏ qua, nhật ký trên màn hình vẫn còn
  }
}

export function addJournal(level: LogLevel, text: string): void {
  ensureLoaded();
  entries = [...entries, { id: ++seq, at: Date.now(), level, text }].slice(-MAX_ENTRIES);
  persist();
  for (const fn of listeners) fn();
}

export function clearJournal(): void {
  ensureLoaded();
  entries = [];
  persist();
  for (const fn of listeners) fn();
}

/** Ảnh chụp bất biến (mảng mới mỗi lần đổi) — dùng được với useSyncExternalStore. */
export function getJournal(): JournalEntry[] {
  ensureLoaded();
  return entries;
}

const EMPTY: JournalEntry[] = [];
export function getServerJournal(): JournalEntry[] {
  return EMPTY;
}

export function subscribeJournal(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function formatJournalTime(at: number): string {
  const d = new Date(at);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Cả nhật ký thành văn bản để chép gửi đi (dòng cũ trước, dòng mới sau). */
export function journalAsText(list: JournalEntry[]): string {
  const mark: Record<LogLevel, string> = { info: " ", warn: "!", error: "X" };
  return list.map((e) => `${formatJournalTime(e.at)} ${mark[e.level] ?? " "} ${e.text}`).join("\n");
}
