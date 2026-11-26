/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsCarrierLookup, returnShipView } from "./return-shipping";

/**
 * Chạy (không cần RN): từ backend/
 *   npx tsx --test ../hubsell-mobile/src/lib/return-shipping.test.ts
 */

type Row = Parameters<typeof returnShipView>[0];

const row = (over: Partial<Row> & { ship?: Partial<NonNullable<Row["returnShipping"]>> } = {}): Row => {
  const { ship, ...rest } = over;
  return {
    returnStatus: "AWAITING",
    trackingCode: "862655446625",
    channel: { channelName: "TIKTOK" },
    returnShipping: { state: "NO_SIGNAL", at: null, source: null, failedDelivery: false, ...ship },
    ...rest,
  };
};

test("sàn báo kiện đã về mà kho chưa quét → Ship báo đã hoàn, dòng đỏ có giờ sàn báo", () => {
  const v = returnShipView(row({ ship: { state: "RETURNED", at: "2026-11-22T02:07:27.000Z", source: "platform" } }));
  assert.equal(v?.shipReturned, true);
  assert.equal(v?.tone, "red");
  assert.match(v!.line!, /^Sàn báo \d{2}\/\d{2} \d{2}:\d{2} · kho chưa quét nhận$/);
});

test("sàn báo đã về nhưng không ghi giờ (Lazada) → vẫn Ship báo đã hoàn, câu không có giờ", () => {
  const v = returnShipView(row({ channel: { channelName: "LAZADA" }, ship: { state: "RETURNED", source: "platform" } }));
  assert.equal(v?.shipReturned, true);
  assert.equal(v?.line, "Sàn báo kiện đã về shop · kho chưa quét nhận");
});

test("giao thất bại: chưa có câu trả lời của hãng → đang hỏi, CHƯA gọi là đã hoàn", () => {
  const o = row({ ship: { failedDelivery: true } });
  assert.equal(needsCarrierLookup(o), true);
  const v = returnShipView(o);
  assert.equal(v?.asking, true);
  assert.equal(v?.shipReturned, false);
});

test("giao thất bại: hãng báo đã trả kiện → Ship báo đã hoàn, ghi rõ là hãng báo", () => {
  const v = returnShipView(row({ ship: { failedDelivery: true } }), {
    status: "ok",
    state: "RETURNED",
    at: "2026-11-25T08:30:00.000Z",
    latest: { at: "2026-11-25T08:30:00.000Z", description: "Đã trả hàng thành công cho người gửi" },
    fetchedAt: null,
  });
  assert.equal(v?.shipReturned, true);
  assert.match(v!.line!, /^Hãng báo \d{2}\/\d{2} \d{2}:\d{2} · kho chưa quét nhận$/);
});

test("giao thất bại: mốc hãng trả kiện backend đã lưu → Ship báo đã hoàn 'Hãng báo', không hỏi hãng nữa", () => {
  const o = row({ ship: { state: "RETURNED", at: "2026-11-25T08:30:00.000Z", source: "carrier", failedDelivery: true } });
  assert.equal(needsCarrierLookup(o), false);
  const v = returnShipView(o);
  assert.equal(v?.shipReturned, true);
  assert.equal(v?.asking, false);
  assert.match(v!.line!, /^Hãng báo \d{2}\/\d{2} \d{2}:\d{2} · kho chưa quét nhận$/);
});

test("giao thất bại: hãng trả lời kiện đang về / chưa có mốc hoàn → đọc nguyên văn mốc mới nhất", () => {
  const o = row({ ship: { failedDelivery: true } });
  const returning = returnShipView(o, {
    status: "ok",
    state: "RETURNING",
    at: null,
    latest: { at: null, description: "Đang hoàn trả về người gửi" },
    fetchedAt: null,
  });
  assert.equal(returning?.line, "Đang hoàn về · Đang hoàn trả về người gửi");
  assert.equal(returning?.tone, "blue");
  const none = returnShipView(o, { status: "ok", state: "NO_SIGNAL", at: null, latest: null, fetchedAt: null });
  assert.equal(none?.line, "Giao thất bại");
  assert.equal(none?.shipReturned, false);
});

test("giao thất bại: hãng lỗi / sàn không có hành trình → không treo 'đang hỏi', không đoán là đã về", () => {
  const o = row({ ship: { failedDelivery: true } });
  for (const carrier of [{ status: "error" }, { status: "unsupported" }] as const) {
    const v = returnShipView(o, carrier);
    assert.equal(v?.asking, false);
    assert.equal(v?.shipReturned, false);
    assert.equal(v?.line, "Giao thất bại, kiện quay đầu");
  }
});

test("Lazada giao thất bại + đơn thiếu mã vận đơn: không thuộc diện hỏi hãng", () => {
  assert.equal(needsCarrierLookup(row({ channel: { channelName: "LAZADA" }, ship: { failedDelivery: true } })), false);
  assert.equal(needsCarrierLookup(row({ trackingCode: null, ship: { failedDelivery: true } })), false);
  // Khách trả hàng (không phải giao thất bại): số của sàn đã đủ, không hỏi hãng.
  assert.equal(needsCarrierLookup(row({ ship: { state: "RETURNING" } })), false);
});

test("khách trả hàng: đang về / chờ khách gửi / chưa có tin", () => {
  assert.equal(returnShipView(row({ ship: { state: "RETURNING" } }))?.line, "Đang hoàn về · sàn chưa báo kiện về tới");
  assert.equal(returnShipView(row({ ship: { state: "WAITING_BUYER" } }))?.line, "Chờ khách gửi hàng");
  assert.equal(returnShipView(row())?.line, "Chưa có tin từ hãng");
});

test("kho đã cầm kiện, hoặc backend bản cũ không gửi returnShipping → không thêm gì vào dòng", () => {
  assert.equal(returnShipView(row({ returnStatus: "RECEIVED", ship: { state: "RETURNED", source: "warehouse" } })), null);
  assert.equal(returnShipView({ ...row(), returnShipping: undefined }), null);
});
