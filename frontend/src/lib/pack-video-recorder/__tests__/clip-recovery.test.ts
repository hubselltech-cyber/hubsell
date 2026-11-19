// Chạy: xem đầu tệp upload-queue.test.ts.
// CỨU CLIP ĐANG QUAY DỞ (lát M1b, 19/11/2026): sổ khung hình ghi kèm lúc quay + kế hoạch ghép lại — phần thuần.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RECOVERY_HEAD_NAME,
  createPieceReader,
  encodeRecoveryHead,
  findDataStart,
  fromBase64,
  isRecoveryIndexName,
  isValidAvccSample,
  parseRecoveryHead,
  parseRecoveryIndex,
  planRecovery,
  toBase64,
  type RecoveryIndexFile,
  type RecoveryOwnerInfo,
} from "../clip-recovery";
import { ClipStore, type MetaBackend, type PieceBackend, type StoredClipMeta } from "../clip-store";
import type { RecoveryHead } from "../types";

// ---------- dữ liệu giả ----------

/** Một khung H.264 dạng AVCC gồm các khối có cỡ cho trước; byte đầu mỗi khối là kiểu khối hợp lệ. */
function avcc(unitSizes: number[], fill: number): Uint8Array {
  const total = unitSizes.reduce((sum, n) => sum + 4 + n, 0);
  const out = new Uint8Array(total).fill(fill & 0x7f);
  let at = 0;
  for (const n of unitSizes) {
    new DataView(out.buffer).setUint32(at, n);
    out[at + 4] = 0x65;
    at += 4 + n;
  }
  return out;
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

class FakeDisk implements PieceBackend {
  files = new Map<string, Uint8Array>();
  /** Tên tệp bắt đầu bằng chuỗi này thì ghi hỏng (giả ổ đầy riêng cho sổ cứu clip). */
  failPrefix: string | null = null;
  async writePiece(fileKey: string, name: string, data: Uint8Array): Promise<void> {
    if (this.failPrefix && name.startsWith(this.failPrefix)) throw new DOMException("ổ đầy", "QuotaExceededError");
    this.files.set(`${fileKey}/${name}`, data.slice());
  }
  async readPiece(fileKey: string, name: string): Promise<Blob> {
    const data = this.files.get(`${fileKey}/${name}`);
    if (!data) throw new DOMException("không có", "NotFoundError");
    return new Blob([data as Uint8Array<ArrayBuffer>]);
  }
  async removeClip(fileKey: string): Promise<void> {
    for (const key of [...this.files.keys()]) if (key.startsWith(`${fileKey}/`)) this.files.delete(key);
  }
  async listPieces(fileKey: string): Promise<string[]> {
    return [...this.files.keys()].filter((k) => k.startsWith(`${fileKey}/`)).map((k) => k.slice(fileKey.length + 1));
  }
  async removePiece(fileKey: string, name: string): Promise<void> {
    this.files.delete(`${fileKey}/${name}`);
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

const OWNER: RecoveryOwnerInfo = { ownerKey: "shop-1", deviceName: "Web Camera", kind: "PACK" };

function headOf(firstSample: Uint8Array): RecoveryHead {
  return {
    code: "SPXVN06316825343B",
    manual: false,
    startedAtIso: "2026-11-19T07:00:00.000Z",
    width: 1280,
    height: 720,
    codec: "avc1.64001f",
    description: new Uint8Array([1, 100, 0, 31, 255]),
    firstBytes: firstSample.slice(0, 32),
  };
}

const text = (data: Uint8Array) => new TextDecoder().decode(data);

// ---------- đọc / ghi sổ ----------

test("base64 đi về đúng từng byte, kể cả byte 0 và 255", () => {
  const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
  assert.deepEqual([...fromBase64(toBase64(bytes))], [...bytes]);
});

test("rec-head: ghi rồi đọc lại đủ trường; tệp cụt / thiếu trường → null (không cứu bừa)", () => {
  const sample = avcc([40], 7);
  const encoded = text(encodeRecoveryHead(headOf(sample), OWNER));
  const head = parseRecoveryHead(encoded);
  assert.ok(head);
  assert.equal(head.ownerKey, "shop-1");
  assert.equal(head.code, "SPXVN06316825343B");
  assert.equal(head.kind, "PACK");
  assert.deepEqual([...fromBase64(head.firstBytesB64)], [...sample.slice(0, 32)]);
  assert.deepEqual([...fromBase64(head.descriptionB64 ?? "")], [1, 100, 0, 31, 255]);
  assert.equal(parseRecoveryHead(encoded.slice(0, encoded.length - 9)), null, "tệp ghi dở");
  assert.equal(parseRecoveryHead(JSON.stringify({ ...JSON.parse(encoded), ownerKey: "" })), null, "thiếu tài khoản");
  assert.equal(parseRecoveryHead(JSON.stringify({ ...JSON.parse(encoded), v: 2 })), null, "bản sổ lạ");
  assert.equal(parseRecoveryHead("không phải json"), null);
});

test("bản ghi sổ: đọc được bản đúng; mảnh cỡ 0, khung cỡ 0, JSON cụt → null", () => {
  const good: RecoveryIndexFile = {
    v: 1,
    kind: "UNBOX",
    piece: { name: "000001", position: 0, length: 100 },
    samples: [
      [44, 0, 33_333, 1],
      [20, 33_333, 33_333, 0],
    ],
  };
  assert.deepEqual(parseRecoveryIndex(JSON.stringify(good)), good);
  assert.equal(parseRecoveryIndex(JSON.stringify({ ...good, piece: { ...good.piece, length: 0 } })), null);
  assert.equal(parseRecoveryIndex(JSON.stringify({ ...good, samples: [[0, 0, 1, 1]] })), null);
  assert.equal(parseRecoveryIndex(JSON.stringify(good).slice(0, 30)), null);
  assert.ok(isRecoveryIndexName("rec-000012"));
  assert.ok(!isRecoveryIndexName(RECOVERY_HEAD_NAME));
  assert.ok(!isRecoveryIndexName("000012"));
});

// ---------- soát khung + tìm chỗ bắt đầu ----------

test("khung H.264 đúng cấu trúc thì nhận; đọc lệch một byte / cụt / cỡ khối 0 thì từ chối", () => {
  const frame = avcc([30, 12], 5);
  assert.ok(isValidAvccSample(frame));
  assert.ok(!isValidAvccSample(frame.subarray(1)), "lệch một byte");
  assert.ok(!isValidAvccSample(frame.subarray(0, frame.length - 1)), "cụt một byte");
  assert.ok(!isValidAvccSample(new Uint8Array(8)), "cỡ khối 0");
  assert.ok(!isValidAvccSample(new Uint8Array(0)));
  const forbidden = avcc([10], 5);
  forbidden[4] = 0xe5; // bit cấm = 1
  assert.ok(!isValidAvccSample(forbidden));
});

test("tìm chỗ bắt đầu dữ liệu bằng vài byte đầu của khung đầu — không phụ thuộc cỡ phần đầu tệp", () => {
  const frame = avcc([60], 9);
  const needle = frame.slice(0, 32);
  for (const headerBytes of [24, 40, 48, 1000]) {
    const file = concat([new Uint8Array(headerBytes).fill(0xaa), frame]);
    assert.equal(findDataStart(file, needle), headerBytes);
  }
  assert.equal(findDataStart(new Uint8Array(500).fill(0xaa), needle), -1);
  assert.equal(findDataStart(concat([new Uint8Array(5000).fill(0xaa), frame]), needle), -1, "chỉ tìm ở đầu tệp");
});

// ---------- kế hoạch cứu ----------

const idx = (name: string, position: number, length: number, samples: RecoveryIndexFile["samples"]): RecoveryIndexFile => ({
  v: 1,
  kind: "PACK",
  piece: { name, position, length },
  samples,
});

test("chỉ lấy khung nằm TRỌN trong phần đã ghi xuống ổ; khung vắt ra ngoài thì dừng", () => {
  // Đầu tệp 40 byte; mỗi khung 30 byte; trên ổ có 2 mảnh × 100 byte = 200 byte.
  const plan = planRecovery(
    [
      idx("000001", 0, 100, [
        [30, 0, 10, 1],
        [30, 10, 10, 0],
        [30, 20, 10, 0], // 100..130: vắt sang mảnh 2 (đã ghi) → vẫn lấy
      ]),
      idx("000002", 100, 100, [
        [30, 30, 10, 0], // 130..160
        [30, 40, 10, 0], // 160..190
        [30, 50, 10, 0], // 190..220: thò ra ngoài 200 → dừng
        [30, 60, 10, 0],
      ]),
    ],
    40
  );
  assert.equal(plan.coveredBytes, 200);
  assert.deepEqual(
    plan.samples.map((s) => [s.offset, s.timestampUs, s.key]),
    [
      [40, 0, true],
      [70, 10, false],
      [100, 20, false],
      [130, 30, false],
      [160, 40, false],
    ]
  );
});

test("khung đầu không phải khung khóa → không cứu; mốc giờ không tăng → dừng; loại video lấy bản ghi SAU CÙNG", () => {
  assert.deepEqual(planRecovery([idx("000001", 0, 500, [[30, 0, 10, 0]])], 40).samples, []);
  const stalled = planRecovery(
    [
      idx("000001", 0, 500, [
        [30, 0, 10, 1],
        [30, 10, 10, 0],
        [30, 10, 10, 0],
        [30, 30, 10, 0],
      ]),
    ],
    40
  );
  assert.equal(stalled.samples.length, 2);
  const relabeled = planRecovery(
    [idx("000001", 0, 100, [[30, 0, 10, 1]]), { ...idx("000002", 100, 100, []), kind: "UNBOX" }],
    40
  );
  assert.equal(relabeled.kind, "UNBOX");
  assert.equal(planRecovery([], 40).kind, null);
});

test("mảnh bị thiếu ở giữa → chỉ tính phần liền từ đầu tệp", () => {
  const plan = planRecovery(
    [idx("000001", 0, 100, [[30, 0, 10, 1]]), idx("000003", 200, 100, [[150, 10, 10, 0]])],
    40
  );
  assert.equal(plan.coveredBytes, 100);
  assert.equal(plan.samples.length, 1);
});

test("trình đọc mảnh: khung vắt qua hai mảnh được nối đúng; đọc quá phần đã ghi thì báo lỗi", async () => {
  const whole = Uint8Array.from({ length: 250 }, (_, i) => i % 251);
  const pieces = [
    { name: "000001", position: 0, length: 100 },
    { name: "000002", position: 100, length: 100 },
    { name: "000003", position: 200, length: 50 },
  ];
  let loads = 0;
  const read = createPieceReader(pieces, async (name) => {
    loads++;
    const p = pieces.find((x) => x.name === name);
    assert.ok(p);
    return whole.slice(p.position, p.position + p.length);
  });
  assert.deepEqual([...(await read(90, 30))], [...whole.slice(90, 120)]);
  assert.deepEqual([...(await read(120, 20))], [...whole.slice(120, 140)]);
  assert.equal(loads, 2, "mảnh đang giữ trong bộ nhớ không đọc lại");
  assert.deepEqual([...(await read(195, 55))], [...whole.slice(195, 250)]);
  await assert.rejects(read(240, 20));
});

// ---------- kho clip ghi sổ cứu trong lúc quay ----------

function makeStore(disk: FakeDisk, meta: FakeMeta, info: RecoveryOwnerInfo | null) {
  let n = 0;
  return new ClipStore(disk, meta, { onSpill: () => {}, newKey: () => `clip${++n}`, recoveryInfo: () => info });
}

test("trang sập giữa clip: từ các tệp CÒN TRÊN Ổ dựng lại đúng từng khung đã ghi, bỏ phần còn trong bộ nhớ", async () => {
  const disk = new FakeDisk();
  const store = makeStore(disk, new FakeMeta(), OWNER);
  const sink = store.openSink();
  // Tệp dở = 40 byte đầu tệp + 6 khung; bộ ghép đưa ra từng khúc 100 byte, khúc cuối CHƯA kịp ghi (sập).
  const frames = [avcc([56], 1), avcc([26], 2), avcc([40, 10], 3), avcc([36], 4), avcc([50], 5), avcc([30], 6)];
  const file = concat([new Uint8Array(40).fill(0xaa), ...frames]);
  sink.recoveryBegin(headOf(frames[0]));
  let ts = 0;
  let fed = 0;
  const feedUntil = (bytes: number) => {
    // Bộ ghép nhận khung trước, rồi mới đẩy khúc chứa chúng xuống ổ.
    let end = 40 + frames.slice(0, fed).reduce((sum, f) => sum + f.length, 0);
    while (fed < frames.length && end < bytes) {
      sink.recoverySample(frames[fed].length, ts, 33_333, fed === 0);
      ts += 33_333;
      end += frames[fed].length;
      fed++;
    }
  };
  feedUntil(100);
  await sink.write({ type: "write", position: 0, data: file.slice(0, 100) });
  feedUntil(200);
  await sink.write({ type: "write", position: 100, data: file.slice(100, 200) });
  // ----- sập ở đây: phần file[200..] và các khung chưa ghi sổ nằm trong bộ nhớ, mất -----

  const names = (await store.listFiles(sink.fileKey)).sort();
  assert.deepEqual(names, ["000001", "000002", "rec-000001", "rec-000002", RECOVERY_HEAD_NAME]);
  const head = parseRecoveryHead(text(await store.readFile(sink.fileKey, RECOVERY_HEAD_NAME)));
  assert.ok(head);
  const indexes: RecoveryIndexFile[] = [];
  for (const name of names.filter(isRecoveryIndexName)) {
    const index = parseRecoveryIndex(text(await store.readFile(sink.fileKey, name)));
    assert.ok(index);
    indexes.push(index);
  }
  const dataStart = findDataStart(await store.readFile(sink.fileKey, "000001"), fromBase64(head.firstBytesB64));
  assert.equal(dataStart, 40);
  const plan = planRecovery(indexes, dataStart);
  const read = createPieceReader(plan.pieces, (name) => store.readFile(sink.fileKey, name));
  // Khung 1–3 kết thúc ở byte 220 > 200 → chỉ khung 1, 2 nằm trọn (40..100, 100..130); khung 3 (130..192) cũng trọn.
  const expected = frames.filter((_, i) => 40 + frames.slice(0, i + 1).reduce((sum, f) => sum + f.length, 0) <= 200);
  assert.equal(plan.samples.length, expected.length);
  assert.ok(expected.length >= 2 && expected.length < frames.length, "phải cứu được một phần, không phải tất cả");
  for (let i = 0; i < plan.samples.length; i++) {
    const data = await read(plan.samples[i].offset, plan.samples[i].size);
    assert.deepEqual([...data], [...expected[i]]);
    assert.ok(isValidAvccSample(data));
  }
  assert.equal(plan.samples[0].key, true);
});

test("chưa đăng nhập (không biết tài khoản) → KHÔNG ghi sổ cứu; video vẫn ghi bình thường", async () => {
  const disk = new FakeDisk();
  const store = makeStore(disk, new FakeMeta(), null);
  const sink = store.openSink();
  sink.recoveryBegin(headOf(avcc([40], 1)));
  sink.recoverySample(44, 0, 33_333, true);
  await sink.write({ type: "write", position: 0, data: new Uint8Array(100) });
  assert.deepEqual(await store.listFiles(sink.fileKey), ["000001"]);
});

test("sổ cứu ghi hỏng (ổ sắp đầy) → thôi ghi sổ, KHÔNG làm hỏng video và không báo ổ đầy", async () => {
  const disk = new FakeDisk();
  disk.failPrefix = "rec-0";
  let spills = 0;
  const store = new ClipStore(disk, new FakeMeta(), { onSpill: () => spills++, newKey: () => "clip1", recoveryInfo: () => OWNER });
  const sink = store.openSink();
  sink.recoveryBegin(headOf(avcc([40], 1)));
  sink.recoverySample(44, 0, 33_333, true);
  await sink.write({ type: "write", position: 0, data: new Uint8Array(100).fill(1) });
  await sink.write({ type: "write", position: 100, data: new Uint8Array(100).fill(2) });
  const file = sink.finish();
  assert.equal(spills, 0);
  assert.equal(file.durable, true);
  assert.equal(file.sizeBytes, 200);
  assert.deepEqual((await store.listFiles(sink.fileKey)).sort(), ["000001", "000002", RECOVERY_HEAD_NAME]);
});

test("clip quay XONG và đã có dòng sổ hàng chờ → gỡ rec-head (không bao giờ bị cứu nhầm rồi gửi trùng)", async () => {
  const disk = new FakeDisk();
  const meta = new FakeMeta();
  const store = makeStore(disk, meta, OWNER);
  const sink = store.openSink();
  sink.recoveryBegin(headOf(avcc([40], 1)));
  await sink.write({ type: "write", position: 0, data: new Uint8Array(100) });
  const file = sink.finish();
  assert.ok((await store.listFiles(file.fileKey)).includes(RECOVERY_HEAD_NAME));
  const saved = await store.saveMeta({
    localId: "a",
    clientId: "c-a",
    ownerKey: "shop-1",
    code: "SPX1",
    manual: false,
    kind: "PACK",
    startedAtIso: "2026-11-19T07:00:00.000Z",
    durationSec: 10,
    width: 1280,
    height: 720,
    deviceName: null,
    queuedAtMs: 0,
    file,
  });
  assert.equal(saved, true);
  assert.ok(!(await store.listFiles(file.fileKey)).includes(RECOVERY_HEAD_NAME));
  // Tệp gửi đi chỉ gồm các mảnh video, không lẫn sổ cứu clip.
  assert.equal((await store.blobOf(file)).size, 100);
});

test("tệp ghép lại từ clip vừa cứu KHÔNG ghi sổ cứu (recoverable: false)", async () => {
  const disk = new FakeDisk();
  const store = makeStore(disk, new FakeMeta(), OWNER);
  const sink = store.openSink({ recoverable: false });
  sink.recoveryBegin(headOf(avcc([40], 1)));
  await sink.write({ type: "write", position: 0, data: new Uint8Array(100) });
  assert.deepEqual(await store.listFiles(sink.fileKey), ["000001"]);
});
