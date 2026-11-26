// Chạy: từ `backend/` → `npx tsx --test ../hubsell-mobile/src/lib/pack-video-hours.test.ts`
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterClipStored,
  formatHoursBalance,
  hoursLabel,
  outOfHours,
  parsePackHours,
  type PackHours,
} from "./pack-video-hours";

const h = (purchasedSeconds: number, usedSeconds: number): PackHours => ({
  purchasedSeconds,
  usedSeconds,
  remainingSeconds: purchasedSeconds - usedSeconds,
});

test("chưa có số giờ (đang tải / mất mạng) thì KHÔNG chặn — máy chủ vẫn là rào thật", () => {
  assert.equal(outOfHours(null), false);
});

test("chưa mua giờ nào: chặn + câu 'Chưa mua giờ quay'", () => {
  assert.equal(outOfHours(h(0, 0)), true);
  assert.equal(hoursLabel(h(0, 0)), "Chưa mua giờ quay");
});

test("còn giờ: không chặn, hiện đúng số", () => {
  assert.equal(outOfHours(h(72_000, 600)), false);
  assert.equal(hoursLabel(h(72_000, 600)), "Còn 19 giờ 50 phút");
  assert.equal(outOfHours(h(72_000, 71_999)), false);
  assert.equal(hoursLabel(h(72_000, 71_999)), "Còn 1 giây");
});

test("vừa đúng hết giờ: chặn + 'Đã hết giờ quay'", () => {
  assert.equal(outOfHours(h(72_000, 72_000)), true);
  assert.equal(hoursLabel(h(72_000, 72_000)), "Đã hết giờ quay");
});

test("số dư âm (clip quay dở lúc hết giờ): chặn + chữ 'Vượt gói', không dấu trừ", () => {
  assert.equal(outOfHours(h(72_000, 72_540)), true);
  assert.equal(hoursLabel(h(72_000, 72_540)), "Vượt gói 9 phút");
  // Quay thử trước khi mua giờ nào: đã dùng > 0, đã mua = 0.
  assert.equal(hoursLabel(h(0, 600)), "Vượt gói 10 phút");
});

test("cách viết số giờ: giây / phút / giờ tròn / giờ lẻ phút / nghìn giờ", () => {
  assert.equal(formatHoursBalance(0), "0 giây");
  assert.equal(formatHoursBalance(59), "59 giây");
  assert.equal(formatHoursBalance(60), "1 phút");
  assert.equal(formatHoursBalance(3_599), "59 phút");
  assert.equal(formatHoursBalance(3_600), "1 giờ");
  assert.equal(formatHoursBalance(3_900), "1 giờ 05 phút");
  assert.equal(formatHoursBalance(4_443_300), "1.234 giờ 15 phút");
  assert.equal(formatHoursBalance(Number.NaN), "0 giây");
});

test("clip của máy này lên xong: trừ ngay đúng số máy chủ ghi (làm tròn, tối thiểu 1 giây)", () => {
  assert.deepEqual(afterClipStored(h(3_600, 0), 42.4), h(3_600, 42));
  assert.deepEqual(afterClipStored(h(3_600, 0), 0.2), h(3_600, 1));
  // Clip cuối làm số dư về âm → từ đó chặn mở clip mới.
  const after = afterClipStored(h(3_600, 3_590), 65);
  assert.equal(after.remainingSeconds, -55);
  assert.equal(outOfHours(after), true);
  assert.deepEqual(afterClipStored(h(3_600, 0), Number.NaN), h(3_600, 1));
});

test("đọc câu trả lời máy chủ: chỉ lấy ba số, thiếu / sai kiểu thì về 0", () => {
  assert.deepEqual(
    parsePackHours({ purchasedSeconds: 72_000, usedSeconds: 600, remainingSeconds: 71_400, ledger: [], salesOpen: true }),
    h(72_000, 600)
  );
  assert.deepEqual(parsePackHours(null), h(0, 0));
  assert.deepEqual(parsePackHours({ purchasedSeconds: "abc" }), h(0, 0));
});
