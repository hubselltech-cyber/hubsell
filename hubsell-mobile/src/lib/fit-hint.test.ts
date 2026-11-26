/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitHint } from "./fit-hint";

/**
 * Chạy (không cần RN): từ backend/
 *   npx tsx --test ../hubsell-mobile/src/lib/fit-hint.test.ts
 */

const ORDERS = ["Mã đơn, tên khách, SĐT, mã vận đơn…", "Mã đơn, tên khách, SĐT…", "Mã đơn, tên khách…", "Tìm đơn…"] as const;

/** Bề ngang chỗ viết chữ của ô tìm tab Đơn hàng: ba cột của lưới 4 cột, trừ đệm + icon (xem orders.tsx). */
const ordersField = (win: number) => (win - 40) * 0.75 - 56;

test("màn rộng, cỡ chữ thường → câu đầy đủ", () => {
  assert.equal(fitHint(ORDERS, ordersField(600), 1), ORDERS[0]);
});

test("iPhone 390, cỡ chữ thường → câu vừa (không cắt cụt giữa chữ)", () => {
  assert.equal(fitHint(ORDERS, ordersField(390), 1), ORDERS[1]);
});

test("Android 360dp, cỡ chữ máy lớn (ca đã thấy chữ lòi mép) → câu ngắn hơn, vừa một dòng", () => {
  const hint = fitHint(ORDERS, ordersField(360), 1.5);
  assert.notEqual(hint, ORDERS[0]);
  // Bề ngang thật đo trên máy ảo ≈ 0,42 × cỡ chữ mỗi ký tự: câu được chọn phải lọt.
  assert.ok(hint.length * 14 * 1.2 * 0.42 <= ordersField(360));
});

test("màn 320dp + chữ lớn → vẫn ra một câu, ngắn nhất là câu cuối", () => {
  const hint = fitHint(ORDERS, ordersField(320), 2);
  assert.ok(ORDERS.includes(hint as (typeof ORDERS)[number]));
  assert.equal(fitHint(ORDERS, 10, 1), "Tìm đơn…");
});

test("hệ số cỡ chữ lạ (0, NaN, 3) không làm vỡ: kẹp trong 1 – 1,2", () => {
  assert.equal(fitHint(ORDERS, ordersField(600), Number.NaN), ORDERS[0]);
  assert.equal(fitHint(ORDERS, ordersField(600), 0), ORDERS[0]);
  assert.equal(fitHint(ORDERS, ordersField(390), 3), fitHint(ORDERS, ordersField(390), 1.2));
});
