// Chạy: từ `backend/` → `npx tsx --test ../hubsell-mobile/src/lib/pack-video-queue-record.test.ts`
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clipFileName,
  decodeRecord,
  encodeRecord,
  isClientId,
  recordFileName,
  recordsToResume,
  type QueueRecord,
} from "./pack-video-queue-record";

const rec = (patch: Partial<QueueRecord> = {}): QueueRecord => ({
  v: 1,
  clientId: "mabc123xyz9",
  ownerId: "user-1",
  fileName: "mabc123xyz9.mp4",
  absPath: null,
  trackingCode: "SPXVN06316825343B",
  kind: "PACK",
  recordedAt: "2026-11-20T07:00:00.000Z",
  durationSec: 42.4,
  width: 768,
  height: 1024,
  deviceName: "iPhone 15",
  ticket: null,
  partSize: null,
  ...patch,
});

test("ghi rồi đọc lại ra đúng dòng sổ", () => {
  assert.deepEqual(decodeRecord(encodeRecord(rec())), rec());
  const unbox = rec({ kind: "UNBOX", width: null, height: null, deviceName: null, ownerId: null });
  assert.deepEqual(decodeRecord(encodeRecord(unbox)), unbox);
});

test("vé tải lên (đường v2): giữ được qua ghi / đọc; dòng sổ của bản app trước không có vé vẫn đọc được", () => {
  const single = rec({ ticket: "eyJhbGciOi.vé-một-lượt.chữ-ký" });
  assert.deepEqual(decodeRecord(encodeRecord(single)), single);
  const multi = rec({ ticket: "eyJhbGciOi.vé-theo-mảnh.chữ-ký", partSize: 8 * 1024 * 1024 });
  assert.deepEqual(decodeRecord(encodeRecord(multi)), multi);

  // Sổ ghi bởi bản app trước M2.4: không có hai trường vé.
  const { ticket: _t, partSize: _p, ...old } = rec();
  assert.deepEqual(decodeRecord(JSON.stringify(old)), rec());
});

test("vé hỏng / lạ không làm mất clip: bỏ vé, dòng sổ vẫn dùng được (clip bắt đầu lại từ bước xin vé)", () => {
  for (const bad of [123, "", "x".repeat(4001), { a: 1 }]) {
    const got = decodeRecord(JSON.stringify({ ...rec(), ticket: bad, partSize: 8388608 }));
    assert.deepEqual(got, rec(), `vé ${JSON.stringify(bad).slice(0, 20)}`);
  }
  // Cỡ mảnh chỉ có nghĩa khi có vé; cỡ mảnh rác thì coi như tải một lượt.
  assert.equal(decodeRecord(JSON.stringify({ ...rec(), ticket: null, partSize: 8388608 }))?.partSize, null);
  assert.equal(decodeRecord(JSON.stringify({ ...rec(), ticket: "abc.def.ghi", partSize: -5 }))?.partSize, null);
});

test("tệp sổ ghi dở / hỏng / rỗng → bỏ qua (null), không ném lỗi", () => {
  assert.equal(decodeRecord(""), null);
  assert.equal(decodeRecord("{"), null);
  assert.equal(decodeRecord(encodeRecord(rec()).slice(0, 40)), null);
  assert.equal(decodeRecord("null"), null);
  assert.equal(decodeRecord("[]"), null);
});

test("thiếu trường / sai kiểu → null", () => {
  const broken = (patch: Record<string, unknown>) => decodeRecord(JSON.stringify({ ...rec(), ...patch }));
  assert.equal(broken({ v: 2 }), null);
  assert.equal(broken({ trackingCode: "" }), null);
  assert.equal(broken({ kind: "OTHER" }), null);
  assert.equal(broken({ recordedAt: "hôm qua" }), null);
  assert.equal(broken({ durationSec: "42" }), null);
  assert.equal(broken({ durationSec: -1 }), null);
  assert.equal(broken({ width: 0 }), null);
  assert.equal(broken({ ownerId: 7 }), null);
});

test("tên tệp clip phải là tệp của chính dòng sổ — không nhận đường dẫn trỏ ra ngoài thư mục hàng chờ", () => {
  assert.equal(decodeRecord(JSON.stringify({ ...rec(), fileName: "../../khac.mp4" })), null);
  assert.equal(decodeRecord(JSON.stringify({ ...rec(), fileName: "mkhac000000.mp4" })), null);
  assert.equal(decodeRecord(JSON.stringify({ ...rec(), clientId: "../x" })), null);
  assert.equal(decodeRecord(JSON.stringify({ ...rec(), clientId: "ABC DEF" })), null);
});

test("không dời được tệp vào thư mục hàng chờ: dùng đường dẫn gốc; thiếu cả hai thì bỏ", () => {
  const outside = rec({ fileName: null, absPath: "/storage/emulated/0/Android/data/x/files/thu/clip-1.mp4" });
  assert.deepEqual(decodeRecord(encodeRecord(outside)), outside);
  assert.equal(decodeRecord(encodeRecord(rec({ fileName: null, absPath: null }))), null);
});

test("tên tệp sổ và tệp clip đi theo clientId", () => {
  assert.equal(recordFileName("mabc123xyz9"), "mabc123xyz9.json");
  assert.equal(clipFileName("mabc123xyz9"), "mabc123xyz9.mp4");
  assert.equal(isClientId("mabc123xyz9"), true);
  assert.equal(isClientId("m1"), false);
  assert.equal(isClientId(null), false);
});

test("gửi tiếp: chỉ clip của tài khoản đang đăng nhập, chưa nằm trong hàng, clip cũ trước", () => {
  const a = rec({ clientId: "maaaaaaaaa1", fileName: "maaaaaaaaa1.mp4", recordedAt: "2026-11-20T07:05:00.000Z" });
  const b = rec({ clientId: "mbbbbbbbbb2", fileName: "mbbbbbbbbb2.mp4", recordedAt: "2026-11-20T07:01:00.000Z" });
  const other = rec({ clientId: "mccccccccc3", fileName: "mccccccccc3.mp4", ownerId: "user-2" });
  const loaded = rec({ clientId: "mddddddddd4", fileName: "mddddddddd4.mp4" });
  const out = recordsToResume([a, b, other, loaded], "user-1", new Set(["mddddddddd4"]));
  assert.deepEqual(
    out.map((r) => r.clientId),
    ["mbbbbbbbbb2", "maaaaaaaaa1"]
  );
});

test("chưa đăng nhập thì KHÔNG gửi clip của tài khoản nào; đăng nhập tài khoản khác thì clip nằm chờ", () => {
  assert.deepEqual(recordsToResume([rec()], null, new Set()), []);
  assert.deepEqual(recordsToResume([rec()], "user-2", new Set()), []);
  // Bản thử không đăng nhập (ownerId null) chỉ gửi clip quay lúc không đăng nhập.
  const anon = rec({ ownerId: null });
  assert.deepEqual(recordsToResume([anon, rec()], null, new Set()), [anon]);
});
