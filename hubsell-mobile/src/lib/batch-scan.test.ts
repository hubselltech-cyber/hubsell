/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { flashOfBatchError, flashOfBatchScan, summarizeBatch, type BatchOrder } from "./batch-scan";

/** Chạy (không cần RN): từ backend/  npx tsx --test ../hubsell-mobile/src/lib/batch-scan.test.ts */

let seq = 0;
function order(over: Partial<BatchOrder> & { items: BatchOrder["items"] }): BatchOrder {
  seq++;
  return {
    id: `o${seq}`,
    orderCode: `DON${seq}`,
    trackingCode: `VD${seq}`,
    shippingStatus: "PROCESSED",
    carrier: null,
    shippingCarrierName: "J&T Express",
    channel: { channelName: "TIKTOK", shopName: "Shop thử" },
    ...over,
  };
}
const item = (productName: string, channelSku: string | null, quantity: number, imageUrl: string | null = null) => ({
  productName,
  channelSku,
  quantity,
  imageUrl,
});

test("cộng theo SKU và theo sản phẩm; đếm số ĐƠN có món đó, không đếm số dòng", () => {
  const s = summarizeBatch([
    order({ items: [item("Áo thun", "AO-M", 2), item("Áo thun", "AO-L", 1)] }),
    order({ items: [item("Áo thun", "AO-M", 3)] }),
    order({ items: [item("Quần", "QUAN-32", 1), item("Quần", "QUAN-32", 1)] }), // tách hai dòng cùng SKU
  ]);
  assert.equal(s.parcels, 3);
  assert.equal(s.qty, 8);
  assert.deepEqual(
    s.bySku.map((l) => [l.sku, l.qty, l.orders]),
    [
      ["AO-M", 5, 2],
      ["QUAN-32", 2, 1],
      ["AO-L", 1, 1],
    ]
  );
  const ao = s.byProduct.find((l) => l.name === "Áo thun");
  assert.deepEqual([ao?.qty, ao?.orders, ao?.skuCount, ao?.sku], [6, 2, 2, null]);
  const quan = s.byProduct.find((l) => l.name === "Quần");
  assert.deepEqual([quan?.qty, quan?.orders, quan?.skuCount, quan?.sku], [2, 1, 1, "QUAN-32"]);
});

test("đơn ĐÃ HỦY: đếm riêng, không vào số hàng, không vào số theo sàn / hãng", () => {
  const s = summarizeBatch([
    order({ items: [item("Áo", "A", 2)] }),
    order({ shippingStatus: "CANCELLED", items: [item("Áo", "A", 99)] }),
  ]);
  assert.equal(s.parcels, 2);
  assert.equal(s.cancelled, 1);
  assert.equal(s.qty, 2);
  assert.deepEqual(s.byChannel, [{ key: "TIKTOK", count: 1 }]);
  assert.deepEqual(s.byCarrier, [{ key: "J&T Express", count: 1 }]);
});

test("khách đang xin hủy vẫn tính hàng (đơn chưa hủy) nhưng được đếm để nhắc", () => {
  const s = summarizeBatch([order({ cancelRequestedAt: "2026-11-12T03:00:00.000Z", items: [item("Áo", "A", 1)] })]);
  assert.equal(s.cancelRequested, 1);
  assert.equal(s.qty, 1);
});

test("hàng không có SKU gom theo tên; SKU trùng chữ với tên không bị gộp nhầm", () => {
  const s = summarizeBatch([
    order({ items: [item("Áo", null, 1), item("Áo", "  ", 2)] }),
    order({ items: [item("Mẫu khác", "Áo", 5)] }),
  ]);
  assert.deepEqual(
    s.bySku.map((l) => [l.sku, l.name, l.qty]),
    [
      ["Áo", "Mẫu khác", 5],
      [null, "Áo", 3],
    ]
  );
});

test("lô rỗng, đơn không có dòng hàng, số lượng 0 / âm / không phải số: không NaN, không dòng rác", () => {
  assert.deepEqual(summarizeBatch([]), {
    parcels: 0,
    cancelled: 0,
    cancelRequested: 0,
    qty: 0,
    bySku: [],
    byProduct: [],
    byChannel: [],
    byCarrier: [],
  });
  const s = summarizeBatch([
    order({ items: [] }),
    order({ items: [item("Áo", "A", 0), item("Áo", "A", -2), item("Áo", "A", Number.NaN), item("Quần", "Q", 1)] }),
  ]);
  assert.equal(s.parcels, 2);
  assert.equal(s.qty, 1);
  assert.deepEqual(s.bySku.map((l) => l.sku), ["Q"]);
});

test("ảnh lấy từ dòng đầu tiên có ảnh; theo sàn / hãng xếp nhiều trước", () => {
  const s = summarizeBatch([
    order({ channel: { channelName: "SHOPEE", shopName: "S" }, shippingCarrierName: "SPX", items: [item("Áo", "A", 1)] }),
    order({ items: [item("Áo", "A", 1, "https://img/a.jpg")] }),
    order({ items: [item("Áo", "A", 1)] }),
  ]);
  assert.equal(s.bySku[0].imageUrl, "https://img/a.jpg");
  assert.deepEqual(s.byChannel.map((c) => c.key), ["TIKTOK", "SHOPEE"]);
  assert.deepEqual(s.byCarrier.map((c) => [c.key, c.count]), [["J&T Express", 2], ["SPX", 1]]);
});

test("màn báo: thêm mới / đã có trong lô / đơn hủy / khách xin hủy — không bao giờ cộng ô đếm", () => {
  const o = order({ items: [] });
  const added = flashOfBatchScan(o, "Shop · J&T", false);
  assert.deepEqual([added.kind, added.sound, added.counter], ["ok", "success", null]);
  const dup = flashOfBatchScan(o, null, true);
  assert.deepEqual([dup.kind, dup.sound], ["dup", "duplicate"]);
  const cancelled = flashOfBatchScan({ ...o, shippingStatus: "CANCELLED" }, null, false);
  assert.deepEqual([cancelled.kind, cancelled.sound, cancelled.haptic], ["cancelled", "cancelled", "errorTwice"]);
  // Đơn hủy quét lại vẫn là màn đỏ + còi hủy, chỉ đổi câu.
  const cancelledAgain = flashOfBatchScan({ ...o, shippingStatus: "CANCELLED" }, null, true);
  assert.equal(cancelledAgain.kind, "cancelled");
  assert.match(cancelledAgain.detail ?? "", /đã quét rồi/);
  const asked = flashOfBatchScan({ ...o, cancelRequestedAt: "2026-11-12T03:00:00.000Z" }, null, false);
  assert.equal(asked.kind, "caution");
});

test("lượt tra hỏng: mất mạng nói rõ CHƯA vào lô; 404 / 409 có câu riêng", () => {
  assert.match(flashOfBatchError("X", 0, "").detail ?? "", /CHƯA vào lô/);
  assert.equal(flashOfBatchError("X", 503, "").title, "CHƯA THÊM ĐƯỢC");
  assert.equal(flashOfBatchError("X", 404, "").title, "KHÔNG THẤY ĐƠN");
  assert.equal(flashOfBatchError("X", 409, "").title, "MÃ KHỚP NHIỀU ĐƠN");
  assert.equal(flashOfBatchError("X", 400, "câu máy chủ").detail, "câu máy chủ");
});
