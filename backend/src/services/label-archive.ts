// ============================================================
// LƯU VẬN ĐƠN ĐÃ IN 60 NGÀY (06/11/2026, anh Trung — docs/LUU-VAN-DON-DA-IN.md)
//
// Vì sao phải lưu: thăm dò prod 06/11 (scripts/label-delivered-probe.ts) cho thấy Shopee và
// TikTok KHÔNG trả vận đơn nữa ngay sau khi hãng vận chuyển lấy kiện ("the parcel has been
// shipped" / mã 21042102) — muốn in lại cho đơn Đang giao / Đã giao thì chỉ còn cách giữ bản
// khách đã in. Chép tệp ngay lúc khách in qua Hubsell (PDF vốn đã đi qua backend), KHÔNG gọi
// thêm sàn, KHÔNG ghi bảng nghiệp vụ nào.
//
// ĐƯỜNG DẪN (không cần bảng / cột riêng cho từng tệp):
//   {ngày in UTC}/{channelId}.{orderId}.pdf         — phiếu của MỘT đơn (TikTok, Lazada, Shopee in
//                                                     kèm phiếu nhặt, Shopee tải từng đơn)
//   {ngày}/{channelId}.lo-{khóa}.pdf                — NGUYÊN tệp gộp Shopee trả (≤ 50 đơn)
//   {ngày in UTC}/{channelId}.{orderId}.json        — tệp chỉ đường của đơn nằm trong tệp gộp
// "Ngày in" = ngày của Order.labelPrintedAt (mốc in LẦN ĐẦU); đơn chưa có mốc thì là hôm nay,
// vì frontend đánh dấu đã in vài giây SAU khi nhận tệp — lúc đọc lại thử ngày của mốc rồi ngày
// liền trước. Mỗi ngày MỘT thư mục phẳng: mỗi tệp là một dòng `storage.objects` trong chính
// Postgres đang hụt Disk IO, nên việc dọn chỉ liệt kê đúng thư mục của ngày hết hạn (1.000 tệp /
// lệnh) thay vì dò theo gian hay quét bảng Order.
//
// TỆP GỘP: lưu nguyên văn, KHÔNG tách lúc in (tốn CPU tiến trình web ở mọi lượt in, mà in lại
// thì hiếm). Lúc in lại mới tách đúng trang của đơn, và CHỈ KHI số trang = số đơn trong tệp gộp
// (mẫu đo thật 06/11: 2 đơn = 2 trang). Không khớp → trả cả tệp gộp kèm cờ `wholeBatch` để
// giao diện nói rõ, không đoán trang.
//
// Lượt in chỉ XẾP HÀNG (LabelArchiveSpool bên dưới) rồi trả về ngay; tải lên kho chạy nhỏ giọt ở nền.
// Mọi lỗi lưu chỉ ghi log `[label-archive]`, không bao giờ làm hỏng hay làm chậm lượt in.
// ============================================================

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { isStorageConfigured, orderLabels, type StorageListEntry } from "../lib/supabase-storage";

/** Giữ tệp ngần này ngày kể từ lúc in (anh Trung chốt 06/11: 60, trong khoảng 50–60 anh nêu). */
export const LABEL_ARCHIVE_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Mỗi lệnh liệt kê / xóa của việc dọn — trần của kho là 1.000 dòng / lệnh liệt kê. */
const PURGE_BATCH = 1000;
/** Trần số lô mỗi lượt dọn (500 × 1.000 = 500.000 tệp) — số tự chọn; còn dư thì lượt sau dọn tiếp. */
const PURGE_MAX_BATCHES = 500;
const PURGE_PAUSE_MS = 200;

// ---------- Kho tệp (Supabase thật / thư mục máy khi phát triển / giả lập trong test) ----------

export interface LabelStore {
  putIfAbsent(path: string, body: Buffer, contentType: string): Promise<"created" | "exists">;
  /** Không có tệp → null. */
  get(path: string): Promise<Buffer | null>;
  /** Một cấp dưới `prefix` ("" = gốc), tối đa `limit` dòng, luôn đọc từ đầu. */
  list(prefix: string, limit: number): Promise<StorageListEntry[]>;
  remove(paths: string[]): Promise<void>;
}

/** Thư mục máy thay kho khi phát triển (cùng chỗ với ảnh sản phẩm Tạo mới). KHÔNG BAO GIỜ ở production. */
export const LOCAL_LABEL_DIR = path.resolve(process.cwd(), ".local-uploads", "order-labels");

export function createLocalLabelStore(root: string): LabelStore {
  const full = (p: string) => path.join(root, ...p.split("/"));
  return {
    async putIfAbsent(p, body) {
      await fs.mkdir(path.dirname(full(p)), { recursive: true });
      try {
        await fs.writeFile(full(p), body, { flag: "wx" });
        return "created";
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") return "exists";
        throw err;
      }
    },
    async get(p) {
      try {
        return await fs.readFile(full(p));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async list(prefix, limit) {
      try {
        const rows = await fs.readdir(prefix ? full(prefix) : root, { withFileTypes: true });
        return rows
          .map((r) => ({ name: r.name, isFolder: r.isDirectory() }))
          .sort((a, b) => (a.name < b.name ? -1 : 1))
          .slice(0, limit);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
    },
    async remove(paths) {
      await Promise.all(paths.map((p) => fs.rm(full(p), { force: true })));
      // Thư mục ngày đã rỗng thì gỡ luôn (kho thật không có khái niệm thư mục rỗng).
      for (const dir of new Set(paths.map((p) => path.dirname(full(p))))) {
        await fs.rmdir(dir).catch(() => undefined);
      }
    },
  };
}

/**
 * Kho đang dùng: Supabase Storage khi đã cấu hình; chưa cấu hình mà KHÔNG phải production →
 * thư mục máy (để dựng và soi tính năng trên local); còn lại null = tính năng tự ẩn, không lỗi.
 */
export function getLabelStore(): LabelStore | null {
  if (isStorageConfigured()) return orderLabels;
  if (process.env.NODE_ENV !== "production") return createLocalLabelStore(LOCAL_LABEL_DIR);
  return null;
}

/**
 * Chủ shop này có được thấy / gạt công tắc Lưu vận đơn không. ĐÂY LÀ CHỖ GẮN THU PHÍ VỀ SAU
 * (anh Trung 06/11: "dùng chính công tắc gạt này để thu thêm phí") — đổi thân hàm thành kiểm
 * quyền lợi đã mua là xong, nơi gọi không đổi.
 * Hiện tại: env LABEL_ARCHIVE_OWNERS = "*" (mọi chủ shop) hoặc danh sách id chủ shop cách nhau
 * dấu phẩy. Trống: production = chưa ai thấy (mặc định TẮT khi lên prod), ngoài production = mở.
 */
export function labelArchiveAllowed(ownerId: string): boolean {
  if (!getLabelStore()) return false;
  const raw = (process.env.LABEL_ARCHIVE_OWNERS ?? "").trim();
  if (!raw) return process.env.NODE_ENV !== "production";
  if (raw === "*") return true;
  return raw.split(",").map((s) => s.trim()).includes(ownerId);
}

// ---------- Luật thuần ----------

/** Ngày UTC dạng YYYY-MM-DD — tên thư mục. So chuỗi được vì cùng độ dài, cùng thứ tự. */
export function archiveDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Quá 60 ngày kể từ mốc in → coi như đã xóa (tệp có thể còn nằm tới lượt dọn kế, không trả nữa). */
export function isLabelExpired(printedAt: Date, now: Date): boolean {
  return now.getTime() - printedAt.getTime() > LABEL_ARCHIVE_DAYS * DAY_MS;
}

/** Thư mục ngày nào cũ hơn chuỗi này là đã hết hạn TRỌN ngày (tệp in cuối ngày đó cũng đủ 60 ngày). */
export function purgeCutoffDay(now: Date): string {
  return archiveDay(new Date(now.getTime() - LABEL_ARCHIVE_DAYS * DAY_MS));
}

export const singleLabelPath = (day: string, channelId: string, orderId: string) => `${day}/${channelId}.${orderId}.pdf`;
export const pointerPath = (day: string, channelId: string, orderId: string) => `${day}/${channelId}.${orderId}.json`;

/** Khóa tệp gộp: băm danh sách đơn theo đúng thứ tự trang — cùng mẻ in lại ra cùng tên, không lưu trùng. */
export function batchKey(orderIds: string[]): string {
  return crypto.createHash("sha1").update(orderIds.join(",")).digest("hex").slice(0, 16);
}
export const batchLabelPath = (day: string, channelId: string, orderIds: string[]) =>
  `${day}/${channelId}.lo-${batchKey(orderIds)}.pdf`;

/** Ngày thư mục để LƯU: ngày của mốc in lần đầu nếu đã có, chưa có thì hôm nay. */
export function storageDayFor(labelPrintedAt: Date | null, now: Date): string {
  return archiveDay(labelPrintedAt ?? now);
}

/**
 * Các ngày thư mục để TÌM lại tệp của một đơn: ngày của mốc in, rồi ngày liền trước (tệp được
 * chép trước khi frontend đánh dấu đã in — in lúc 23:59:59, đánh dấu 00:00:02 là lệch một ngày).
 */
export function lookupDays(labelPrintedAt: Date): string[] {
  const day = archiveDay(labelPrintedAt);
  const prev = archiveDay(new Date(labelPrintedAt.getTime() - DAY_MS));
  return [day, prev];
}

/** Tệp chỉ đường của một đơn nằm trong tệp gộp. */
export interface LabelPointer {
  v: 1;
  /** Đường dẫn đầy đủ của tệp gộp trong kho. */
  batch: string;
  /** Vị trí của đơn trong tệp gộp (0 = đầu). */
  index: number;
  /** Số đơn của tệp gộp — chỉ tách trang khi số trang đúng bằng số này. */
  count: number;
}

export function parsePointer(raw: Buffer): LabelPointer | null {
  try {
    const o = JSON.parse(raw.toString("utf8")) as Partial<LabelPointer>;
    if (o.v !== 1 || typeof o.batch !== "string" || !o.batch) return null;
    if (!Number.isInteger(o.index) || !Number.isInteger(o.count)) return null;
    if (o.index! < 0 || o.count! < 1 || o.index! >= o.count!) return null;
    return { v: 1, batch: o.batch, index: o.index!, count: o.count! };
  } catch {
    return null;
  }
}

/**
 * Giao diện có nên vẽ nút "In lại phiếu" cho đơn này không — cùng luật ở backend (endpoint in lại
 * từ chối đúng các ca này) và frontend (lib/label-archive.ts). Không hỏi kho: đơn in SAU mốc bật
 * công tắc và chưa quá 60 ngày thì coi là có tệp; ca lệch (lúc lưu lỗi) endpoint báo rõ.
 */
export function mayHaveSavedLabel(
  o: { labelPrintedAt: Date | null },
  channel: { labelArchiveEnabledAt: Date | null },
  now: Date
): boolean {
  if (!channel.labelArchiveEnabledAt || !o.labelPrintedAt) return false;
  if (o.labelPrintedAt.getTime() < channel.labelArchiveEnabledAt.getTime()) return false;
  return !isLabelExpired(o.labelPrintedAt, now);
}

// ---------- Lưu lúc in: HÀNG CHỜ NHỎ GIỌT ----------
//
// Anh Trung 06/11: "thiết kế theo mô hình lớn… không cần phải lưu tức thì, cứ từ từ mà xếp hàng
// lưu lại, anh không muốn nó ảnh hưởng hệ thống". Vì vậy lượt in KHÔNG tự tải tệp lên kho: nó chỉ
// đặt việc vào một hàng chờ của tiến trình rồi trả về ngay. Hàng chờ:
//   · MỘT hàng cho cả tiến trình, số lệnh tải lên cùng lúc cố định (mặc định 2) + nghỉ giữa hai
//     lệnh — 1 lượt in 200 đơn hay 50 lượt in cùng lúc thì kho và Postgres vẫn chỉ thấy đúng nhịp đó.
//   · Có TRẦN bộ nhớ (mặc định 48 MB PDF đang chờ — tiến trình web từng hết RAM 03/11). Đầy thì
//     lượt in mới KHÔNG được xếp hàng (ghi log), tuyệt đối không phình RAM.
//   · Lỗi thì xếp lại cuối hàng, thử lại sau 5 giây rồi 30 giây; hết lượt mới ghi log lỗi.
//   · Không khóa, không trạng thái dùng chung giữa các tiến trình: nhiều máy web thì mỗi máy một
//     hàng, tải cùng một tệp hai lần là vô hại (putIfAbsent).
// Hàng chờ nằm trong RAM vì tệp PDF không được phép vào Postgres (đã chốt) — kho tệp chính là nơi
// bền duy nhất. Hệ quả chấp nhận: tiến trình khởi động lại thì mất các tệp còn đang chờ (vài giây
// tới vài phút gần nhất); khách in lại khi kiện chưa bị lấy thì tệp được xếp hàng lại.
// Mã ở đây KHÔNG ghi bảng nào. Phía Supabase, mỗi tệp là một dòng storage.objects do kho tự ghi.

export interface ArchiveOrder {
  id: string;
  channelId: string;
  /** Tên sàn — chỉ để log cỡ tệp theo sàn. */
  platform: string;
  labelPrintedAt: Date | null;
}

export interface ArchiveInput {
  /** CHỈ các đơn thuộc gian đang bật công tắc (nơi gọi đã lọc). */
  orders: ArchiveOrder[];
  /** Phiếu theo từng đơn (đơn không có mặt = không có phiếu riêng). */
  single: Map<string, Buffer>;
  /** Tệp gộp sàn trả, trang theo đúng thứ tự `orderIds`. */
  combined: { orderIds: string[]; pdf: Buffer }[];
  now?: Date;
}

/** Một việc tải lên. Việc "tệp gộp" kéo theo các tệp chỉ đường — chỉ xếp hàng khi tệp gộp đã lên. */
export interface ArchiveJob {
  path: string;
  body: Buffer;
  contentType: "application/pdf" | "application/json";
  /** Số đơn mất bản lưu nếu việc này hỏng hẳn. */
  orders: number;
  /** true = việc này hoàn tất là MỘT đơn đã có bản lưu (phiếu riêng / tệp chỉ đường). */
  completesOrder: boolean;
  platform: string;
  /** Số phiếu nằm trong tệp (để log cỡ tệp / phiếu); tệp chỉ đường = 0. */
  labels: number;
  followUps: ArchiveJob[];
  attempt: number;
  notBefore: number;
}

/** Luật thuần: một lượt in → danh sách việc tải lên. `skippedExpired` = đơn có mốc in đã quá 60 ngày. */
export function buildArchiveJobs(input: ArchiveInput): { jobs: ArchiveJob[]; skippedExpired: number } {
  const now = input.now ?? new Date();
  const byId = new Map(input.orders.map((o) => [o.id, o]));
  let skippedExpired = 0;
  const alive = (o: ArchiveOrder) => {
    if (o.labelPrintedAt && isLabelExpired(o.labelPrintedAt, now)) {
      skippedExpired += 1;
      return false;
    }
    return true;
  };
  const jobs: ArchiveJob[] = [];
  for (const [orderId, pdf] of input.single) {
    const o = byId.get(orderId);
    if (!o || !alive(o)) continue;
    jobs.push({
      path: singleLabelPath(storageDayFor(o.labelPrintedAt, now), o.channelId, o.id),
      body: pdf,
      contentType: "application/pdf",
      orders: 1,
      completesOrder: true,
      platform: o.platform,
      labels: 1,
      followUps: [],
      attempt: 0,
      notBefore: 0,
    });
  }
  for (const part of input.combined) {
    // Vị trí trang tính trên TOÀN BỘ danh sách của tệp gộp, kể cả đơn không được lưu.
    const members: { o: ArchiveOrder; index: number }[] = [];
    part.orderIds.forEach((id, index) => {
      const o = byId.get(id);
      if (o && alive(o)) members.push({ o, index });
    });
    if (members.length === 0) continue;
    const first = members[0].o;
    const batch = batchLabelPath(archiveDay(now), first.channelId, part.orderIds);
    jobs.push({
      path: batch,
      body: part.pdf,
      contentType: "application/pdf",
      orders: members.length,
      completesOrder: false,
      platform: first.platform,
      labels: part.orderIds.length,
      attempt: 0,
      notBefore: 0,
      followUps: members.map(({ o, index }) => {
        const pointer: LabelPointer = { v: 1, batch, index, count: part.orderIds.length };
        return {
          path: pointerPath(storageDayFor(o.labelPrintedAt, now), o.channelId, o.id),
          body: Buffer.from(JSON.stringify(pointer)),
          contentType: "application/json" as const,
          orders: 1,
          completesOrder: true,
          platform: o.platform,
          labels: 0,
          followUps: [],
          attempt: 0,
          notBefore: 0,
        };
      }),
    });
  }
  return { jobs, skippedExpired };
}

export interface SpoolOptions {
  /** Số lệnh tải lên cùng lúc của CẢ tiến trình. */
  concurrency: number;
  /** Nghỉ sau mỗi lệnh tải lên. */
  pauseMs: number;
  /** Trần tổng cỡ tệp đang chờ; vượt thì lượt in mới không được xếp hàng. */
  maxQueuedBytes: number;
  /** Hỏng thì thử lại sau từng khoảng này (hết danh sách = bỏ). */
  retryDelaysMs: number[];
  /** Cứ ngần này việc xong thì ghi một dòng tổng kết (kể cả khi hàng chưa cạn). */
  logEvery: number;
}

export interface SpoolStats {
  /** Số đơn đã có bản lưu trong kho (mới + đã có sẵn). */
  saved: number;
  created: number;
  existed: number;
  /** Số đơn mất bản lưu vì tải lên hỏng hết lượt thử. */
  failed: number;
  /** Số đơn không được xếp hàng vì hàng chờ đầy. */
  dropped: number;
  skippedExpired: number;
  /** Byte PDF MỚI ghi vào kho. */
  bytes: number;
}

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** Mặc định — đều là số TỰ CHỌN (chưa có số đo tải thật), chỉnh bằng env không cần sửa mã. */
export function defaultSpoolOptions(): SpoolOptions {
  return {
    concurrency: envInt("LABEL_ARCHIVE_CONCURRENCY", 2),
    pauseMs: envInt("LABEL_ARCHIVE_PAUSE_MS", 100),
    maxQueuedBytes: envInt("LABEL_ARCHIVE_MAX_QUEUE_MB", 48) * 1024 * 1024,
    retryDelaysMs: [5_000, 30_000],
    logEvery: 500,
  };
}

const freshStats = (): SpoolStats => ({ saved: 0, created: 0, existed: 0, failed: 0, dropped: 0, skippedExpired: 0, bytes: 0 });
const jobBytes = (j: ArchiveJob): number => j.body.length + j.followUps.reduce((n, f) => n + f.body.length, 0);
const unrefSleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms).unref();
  });

export class LabelArchiveSpool {
  private queue: ArchiveJob[] = [];
  private running = 0;
  private queuedBytes = 0;
  private wake: NodeJS.Timeout | null = null;
  private idleWaiters: (() => void)[] = [];
  /** Cộng dồn từ lúc tạo — test và soi máy đọc. */
  readonly totals: SpoolStats = freshStats();
  /** Cộng dồn từ dòng log gần nhất. */
  private window: SpoolStats = freshStats();
  private windowDone = 0;
  private perPlatform = new Map<string, { labels: number; bytes: number }>();

  constructor(
    private readonly store: LabelStore,
    private readonly opts: SpoolOptions = defaultSpoolOptions()
  ) {}

  /** Số việc và số byte đang chờ (kể cả việc đang chạy). */
  get pending(): { jobs: number; bytes: number } {
    return { jobs: this.queue.length + this.running, bytes: this.queuedBytes };
  }

  /** Xếp hàng một lượt in. KHÔNG ném, KHÔNG chờ mạng. Trả số đơn được xếp / bị bỏ vì hàng đầy. */
  enqueue(input: ArchiveInput): { queued: number; dropped: number } {
    const { jobs, skippedExpired } = buildArchiveJobs(input);
    this.add("skippedExpired", skippedExpired);
    if (jobs.length === 0) return { queued: 0, dropped: 0 };
    const bytes = jobs.reduce((n, j) => n + jobBytes(j), 0);
    const orders = jobs.reduce((n, j) => n + j.orders, 0);
    if (this.queuedBytes + bytes > this.opts.maxQueuedBytes) {
      this.add("dropped", orders);
      console.warn(
        `[label-archive] HÀNG CHỜ ĐẦY — bỏ lưu ${orders} đơn (${(bytes / 1024 / 1024).toFixed(1)} MB) vì đang chờ ` +
          `${(this.queuedBytes / 1024 / 1024).toFixed(1)} MB / trần ${(this.opts.maxQueuedBytes / 1024 / 1024).toFixed(0)} MB`
      );
      return { queued: 0, dropped: orders };
    }
    this.queuedBytes += bytes;
    this.queue.push(...jobs);
    this.pump();
    return { queued: orders, dropped: 0 };
  }

  /** Chờ tới khi hàng cạn (test, script). */
  idle(): Promise<void> {
    if (this.queue.length === 0 && this.running === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private add(key: keyof SpoolStats, n: number) {
    if (!n) return;
    this.totals[key] += n;
    this.window[key] += n;
  }

  private pump() {
    while (this.running < this.opts.concurrency) {
      const now = Date.now();
      const i = this.queue.findIndex((j) => j.notBefore <= now);
      if (i < 0) break;
      const [job] = this.queue.splice(i, 1);
      this.running += 1;
      void this.run(job).finally(async () => {
        if (this.opts.pauseMs > 0) await unrefSleep(this.opts.pauseMs);
        this.running -= 1;
        this.pump();
      });
    }
    if (this.running > 0) return;
    if (this.queue.length === 0) {
      this.flushLog();
      for (const r of this.idleWaiters.splice(0)) r();
      return;
    }
    // Chỉ còn việc đang chờ tới giờ thử lại → hẹn dậy đúng lúc việc sớm nhất tới hạn.
    if (this.wake) clearTimeout(this.wake);
    const due = Math.min(...this.queue.map((j) => j.notBefore));
    this.wake = setTimeout(() => {
      this.wake = null;
      this.pump();
    }, Math.max(0, due - Date.now()));
    this.wake.unref();
  }

  private async run(job: ArchiveJob): Promise<void> {
    try {
      const r = await this.store.putIfAbsent(job.path, job.body, job.contentType);
      this.queuedBytes -= job.body.length;
      if (job.completesOrder) {
        this.add("saved", 1);
        this.add(r === "created" ? "created" : "existed", 1);
      }
      if (r === "created" && job.labels > 0) {
        this.add("bytes", job.body.length);
        const cur = this.perPlatform.get(job.platform) ?? { labels: 0, bytes: 0 };
        this.perPlatform.set(job.platform, { labels: cur.labels + job.labels, bytes: cur.bytes + job.body.length });
      }
      if (job.followUps.length > 0) this.queue.push(...job.followUps);
    } catch (err) {
      if (job.attempt < this.opts.retryDelaysMs.length) {
        job.notBefore = Date.now() + this.opts.retryDelaysMs[job.attempt];
        job.attempt += 1;
        this.queue.push(job); // cuối hàng — việc khác đi trước
      } else {
        this.queuedBytes -= jobBytes(job);
        this.add("failed", job.orders);
        console.error(
          `[label-archive] LỖI lưu ${job.path} (${job.orders} đơn, đã thử ${job.attempt + 1} lần): ${(err as Error).message}`
        );
      }
    }
    this.windowDone += 1;
    if (this.windowDone >= this.opts.logEvery) this.flushLog();
  }

  private flushLog() {
    const w = this.window;
    if (w.saved + w.failed + w.dropped + w.skippedExpired === 0) return;
    const sizes = [...this.perPlatform.entries()]
      .map(
        ([p, v]) =>
          `${p} ${v.labels} phiếu ${(v.bytes / 1024).toFixed(1)} KB (${(v.bytes / 1024 / Math.max(1, v.labels)).toFixed(1)} KB/phiếu)`
      )
      .join("; ");
    console.log(
      `[label-archive] lưu ${w.saved} đơn (mới ${w.created}, đã có ${w.existed}), lỗi ${w.failed}` +
        (w.dropped ? `, bỏ ${w.dropped} đơn vì hàng chờ đầy` : "") +
        (w.skippedExpired ? `, bỏ ${w.skippedExpired} đơn in quá ${LABEL_ARCHIVE_DAYS} ngày` : "") +
        (sizes ? ` — cỡ tệp mới: ${sizes}` : "") +
        (this.queue.length + this.running > 0 ? ` — còn chờ ${this.queue.length + this.running} việc` : "")
    );
    this.window = freshStats();
    this.windowDone = 0;
    this.perPlatform = new Map();
  }
}

let spool: LabelArchiveSpool | null = null;

/** Hàng chờ của tiến trình này; null khi chưa có kho tệp (tính năng tự ẩn). */
export function getLabelArchiveSpool(): LabelArchiveSpool | null {
  if (spool) return spool;
  const store = getLabelStore();
  if (!store) return null;
  spool = new LabelArchiveSpool(store);
  return spool;
}

// ---------- Đọc lại để in ----------

export type SavedLabelResult =
  | { kind: "ok"; pdf: Buffer; /** true = không tách được trang, trả CẢ tệp gộp `count` đơn. */ wholeBatch: boolean; count: number }
  | { kind: "not-printed" }
  | { kind: "expired" }
  | { kind: "missing" };

/** Tách đúng một trang của tệp gộp; số trang không bằng số đơn → null (không đoán). */
async function extractPage(batch: Buffer, pointer: LabelPointer): Promise<Buffer | null> {
  const src = await PDFDocument.load(batch, { ignoreEncryption: true });
  if (src.getPageCount() !== pointer.count) return null;
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(src, [pointer.index]);
  out.addPage(page);
  return Buffer.from(await out.save());
}

/** Tìm tệp đã lưu của một đơn. Ném khi kho lỗi (route trả 502), các ca "không có" trả về `kind`. */
export async function loadSavedLabel(
  store: LabelStore,
  order: { id: string; channelId: string; labelPrintedAt: Date | null },
  now: Date = new Date()
): Promise<SavedLabelResult> {
  if (!order.labelPrintedAt) return { kind: "not-printed" };
  if (isLabelExpired(order.labelPrintedAt, now)) return { kind: "expired" };
  for (const day of lookupDays(order.labelPrintedAt)) {
    const pdf = await store.get(singleLabelPath(day, order.channelId, order.id));
    if (pdf) return { kind: "ok", pdf, wholeBatch: false, count: 1 };
    const raw = await store.get(pointerPath(day, order.channelId, order.id));
    if (!raw) continue;
    const pointer = parsePointer(raw);
    // Tệp chỉ đường phải trỏ vào tệp gộp của CHÍNH gian này — không tin đường dẫn lạ.
    if (!pointer || !pointer.batch.includes(`/${order.channelId}.lo-`)) continue;
    const batch = await store.get(pointer.batch);
    if (!batch) continue;
    let page: Buffer | null = null;
    try {
      page = await extractPage(batch, pointer);
    } catch (err) {
      console.warn(`[label-archive] không tách được trang đơn ${order.id}: ${(err as Error).message}`);
    }
    if (page) return { kind: "ok", pdf: page, wholeBatch: false, count: pointer.count };
    return { kind: "ok", pdf: batch, wholeBatch: true, count: pointer.count };
  }
  return { kind: "missing" };
}

// ---------- Dọn sau 60 ngày ----------

const DAY_FOLDER = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Xóa mọi thư mục ngày đã hết hạn trọn ngày. Liệt kê gốc (mỗi ngày một thư mục, ~62 dòng) rồi với
 * từng ngày hết hạn: liệt kê 1.000 tệp đầu → xóa → liệt kê lại, tới khi rỗng. Gọi từ cron
 * log-cleanup (24 giờ / lần, tiến trình worker).
 */
export async function purgeExpiredLabels(
  store: LabelStore,
  now: Date = new Date(),
  opts: { maxBatches?: number; pauseMs?: number } = {}
): Promise<{ days: number; files: number; truncated: boolean }> {
  const maxBatches = opts.maxBatches ?? PURGE_MAX_BATCHES;
  const pauseMs = opts.pauseMs ?? PURGE_PAUSE_MS;
  const cutoff = purgeCutoffDay(now);
  const folders = (await store.list("", PURGE_BATCH))
    .filter((e) => e.isFolder && DAY_FOLDER.test(e.name) && e.name < cutoff)
    .map((e) => e.name);
  let files = 0;
  let days = 0;
  let batches = 0;
  for (const day of folders) {
    let emptied = false;
    while (batches < maxBatches) {
      const rows = (await store.list(day, PURGE_BATCH)).filter((e) => !e.isFolder);
      if (rows.length === 0) {
        emptied = true;
        break;
      }
      await store.remove(rows.map((r) => `${day}/${r.name}`));
      files += rows.length;
      batches += 1;
      if (pauseMs > 0) await unrefSleep(pauseMs);
    }
    if (!emptied) return { days, files, truncated: true };
    days += 1;
  }
  return { days, files, truncated: false };
}
