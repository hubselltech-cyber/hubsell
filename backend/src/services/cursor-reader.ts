// ============================================================
// MÁY ĐỌC CON TRỎ (N2 + N3) — Pha B "Nền", docs/CUNG-HOA-LOP-GOI-SAN.md mục 5b
//
// MỘT đoạn mã dùng chung cho mọi (sàn, luồng dữ liệu). Mỗi luồng chỉ khai:
// cách gọi một trang trong cửa sổ, khóa dòng, cách ghi dòng, trần cửa sổ sàn.
// Hết chuyện mỗi hàm tự chọn trần trang và tự xử lý "bị cắt":
//
//   • Con trỏ bền trong DB (`sync_cursors`): "đã đọc TRỌN tới cursorAt".
//     Tiến con trỏ CÙNG GIAO DỊCH với trang cuối của cửa sổ → at-least-once +
//     upsert idempotent = không mất, không nhân đôi. Chết giữa chừng → đọc lại.
//   • Cửa sổ tự co (lib/cursor-window): đọc trọn trong ≤ K trang, không thì co
//     và đọc lại. Ở đáy (MIN_WINDOW) vẫn tràn → đọc tiếp quá K, KHÔNG BAO GIỜ cắt.
//   • Tập đổi giữa lúc đọc (sàn phân trang kiểu offset: một đơn rời cửa sổ làm
//     đơn khác trượt qua ranh trang — giả thuyết H8, mục 5b): sàn có báo tổng
//     thì so tổng trang đầu/trang cuối và số dòng khác nhau đã đọc; lệch → đọc
//     lại cửa sổ (tối đa MAX_UNSTABLE_REREADS) rồi mới tiến con trỏ.
//   • Token trang hết hạn → đọc lại cửa sổ từ đầu.
//   • Ngân sách một lượt (N6): tối đa RUN_MAX_PAGES / RUN_MAX_MS rồi trả suất, xét ở
//     RANH cửa sổ; gian lớn chỉ TRỄ HƠN (lagMs), không bao giờ MẤT, không bao giờ kẹt.
//   • Lỗi tạm có hẹn chờ (429 qua cổng) giữa cửa sổ → chờ, đọc lại đúng trang đó.
//     Lỗi khác / chết tiến trình: mất công tối đa một cửa sổ (≤ K trang) — K là trần lãng phí.
//
// CHƯA nối vào worker nào — Pha C mới chuyển từng luồng, chạy bóng theo cờ gian.
// Lỗi gọi sàn khác (429, mạng, ủy quyền) để nguyên cho cổng gọi sàn (lát B2) và
// làn (lát B3) xử lý; trang đã ghi vẫn giữ, con trỏ không tiến.
// ============================================================

import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { CURSOR_READ } from "../config/marketplace-read";
import {
  canShrink,
  clampWindow,
  growWindow,
  planWindow,
  shrinkWindow,
  totalOverflows,
  type TimeWindow,
  type WindowConfig,
} from "../lib/cursor-window";

/** Một trang sàn trả về. `total` = tổng sàn báo cho CẢ cửa sổ (TikTok total_count, Lazada countTotal); Shopee không có. */
export interface PageResult<Row> {
  rows: Row[];
  nextToken?: string | null;
  total?: number;
  pageSize: number;
}

/** Adapter ném lỗi này khi sàn báo token trang hết hạn / không hợp lệ. */
export class PageTokenExpiredError extends Error {
  constructor(message = "page token hết hạn") {
    super(message);
    this.name = "PageTokenExpiredError";
  }
}

export interface StreamSpec<Row, Tx> {
  channelId: string;
  /** Tên luồng: "orders" | "returns" | "escrow" | "wallet" | … */
  stream: string;
  /** Trần cửa sổ của sàn (PLATFORM_MAX_WINDOW_MS). */
  maxWindowMs: number;
  /** Con trỏ khởi đầu khi gian chưa có dòng `sync_cursors` (vd now − 90 ngày cho làn nạp gian mới). */
  initialCursorAt: (now: number) => number;
  /**
   * Gọi MỘT trang. Hợp đồng: trả mọi dòng có mốc ∈ [win.from, win.to) (phủ rộng hơn
   * ở ranh giây được — đọc trùng vô hại); `pageToken` undefined = trang đầu.
   */
  fetchPage: (win: TimeWindow, pageToken: string | undefined) => Promise<PageResult<Row>>;
  /** Khóa sàn của dòng (mã đơn, mã giao dịch…) — đếm dòng khác nhau để soát tổng. */
  rowKey: (row: Row) => string;
  /** Ghi các dòng (upsert idempotent) trong giao dịch `tx`. */
  persist: (rows: Row[], tx: Tx) => Promise<void>;
  /** Sau mỗi lần commit thành công (dữ liệu + con trỏ) — việc chỉ được làm SAU commit (chốt phiếu đẩy tồn…). */
  afterCommit?: () => Promise<void>;
}

export interface CursorState {
  cursorAt: number;
  windowMs: number;
}

/** caught_up = tới mốc cuối lượt; budget = hết ngân sách lượt; aborted = làn hủy (mất thuê bao / dừng). */
export type ReadStatus = "caught_up" | "budget" | "aborted";

export interface CursorRunStats {
  status: ReadStatus;
  pages: number;
  rows: number;
}

export interface CursorStore<Tx> {
  load(channelId: string, stream: string): Promise<CursorState | null>;
  /** Chạy `write` và (nếu có) ghi trạng thái con trỏ trong MỘT giao dịch. */
  commit(channelId: string, stream: string, write: (tx: Tx) => Promise<void>, next: CursorState | null): Promise<void>;
  /** Ghi số đo lượt (ngoài giao dịch dữ liệu, mất cũng không sao). */
  noteRun?(channelId: string, stream: string, stats: CursorRunStats): Promise<void>;
}

export interface ReadResult extends CursorRunStats {
  cursorAt: number;
  windowMs: number;
  /** Độ trễ = now − cursorAt (N7). */
  lagMs: number;
  windowsCompleted: number;
  shrinks: number;
  /** Cửa sổ ở đáy vẫn tràn K trang (đọc tiếp, không cắt) — số đo bất thường. */
  floorOverflows: number;
  unstableRereads: number;
  tokenRestarts: number;
  /** Số lần đọc lại một trang sau lỗi tạm có hẹn chờ. */
  pageRetries: number;
}

export interface ReadOptions {
  now?: () => number;
  maxPages?: number;
  maxMs?: number;
  config?: Partial<Omit<WindowConfig, "maxWindowMs">> & { settleMs?: number };
  /** Làn hủy (mất thuê bao, dừng tiến trình) → dừng trước trang kế, con trỏ ở ranh cửa sổ đã đọc trọn. */
  signal?: AbortSignal;
  /**
   * Lỗi gọi trang có nên chờ rồi đọc lại đúng trang đó không: trả số ms chờ, null = ném ra.
   * Làn truyền "GatewayDeferError ngắn → waitMs" — 429 giữa cửa sổ không bỏ công cả cửa sổ.
   */
  retryDelay?: (err: unknown) => number | null;
  sleep?: (ms: number) => Promise<void>;
}

/** Đọc một (gian, luồng) theo con trỏ tới khi đuổi kịp `now − settle` hoặc hết ngân sách lượt. */
export async function readByCursor<Row, Tx>(
  spec: StreamSpec<Row, Tx>,
  store: CursorStore<Tx>,
  opts: ReadOptions = {}
): Promise<ReadResult> {
  const now = opts.now ?? Date.now;
  const cfg: WindowConfig = {
    pagesPerWindow: opts.config?.pagesPerWindow ?? CURSOR_READ.PAGES_PER_WINDOW,
    minWindowMs: opts.config?.minWindowMs ?? CURSOR_READ.MIN_WINDOW_MS,
    maxWindowMs: spec.maxWindowMs,
    growBelowRatio: opts.config?.growBelowRatio ?? CURSOR_READ.GROW_BELOW_RATIO,
    shrinkTargetRatio: opts.config?.shrinkTargetRatio ?? CURSOR_READ.SHRINK_TARGET_RATIO,
  };
  const settleMs = opts.config?.settleMs ?? CURSOR_READ.SETTLE_MS;
  const maxPages = opts.maxPages ?? CURSOR_READ.RUN_MAX_PAGES;
  const maxMs = opts.maxMs ?? CURSOR_READ.RUN_MAX_MS;
  const startedAt = now();

  const loaded = await store.load(spec.channelId, spec.stream);
  const state: CursorState = loaded
    ? { cursorAt: loaded.cursorAt, windowMs: clampWindow(loaded.windowMs, cfg) }
    : { cursorAt: spec.initialCursorAt(startedAt), windowMs: clampWindow(CURSOR_READ.INITIAL_WINDOW_MS, cfg) };

  const res: ReadResult = {
    status: "caught_up",
    pages: 0,
    rows: 0,
    cursorAt: state.cursorAt,
    windowMs: state.windowMs,
    lagMs: 0,
    windowsCompleted: 0,
    shrinks: 0,
    floorOverflows: 0,
    unstableRereads: 0,
    tokenRestarts: 0,
    pageRetries: 0,
  };
  const outOfBudget = () => res.pages >= maxPages || now() - startedAt >= maxMs;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const write = async (rows: Row[], next: CursorState | null) => {
    await store.commit(spec.channelId, spec.stream, (tx) => (rows.length ? spec.persist(rows, tx) : Promise.resolve()), next);
    await spec.afterCommit?.();
  };

  // Mốc cuối chốt MỘT lần đầu lượt: tính lại mỗi vòng thì đồng hồ chạy theo từng lệnh
  // sàn, lượt không bao giờ "đuổi kịp" (mỗi vòng lại có cửa sổ vài trăm ms mới).
  const endLimit = startedAt - settleMs;

  outer: for (;;) {
    const win = planWindow(state.cursorAt, state.windowMs, endLimit, cfg);
    if (!win) break;
    // Ngân sách chỉ xét ở ranh cửa sổ (xem CURSOR_READ.RUN_MAX_PAGES).
    if (outOfBudget()) {
      res.status = "budget";
      break;
    }

    let unstable = 0;
    let restarts = 0;
    // Một lần đọc trọn cửa sổ; `continue window` = đọc lại cùng cửa sổ từ trang đầu.
    window: for (;;) {
      let token: string | undefined;
      let pagesInWindow = 0;
      let firstTotal: number | undefined;
      const seen = new Set<string>();
      let floorOverflowNoted = false;
      let pageRetries = 0;

      for (;;) {
        if (opts.signal?.aborted) {
          res.status = "aborted";
          break outer;
        }
        let page: PageResult<Row>;
        try {
          page = await spec.fetchPage(win, token);
          pageRetries = 0;
        } catch (err) {
          const delay = opts.retryDelay?.(err) ?? null;
          if (delay != null && pageRetries < CURSOR_READ.MAX_PAGE_RETRIES) {
            pageRetries++;
            res.pageRetries++;
            await sleep(delay);
            continue;
          }
          if (err instanceof PageTokenExpiredError && token !== undefined && restarts < CURSOR_READ.MAX_TOKEN_RESTARTS) {
            restarts++;
            res.tokenRestarts++;
            continue window;
          }
          throw err;
        }
        res.pages++;
        pagesInWindow++;
        res.rows += page.rows.length;
        for (const r of page.rows) seen.add(spec.rowKey(r));
        if (pagesInWindow === 1) firstTotal = page.total;
        const last = !page.nextToken;

        // Tràn: biết trước qua tổng (trang đầu) hoặc tới trang K mà còn tiếp.
        const overflow =
          !last &&
          ((pagesInWindow === 1 && totalOverflows(page.total, page.pageSize, cfg)) || pagesInWindow >= cfg.pagesPerWindow);
        if (overflow && canShrink(win, cfg)) {
          state.windowMs = shrinkWindow(
            win,
            cfg,
            page.total != null ? { total: page.total, pageSize: page.pageSize } : undefined
          );
          res.shrinks++;
          await write(page.rows, { ...state });
          continue outer;
        }
        if (overflow && !floorOverflowNoted) {
          floorOverflowNoted = true;
          res.floorOverflows++;
          console.warn(
            `[cursor-reader] ${spec.stream} ${spec.channelId}: cửa sổ đáy ${cfg.minWindowMs} ms vẫn quá ${cfg.pagesPerWindow} trang — đọc tiếp, không cắt`
          );
        }

        if (!last) {
          await write(page.rows, null);
          token = page.nextToken!;
          continue;
        }

        // Trang cuối: soát tập có đổi giữa lúc đọc không (chỉ khi sàn báo tổng).
        const lastTotal = page.total;
        const drifted =
          (firstTotal != null && lastTotal != null && firstTotal !== lastTotal) ||
          (lastTotal != null && seen.size < lastTotal);
        if (drifted && unstable < CURSOR_READ.MAX_UNSTABLE_REREADS) {
          unstable++;
          res.unstableRereads++;
          await write(page.rows, null);
          continue window;
        }
        if (drifted) {
          console.warn(
            `[cursor-reader] ${spec.stream} ${spec.channelId}: cửa sổ ${new Date(win.from).toISOString()}→${new Date(win.to).toISOString()} vẫn lệch tổng sau ${unstable} lần đọc lại (đầu ${firstTotal}, cuối ${lastTotal}, đọc ${seen.size}) — tiến con trỏ, để lượt đối soát + webhook bù`
          );
        }
        state.windowMs = growWindow(state.windowMs, win, pagesInWindow, cfg);
        state.cursorAt = win.to;
        res.windowsCompleted++;
        await write(page.rows, { ...state });
        break window;
      }
    }
  }

  res.cursorAt = state.cursorAt;
  res.windowMs = state.windowMs;
  res.lagMs = Math.max(0, now() - state.cursorAt);
  await store.noteRun?.(spec.channelId, spec.stream, { status: res.status, pages: res.pages, rows: res.rows }).catch(() => {});
  return res;
}

// ---------- Kho con trỏ trong Postgres ----------

const TX_TIMEOUT_MS = 30_000;

/** Kho con trỏ bảng `sync_cursors`; dữ liệu trang + con trỏ chung một giao dịch Prisma. */
export const prismaCursorStore: CursorStore<Prisma.TransactionClient> = {
  async load(channelId, stream) {
    const row = await prisma.syncCursor.findUnique({ where: { channelId_stream: { channelId, stream } } });
    return row ? { cursorAt: row.cursorAt.getTime(), windowMs: row.windowMs } : null;
  },
  async commit(channelId, stream, write, next) {
    await prisma.$transaction(
      async (tx) => {
        await write(tx);
        if (next) {
          const data = { cursorAt: new Date(next.cursorAt), windowMs: Math.round(next.windowMs) };
          await tx.syncCursor.upsert({
            where: { channelId_stream: { channelId, stream } },
            update: data,
            create: { channelId, stream, ...data },
          });
        }
      },
      { timeout: TX_TIMEOUT_MS }
    );
  },
  async noteRun(channelId, stream, stats) {
    await prisma.syncCursor.updateMany({
      where: { channelId, stream },
      data: { lastRunAt: new Date(), lastStatus: stats.status, lastPages: stats.pages },
    });
  },
};
