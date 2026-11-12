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

// ───────── 12/11/2026 — anh Trung thử máy thật: quét lần hai vào cùng một đơn thì "đơ",
// đơn hủy quét lần hai còn báo "không thấy đơn". Các ca dưới mô phỏng CÓ ĐỘ TRỄ máy chủ
// (lượt gọi mất 200 ms) — bản cũ chỉ test với máy chủ trả lời tức thì nên không lộ. ─────────

/**
 * Giữ `codes` trong khung từ `from` tới `to`, máy chủ trả lời sau `latency` ms:
 * `server(code)` = id đơn, hoặc null khi không ra đơn (404). Trả về các mã đã gửi.
 */
function present(
  gate: PackScanGate,
  codes: string[],
  from: number,
  to: number,
  server: (code: string) => string | null,
  latency = 200
): string[] {
  const fired: string[] = [];
  const pending: { at: number; code: string }[] = [];
  for (let t = from; t < to; t += 100) {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].at <= t) {
        const { code } = pending.splice(i, 1)[0];
        const orderId = server(code);
        if (orderId) gate.resolved(code, orderId);
        else gate.unknown(code);
      }
    }
    for (const c of codes) {
      if (gate.admit(c, t) === "fire") {
        fired.push(c);
        pending.push({ at: t + latency, code: c });
      }
    }
  }
  for (const p of pending) {
    const orderId = server(p.code);
    if (orderId) gate.resolved(p.code, orderId);
    else gate.unknown(p.code);
  }
  return fired;
}

const TEM = (code: string) => (code === "VD1" || code === "MADON1" ? "don-1" : null);

test("quét LẠI kiện: mã phân tuyến đọc trước, mã vận đơn vẫn phải tới máy chủ (không báo 'không thấy đơn' oan)", () => {
  const gate = new PackScanGate();
  present(gate, ["TUYEN-9", "VD1"], 0, 1000, TEM);
  // Cất kiện đi 4 giây rồi đưa lại — camera đọc mã phân tuyến trước.
  const again = present(gate, ["TUYEN-9", "VD1"], 5000, 7000, TEM);
  assert.deepEqual(again, ["VD1"]);
});

test("đưa lại kiện đúng lúc đang có lượt gọi khác: mã không bị khóa 'đã xử lý' oan", () => {
  const gate = new PackScanGate();
  assert.equal(gate.admit("VD1", 0), "fire");
  gate.resolved("VD1", "don-1");
  // 5 giây sau: đang gõ tay một mã khác thì đưa lại kiện VD1.
  assert.equal(gate.admitManual("GO-TAY"), true);
  assert.equal(gate.admit("VD1", 5000), "busy");
  assert.equal(gate.admit("VD1", 5100), "busy");
  gate.unknown("GO-TAY");
  assert.equal(gate.admit("VD1", 5200), "fire"); // bản cũ: "same" mãi → màn hình đơ
});

test("tem hai mã vạch CÙNG ra một đơn: mỗi lần đưa kiện vào chỉ gửi một mã, lần nào cũng gửi", () => {
  const gate = new PackScanGate();
  assert.deepEqual(present(gate, ["VD1", "MADON1"], 0, 1500, TEM), ["VD1", "MADON1"].slice(0, 1));
  // Lần hai, lần ba: vẫn đúng một lượt gọi mỗi lần, không khóa chéo nhau.
  assert.equal(present(gate, ["MADON1", "VD1"], 5000, 6500, TEM).length, 1);
  assert.equal(present(gate, ["VD1", "MADON1"], 10000, 11500, TEM).length, 1);
});

test("hai mã của cùng đơn đưa lại đúng lúc máy chủ đang bận: không khóa chéo nhau", () => {
  const gate = new PackScanGate();
  for (const c of ["VD1", "MADON1"]) {
    assert.equal(gate.admitManual(c), true);
    gate.resolved(c, "don-1");
  }
  assert.equal(gate.admitManual("GO-TAY"), true);
  for (let t = 5000; t < 5300; t += 100) {
    assert.notEqual(gate.admit("VD1", t), "fire");
    assert.notEqual(gate.admit("MADON1", t), "fire");
  }
  gate.unknown("GO-TAY");
  const fired = present(gate, ["VD1", "MADON1"], 5300, 6500, TEM);
  assert.equal(fired.length, 1);
});

test("tem chỉ còn đọc được mã không ra đơn: đưa lại vẫn được hỏi máy chủ (chậm hơn một nhịp)", () => {
  const gate = new PackScanGate();
  assert.deepEqual(present(gate, ["LA-1"], 0, 1000, TEM), ["LA-1"]);
  assert.equal(gate.admit("LA-1", 5000), "hold");
  assert.equal(gate.admit("LA-1", 5000 + COMPANION_MS), "fire");
});

test("resolved: lần đầu của đơn → first; mã vạch khác khi tem còn trong khung → alias (im)", () => {
  const gate = new PackScanGate();
  assert.equal(gate.admit("VD1", 0), "fire");
  assert.equal(gate.resolved("VD1", "don-1", 200), "first");
  // VD1 khuất 700 ms (ngón tay che) nhưng tem chưa rời khung → mã đơn lọt qua luật 3.
  assert.equal(gate.admit("MADON1", 900), "fire");
  assert.equal(gate.resolved("MADON1", "don-1", 1100), "alias");
});

test("resolved: đưa kiện vào LẦN NỮA → repeat, kể cả khi camera đọc trúng mã vạch chưa từng gửi", () => {
  const gate = new PackScanGate();
  assert.equal(gate.admit("VD1", 0), "fire");
  assert.equal(gate.resolved("VD1", "don-1", 200), "first");
  // 5 giây sau đưa lại, lần này camera bắt mã đơn trước (lần đầu nó bị luật 3 bỏ qua).
  assert.equal(gate.admit("MADON1", 5000), "fire");
  assert.equal(gate.resolved("MADON1", "don-1", 5200), "repeat"); // bản cũ: im lặng 10 giây → đơ
  // Lần ba, đọc lại đúng mã vận đơn.
  assert.equal(gate.admit("VD1", 10000), "fire");
  assert.equal(gate.resolved("VD1", "don-1", 10200), "repeat");
});

test("resolved: gõ tay lại mã của đơn đã quét → repeat (không có mã nào đang trong khung)", () => {
  const gate = new PackScanGate();
  assert.equal(gate.admitManual("VD1"), true);
  assert.equal(gate.resolved("VD1", "don-1", 0), "first");
  assert.equal(gate.admitManual("VD1"), true);
  assert.equal(gate.resolved("VD1", "don-1", 100), "repeat");
});
