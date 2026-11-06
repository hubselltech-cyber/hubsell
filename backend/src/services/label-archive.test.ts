import fs from "fs/promises";
import os from "os";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LABEL_ARCHIVE_DAYS,
  LabelArchiveSpool,
  archiveDay,
  batchKey,
  batchLabelPath,
  buildArchiveJobs,
  createLocalLabelStore,
  isLabelExpired,
  labelArchiveAllowed,
  loadSavedLabel,
  lookupDays,
  mayHaveSavedLabel,
  parsePointer,
  pointerPath,
  purgeCutoffDay,
  purgeExpiredLabels,
  singleLabelPath,
  type ArchiveOrder,
  type LabelStore,
  type SpoolOptions,
} from "./label-archive";

const DAY = 24 * 3600_000;
const NOW = new Date("2026-11-06T13:00:00.000Z");

/** Kho giả lập trong RAM — đếm lệnh gọi, cho phép cài lỗi theo đường dẫn. */
function fakeStore() {
  const files = new Map<string, Buffer>();
  const calls = { put: 0, get: 0, list: 0, remove: 0 };
  /** Đường dẫn → số lần còn phải lỗi (Infinity = lỗi mãi). */
  const failPut = new Map<string, number>();
  let active = 0;
  let maxActive = 0;
  const store: LabelStore = {
    async putIfAbsent(p, body) {
      calls.put += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      const left = failPut.get(p) ?? 0;
      if (left > 0) {
        failPut.set(p, left - 1);
        throw new Error("kho lỗi 500");
      }
      if (files.has(p)) return "exists";
      files.set(p, body);
      return "created";
    },
    async get(p) {
      calls.get += 1;
      return files.get(p) ?? null;
    },
    async list(prefix, limit) {
      calls.list += 1;
      const names = new Map<string, boolean>();
      for (const key of files.keys()) {
        if (prefix && !key.startsWith(`${prefix}/`)) continue;
        const rest = prefix ? key.slice(prefix.length + 1) : key;
        const slash = rest.indexOf("/");
        names.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
      }
      return [...names.entries()]
        .map(([name, isFolder]) => ({ name, isFolder }))
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .slice(0, limit);
    },
    async remove(paths) {
      calls.remove += 1;
      for (const p of paths) files.delete(p);
    },
  };
  return { store, files, calls, failPut, maxActive: () => maxActive };
}

/** PDF n trang, trang i rộng 100 + i điểm — đọc bề rộng là biết đúng trang nào. */
async function pdfWithPages(n: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([100 + i, 150]);
  return Buffer.from(await doc.save());
}
async function pageWidths(pdf: Buffer): Promise<number[]> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((p) => p.getWidth());
}

const FAST: SpoolOptions = { concurrency: 2, pauseMs: 0, maxQueuedBytes: 10 * 1024 * 1024, retryDelaysMs: [1, 1], logEvery: 1000 };
const order = (id: string, over: Partial<ArchiveOrder> = {}): ArchiveOrder => ({
  id,
  channelId: "ch1",
  platform: "SHOPEE",
  labelPrintedAt: null,
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("luật ngày và đường dẫn", () => {
  it("ngày thư mục là ngày UTC", () => {
    expect(archiveDay(new Date("2026-11-06T23:59:59.999Z"))).toBe("2026-11-06");
    expect(archiveDay(new Date("2026-11-07T00:00:00.000Z"))).toBe("2026-11-07");
  });

  it("hết hạn đúng sau 60 ngày kể từ mốc in", () => {
    const printed = new Date(NOW.getTime() - LABEL_ARCHIVE_DAYS * DAY);
    expect(isLabelExpired(printed, NOW)).toBe(false); // đúng 60 ngày: còn
    expect(isLabelExpired(new Date(printed.getTime() - 1), NOW)).toBe(true);
  });

  it("chỉ dọn thư mục đã hết hạn TRỌN ngày", () => {
    // 06/11 13:00 − 60 ngày = 07/09 13:00 → thư mục 07/09 còn tệp in sau 13:00 chưa đủ 60 ngày
    expect(purgeCutoffDay(NOW)).toBe("2026-09-07");
    expect("2026-09-06" < purgeCutoffDay(NOW)).toBe(true);
    expect("2026-09-07" < purgeCutoffDay(NOW)).toBe(false);
  });

  it("tìm lại: ngày của mốc in rồi ngày liền trước", () => {
    expect(lookupDays(new Date("2026-11-07T00:00:02.000Z"))).toEqual(["2026-11-07", "2026-11-06"]);
  });

  it("đường dẫn phẳng trong thư mục ngày, khóa tệp gộp theo đúng thứ tự đơn", () => {
    expect(singleLabelPath("2026-11-06", "ch1", "o1")).toBe("2026-11-06/ch1.o1.pdf");
    expect(pointerPath("2026-11-06", "ch1", "o1")).toBe("2026-11-06/ch1.o1.json");
    expect(batchKey(["a", "b"])).toBe(batchKey(["a", "b"]));
    expect(batchKey(["a", "b"])).not.toBe(batchKey(["b", "a"]));
    expect(batchLabelPath("2026-11-06", "ch1", ["a", "b"])).toMatch(/^2026-11-06\/ch1\.lo-[0-9a-f]{16}\.pdf$/);
  });

  it("tệp chỉ đường hỏng hoặc lệch thì bỏ", () => {
    const ok = { v: 1, batch: "2026-11-06/ch1.lo-abc.pdf", index: 1, count: 3 };
    expect(parsePointer(Buffer.from(JSON.stringify(ok)))).toEqual(ok);
    expect(parsePointer(Buffer.from("không phải json"))).toBeNull();
    expect(parsePointer(Buffer.from(JSON.stringify({ ...ok, index: 3 })))).toBeNull();
    expect(parsePointer(Buffer.from(JSON.stringify({ ...ok, v: 2 })))).toBeNull();
    expect(parsePointer(Buffer.from(JSON.stringify({ ...ok, batch: "" })))).toBeNull();
  });

  it("nút In lại chỉ hiện với đơn in sau mốc bật công tắc và chưa quá 60 ngày", () => {
    const on = { labelArchiveEnabledAt: new Date("2026-10-01T00:00:00Z") };
    expect(mayHaveSavedLabel({ labelPrintedAt: new Date("2026-10-02T00:00:00Z") }, on, NOW)).toBe(true);
    expect(mayHaveSavedLabel({ labelPrintedAt: new Date("2026-09-30T00:00:00Z") }, on, NOW)).toBe(false); // in trước khi bật
    expect(mayHaveSavedLabel({ labelPrintedAt: null }, on, NOW)).toBe(false);
    expect(mayHaveSavedLabel({ labelPrintedAt: new Date("2026-10-02T00:00:00Z") }, { labelArchiveEnabledAt: null }, NOW)).toBe(false);
    const old = { labelArchiveEnabledAt: new Date("2026-01-01T00:00:00Z") };
    expect(mayHaveSavedLabel({ labelPrintedAt: new Date("2026-09-01T00:00:00Z") }, old, NOW)).toBe(false); // quá 60 ngày
  });
});

describe("một lượt in → danh sách việc", () => {
  it("phiếu riêng: mỗi đơn một tệp; đơn không thuộc gian bật thì bỏ", () => {
    const { jobs } = buildArchiveJobs({
      now: NOW,
      orders: [order("o1"), order("o2", { channelId: "ch2", platform: "TIKTOK" })],
      single: new Map([
        ["o1", Buffer.from("a")],
        ["o2", Buffer.from("b")],
        ["o3", Buffer.from("c")], // gian chưa bật → không có trong orders
      ]),
      combined: [],
    });
    expect(jobs.map((j) => j.path)).toEqual(["2026-11-06/ch1.o1.pdf", "2026-11-06/ch2.o2.pdf"]);
  });

  it("in lại: lưu vào thư mục của mốc in LẦN ĐẦU; quá 60 ngày thì bỏ", () => {
    const { jobs, skippedExpired } = buildArchiveJobs({
      now: NOW,
      orders: [
        order("o1", { labelPrintedAt: new Date("2026-11-01T05:00:00Z") }),
        order("o2", { labelPrintedAt: new Date("2026-08-01T05:00:00Z") }),
      ],
      single: new Map([
        ["o1", Buffer.from("a")],
        ["o2", Buffer.from("b")],
      ]),
      combined: [],
    });
    expect(jobs.map((j) => j.path)).toEqual(["2026-11-01/ch1.o1.pdf"]);
    expect(skippedExpired).toBe(1);
  });

  it("tệp gộp: MỘT tệp nguyên văn + chỉ đường từng đơn, vị trí tính trên cả danh sách", () => {
    const pdf = Buffer.from("gop");
    const { jobs } = buildArchiveJobs({
      now: NOW,
      // o2 không được lưu (gian khác / không trong orders) nhưng vẫn chiếm trang 1
      orders: [order("o1"), order("o3")],
      single: new Map(),
      combined: [{ orderIds: ["o1", "o2", "o3"], pdf }],
    });
    expect(jobs).toHaveLength(1);
    const batch = jobs[0];
    expect(batch.path).toBe(batchLabelPath("2026-11-06", "ch1", ["o1", "o2", "o3"]));
    expect(batch.completesOrder).toBe(false);
    expect(batch.orders).toBe(2);
    expect(batch.labels).toBe(3);
    const pointers = batch.followUps.map((f) => ({ path: f.path, ...parsePointer(f.body)! }));
    expect(pointers).toEqual([
      { path: "2026-11-06/ch1.o1.json", v: 1, batch: batch.path, index: 0, count: 3 },
      { path: "2026-11-06/ch1.o3.json", v: 1, batch: batch.path, index: 2, count: 3 },
    ]);
  });
});

describe("hàng chờ nhỏ giọt", () => {
  it("lưu phiếu riêng và tệp gộp; xếp hàng trả về ngay, không chờ mạng", async () => {
    const f = fakeStore();
    const spool = new LabelArchiveSpool(f.store, FAST);
    const r = spool.enqueue({
      now: NOW,
      orders: [order("o1"), order("o2"), order("o3")],
      single: new Map([["o1", Buffer.from("mot")]]),
      combined: [{ orderIds: ["o2", "o3"], pdf: Buffer.from("gop") }],
    });
    expect(r).toEqual({ queued: 3, dropped: 0 });
    expect(f.files.size).toBe(0); // chưa tải gì lúc enqueue trả về
    await spool.idle();
    expect([...f.files.keys()].sort()).toEqual(
      [
        "2026-11-06/ch1.o1.pdf",
        "2026-11-06/ch1.o2.json",
        "2026-11-06/ch1.o3.json",
        batchLabelPath("2026-11-06", "ch1", ["o2", "o3"]),
      ].sort()
    );
    expect(spool.totals).toMatchObject({ saved: 3, created: 3, existed: 0, failed: 0, dropped: 0, bytes: 6 });
    expect(spool.pending).toEqual({ jobs: 0, bytes: 0 });
  });

  it("in lại cùng phiếu: không ghi đè, đếm là đã có", async () => {
    const f = fakeStore();
    const spool = new LabelArchiveSpool(f.store, FAST);
    const input = { now: NOW, orders: [order("o1")], single: new Map([["o1", Buffer.from("mot")]]), combined: [] };
    spool.enqueue(input);
    await spool.idle();
    spool.enqueue(input);
    await spool.idle();
    expect(f.files.size).toBe(1);
    expect(spool.totals).toMatchObject({ saved: 2, created: 1, existed: 1, bytes: 3 });
  });

  it("kho lỗi tạm: thử lại rồi lưu được", async () => {
    const f = fakeStore();
    f.failPut.set("2026-11-06/ch1.o1.pdf", 2);
    const spool = new LabelArchiveSpool(f.store, FAST);
    spool.enqueue({ now: NOW, orders: [order("o1")], single: new Map([["o1", Buffer.from("mot")]]), combined: [] });
    await spool.idle();
    expect(f.files.has("2026-11-06/ch1.o1.pdf")).toBe(true);
    expect(f.calls.put).toBe(3);
    expect(spool.totals).toMatchObject({ saved: 1, failed: 0 });
  });

  it("kho lỗi hẳn: ghi log lỗi, không ném, trả lại bộ nhớ", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fakeStore();
    f.failPut.set("2026-11-06/ch1.o1.pdf", Infinity);
    const spool = new LabelArchiveSpool(f.store, FAST);
    spool.enqueue({ now: NOW, orders: [order("o1")], single: new Map([["o1", Buffer.from("mot")]]), combined: [] });
    await spool.idle();
    expect(spool.totals).toMatchObject({ saved: 0, failed: 1 });
    expect(spool.pending).toEqual({ jobs: 0, bytes: 0 });
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[label-archive] LỖI lưu 2026-11-06/ch1.o1.pdf"));
  });

  it("tệp gộp không lên được thì KHÔNG tạo chỉ đường, mọi đơn trong tệp tính là lỗi", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fakeStore();
    f.failPut.set(batchLabelPath("2026-11-06", "ch1", ["o1", "o2"]), Infinity);
    const spool = new LabelArchiveSpool(f.store, FAST);
    spool.enqueue({
      now: NOW,
      orders: [order("o1"), order("o2")],
      single: new Map(),
      combined: [{ orderIds: ["o1", "o2"], pdf: Buffer.from("gop") }],
    });
    await spool.idle();
    expect(f.files.size).toBe(0);
    expect(spool.totals).toMatchObject({ saved: 0, failed: 2 });
    expect(spool.pending).toEqual({ jobs: 0, bytes: 0 });
  });

  it("hàng chờ đầy: lượt in mới không được xếp hàng, không phình bộ nhớ", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = fakeStore();
    const spool = new LabelArchiveSpool(f.store, { ...FAST, maxQueuedBytes: 10 });
    const big = Buffer.alloc(8);
    expect(spool.enqueue({ now: NOW, orders: [order("o1")], single: new Map([["o1", big]]), combined: [] })).toEqual({
      queued: 1,
      dropped: 0,
    });
    expect(spool.enqueue({ now: NOW, orders: [order("o2")], single: new Map([["o2", big]]), combined: [] })).toEqual({
      queued: 0,
      dropped: 1,
    });
    await spool.idle();
    expect([...f.files.keys()]).toEqual(["2026-11-06/ch1.o1.pdf"]);
    expect(spool.totals.dropped).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("HÀNG CHỜ ĐẦY"));
    // Hàng đã cạn thì lượt sau lại xếp được
    expect(spool.enqueue({ now: NOW, orders: [order("o2")], single: new Map([["o2", big]]), combined: [] }).queued).toBe(1);
    await spool.idle();
  });

  it("nhiều lượt in cùng lúc vẫn chỉ tải lên đúng số lệnh song song đã đặt", async () => {
    const f = fakeStore();
    const spool = new LabelArchiveSpool(f.store, { ...FAST, concurrency: 2 });
    for (let lot = 0; lot < 5; lot++) {
      const ids = Array.from({ length: 8 }, (_, i) => `o${lot}-${i}`);
      spool.enqueue({
        now: NOW,
        orders: ids.map((id) => order(id)),
        single: new Map(ids.map((id) => [id, Buffer.from(id)])),
        combined: [],
      });
    }
    await spool.idle();
    expect(f.files.size).toBe(40);
    expect(f.maxActive()).toBeLessThanOrEqual(2);
  });
});

describe("đọc lại để in", () => {
  const printed = new Date("2026-11-05T10:00:00Z");
  const base = { id: "o1", channelId: "ch1", labelPrintedAt: printed };

  it("đơn chưa in qua Hubsell / đã quá 60 ngày / không có tệp", async () => {
    const f = fakeStore();
    expect(await loadSavedLabel(f.store, { ...base, labelPrintedAt: null }, NOW)).toEqual({ kind: "not-printed" });
    const old = new Date(NOW.getTime() - 61 * DAY);
    expect(await loadSavedLabel(f.store, { ...base, labelPrintedAt: old }, NOW)).toEqual({ kind: "expired" });
    expect(f.calls.get).toBe(0); // hai ca trên không hỏi kho
    expect(await loadSavedLabel(f.store, base, NOW)).toEqual({ kind: "missing" });
  });

  it("phiếu riêng: trả đúng tệp, kể cả khi tệp nằm ở thư mục ngày liền trước", async () => {
    const f = fakeStore();
    const pdf = await pdfWithPages(1);
    f.files.set("2026-11-04/ch1.o1.pdf", pdf); // chép 23:59 ngày 04, đánh dấu đã in 00:00 ngày 05
    const r = await loadSavedLabel(f.store, { ...base, labelPrintedAt: new Date("2026-11-05T00:00:03Z") }, NOW);
    expect(r).toMatchObject({ kind: "ok", wholeBatch: false, count: 1 });
    expect(r.kind === "ok" && r.pdf.equals(pdf)).toBe(true);
  });

  it("đơn trong tệp gộp: tách ĐÚNG trang của đơn khi số trang = số đơn", async () => {
    const f = fakeStore();
    const spool = new LabelArchiveSpool(f.store, FAST);
    spool.enqueue({
      now: printed,
      orders: [order("o1"), order("o2"), order("o3")],
      single: new Map(),
      combined: [{ orderIds: ["o1", "o2", "o3"], pdf: await pdfWithPages(3) }],
    });
    await spool.idle();
    for (const [id, width] of [
      ["o1", 100],
      ["o2", 101],
      ["o3", 102],
    ] as const) {
      const r = await loadSavedLabel(f.store, { ...base, id }, NOW);
      expect(r).toMatchObject({ kind: "ok", wholeBatch: false, count: 3 });
      expect(r.kind === "ok" ? await pageWidths(r.pdf) : []).toEqual([width]);
    }
  });

  it("tệp gộp có số trang KHÁC số đơn: trả cả tệp gộp, không đoán trang", async () => {
    const f = fakeStore();
    const spool = new LabelArchiveSpool(f.store, FAST);
    const batch = await pdfWithPages(5); // 3 đơn nhưng 5 trang (có đơn nhiều trang)
    spool.enqueue({
      now: printed,
      orders: [order("o1"), order("o2"), order("o3")],
      single: new Map(),
      combined: [{ orderIds: ["o1", "o2", "o3"], pdf: batch }],
    });
    await spool.idle();
    const r = await loadSavedLabel(f.store, { ...base, id: "o2" }, NOW);
    expect(r).toMatchObject({ kind: "ok", wholeBatch: true, count: 3 });
    expect(r.kind === "ok" && r.pdf.equals(batch)).toBe(true);
  });

  it("tệp chỉ đường trỏ sang tệp gộp của gian khác thì không trả", async () => {
    const f = fakeStore();
    f.files.set("2026-11-05/chKHAC.lo-aaaa.pdf", await pdfWithPages(2));
    f.files.set(
      "2026-11-05/ch1.o1.json",
      Buffer.from(JSON.stringify({ v: 1, batch: "2026-11-05/chKHAC.lo-aaaa.pdf", index: 0, count: 2 }))
    );
    expect(await loadSavedLabel(f.store, base, NOW)).toEqual({ kind: "missing" });
  });
});

describe("dọn sau 60 ngày", () => {
  it("chỉ xóa thư mục ngày đã hết hạn trọn ngày, không đụng thư mục lạ", async () => {
    const f = fakeStore();
    for (const p of [
      "2026-09-05/ch1.a.pdf",
      "2026-09-06/ch1.b.pdf",
      "2026-09-06/ch1.c.json",
      "2026-09-07/ch1.d.pdf", // còn tệp chưa đủ 60 ngày
      "2026-11-06/ch1.e.pdf",
      "ghi-chu/khong-phai-ngay.pdf",
    ]) {
      f.files.set(p, Buffer.from("x"));
    }
    const r = await purgeExpiredLabels(f.store, NOW, { pauseMs: 0 });
    expect(r).toEqual({ days: 2, files: 3, truncated: false });
    expect([...f.files.keys()].sort()).toEqual(["2026-09-07/ch1.d.pdf", "2026-11-06/ch1.e.pdf", "ghi-chu/khong-phai-ngay.pdf"]);
  });

  it("thư mục nhiều hơn một lô: xóa xong mới liệt kê tiếp; chạm trần lô thì dừng và báo còn dư", async () => {
    const f = fakeStore();
    for (let i = 0; i < 2500; i++) f.files.set(`2026-08-01/ch1.o${i}.pdf`, Buffer.from("x"));
    const partial = await purgeExpiredLabels(f.store, NOW, { pauseMs: 0, maxBatches: 2 });
    expect(partial).toEqual({ days: 0, files: 2000, truncated: true });
    expect(f.files.size).toBe(500);
    const rest = await purgeExpiredLabels(f.store, NOW, { pauseMs: 0 });
    expect(rest).toEqual({ days: 1, files: 500, truncated: false });
    expect(f.files.size).toBe(0);
  });

  it("kho rỗng: không làm gì, một lệnh liệt kê", async () => {
    const f = fakeStore();
    expect(await purgeExpiredLabels(f.store, NOW, { pauseMs: 0 })).toEqual({ days: 0, files: 0, truncated: false });
    expect(f.calls).toMatchObject({ list: 1, remove: 0 });
  });
});

describe("kho thư mục máy (chỉ khi phát triển)", () => {
  it("ghi nếu chưa có, đọc, liệt kê một cấp, xóa", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "label-archive-"));
    try {
      const store = createLocalLabelStore(root);
      expect(await store.get("2026-11-06/ch1.o1.pdf")).toBeNull();
      expect(await store.list("", 10)).toEqual([]);
      expect(await store.putIfAbsent("2026-11-06/ch1.o1.pdf", Buffer.from("a"), "application/pdf")).toBe("created");
      expect(await store.putIfAbsent("2026-11-06/ch1.o1.pdf", Buffer.from("b"), "application/pdf")).toBe("exists");
      expect((await store.get("2026-11-06/ch1.o1.pdf"))?.toString()).toBe("a");
      expect(await store.list("", 10)).toEqual([{ name: "2026-11-06", isFolder: true }]);
      expect(await store.list("2026-11-06", 10)).toEqual([{ name: "ch1.o1.pdf", isFolder: false }]);
      await store.remove(["2026-11-06/ch1.o1.pdf"]);
      expect(await store.list("", 10)).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("ai được thấy công tắc (chỗ gắn thu phí về sau)", () => {
  it("production chưa đặt env = chưa ai; '*' = mọi chủ shop; danh sách = đúng người", () => {
    vi.stubEnv("SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LABEL_ARCHIVE_OWNERS", "");
    expect(labelArchiveAllowed("u1")).toBe(false);
    vi.stubEnv("LABEL_ARCHIVE_OWNERS", "*");
    expect(labelArchiveAllowed("u1")).toBe(true);
    vi.stubEnv("LABEL_ARCHIVE_OWNERS", "u2, u3");
    expect(labelArchiveAllowed("u1")).toBe(false);
    expect(labelArchiveAllowed("u3")).toBe(true);
  });

  it("production không có kho tệp = tính năng tự ẩn dù env mở", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LABEL_ARCHIVE_OWNERS", "*");
    expect(labelArchiveAllowed("u1")).toBe(false);
  });
});
