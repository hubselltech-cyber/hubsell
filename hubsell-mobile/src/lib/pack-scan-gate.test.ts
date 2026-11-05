/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPANION_MS, NETWORK_RETRY_MS, PackScanGate, REARM_MS } from "./pack-scan-gate";

/**
 * Chạy (không cần RN): từ backend/
 *   npx tsx --test ../hubsell-mobile/src/lib/pack-scan-gate.test.ts
 *
 * Kịch bản mô phỏng camera: mỗi mã trong khung bắn một lượt đọc mỗi 100 ms.
 */

/** Giữ `codes` trong khung từ `from` tới `to` (ms), trả về các lượt được gửi máy chủ. */
function hold(
  gate: PackScanGate,
  codes: string[],
  from: number,
  to: number,
  onFire: (code: string, at: number) => void = () => {}
): string[] {
  const fired: string[] = [];
  for (let t = from; t < to; t += 100) {
    for (const c of codes) {
      if (gate.admit(c, t) === "fire") {
        fired.push(c);
        onFire(c, t);
      }
    }
  }
  return fired;
}

test("cùng một mã nằm trong khung 3 giây chỉ gửi máy chủ một lần", () => {
  const gate = new PackScanGate();
  const fired = hold(gate, ["VD1"], 0, 3000, (c) => gate.resolved(c));
  assert.deepEqual(fired, ["VD1"]);
});

test("đang gọi máy chủ thì mã đó chưa gửi lại; gọi xong vẫn không gửi lại khi còn trong khung", () => {
  const gate = new PackScanGate();
  assert.equal(gate.admit("VD1", 0), "fire");
  assert.equal(gate.admit("VD1", 100), "busy");
  gate.resolved("VD1");
  assert.equal(gate.admit("VD1", 200), "same");
});

test("mã đã xử lý rời khung đủ lâu rồi đưa vào lại → gửi lại (máy chủ sẽ báo đã quét rồi)", () => {
  const gate = new PackScanGate();
  hold(gate, ["VD1"], 0, 500, (c) => gate.resolved(c));
  // Thấy lần cuối ở 400; quay lại ngay trước mốc thì vẫn chặn.
  assert.equal(gate.admit("VD1", 400 + REARM_MS - 1), "same");
  // Lượt đọc trên đã làm mới mốc "thấy lần cuối" → phải vắng tiếp đủ REARM_MS.
  const back = 400 + REARM_MS - 1 + REARM_MS;
  assert.equal(gate.admit("VD1", back), "fire");
});

test("tem có hai mã vạch: mã thứ hai bị bỏ qua khi mã vận đơn còn trong khung", () => {
  const gate = new PackScanGate();
  const fired = hold(gate, ["VD1", "TUYEN-9"], 0, 2500, (c) => gate.resolved(c));
  assert.deepEqual(fired, ["VD1"]);
  assert.equal(gate.admit("TUYEN-9", 2500), "companion");
});

test("mã thứ hai của tem đọc được TRONG lúc đang gọi máy chủ cũng không lọt", () => {
  const gate = new PackScanGate();
  assert.equal(gate.admit("VD1", 0), "fire");
  assert.equal(gate.admit("TUYEN-9", 50), "busy"); // chưa biết VD1 có ra đơn không
  gate.resolved("VD1"); // máy chủ trả lời ở ~150 ms
  assert.equal(gate.admit("VD1", 200), "same");
  assert.equal(gate.admit("TUYEN-9", 250), "companion");
});

test("sang kiện kế: mã mới được nhận ngay khi mã cũ đã rời khung, không chờ màn báo tắt", () => {
  const gate = new PackScanGate();
  hold(gate, ["VD1"], 0, 500, (c) => gate.resolved(c)); // VD1 thấy lần cuối ở 400
  // Chưa đủ COMPANION_MS kể từ lần cuối thấy VD1 → còn coi là cùng tem.
  assert.equal(gate.admit("VD2", 400 + COMPANION_MS - 100), "companion");
  // Bị coi là cùng tem KHÔNG làm mã mới bị khóa: lượt đọc kế tiếp sau mốc là gửi.
  assert.equal(gate.admit("VD2", 400 + COMPANION_MS), "fire");
});

test("đọc trúng mã phân tuyến TRƯỚC (không ra đơn) thì mã vận đơn vẫn được gửi", () => {
  const gate = new PackScanGate();
  assert.equal(gate.admit("TUYEN-9", 0), "fire");
  gate.unknown("TUYEN-9"); // 404
  assert.equal(gate.admit("VD1", 100), "fire"); // mã không ra đơn không làm neo
  gate.resolved("VD1");
  // Từ đây cả hai còn trong khung đều im.
  assert.deepEqual(hold(gate, ["VD1", "TUYEN-9"], 200, 1500), []);
});

test("mã không ra đơn còn trong khung không kêu lại liên tục", () => {
  const gate = new PackScanGate();
  const fired = hold(gate, ["LA-1"], 0, 3000, (c) => gate.unknown(c));
  assert.deepEqual(fired, ["LA-1"]);
});

test("hỏng mạng: không dội lượt gọi liên tục, nhưng tự thử lại khi mã vẫn nằm trong khung", () => {
  const gate = new PackScanGate();
  assert.equal(gate.admit("VD1", 0), "fire");
  gate.networkFailed("VD1", 300);
  assert.equal(gate.admit("VD1", 400), "cooldown");
  assert.equal(gate.admit("VD1", 300 + NETWORK_RETRY_MS - 1), "cooldown");
  assert.equal(gate.admit("VD1", 300 + NETWORK_RETRY_MS), "fire");
});

test("hỏng mạng không làm neo: kiện kế vẫn quét được ngay", () => {
  const gate = new PackScanGate();
  assert.equal(gate.admit("VD1", 0), "fire");
  gate.networkFailed("VD1", 300);
  assert.equal(gate.admit("VD2", 350), "fire");
});

test("gõ tay: gửi được khi rảnh, bị giữ lại khi camera đang có lượt gọi", () => {
  const gate = new PackScanGate();
  assert.equal(gate.admitManual("1234"), true);
  assert.equal(gate.admit("VD1", 0), "busy");
  assert.equal(gate.admitManual("5678"), false);
  gate.unknown("1234");
  assert.equal(gate.admit("VD1", 100), "fire");
});

test("ca dài 1.000 kiện: mã cũ được dọn, kiện mới vẫn quét bình thường", () => {
  const gate = new PackScanGate();
  let t = 0;
  for (let i = 0; i < 1000; i++) {
    assert.equal(gate.admit(`VD${i}`, t), "fire", `kiện ${i}`);
    gate.resolved(`VD${i}`);
    t += 1500; // 1,5 giây một kiện
  }
});
