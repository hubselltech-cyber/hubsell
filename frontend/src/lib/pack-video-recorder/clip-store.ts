// ============================================================
// KHO CLIP CHỜ GỬI — phần lõi không phụ thuộc trình duyệt (rủi ro N1 + N5, mục 18.4 / 18.10 / 21).
//
// ĐÂY KHÔNG PHẢI "LƯU LOCAL" (anh Trung chốt 18/11/2026: "bắt buộc phải lưu trên hệ thống hết"): không có nút
// xem / giữ / tải video từ máy. Tệp trên ổ chỉ là HÀNG ĐANG CHỜ GỬI, lên kho xong là xóa.
//
// Cách ghi: bộ ghép MP4 đưa từng khúc ≈ 1 MiB; MỖI khúc thành một tệp mảnh riêng, ghi xong là đóng ngay.
//   · Vì sao không ghi một tệp dài: trình duyệt chỉ "chốt" tệp khi đóng luồng ghi — tab sập giữa chừng là mất
//     sạch phần đã ghi, và MỘT lần ghi hỏng (ổ đầy) làm hỏng cả luồng (đã tra 18/11, mục 18.10).
//   · Mảnh ghi hỏng (ổ đầy thật) → mảnh đó và các mảnh sau nằm trong bộ nhớ: clip đang quay vẫn quay nốt
//     (cảnh báo, không khóa), chỉ báo lên để màn quay ngừng MỞ clip mới.
// Lúc gửi: tệp hoàn chỉnh = các mảnh chồng theo thứ tự ghi (byte-overlay.ts) — nối bằng Blob, không chép vào RAM.
// ============================================================

import { planOverlay } from "./byte-overlay";
import type { ClipFile, ClipKind, ClipPiece } from "./types";

/** Một dòng của SỔ HÀNG CHỜ (IndexedDB): đủ thông tin để gửi lại clip sau khi tải lại trang / mở lại máy. */
export interface StoredClipMeta {
  localId: string;
  /** Khóa chống gửi lặp phía máy chủ — giữ nguyên qua mọi lần thử, mọi lần mở lại trang. */
  clientId: string;
  /** Tài khoản đã quay clip. Clip chỉ được gửi khi ĐÚNG tài khoản này đang đăng nhập (không gửi nhầm sang shop khác). */
  ownerKey: string;
  code: string;
  manual: boolean;
  kind: ClipKind;
  startedAtIso: string;
  durationSec: number;
  width: number;
  height: number;
  deviceName: string | null;
  queuedAtMs: number;
  file: ClipFile;
}

/** Nơi ghi các mảnh xuống ổ. Bản trình duyệt: clip-store-opfs.ts. */
export interface PieceBackend {
  /** Ghi trọn một mảnh; ném lỗi nếu không ghi được (ổ đầy, trình duyệt chặn…). */
  writePiece(fileKey: string, name: string, data: Uint8Array): Promise<void>;
  readPiece(fileKey: string, name: string): Promise<Blob>;
  /** Xóa mọi mảnh của một clip. Không ném lỗi khi clip không còn. */
  removeClip(fileKey: string): Promise<void>;
  /** Clip đã có dòng sổ (hoặc đã bị bỏ) → nhả khóa "đang ghi" để tab khác biết đây không phải rác. */
  settle?(fileKey: string): void;
}

/** Nơi giữ sổ hàng chờ. Bản trình duyệt: IndexedDB. */
export interface MetaBackend {
  put(meta: StoredClipMeta): Promise<void>;
  delete(localId: string): Promise<void>;
  has(localId: string): Promise<boolean>;
  list(): Promise<StoredClipMeta[]>;
}

/** Khúc dữ liệu bộ ghép MP4 đưa ra (cùng hình với StreamTargetChunk của mediabunny). */
export interface SinkChunk {
  type: "write";
  data: Uint8Array;
  position: number;
}

const pieceName = (n: number) => String(n).padStart(6, "0");

/** Chỗ nhận dữ liệu của MỘT clip đang quay. */
export class PieceSink {
  private readonly pieces: ClipPiece[] = [];
  private spilled = false;
  private closed = false;

  constructor(
    readonly fileKey: string,
    private readonly disk: PieceBackend | null,
    private readonly ram: Map<string, Uint8Array>,
    private readonly onSpill: (err: unknown) => void
  ) {}

  /** true = đã có mảnh không ghi được xuống ổ; phần còn lại của clip nằm trong bộ nhớ. */
  get hasSpilled(): boolean {
    return this.spilled;
  }

  /** Ghi một khúc. KHÔNG bao giờ ném lỗi vì ổ đĩa — hỏng thì giữ trong bộ nhớ để clip quay nốt được. */
  async write(chunk: SinkChunk): Promise<void> {
    if (this.closed) throw new Error("Tệp clip đã đóng");
    const name = pieceName(this.pieces.length + 1);
    const { data, position } = chunk;
    if (this.disk && !this.spilled) {
      try {
        await this.disk.writePiece(this.fileKey, name, data);
        this.pieces.push({ position, length: data.byteLength, where: "disk", name });
        return;
      } catch (err) {
        this.spilled = true;
        this.onSpill(err);
      }
    }
    // Chép ra: bộ ghép có thể dùng lại vùng nhớ của khúc sau khi hàm này trả về.
    this.ram.set(`${this.fileKey}/${name}`, data.slice());
    this.pieces.push({ position, length: data.byteLength, where: "ram", name });
  }

  /** Clip quay xong: trả mô tả tệp. `durable` = mọi mảnh đều nằm trên ổ. */
  finish(): ClipFile {
    this.closed = true;
    const plan = planOverlay(this.pieces);
    return {
      fileKey: this.fileKey,
      sizeBytes: plan.totalBytes,
      pieces: this.pieces.slice(),
      durable: !!this.disk && this.pieces.every((p) => p.where === "disk"),
    };
  }

  /** Luồng ghi cho bộ ghép MP4. */
  stream(): WritableStream<SinkChunk> {
    return new WritableStream<SinkChunk>({ write: (chunk) => this.write(chunk) });
  }
}

export class ClipStore {
  /** Mảnh nằm trong bộ nhớ (trình duyệt không cho dùng ổ, hoặc ổ đầy giữa chừng). Khóa: "fileKey/tên mảnh". */
  private readonly ram = new Map<string, Uint8Array>();

  constructor(
    private readonly disk: PieceBackend | null,
    private readonly metaDb: MetaBackend | null,
    private readonly hooks: { onSpill(err: unknown): void; newKey(): string }
  ) {}

  /** true = clip chờ gửi được giữ trên ổ, sống qua tải lại trang. */
  get durable(): boolean {
    return !!this.disk && !!this.metaDb;
  }

  openSink(): PieceSink {
    return new PieceSink(this.hooks.newKey(), this.disk, this.ram, this.hooks.onSpill);
  }

  /** Tệp MP4 hoàn chỉnh của một clip, nối từ các mảnh (mảnh trên ổ không bị chép vào bộ nhớ). */
  async blobOf(file: ClipFile): Promise<Blob> {
    const plan = planOverlay(file.pieces);
    if (plan.gaps.length || plan.totalBytes !== file.sizeBytes) {
      throw new ClipFileBroken("Tệp chờ gửi thiếu dữ liệu");
    }
    const cache = new Map<number, Blob>();
    const parts: Blob[] = [];
    for (const seg of plan.segments) {
      let whole = cache.get(seg.piece);
      if (!whole) {
        whole = await this.readPiece(file.fileKey, file.pieces[seg.piece]);
        cache.set(seg.piece, whole);
      }
      parts.push(seg.offset === 0 && seg.length === whole.size ? whole : whole.slice(seg.offset, seg.offset + seg.length));
    }
    return new Blob(parts, { type: "video/mp4" });
  }

  private async readPiece(fileKey: string, piece: ClipPiece): Promise<Blob> {
    if (piece.where === "ram") {
      const data = this.ram.get(`${fileKey}/${piece.name}`);
      if (!data) throw new ClipFileBroken("Phần video giữ trong bộ nhớ đã mất (trang đã tải lại)");
      return new Blob([data as Uint8Array<ArrayBuffer>]);
    }
    if (!this.disk) throw new ClipFileBroken("Không đọc được ổ đĩa của trình duyệt");
    let blob: Blob;
    try {
      blob = await this.disk.readPiece(fileKey, piece.name);
    } catch {
      throw new ClipFileBroken("Tệp chờ gửi không còn trên ổ đĩa (dữ liệu trình duyệt đã bị xóa)");
    }
    if (blob.size !== piece.length) throw new ClipFileBroken("Tệp chờ gửi trên ổ đĩa bị cụt");
    return blob;
  }

  /** Bỏ tệp của một clip (đã lên kho, hoặc clip hỏng). */
  async remove(file: Pick<ClipFile, "fileKey">): Promise<void> {
    const prefix = `${file.fileKey}/`;
    for (const key of [...this.ram.keys()]) if (key.startsWith(prefix)) this.ram.delete(key);
    await this.disk?.removeClip(file.fileKey).catch(() => {});
    this.disk?.settle?.(file.fileKey);
  }

  /** Ghi dòng sổ cho clip đã quay xong. Trả false nếu clip không bền (nằm trong bộ nhớ) hoặc sổ không ghi được. */
  async saveMeta(meta: StoredClipMeta): Promise<boolean> {
    if (!this.metaDb || !meta.file.durable) return false;
    try {
      await this.metaDb.put(meta);
    } catch {
      return false;
    }
    this.disk?.settle?.(meta.file.fileKey);
    return true;
  }

  async deleteMeta(localId: string): Promise<void> {
    await this.metaDb?.delete(localId).catch(() => {});
  }

  /** Dòng sổ còn không — tab khác có thể đã gửi xong clip này rồi. Không đọc được sổ thì coi như còn. */
  async hasMeta(localId: string): Promise<boolean> {
    if (!this.metaDb) return false;
    return this.metaDb.has(localId).catch(() => true);
  }

  /** Thư mục clip nào đang có dòng sổ (của mọi tài khoản) — để dọn rác không đụng vào. */
  async knownFileKeys(): Promise<Set<string>> {
    if (!this.metaDb) return new Set();
    return new Set((await this.metaDb.list()).map((m) => m.file.fileKey));
  }

  /** Các clip chờ gửi của MỘT tài khoản, cũ trước. */
  async listMeta(ownerKey: string): Promise<{ mine: StoredClipMeta[]; othersCount: number }> {
    if (!this.metaDb) return { mine: [], othersCount: 0 };
    const all = await this.metaDb.list().catch(() => [] as StoredClipMeta[]);
    const mine = all.filter((m) => m.ownerKey === ownerKey).sort((a, b) => a.queuedAtMs - b.queuedAtMs);
    return { mine, othersCount: all.length - mine.length };
  }
}

/** Tệp chờ gửi không còn nguyên vẹn — thử lại cũng vô ích. */
export class ClipFileBroken extends Error {}
