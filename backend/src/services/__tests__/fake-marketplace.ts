// ============================================================
// SÀN GIẢ cho test lớp đọc sàn (Pha B — docs/CUNG-HOA-LOP-GOI-SAN.md mục 5b).
//
// Mô phỏng đúng những kiểu hỏng đã gặp / đã đo ở Pha A, không mô phỏng sàn "ngoan":
//   • thứ tự trả: tăng / giảm / ngẫu nhiên / theo create_time (TikTok không gửi sort_field — H1)
//   • phân trang kiểu OFFSET tính lại trên tập HIỆN TẠI mỗi lệnh → đơn rời cửa sổ giữa
//     lúc đọc làm đơn khác trượt qua ranh trang (H8)
//   • trùng dòng giữa hai trang, token trang hết hạn sau N lệnh
//   • 429 tiêm theo tỷ lệ, trần trang âm thầm (sàn ngừng trả `next` mà không báo)
//   • có / không báo tổng (TikTok total_count, Lazada countTotal / Shopee chỉ `more`)
// Đồng hồ giả: mỗi lệnh sàn tốn `callMs` — test chạy tức thì, không ngủ thật.
// ============================================================

import { PageTokenExpiredError, type CursorState, type CursorStore, type PageResult } from "../cursor-reader";
import { leaseKey, type LeaseItem, type LeaseStore } from "../sync-lanes";
import type { TimeWindow } from "../../lib/cursor-window";

export interface FakeRow {
  id: string;
  /** Mốc quét (update_time) — đổi khi đơn đổi trạng thái. */
  t: number;
  createdAt: number;
  version: number;
}

export class FakeRateLimitError extends Error {
  constructor(readonly retryAfterMs?: number) {
    super("429 error_rate_limit (sàn giả)");
    this.name = "FakeRateLimitError";
  }
}

export type FakeOrder = "asc" | "desc" | "random" | "create_asc";

export interface FakeOptions {
  pageSize?: number;
  order?: FakeOrder;
  reportTotal?: boolean;
  /** Số dòng trang sau lặp lại từ cuối trang trước. */
  overlap?: number;
  /** Token sống tối đa N lệnh sau khi phát. */
  tokenTtlCalls?: number;
  /** Tỷ lệ lệnh bị 429 (0–1). */
  rateLimitRatio?: number;
  /** Sàn âm thầm ngừng trả `next` sau N trang của một truy vấn. */
  silentPageCap?: number;
  /** Mỗi lệnh tốn bao nhiêu ms đồng hồ giả. */
  callMs?: number;
  seed?: number;
}

/** PRNG có hạt giống (mulberry32) — test lặp lại được. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class FakeMarketplace {
  readonly rows = new Map<string, FakeRow>();
  clock: number;
  calls = 0;
  rateLimited = 0;
  /** Cửa sổ của lệnh gần nhất — test đổi đơn NGAY trong cửa sổ đang đọc (H8). */
  lastWindow?: TimeWindow;
  /** Gọi trước mỗi lệnh sàn — test dùng để đổi dữ liệu GIỮA các trang. */
  beforeCall?: (m: FakeMarketplace) => void;
  private readonly rand: () => number;
  private readonly o: Required<Omit<FakeOptions, "silentPageCap">> & { silentPageCap?: number };

  constructor(startClock: number, opts: FakeOptions = {}) {
    this.clock = startClock;
    this.o = {
      pageSize: opts.pageSize ?? 100,
      order: opts.order ?? "random",
      reportTotal: opts.reportTotal ?? false,
      overlap: opts.overlap ?? 0,
      tokenTtlCalls: opts.tokenTtlCalls ?? Number.POSITIVE_INFINITY,
      rateLimitRatio: opts.rateLimitRatio ?? 0,
      callMs: opts.callMs ?? 300,
      seed: opts.seed ?? 1,
      silentPageCap: opts.silentPageCap,
    };
    this.rand = rng(this.o.seed);
  }

  /** Sinh `n` đơn rải đều [from, to) — mỗi đơn đã đổi trạng thái vài lần trước `to`. */
  seed(n: number, from: number, to: number): void {
    for (let i = 0; i < n; i++) {
      const createdAt = from + Math.floor(this.rand() * (to - from));
      const t = createdAt + Math.floor(this.rand() * Math.max(1, to - createdAt));
      this.rows.set(`o${i}`, { id: `o${i}`, t: Math.min(t, to - 1), createdAt, version: 1 });
    }
  }

  /** Đơn đổi trạng thái NGAY BÂY GIỜ (đồng hồ giả) → rời cửa sổ cũ. */
  touch(id: string): void {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, t: this.clock, version: r.version + 1 });
  }

  /** Đổi trạng thái một đơn ĐANG nằm trong cửa sổ vừa đọc (nếu có) — kịch bản H8 gắt nhất. */
  touchInLastWindow(): void {
    const w = this.lastWindow;
    if (!w) return;
    const inWin = [...this.rows.values()].filter((r) => r.t >= w.from && r.t < w.to);
    if (inWin.length) this.touch(inWin[Math.floor(this.rand() * inWin.length)].id);
  }

  randomId(): string {
    const ids = [...this.rows.keys()];
    return ids[Math.floor(this.rand() * ids.length)];
  }

  private sorted(win: TimeWindow): FakeRow[] {
    const inWin = [...this.rows.values()].filter((r) => r.t >= win.from && r.t < win.to);
    switch (this.o.order) {
      case "asc":
        return inWin.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
      case "desc":
        return inWin.sort((a, b) => b.t - a.t || a.id.localeCompare(b.id));
      case "create_asc":
        return inWin.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      case "random": {
        // Ổn định trong MỘT truy vấn (cùng cửa sổ) như sàn thật, khác giữa các cửa sổ.
        const salt = `${win.from}:${win.to}`;
        return inWin.sort((a, b) => hash(salt + a.id) - hash(salt + b.id));
      }
    }
  }

  async fetchPage(win: TimeWindow, token: string | undefined): Promise<PageResult<FakeRow>> {
    this.beforeCall?.(this);
    this.calls++;
    this.clock += this.o.callMs;
    this.lastWindow = win;
    if (this.o.rateLimitRatio > 0 && this.rand() < this.o.rateLimitRatio) {
      this.rateLimited++;
      throw new FakeRateLimitError(1000);
    }
    let offset = 0;
    let pageNo = 0;
    if (token !== undefined) {
      const [off, issued, page] = token.split(":").map(Number);
      if (this.calls - issued > this.o.tokenTtlCalls) throw new PageTokenExpiredError();
      offset = off;
      pageNo = page;
    }
    const all = this.sorted(win);
    const rows = all.slice(offset, offset + this.o.pageSize).map((r) => ({ ...r }));
    const nextOffset = offset + this.o.pageSize - this.o.overlap;
    const capped = this.o.silentPageCap != null && pageNo + 1 >= this.o.silentPageCap;
    const hasMore = offset + this.o.pageSize < all.length && !capped;
    return {
      rows,
      nextToken: hasMore ? `${nextOffset}:${this.calls}:${pageNo + 1}` : null,
      total: this.o.reportTotal ? all.length : undefined,
      pageSize: this.o.pageSize,
    };
  }
}

// ---------- Kho RAM dùng chung cho test lớp đọc sàn ----------

/** Kho con trỏ trong RAM; dữ liệu + con trỏ áp CÙNG LÚC (giống một giao dịch), `failNext` mô phỏng chết giữa chừng. */
export class MemoryStore implements CursorStore<null> {
  cursors = new Map<string, CursorState>();
  sink = new Map<string, FakeRow>();
  commits = 0;
  failAt?: number;
  async load(c: string, s: string) {
    return this.cursors.get(`${c}/${s}`) ?? null;
  }
  async commit(c: string, s: string, write: (tx: null) => Promise<void>, next: CursorState | null) {
    this.commits++;
    if (this.failAt === this.commits) throw new Error("chết giữa giao dịch (giả)");
    await write(null);
    if (next) this.cursors.set(`${c}/${s}`, { ...next });
  }
}

interface LeaseRow extends LeaseItem {
  dueAt: number;
  owner: string | null;
  until: number;
}

export class MemoryLeaseStore implements LeaseStore {
  rows = new Map<string, LeaseRow>();
  add(channelId: string, stream = "orders", lane = "orders", dueAt = Date.now()) {
    this.rows.set(`${channelId}/${stream}`, { channelId, stream, lane, dueAt, owner: null, until: 0 });
  }
  async claim(lane: string, n: number, owner: string, leaseMs: number) {
    const now = Date.now();
    const pick = [...this.rows.values()]
      .filter((r) => r.lane === lane && r.dueAt <= now && (r.owner == null || r.until < now))
      .sort((a, b) => a.dueAt - b.dueAt)
      .slice(0, n);
    for (const r of pick) {
      r.owner = owner;
      r.until = now + leaseMs;
    }
    return pick.map(({ channelId, stream, lane: l }) => ({ channelId, stream, lane: l }));
  }
  async heartbeat(items: LeaseItem[], owner: string, leaseMs: number) {
    const held = new Set<string>();
    for (const it of items) {
      const r = this.rows.get(leaseKey(it));
      if (r && r.owner === owner) {
        r.until = Date.now() + leaseMs;
        held.add(leaseKey(it));
      }
    }
    return held;
  }
  async release(item: LeaseItem, owner: string, dueAt: Date) {
    const r = this.rows.get(leaseKey(item));
    if (r && r.owner === owner) {
      r.owner = null;
      r.until = 0;
      r.dueAt = dueAt.getTime();
    }
  }
}
