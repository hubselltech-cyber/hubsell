// Chạy: xem đầu tệp upload-queue.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";

import { planOverlay } from "../byte-overlay";
import { ClipFileBroken, ClipStore, type MetaBackend, type PieceBackend, type StoredClipMeta } from "../clip-store";
import type { ClipFile } from "../types";
import { createThrottle, queueNotice, RecordRateMeter, UploadSpeedMeter, type QueueSnapshot } from "../upload-speed";

// ---------- ghép tệp từ các lần ghi ----------

test("các lần ghi nối đuôi → mỗi mảnh một đoạn, không lỗ hổng", () => {
  const plan = planOverlay([
    { position: 0, length: 10 },
    { position: 10, length: 5 },
    { position: 15, length: 7 },
  ]);
  assert.equal(plan.totalBytes, 22);
  assert.deepEqual(plan.gaps, []);
  assert.deepEqual(plan.segments, [
    { piece: 0, offset: 0, length: 10 },
    { piece: 1, offset: 0, length: 5 },
    { piece: 2, offset: 0, length: 7 },
  ]);
});

test("ghi SAU đè ghi trước (bộ ghép quay lại sửa cỡ mdat ở đầu tệp)", () => {
  const plan = planOverlay([
    { position: 0, length: 100 },
    { position: 100, length: 50 },
    { position: 28, length: 8 }, // sửa 8 byte giữa mảnh đầu
    { position: 150, length: 20 }, // moov ở cuối
  ]);
  assert.equal(plan.totalBytes, 170);
  assert.deepEqual(plan.segments, [
    { piece: 0, offset: 0, length: 28 },
    { piece: 2, offset: 0, length: 8 },
    { piece: 0, offset: 36, length: 64 },
    { piece: 1, offset: 0, length: 50 },
    { piece: 3, offset: 0, length: 20 },
  ]);
});

test("ghi lại trọn một khúc, và phát hiện lỗ hổng", () => {
  const rewritten = planOverlay([
    { position: 0, length: 10 },
    { position: 0, length: 10 },
  ]);
  assert.deepEqual(rewritten.segments, [{ piece: 1, offset: 0, length: 10 }]);
  const holed = planOverlay([
    { position: 0, length: 10 },
    { position: 20, length: 5 },
  ]);
  assert.deepEqual(holed.gaps, [{ from: 10, to: 20 }]);
});

// ---------- kho clip với ổ đĩa giả ----------

class FakeDisk implements PieceBackend {
  files = new Map<string, Uint8Array>();
  /** Số byte ổ còn nhận; hết thì ném lỗi như ổ đầy thật. */
  freeBytes = Number.POSITIVE_INFINITY;
  settled: string[] = [];
  async writePiece(fileKey: string, name: string, data: Uint8Array): Promise<void> {
    if (data.byteLength > this.freeBytes) throw new DOMException("ổ đầy", "QuotaExceededError");
    this.freeBytes -= data.byteLength;
    this.files.set(`${fileKey}/${name}`, data.slice());
  }
  async readPiece(fileKey: string, name: string): Promise<Blob> {
    const data = this.files.get(`${fileKey}/${name}`);
    if (!data) throw new DOMException("không có", "NotFoundError");
    return new Blob([data as Uint8Array<ArrayBuffer>]);
  }
  async removeClip(fileKey: string): Promise<void> {
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${fileKey}/`)) {
        this.freeBytes += this.files.get(key)?.byteLength ?? 0;
        this.files.delete(key);
      }
    }
  }
  settle(fileKey: string): void {
    this.settled.push(fileKey);
  }
}

class FakeMeta implements MetaBackend {
  rows = new Map<string, StoredClipMeta>();
  async put(meta: StoredClipMeta): Promise<void> {
    this.rows.set(meta.localId, meta);
  }
  async delete(localId: string): Promise<void> {
    this.rows.delete(localId);
  }
  async has(localId: string): Promise<boolean> {
    return this.rows.has(localId);
  }
  async list(): Promise<StoredClipMeta[]> {
    return [...this.rows.values()];
  }
}

function makeStore(disk: FakeDisk | null, meta: FakeMeta | null) {
  const spills: unknown[] = [];
  let n = 0;
  const store = new ClipStore(disk, meta, { onSpill: (err) => spills.push(err), newKey: () => `clip${++n}` });
  return { store, spills };
}

const bytes = (length: number, fill: number) => new Uint8Array(length).fill(fill);

async function content(store: ClipStore, file: ClipFile): Promise<number[]> {
  return [...new Uint8Array(await (await store.blobOf(file)).arrayBuffer())];
}

function metaOf(file: ClipFile, localId: string, ownerKey: string, queuedAtMs = 0): StoredClipMeta {
  return {
    localId,
    clientId: `c-${localId}`,
    ownerKey,
    code: "SPX1",
    manual: false,
    kind: "PACK",
    startedAtIso: "2026-11-18T14:00:00.000Z",
    durationSec: 10,
    width: 1280,
    height: 720,
    deviceName: null,
    queuedAtMs,
    file,
  };
}

test("clip ghi xuống ổ theo mảnh, đọc lại đúng từng byte kể cả chỗ bị ghi đè", async () => {
  const disk = new FakeDisk();
  const { store, spills } = makeStore(disk, new FakeMeta());
  const sink = store.openSink();
  await sink.write({ type: "write", position: 0, data: bytes(6, 1) });
  await sink.write({ type: "write", position: 6, data: bytes(4, 2) });
  await sink.write({ type: "write", position: 2, data: bytes(2, 9) }); // sửa đầu tệp
  await sink.write({ type: "write", position: 10, data: bytes(3, 3) }); // moov cuối
  const file = sink.finish();
  assert.equal(file.sizeBytes, 13);
  assert.equal(file.durable, true);
  assert.equal(spills.length, 0);
  assert.equal(disk.files.size, 4); // mỗi lần ghi một mảnh đã đóng trên ổ
  assert.deepEqual(await content(store, file), [1, 1, 9, 9, 1, 1, 2, 2, 2, 2, 3, 3, 3]);
  await store.remove(file);
  assert.equal(disk.files.size, 0); // lên kho xong là ổ trống
});

test("Ổ ĐẦY giữa clip: clip vẫn quay nốt (phần sau nằm trong bộ nhớ), báo lên đúng một lần, tệp vẫn nguyên vẹn", async () => {
  const disk = new FakeDisk();
  disk.freeBytes = 10;
  const { store, spills } = makeStore(disk, new FakeMeta());
  const sink = store.openSink();
  await sink.write({ type: "write", position: 0, data: bytes(6, 1) }); // xuống ổ
  await sink.write({ type: "write", position: 6, data: bytes(6, 2) }); // ổ đầy → bộ nhớ, KHÔNG ném lỗi
  disk.freeBytes = 1_000; // ổ có chỗ lại giữa chừng: clip này vẫn ở bộ nhớ cho nhất quán
  await sink.write({ type: "write", position: 12, data: bytes(2, 3) });
  await sink.write({ type: "write", position: 1, data: bytes(1, 7) });
  const file = sink.finish();
  assert.equal(spills.length, 1);
  assert.equal((spills[0] as DOMException).name, "QuotaExceededError");
  assert.equal(sink.hasSpilled, true);
  assert.equal(file.durable, false);
  assert.deepEqual(
    file.pieces.map((p) => p.where),
    ["disk", "ram", "ram", "ram"]
  );
  assert.deepEqual(await content(store, file), [1, 7, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3]);
  // Clip không bền thì KHÔNG ghi sổ (tải lại trang là mất phần trong bộ nhớ — không được hứa là còn).
  assert.equal(await store.saveMeta(metaOf(file, "L1", "u1")), false);
});

test("trình duyệt không cho dùng ổ → kho trong bộ nhớ vẫn chạy, không coi là ổ đầy", async () => {
  const { store, spills } = makeStore(null, null);
  assert.equal(store.durable, false);
  const sink = store.openSink();
  await sink.write({ type: "write", position: 0, data: bytes(3, 5) });
  const file = sink.finish();
  assert.equal(spills.length, 0);
  assert.equal(file.durable, false);
  assert.deepEqual(await content(store, file), [5, 5, 5]);
  await store.remove(file);
  await assert.rejects(store.blobOf(file), ClipFileBroken);
});

test("sổ hàng chờ: chỉ trả clip của đúng tài khoản, cũ trước; ghi sổ xong mới nhả khóa đang ghi", async () => {
  const disk = new FakeDisk();
  const meta = new FakeMeta();
  const { store } = makeStore(disk, meta);
  const files: ClipFile[] = [];
  for (let i = 0; i < 3; i++) {
    const sink = store.openSink();
    await sink.write({ type: "write", position: 0, data: bytes(4, i) });
    files.push(sink.finish());
  }
  assert.deepEqual(disk.settled, []);
  assert.equal(await store.saveMeta(metaOf(files[0], "L-moi", "u1", 200)), true);
  assert.equal(await store.saveMeta(metaOf(files[1], "L-cu", "u1", 100)), true);
  assert.equal(await store.saveMeta(metaOf(files[2], "L-khac", "u2", 50)), true);
  assert.deepEqual(disk.settled, ["clip1", "clip2", "clip3"]);
  const { mine, othersCount } = await store.listMeta("u1");
  assert.deepEqual(
    mine.map((m) => m.localId),
    ["L-cu", "L-moi"]
  );
  assert.equal(othersCount, 1); // clip của tài khoản khác không bị gửi nhầm, chỉ đếm để báo
  assert.deepEqual([...(await store.knownFileKeys())].sort(), ["clip1", "clip2", "clip3"]);
  await store.deleteMeta("L-cu");
  assert.equal(await store.hasMeta("L-cu"), false);
  assert.equal(await store.hasMeta("L-moi"), true);
});

test("tệp chờ gửi bị mất / cụt trên ổ → báo hỏng rõ ràng, không gửi tệp sai", async () => {
  const disk = new FakeDisk();
  const { store } = makeStore(disk, new FakeMeta());
  const sink = store.openSink();
  await sink.write({ type: "write", position: 0, data: bytes(8, 1) });
  await sink.write({ type: "write", position: 8, data: bytes(8, 2) });
  const file = sink.finish();
  disk.files.set("clip1/000002", bytes(3, 2)); // mảnh bị cụt
  await assert.rejects(store.blobOf(file), ClipFileBroken);
  disk.files.delete("clip1/000002"); // mảnh bị xóa (người dùng xóa dữ liệu trình duyệt)
  await assert.rejects(store.blobOf(file), ClipFileBroken);
  await assert.rejects(store.blobOf({ ...file, sizeBytes: 99 }), ClipFileBroken); // sổ lệch cỡ
});

// ---------- đo tốc độ + câu báo ----------

const SNAP: QueueSnapshot = {
  online: true,
  waiting: 0,
  backlogBytes: 0,
  failures: 0,
  lastError: null,
  nextRetryAtMs: null,
  uploadBytesPerSec: null,
  recordBytesPerSec: null,
  disk: "ok",
};

test("tốc độ tải: cần đủ số liệu mới nói; cửa sổ trượt 20 giây", () => {
  const meter = new UploadSpeedMeter();
  assert.equal(meter.bytesPerSecond(0), null);
  meter.add(1_000, 0);
  meter.add(50_000, 1_000);
  assert.equal(meter.bytesPerSecond(1_000), null); // mới 1 giây
  meter.add(50_000, 2_000);
  meter.add(50_000, 4_000);
  assert.equal(meter.bytesPerSecond(4_000), 37_500); // 150.000 byte trong 4 giây (mẫu đầu chỉ là mốc)
  assert.equal(meter.bytesPerSecond(60_000), null); // lâu không gửi gì → không nói số cũ
  const rate = new RecordRateMeter();
  assert.equal(rate.bytesPerSecond(), null);
  rate.addClip(6_000_000, 60);
  assert.equal(rate.bytesPerSecond(), 100_000);
  rate.addClip(100, 0.2); // clip quá ngắn không tính
  assert.equal(rate.bytesPerSecond(), 100_000);
});

test("bình thường thì KHÔNG hiện dải nào; một clip đang gửi cũng không", () => {
  assert.equal(queueNotice(SNAP, 0), null);
  assert.equal(queueNotice({ ...SNAP, waiting: 1, uploadBytesPerSec: 10, recordBytesPerSec: 100_000 }, 0), null);
  assert.equal(queueNotice({ ...SNAP, waiting: 3, failures: 1, lastError: "x" }, 0), null); // một lần chập rồi qua
});

test("mạng chậm hơn tốc độ quay → dải vàng có số clip chờ và ước thời gian", () => {
  const notice = queueNotice(
    { ...SNAP, waiting: 4, backlogBytes: 24_000_000, uploadBytesPerSec: 50_000, recordBytesPerSec: 125_000 },
    0
  );
  assert.equal(notice?.kind, "slow");
  assert.equal(notice?.tone, "amber");
  assert.match(notice?.text ?? "", /^Mạng tải lên chậm hơn tốc độ quay — đang chờ 4 video \(≈ 8 phút\)/);
  // Mạng nhanh hơn tốc độ quay thì hàng chờ đang ngắn lại → không báo.
  assert.equal(queueNotice({ ...SNAP, waiting: 4, uploadBytesPerSec: 500_000, recordBytesPerSec: 125_000 }, 0), null);
});

test("thứ tự ưu tiên: ổ đầy > mất mạng > chưa gửi được > mạng chậm > ổ sắp đầy", () => {
  const worst: QueueSnapshot = {
    online: false,
    waiting: 5,
    backlogBytes: 1,
    failures: 9,
    lastError: "mất mạng",
    nextRetryAtMs: 30_000,
    uploadBytesPerSec: 1,
    recordBytesPerSec: 2,
    disk: "full",
  };
  assert.equal(queueNotice(worst, 0)?.kind, "disk-full");
  assert.equal(queueNotice(worst, 0)?.tone, "rose");
  assert.equal(queueNotice({ ...worst, disk: "low" }, 0)?.kind, "offline");
  const retrying = queueNotice({ ...worst, disk: "low", online: true }, 12_000);
  assert.equal(retrying?.kind, "retrying");
  assert.match(retrying?.text ?? "", /5 video đang chờ, tự thử lại sau 18 giây/);
  assert.equal(retrying?.canRetryNow, true);
  assert.equal(queueNotice({ ...worst, disk: "low", online: true, failures: 0 }, 0)?.kind, "slow");
  assert.equal(queueNotice({ ...SNAP, disk: "low" }, 0)?.kind, "disk-low");
  assert.equal(queueNotice({ ...SNAP, online: false }, 0)?.kind, "offline"); // mất mạng báo cả khi chưa có clip chờ
  assert.equal(queueNotice({ ...SNAP, disk: "memory" }, 0), null);
  assert.equal(queueNotice({ ...SNAP, disk: "memory", waiting: 1 }, 0)?.kind, "memory");
});

test("gộp làm mới: lần đầu chạy ngay, trong 30 giây chỉ thêm đúng một lần ở cuối khoảng", () => {
  let now = 0;
  let runs = 0;
  const timers: { at: number; run: () => void }[] = [];
  const throttle = createThrottle(() => runs++, 30_000, {
    now: () => now,
    setTimer: (run, ms) => timers.push({ at: now + ms, run }),
    clearTimer: () => timers.splice(0),
  });
  throttle.call();
  assert.equal(runs, 1);
  for (let i = 1; i <= 20; i++) {
    now = i * 1_000;
    throttle.call(); // 20 video lên kho dồn dập
  }
  assert.equal(runs, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].at, 30_000);
  now = 30_000;
  timers.shift()?.run();
  assert.equal(runs, 2);
  now = 100_000;
  throttle.call(); // đã quá 30 giây → chạy ngay
  assert.equal(runs, 3);
});
