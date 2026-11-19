/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  carrierKey,
  choiceProblem,
  confirmView,
  groupCheck,
  idsOfStage,
  initialChoice,
  isRunnable,
  pipelineCounts,
  selectAllStages,
  selectedOrderIds,
  selectionCounts,
  toggleCarrier,
  toggleGroup,
  workStageOf,
  type OptionGroupLike,
  type QueueGroupLike,
  type WorkStage,
} from "./fulfill";
import { rowParts, sameTemplate, stepZone, toggleColumn, type LabelTemplate } from "./label-template";

/** Chạy (không cần RN): từ backend/  npx tsx --test ../hubsell-mobile/src/lib/fulfill.test.ts */

const group = (over: Partial<OptionGroupLike> = {}): OptionGroupLike => ({
  channelId: "c1",
  orderCount: 3,
  mode: "PLATFORM",
  methods: ["PICKUP", "DROPOFF"],
  pickupAddresses: [
    { id: "a1", isDefault: false, timeSlots: [{ id: "t1" }, { id: "t2" }] },
    { id: "a2", isDefault: true, timeSlots: [{ id: "t3" }] },
  ],
  dropoffBranches: [{ id: "b1" }, { id: "b2" }],
  defaults: null,
  ...over,
});

const queue: QueueGroupLike[] = [
  {
    channelId: "c1",
    count: 3,
    carriers: [
      { key: "EXPRESS", count: 1, orderIds: ["e1"] },
      { key: "SPX", count: 2, orderIds: ["s1", "s2"] },
    ],
  },
  { channelId: "c2", count: 1, carriers: [{ key: "JT", count: 1, orderIds: ["j1"] }] },
];

test("lựa chọn ban đầu: chưa có lần trước → địa chỉ sàn đánh dấu mặc định + khung giờ sớm nhất", () => {
  assert.deepEqual(initialChoice(group()), {
    method: "PICKUP",
    addressId: "a2",
    pickupTimeId: "t3",
    branchId: "b1",
  });
});

test("lựa chọn ban đầu: điền lại lần trước của gian; cách giao sàn không còn cho thì lùi về cách đầu", () => {
  assert.deepEqual(initialChoice(group({ defaults: { method: "DROPOFF", addressId: "a1", branchId: "b2" } })), {
    method: "DROPOFF",
    addressId: "a1",
    pickupTimeId: "t1",
    branchId: "b2",
  });
  assert.equal(initialChoice(group({ methods: ["PICKUP"], defaults: { method: "DROPOFF" } })).method, "PICKUP");
});

test("gian không có địa chỉ / khung giờ nào: không văng, các ô để trống", () => {
  const c = initialChoice(group({ pickupAddresses: [], dropoffBranches: [] }));
  assert.equal(c.addressId, undefined);
  assert.equal(c.pickupTimeId, undefined);
  assert.equal(c.branchId, undefined);
});

test("gian chạy được = sàn nhận lệnh thật hoặc kênh offline", () => {
  assert.equal(isRunnable({ mode: "PLATFORM" }), true);
  assert.equal(isRunnable({ mode: "INTERNAL" }), true);
  assert.equal(isRunnable({ mode: "ERROR" }), false);
  assert.equal(isRunnable({ mode: "UNSUPPORTED" }), false);
});

test("lấy hàng tận nơi mà sàn chưa có địa chỉ → báo trước khi bấm; sàn tự sắp xếp thì không đòi chọn", () => {
  const g = group({ pickupAddresses: [] });
  assert.match(choiceProblem(g, { method: "PICKUP" }) ?? "", /chưa có địa chỉ lấy hàng/);
  assert.equal(choiceProblem(g, { method: "DROPOFF" }), null);
  assert.equal(choiceProblem(group({ methods: [] }), undefined), null);
  assert.equal(choiceProblem(group({ mode: "INTERNAL" }), undefined), null);
});

test("chọn đơn theo cây: mặc định lấy hết, đúng thứ tự máy chủ trả (hỏa tốc trước)", () => {
  assert.deepEqual(selectedOrderIds(queue, new Set()), ["e1", "s1", "s2", "j1"]);
});

test("bỏ tích một hãng → chỉ mất đơn của hãng đó; ô gian chuyển sang 'một phần'", () => {
  const off = toggleCarrier(queue[0], "SPX", new Set());
  assert.deepEqual(selectedOrderIds(queue, off), ["e1", "j1"]);
  assert.equal(groupCheck(queue[0], off), "some");
  assert.equal(groupCheck(queue[1], off), "all");
});

test("bỏ tích hết từng hãng của gian = gian bỏ hết; bấm ô gian thì tích lại tất cả", () => {
  let off = toggleCarrier(queue[0], "SPX", new Set());
  off = toggleCarrier(queue[0], "EXPRESS", off);
  assert.equal(groupCheck(queue[0], off), "none");
  off = toggleGroup(queue[0], off);
  assert.equal(groupCheck(queue[0], off), "all");
  assert.deepEqual(selectedOrderIds(queue, off), ["e1", "s1", "s2", "j1"]);
});

test("bấm ô gian đang tích một phần → bỏ cả gian (không để sót khóa hãng cũ)", () => {
  let off = toggleCarrier(queue[0], "SPX", new Set());
  off = toggleGroup(queue[0], off);
  assert.equal(groupCheck(queue[0], off), "none");
  assert.deepEqual([...off], ["c1"]);
  assert.deepEqual(selectedOrderIds(queue, off), ["j1"]);
});

test("gian đang bỏ cả cụm, bấm một hãng → chỉ hãng đó được tích lại", () => {
  const off = toggleCarrier(queue[0], "EXPRESS", new Set(["c1"]));
  assert.deepEqual(selectedOrderIds(queue, off), ["e1", "j1"]);
  assert.equal(off.has(carrierKey("c1", "SPX")), true);
});

test("kết quả: sàn nhận hết", () => {
  const v = confirmView({ confirmed: 5, skipped: [], failed: [] });
  assert.equal(v.tone, "ok");
  assert.equal(v.title, "Sàn đã nhận 5 đơn");
});

test("kết quả: nhận một phần — liệt kê ĐỦ đơn bị từ chối kèm lý do, nói riêng đơn chưa thanh toán", () => {
  const v = confirmView({
    confirmed: 3,
    skipped: [
      { orderCode: "A", reason: "Khách chưa thanh toán — sàn chưa cho chuẩn bị" },
      { orderCode: "B", reason: "Đơn đã rời Chờ xử lý" },
    ],
    failed: [
      { orderCode: "C", reason: "Sàn báo đơn đã được sắp xếp" },
      { orderCode: "D", reason: "Gian mất kết nối" },
    ],
  });
  assert.equal(v.tone, "partial");
  assert.equal(v.problems.length, 2);
  assert.equal(v.notes.length, 2);
  assert.match(v.notes[0], /1 đơn khách chưa thanh toán/);
});

test("kết quả: sàn từ chối cả mẻ / không có đơn nào chạy", () => {
  assert.equal(confirmView({ confirmed: 0, skipped: [], failed: [{ orderCode: "X", reason: "lỗi" }] }).tone, "fail");
  assert.equal(confirmView({ confirmed: 0, skipped: [], failed: [] }).title, "Không chuẩn bị được đơn nào");
});

test("bốn công đoạn đọc từ bảng đếm; khóa thiếu coi là 0", () => {
  assert.deepEqual(pipelineCounts({ PENDING: 4, PROCESSED_NOT_PRINTED: 2 }), {
    arrange: 4,
    print: 2,
    pack: 0,
    packed: 0,
  });
});

// ───────── Tích đơn trên danh sách ─────────

test("đơn nào có ô tích: chờ xử lý đã thanh toán / chưa in / đã in chưa gói; còn lại không", () => {
  assert.equal(workStageOf({ shippingStatus: "PENDING", paymentStatus: "PAID" }), "arrange");
  assert.equal(workStageOf({ shippingStatus: "PENDING", paymentStatus: null }), "arrange");
  assert.equal(workStageOf({ shippingStatus: "PENDING", paymentStatus: "UNPAID" }), null);
  assert.equal(workStageOf({ shippingStatus: "PROCESSED" }), "print");
  assert.equal(workStageOf({ shippingStatus: "PROCESSED", labelPrintedAt: "2026-11-19T01:00:00Z" }), "reprint");
  assert.equal(
    workStageOf({ shippingStatus: "PROCESSED", labelPrintedAt: "2026-11-19T01:00:00Z", packingDoneAt: "2026-11-19T02:00:00Z" }),
    null
  );
  // Đã quét đóng gói mà chưa có mốc in (in ở app của sàn) → vẫn là đã gói, không còn việc.
  assert.equal(workStageOf({ shippingStatus: "PROCESSED", packingDoneAt: "2026-11-19T02:00:00Z" }), null);
  for (const st of ["SHIPPING", "DELIVERED", "CANCELLED"]) assert.equal(workStageOf({ shippingStatus: st }), null);
});

test("đếm đơn đã tích theo bước; cộng ba bước bằng tổng", () => {
  const sel = new Map<string, WorkStage>([
    ["a", "arrange"],
    ["b", "print"],
    ["c", "arrange"],
    ["d", "reprint"],
  ]);
  const n = selectionCounts(sel);
  assert.deepEqual(n, { arrange: 2, print: 1, reprint: 1, total: 4 });
  assert.equal(n.arrange + n.print + n.reprint, n.total);
  assert.deepEqual(idsOfStage(sel, "arrange"), ["a", "c"]);
  assert.deepEqual(idsOfStage(sel, "print"), ["b"]);
  assert.deepEqual(selectionCounts(new Map()), { arrange: 0, print: 0, reprint: 0, total: 0 });
});

test("Chọn tất cả lấy nhóm nào theo bộ lọc trạng thái đang xem", () => {
  assert.deepEqual(selectAllStages("", ""), ["ARRANGE", "PRINT", "REPRINT"]);
  assert.deepEqual(selectAllStages("PENDING", ""), ["ARRANGE"]);
  assert.deepEqual(selectAllStages("PROCESSED", ""), ["PRINT", "REPRINT"]);
  assert.deepEqual(selectAllStages("PROCESSED", "no"), ["PRINT"]);
  assert.deepEqual(selectAllStages("PROCESSED", "yes"), ["REPRINT"]);
  assert.deepEqual(selectAllStages("PROCESSED", "packed"), []);
  assert.deepEqual(selectAllStages("SHIPPING", ""), []);
});

// ───────── Tùy chỉnh phiếu in ─────────

const tpl: LabelTemplate = {
  enabled: true,
  showSku: true,
  showVariant: true,
  showName: false,
  note: "",
  onePage: true,
  manualZoneMm: null,
};

test("dòng bảng gọn: SKU đậm · phân loại; thiếu mã người bán thì phân loại lên đậm", () => {
  assert.deepEqual(rowParts({ sku: "A1", variant: "Đen", name: "Áo", quantity: 1 }, tpl), [
    { text: "A1", bold: true },
    { text: "Đen", bold: false },
  ]);
  assert.deepEqual(rowParts({ sku: null, variant: "Đen", name: "Áo", quantity: 1 }, tpl), [
    { text: "Đen", bold: true },
  ]);
});

test("chỉ bật SKU mà dòng không có mã, không có phân loại → lùi về tên, không ra dòng trống", () => {
  const only = { ...tpl, showVariant: false };
  assert.deepEqual(rowParts({ sku: null, variant: null, name: "Áo", quantity: 1 }, only), [
    { text: "Áo", bold: true },
  ]);
});

test("không tắt được cột cuối cùng đang bật", () => {
  const onlySku = { ...tpl, showVariant: false };
  assert.equal(toggleColumn(onlySku, "showSku"), onlySku);
  assert.equal(toggleColumn(tpl, "showVariant").showVariant, false);
});

test("so mẫu để bật nút Lưu: khoảng trắng đầu cuối của dòng nhắn không tính là thay đổi", () => {
  assert.equal(sameTemplate(tpl, { ...tpl, note: "  " }), true);
  assert.equal(sameTemplate(tpl, { ...tpl, note: "Gọi shop" }), false);
  assert.equal(sameTemplate(tpl, { ...tpl, manualZoneMm: 45 }), false);
});

test("vùng tự đặt đổi theo nấc và kẹp trong giới hạn", () => {
  const limits = { zoneMinMm: 20, zoneMaxMm: 70 };
  assert.equal(stepZone(45, 5, limits), 50);
  assert.equal(stepZone(70, 5, limits), 70);
  assert.equal(stepZone(20, -5, limits), 20);
});
