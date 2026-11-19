// ============================================================
// KHO CLIP CHỜ GỬI — phần chạm trình duyệt: mảnh video trên OPFS (ổ riêng của trang), sổ ở IndexedDB,
// khóa giữa các tab bằng Web Locks. Lõi + lý do thiết kế: clip-store.ts.
//
// Bố cục trên ổ:  hubsell-pack-video-queue/<fileKey>/<000001…>   — mỗi clip một thư mục, mỗi lần ghi một tệp.
// Sổ:             IndexedDB "hubsell-pack-video" › "queue" (khóa localId).
//
// RÁC: thư mục clip không có dòng sổ = clip đang quay dở lúc trang bị đóng / máy sập. MP4 chưa có `moov` thì
// không phát được nên không cứu được ở lát này → dọn đi cho khỏi chiếm ổ. Tab ĐANG ghi clip giữ một khóa
// (Web Locks) trên thư mục đó, nên tab khác không dọn nhầm clip đang quay.
// ============================================================

import { ClipStore, type MetaBackend, type PieceBackend, type StoredClipMeta } from "./clip-store";

const ROOT_DIR = "hubsell-pack-video-queue";
const DB_NAME = "hubsell-pack-video";
const DB_STORE = "queue";
const LOCK_PREFIX = "hubsell-pv-";
/** Tệp ghi thử cũ hơn mức này coi là rác của một tab đã sập. Số tự chọn. */
const STALE_PROBE_MS = 10 * 60_000;

function newKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Giữ một khóa Web Locks tới khi gọi hàm trả về. Trình duyệt không có Web Locks → không khóa (một tab vẫn đúng). */
function holdLock(name: string): () => void {
  if (typeof navigator === "undefined" || !navigator.locks) return () => {};
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  void navigator.locks.request(name, () => held).catch(() => {});
  return release;
}

/** Chạy `fn` khi lấy được khóa — tab khác đang giữ thì CHỜ tới khi họ xong (dùng cho lượt gửi một clip). */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return fn();
  return navigator.locks.request(LOCK_PREFIX + name, fn);
}

/** Chạy `fn` nếu lấy được khóa NGAY; khóa đang bị giữ (tab khác đang làm) thì trả "busy". */
export async function tryWithLock<T>(name: string, fn: () => Promise<T>): Promise<T | "busy"> {
  if (typeof navigator === "undefined" || !navigator.locks) return fn();
  return navigator.locks.request(LOCK_PREFIX + name, { ifAvailable: true }, async (lock) => {
    if (!lock) return "busy" as const;
    return fn();
  });
}

class OpfsPieces implements PieceBackend {
  private readonly dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
  private readonly writing = new Map<string, () => void>();

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  private dir(fileKey: string): Promise<FileSystemDirectoryHandle> {
    let dir = this.dirs.get(fileKey);
    if (!dir) {
      // Khóa "đang ghi" TRƯỚC khi thư mục xuất hiện → tab khác không bao giờ thấy thư mục mà không thấy khóa.
      this.writing.set(fileKey, holdLock(LOCK_PREFIX + fileKey));
      dir = this.root.getDirectoryHandle(fileKey, { create: true });
      this.dirs.set(fileKey, dir);
    }
    return dir;
  }

  async writePiece(fileKey: string, name: string, data: Uint8Array): Promise<void> {
    const dir = await this.dir(fileKey);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(data as Uint8Array<ArrayBuffer>);
      await writable.close(); // chỉ khi đóng xong mảnh mới thật sự nằm trên ổ
    } catch (err) {
      await writable.abort().catch(() => {});
      await dir.removeEntry(name).catch(() => {});
      throw err;
    }
  }

  async readPiece(fileKey: string, name: string): Promise<Blob> {
    const dir = await this.root.getDirectoryHandle(fileKey);
    return (await dir.getFileHandle(name)).getFile();
  }

  async removeClip(fileKey: string): Promise<void> {
    this.dirs.delete(fileKey);
    try {
      await this.root.removeEntry(fileKey, { recursive: true });
    } catch (err) {
      if ((err as DOMException)?.name !== "NotFoundError") throw err;
    }
  }

  settle(fileKey: string): void {
    this.writing.get(fileKey)?.();
    this.writing.delete(fileKey);
  }

  /**
   * Dọn thư mục clip không có dòng sổ và không tab nào đang ghi. Trả số thư mục đã dọn.
   * `listKnown` được hỏi LẠI bên trong khóa: một tab khác có thể vừa ghi dòng sổ cho clip này xong rồi nhả khóa.
   */
  async sweepOrphans(listKnown: () => Promise<Set<string>>): Promise<number> {
    let swept = 0;
    const names: string[] = [];
    // TypeScript chưa khai `keys()` của thư mục OPFS ở mọi bản lib → ép kiểu hẹp.
    const iterable = this.root as unknown as { keys(): AsyncIterable<string> };
    for await (const name of iterable.keys()) names.push(name);
    for (const name of names) {
      if (this.writing.has(name)) continue;
      if (name.startsWith(".probe-")) {
        // Tệp ghi thử của một tab đã sập: chỉ dọn khi đã cũ (tab đang ghi thử thì để yên).
        const file = await this.root.getFileHandle(name).then((h) => h.getFile()).catch(() => null);
        if (file && Date.now() - file.lastModified > STALE_PROBE_MS) await this.root.removeEntry(name).catch(() => {});
        continue;
      }
      const result = await tryWithLock(name, async () => {
        if ((await listKnown()).has(name)) return false;
        await this.root.removeEntry(name, { recursive: true }).catch(() => {});
        return true;
      });
      if (result === true) swept++;
    }
    return swept;
  }

  /** Ghi thử `bytes` byte rồi xóa. false = ổ không còn nhận nổi chừng đó (đo bằng lần ghi THẬT, không tin số trình duyệt báo). */
  async probe(bytes: number): Promise<boolean> {
    const name = `.probe-${newKey()}`;
    const chunk = new Uint8Array(1024 * 1024);
    try {
      const handle = await this.root.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      try {
        for (let sent = 0; sent < bytes; sent += chunk.byteLength) await writable.write(chunk);
        await writable.close();
      } catch (err) {
        await writable.abort().catch(() => {});
        throw err;
      }
      return true;
    } catch {
      return false;
    } finally {
      await this.root.removeEntry(name).catch(() => {});
    }
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB lỗi"));
  });
}

class IdbMeta implements MetaBackend {
  constructor(private readonly db: IDBDatabase) {}

  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(DB_STORE, mode).objectStore(DB_STORE);
  }

  async put(meta: StoredClipMeta): Promise<void> {
    await request(this.store("readwrite").put(meta));
  }

  async delete(localId: string): Promise<void> {
    await request(this.store("readwrite").delete(localId));
  }

  async has(localId: string): Promise<boolean> {
    return (await request(this.store("readonly").count(localId))) > 0;
  }

  async list(): Promise<StoredClipMeta[]> {
    return (await request(this.store("readonly").getAll())) as StoredClipMeta[];
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE, { keyPath: "localId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Không mở được IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB đang bị tab khác giữ"));
  });
}

export interface BrowserClipStore {
  store: ClipStore;
  /** Lý do không dùng được ổ (→ clip chờ gửi nằm trong bộ nhớ); null = dùng ổ bình thường. */
  memoryReason: string | null;
  /** Trình duyệt có hứa giữ dữ liệu khi máy chật ổ không (navigator.storage.persist). null = không hỏi được. */
  persisted: boolean | null;
  sweepOrphans(listKnown: () => Promise<Set<string>>): Promise<number>;
  probe(bytes: number): Promise<boolean>;
  /** Chỗ trống theo con số trình duyệt báo — CHỈ để cảnh báo sớm, không dùng để chặn (Chrome báo dư, mục 18.9). */
  reportedFreeBytes(): Promise<number | null>;
}

/** Mở kho clip chờ gửi. Không dùng được ổ thì trả kho trong bộ nhớ kèm lý do — không ném lỗi. */
export async function openBrowserClipStore(onSpill: (err: unknown) => void): Promise<BrowserClipStore> {
  const memory = (reason: string): BrowserClipStore => ({
    store: new ClipStore(null, null, { onSpill, newKey }),
    memoryReason: reason,
    persisted: null,
    sweepOrphans: async () => 0,
    probe: async () => true,
    reportedFreeBytes: async () => null,
  });
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory || typeof indexedDB === "undefined") {
    return memory("trình duyệt không có ổ riêng cho trang");
  }
  try {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT_DIR, { create: true });
    const pieces = new OpfsPieces(root);
    const meta = new IdbMeta(await openDb());
    await meta.list(); // đọc thử: sổ hỏng thì lùi về bộ nhớ ngay từ đầu, không đợi tới lúc có clip
    let persisted: boolean | null = null;
    try {
      persisted = (await navigator.storage.persisted?.()) || (await navigator.storage.persist?.()) || false;
    } catch {
      persisted = null;
    }
    return {
      store: new ClipStore(pieces, meta, { onSpill, newKey }),
      memoryReason: null,
      persisted,
      sweepOrphans: (listKnown) => pieces.sweepOrphans(listKnown),
      probe: (bytes) => pieces.probe(bytes),
      reportedFreeBytes: async () => {
        try {
          const { quota, usage } = await navigator.storage.estimate();
          return typeof quota === "number" && typeof usage === "number" ? quota - usage : null;
        } catch {
          return null;
        }
      },
    };
  } catch (err) {
    return memory(err instanceof Error ? err.message : String(err));
  }
}
