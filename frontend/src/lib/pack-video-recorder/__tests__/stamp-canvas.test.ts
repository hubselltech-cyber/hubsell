// Chạy (từ thư mục frontend — frontend chưa có bộ chạy test riêng, mượn bộ nạp TypeScript của backend):
//   node --import ../backend/node_modules/tsx/dist/loader.mjs --test "src/lib/pack-video-recorder/__tests__/*.test.ts"
// IN MÃ VẬN ĐƠN + MÃ ĐƠN HÀNG LÊN VIDEO (18/11/2026): câu chữ và cách xếp hộp — phần thuần, không cần canvas.
import assert from "node:assert/strict";
import { test } from "node:test";

import { layoutCodeBoxes, stampCodeLines } from "../stamp-canvas";

/** Phông đơn cách: mỗi ký tự rộng 0,6 cỡ chữ (gần với Consolas). */
const mono = (text: string, fontPx: number) => text.length * fontPx * 0.6;
/** Khung 1280×720 như màn quay webcam: lề 9, hộp ngày giờ cao 25 (STAMP_BOX_RATIO 3,5 %). */
const FRAME = { width: 1280, height: 720, margin: 9, top: 9 + 25, baseBoxH: 25 };

test("chỉ có mã vận đơn → một dòng; có mã đơn hàng → hai dòng, đúng thứ tự", () => {
  assert.deepEqual(stampCodeLines("SPXVN06316825343B", null), ["Mã vận đơn: SPXVN06316825343B"]);
  assert.deepEqual(stampCodeLines("SPXVN06316825343B", "261118KC2FFVYY"), [
    "Mã vận đơn: SPXVN06316825343B",
    "Mã đơn hàng: 261118KC2FFVYY",
  ]);
});

test("mã có khoảng trắng / quá dài được dọn; mã đơn hàng rỗng thì không in dòng thứ hai", () => {
  assert.deepEqual(stampCodeLines(" SPX VN 123 ", "   "), ["Mã vận đơn: SPXVN123"]);
  assert.equal(stampCodeLines("A".repeat(80), null)[0], `Mã vận đơn: ${"A".repeat(30)}`);
});

test("hai dòng mã nằm DƯỚI hộp ngày giờ, không chồng nhau, chữ to hơn ngày giờ", () => {
  const boxes = layoutCodeBoxes(FRAME, stampCodeLines("SPXVN06316825343B", "261118KC2FFVYY"), mono);
  assert.equal(boxes.length, 2);
  assert.ok(boxes[0].y >= FRAME.top, "dòng đầu phải nằm dưới hộp ngày giờ");
  assert.ok(boxes[1].y >= boxes[0].y + boxes[0].h, "hai dòng không chồng nhau");
  assert.ok(boxes[0].h > FRAME.baseBoxH, "dòng mã cao hơn dòng ngày giờ");
  for (const b of boxes) {
    assert.equal(b.x, FRAME.margin);
    assert.ok(b.x + b.w <= FRAME.width - FRAME.margin, "hộp không tràn mép phải");
  }
});

test("khung ngang 1280×720: mã đơn TikTok 18 chữ số vừa khung mà KHÔNG phải thu chữ", () => {
  const lines = stampCodeLines("862774718126", "587245811271173673");
  const roomy = layoutCodeBoxes({ ...FRAME, width: 4000 }, lines, mono);
  const boxes = layoutCodeBoxes(FRAME, lines, mono);
  assert.equal(boxes.length, 2);
  assert.deepEqual(
    boxes.map((b) => b.fontPx),
    roomy.map((b) => b.fontPx)
  );
});

test("khung dọc hẹp 720: dòng dài nhất được thu chữ vừa đủ, vẫn còn to (≥ 30 điểm ảnh) và không tràn", () => {
  const narrow = { width: 720, height: 1280, margin: 15, top: 15 + 45, baseBoxH: 45 };
  const boxes = layoutCodeBoxes(narrow, stampCodeLines("862774718126", "587245811271173673"), mono);
  assert.equal(boxes.length, 2);
  for (const b of boxes) {
    assert.ok(b.fontPx >= 30, `chữ còn ${b.fontPx}`);
    assert.ok(b.x + b.w <= narrow.width - narrow.margin);
  }
});

test("dòng rộng hơn khung thì THU NHỎ chữ cho vừa, không tràn", () => {
  const tiny = { width: 320, height: 240, margin: 4, top: 4 + 12, baseBoxH: 12 };
  const [box] = layoutCodeBoxes(tiny, ["Mã vận đơn: " + "9".repeat(30)], (t, px) => t.length * px * 0.9);
  assert.ok(box, "vẫn phải vẽ được");
  assert.ok(box.x + box.w <= tiny.width - tiny.margin);
});

test("hết chỗ theo chiều cao thì bỏ dòng thừa, không vẽ ra ngoài khung", () => {
  const short = { width: 1280, height: 80, margin: 9, top: 9 + 25, baseBoxH: 25 };
  const boxes = layoutCodeBoxes(short, ["dòng 1", "dòng 2", "dòng 3"], mono);
  assert.ok(boxes.length < 3);
  for (const b of boxes) assert.ok(b.y + b.h <= short.height - short.margin);
});
