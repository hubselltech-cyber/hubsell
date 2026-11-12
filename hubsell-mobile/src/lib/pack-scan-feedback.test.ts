/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { flashOfError, flashOfResponse, isNetworkFailure } from "./pack-scan-feedback";
import type { PackingScanResponse } from "../types/api";

/**
 * Chạy (không cần RN): từ backend/
 *   npx tsx --test ../hubsell-mobile/src/lib/pack-scan-feedback.test.ts
 *
 * BẢNG RÀ: mọi nhánh của backend/src/lib/packing-scan.ts (decidePackingScan) + mã lỗi
 * của route /api/orders/packing/scan → màn / âm / ô đếm trên app. Backend thêm lý do
 * chặn hoặc cảnh báo mới thì thêm một ca ở đây.
 */
function res(over: Partial<PackingScanResponse>): PackingScanResponse {
  return {
    result: "PACKED",
    reason: null,
    reasonText: null,
    warnings: [],
    warningTexts: [],
    order: {
      id: "o1",
      orderCode: "261105G3BXKUU7",
      customerName: "N*** A",
      shippingStatus: "PROCESSED",
      carrierLabel: "SPX Express",
      trackingCode: "VN268837249821L",
      packingDoneAt: "2026-11-05T06:30:00.000Z",
      channel: { channelName: "SHOPEE", shopName: "ANO Official Store" },
    },
    ...over,
  };
}

test("ghi được: xanh, ting-ting, tự tắt nhanh, cộng ô Đã gói", () => {
  const f = flashOfResponse(res({}));
  assert.equal(f.kind, "ok");
  assert.equal(f.sound, "success");
  assert.equal(f.counter, "packed");
  assert.equal(f.holdMs, 800);
  assert.equal(f.code, "261105G3BXKUU7");
  assert.equal(f.meta, "ANO Official Store · SPX Express");
});

test("ĐƠN ĐÃ HỦY: âm RIÊNG, rung hai nhịp, giữ lâu, cộng ô Đơn hủy", () => {
  const f = flashOfResponse(
    res({ result: "REJECTED", reason: "CANCELLED", reasonText: "ĐƠN ĐÃ HỦY — bỏ kiện lại, không đưa ship" })
  );
  assert.equal(f.kind, "cancelled");
  assert.equal(f.sound, "cancelled");
  assert.equal(f.haptic, "errorTwice");
  assert.equal(f.counter, "cancelled");
  assert.equal(f.holdMs, 2500);
});

test("đơn hủy và đơn ghi được KHÔNG chung âm, không chung màu", () => {
  const ok = flashOfResponse(res({}));
  const cancelled = flashOfResponse(res({ result: "REJECTED", reason: "CANCELLED" }));
  assert.notEqual(ok.sound, cancelled.sound);
  assert.notEqual(ok.kind, cancelled.kind);
});

for (const reason of ["NOT_CONFIRMED", "DELIVERED", "ON_HANDOVER_SHEET"] as const) {
  test(`chặn ${reason}: đỏ, tiếng lỗi thường (không dùng còi đơn hủy), câu của máy chủ`, () => {
    const f = flashOfResponse(res({ result: "REJECTED", reason, reasonText: "câu máy chủ soạn" }));
    assert.equal(f.kind, "blocked");
    assert.equal(f.sound, "error");
    assert.equal(f.detail, "câu máy chủ soạn");
    assert.equal(f.counter, "failed");
  });
}

test("đã quét rồi: vàng, boop-boop, KHÔNG cộng ô nào, ghi giờ quét lần đầu", () => {
  const f = flashOfResponse(res({ result: "ALREADY_PACKED" }));
  assert.equal(f.kind, "dup");
  assert.equal(f.sound, "duplicate");
  assert.equal(f.counter, null);
  assert.match(f.detail ?? "", /^Đã quét lúc \d{2}:\d{2}$/);
});

test("ghi được nhưng khách đang xin hủy: vàng, tiếng lỗi, vẫn cộng Đã gói, giữ lâu", () => {
  const f = flashOfResponse(
    res({ warnings: ["CANCEL_REQUESTED"], warningTexts: ["Khách đang xin hủy — sàn chờ shop quyết"] })
  );
  assert.equal(f.kind, "caution");
  assert.equal(f.sound, "error");
  assert.equal(f.counter, "packed");
  assert.equal(f.holdMs, 2500);
});

test("đã quét rồi + khách đang xin hủy: vẫn nhắc để riêng kiện", () => {
  const f = flashOfResponse(res({ result: "ALREADY_PACKED", warnings: ["CANCEL_REQUESTED"] }));
  assert.equal(f.kind, "dup");
  assert.match(f.detail ?? "", /xin hủy/);
});

test("lưu ý nhẹ (chưa in phiếu / sàn đã Đang giao): vẫn là ghi được, có dòng chữ", () => {
  for (const w of ["NOT_PRINTED", "ALREADY_SHIPPING"] as const) {
    const f = flashOfResponse(res({ warnings: [w], warningTexts: ["lưu ý"] }));
    assert.equal(f.kind, "ok");
    assert.equal(f.sound, "success");
    assert.equal(f.detail, "lưu ý");
    assert.equal(f.counter, "packed");
  }
});

test("không thấy đơn / khớp nhiều đơn: đỏ, tiếng lỗi, nêu mã vừa quét", () => {
  const notFound = flashOfError("XYZ123456", 404, "Không thấy đơn nào có mã");
  assert.equal(notFound.kind, "failed");
  assert.equal(notFound.title, "KHÔNG THẤY ĐƠN");
  assert.equal(notFound.code, "XYZ123456");
  assert.equal(flashOfError("123456", 409, "khớp 3 đơn").title, "MÃ KHỚP NHIỀU ĐƠN");
});

test("mất mạng / máy chủ lỗi: nói rõ kiện CHƯA được ghi", () => {
  for (const status of [0, 408, 500, 502, 503]) {
    assert.equal(isNetworkFailure(status), true, String(status));
    const f = flashOfError("VD1", status, "bất kỳ");
    assert.equal(f.title, "CHƯA GHI ĐƯỢC");
    assert.match(f.detail ?? "", /CHƯA được ghi/);
  }
});

test("lỗi phía người dùng (thiếu quyền…) không bị coi là mất mạng, hiện câu máy chủ", () => {
  for (const status of [400, 403, 404, 409]) assert.equal(isNetworkFailure(status), false, String(status));
  const f = flashOfError("VD1", 403, "Bạn không có quyền Đơn hàng");
  assert.equal(f.title, "KHÔNG GHI ĐƯỢC");
  assert.equal(f.detail, "Bạn không có quyền Đơn hàng");
});

test("đơn hủy quét LẠI: vẫn còi hủy + ô Đơn hủy, nhưng nói rõ là kiện đã quét rồi", () => {
  const first = flashOfResponse(res({ result: "REJECTED", reason: "CANCELLED" }));
  const again = flashOfResponse(res({ result: "REJECTED", reason: "CANCELLED" }), true);
  assert.equal(again.kind, "cancelled");
  assert.equal(again.sound, "cancelled");
  assert.equal(again.counter, "cancelled");
  assert.match(again.detail ?? "", /đã quét rồi/);
  assert.match(again.short, /đã quét rồi/);
  assert.doesNotMatch(first.detail ?? "", /đã quét rồi/);
});
