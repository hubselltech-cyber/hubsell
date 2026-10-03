// ============================================================
// XUẤT HÓA ĐƠN HÀNG LOẠT CHẠY NỀN QUA LÀN — hóa đơn bước 5, lát 9 (03/10/2026).
// Chạy trên database dev (cần migration 20261003160000_invoice_requests + lát 8).
// Nhà cung cấp thay bằng adapter giả; KHÔNG chạm MISA. pg-boss KHÔNG khởi động trong
// test → mọi ca ở đây chạy nhờ lưới quét, tức cũng là ca "mất tín hiệu vẫn chạy".
//
//   1. Gộp kết cục hai phần của một lượt (hàm thuần).
//   2. Nhận yêu cầu: lọc đơn ngoài phạm vi / đã hủy / đã có hóa đơn; bấm trùng không
//      sinh dòng thứ hai; tạo làn cho shop chưa từng bật tự phát hành.
//   3. Shop KHÔNG bật tự phát hành vẫn xuất tay được; lịch tự phát hành không bị đụng;
//      xong lô có một chuông.
//   4. Thứ tự trong một lượt: yêu cầu bấm tay trước, tự phát hành sau, chung trần 20.
//   5. Lỗi riêng đơn: đơn đó FAILED kèm lý do, đơn sau vẫn chạy.
//   6. Lỗi tạm: dừng lượt, cả phần chờ tính một lượt + hẹn 1 phút; đủ 3 lượt thì FAILED.
//   7. Lỗi tài khoản: phần còn lại FAILED cùng lý do, chỉ gọi nhà cung cấp MỘT lần;
//      không ngắt mạch tự phát hành.
//   8. Quá 20 yêu cầu: lượt đầu 20, phần còn lại nghỉ rồi mới chạy; lô bấm thêm xếp sau mốc nghỉ.
//   9. Dừng phần còn lại: yêu cầu chưa chạy CANCELLED, tờ đang dở vẫn xong.
//  10. Dừng êm giữa lô: yêu cầu còn PENDING, lượt sau làm tiếp, không tờ nào lập hai lần.
//  11. Chưa rõ kết quả: yêu cầu đóng với mã OUTCOME_UNKNOWN, đếm riêng "đang kiểm lại".
//  12. Làn đang do tiến trình khác thuê: không chạy, yêu cầu giữ nguyên.
// ============================================================
import "./load-env";
import { InvoiceLogStatus, ShippingStatus } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { providerHolder } = vi.hoisted(() => ({ providerHolder: { current: null as unknown } }));

vi.mock("../invoice/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/index")>();
  return { ...actual, getInvoiceProvider: async () => providerHolder.current };
});
vi.mock("../invoice/misa-safety", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/misa-safety")>();
  return { ...actual, isPublishAllowed: () => true };
});

import { prisma } from "../../lib/prisma";
import type { CreateInvoiceInput, InvoiceProvider, InvoiceResult } from "../invoice/types";
import { MISA_CAPABILITIES } from "../invoice/misa-provider";
import {
  acceptBulkIssue,
  cancelBatch,
  findActiveBatchId,
  getBatchProgress,
  openIssueRequestCodes,
  REQUEST_MAX_ATTEMPTS,
  REQUEST_RETRY_MS,
  requestBacklogDelayMs,
} from "../../services/invoice-requests";
import {
  claimInvoiceLane,
  mergeLaneOutcome,
  resumeInvoiceLanes,
  runInvoiceLaneOnce,
  setInvoiceLaneWorkerId,
  stopInvoiceLanes,
  sweepInvoiceRequests,
  whenInvoiceLanesIdle,
} from "../../workers/invoice-lanes";
import { createStockFixture, type StockFixture } from "./fixtures";

let fx: StockFixture; // shop BẬT tự phát hành
let fx2: StockFixture; // shop KHÔNG bật tự phát hành
let productId: string;
let product2Id: string;
let called: string[] = [];
let delayMs = 0;
let nextResult: (input: CreateInvoiceInput) => InvoiceResult;
let seq = 0;

const fakeProvider: InvoiceProvider = {
  name: "MISA",
  capabilities: { ...MISA_CAPABILITIES, publishGapMs: 0 },
  async createInvoice(input) {
    called.push(input.orderCode);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return nextResult(input);
  },
  async cancelInvoice() {
    return { status: InvoiceLogStatus.FAILED };
  },
  async checkStatus() {
    return { status: InvoiceLogStatus.FAILED };
  },
  async findByReference() {
    return { kind: "LOOKUP_FAILED", message: "test" } as never;
  },
};

const issued = (): InvoiceResult => {
  seq += 1;
  return {
    status: InvoiceLogStatus.ISSUED,
    invoiceNo: `R${String(seq).padStart(7, "0")}`,
    transactionId: `REQ-TX-${fx.suffix}-${seq}`,
  };
};
const transientFault = (): InvoiceResult => ({
  status: InvoiceLogStatus.FAILED,
  errorScope: "TRANSIENT",
  errorCode: "HTTP_429",
  errorMessage: "meInvoice đang quá tải (test).",
});
const accountFault = (): InvoiceResult => ({
  status: InvoiceLogStatus.FAILED,
  errorScope: "ACCOUNT",
  errorCode: "UnAuthorize",
  errorMessage: "Sai mật khẩu meInvoice (test)",
});
const orderFault = (): InvoiceResult => ({
  status: InvoiceLogStatus.FAILED,
  errorScope: "ORDER",
  errorCode: "TaxRateInfo_VATRateName",
  errorMessage: "Tên thuế suất không hợp lệ (test)",
});
const unknownFault = (): InvoiceResult => ({
  status: InvoiceLogStatus.FAILED,
  errorScope: "TRANSIENT",
  errorCode: "NETWORK",
  errorMessage: "Đứt kết nối sau khi gửi lệnh (test)",
  outcomeUnknown: true,
});

const DAY = 86_400_000;
const MIN = 60_000;
const near = (d: Date, expectedMs: number, slackMs = 5_000) => Math.abs(d.getTime() - expectedMs) <= slackMs;

async function deliveredOrder(f: StockFixture, pid: string): Promise<string> {
  const id = await f.createOrder(pid, 1);
  const o = await prisma.order.update({
    where: { id },
    data: { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: new Date(Date.now() - DAY) },
    select: { orderCode: true },
  });
  return o.orderCode;
}

async function clearShop(f: StockFixture) {
  const orders = await prisma.order.findMany({ where: { channel: { userId: f.userId } }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  await prisma.invoiceRequest.deleteMany({ where: { ownerId: f.userId } });
  await prisma.notification.deleteMany({ where: { ownerId: f.userId } });
  await prisma.invoiceStatusHistory.deleteMany({ where: { invoiceLog: { ownerId: f.userId } } });
  await prisma.invoiceLog.deleteMany({ where: { ownerId: f.userId } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
}

const accept = (f: StockFixture, orderCodes: string[]) =>
  acceptBulkIssue({ ownerId: f.userId, channelWhere: { userId: f.userId }, orderCodes });
const only = () => ({ onlyOwnerIds: [fx.userId, fx2.userId] });
const requests = (f: StockFixture) =>
  prisma.invoiceRequest.findMany({ where: { ownerId: f.userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
/** Đưa mọi yêu cầu đang chờ của shop về "tới hạn ngay" (thay cho việc chờ 1 phút thật). */
const makeDue = (f: StockFixture) =>
  prisma.invoiceRequest.updateMany({ where: { ownerId: f.userId, status: "PENDING" }, data: { nextRetryAt: new Date() } });

beforeAll(async () => {
  fx = await createStockFixture("invreq");
  fx2 = await createStockFixture("invreq2");
  productId = await fx.createProduct(500);
  product2Id = await fx2.createProduct(500);
  for (const [f, auto] of [
    [fx, true],
    [fx2, false],
  ] as const) {
    await prisma.invoiceConfig.create({
      data: {
        ownerId: f.userId,
        provider: "MISA",
        invoicePattern: "1",
        invoiceSeries: "1C26TAA",
        taxCode: "0101234567",
        meinvoiceUsername: "req@test",
        meinvoicePassword: "x",
        autoIssueEnabled: auto,
        autoIssueTrigger: "DELIVERED",
      },
    });
  }
  providerHolder.current = fakeProvider;
  setInvoiceLaneWorkerId("test-worker-R");
});

beforeEach(async () => {
  called = [];
  delayMs = 0;
  nextResult = issued;
  resumeInvoiceLanes();
  await clearShop(fx);
  await clearShop(fx2);
  await prisma.invoiceLane.deleteMany({ where: { ownerId: { in: [fx.userId, fx2.userId] } } });
  await prisma.invoiceConfig.updateMany({
    where: { ownerId: { in: [fx.userId, fx2.userId] } },
    data: { autoIssuePausedAt: null, autoIssuePauseReason: null },
  });
});

afterEach(async () => {
  await whenInvoiceLanesIdle();
  resumeInvoiceLanes();
});

afterAll(async () => {
  await clearShop(fx);
  await clearShop(fx2);
  await fx.cleanup();
  await fx2.cleanup();
});

describe("Lát 9: gộp kết cục một lượt (hàm thuần)", () => {
  it("lỗi tạm / ngắt mạch thắng; rồi còn tồn; rồi đã làm; rồi rỗng", () => {
    expect(mergeLaneOutcome("TRANSIENT", null)).toBe("TRANSIENT");
    expect(mergeLaneOutcome("DONE", "TRANSIENT")).toBe("TRANSIENT");
    expect(mergeLaneOutcome("DONE", "PAUSED")).toBe("PAUSED");
    expect(mergeLaneOutcome("BACKLOG", null)).toBe("BACKLOG");
    expect(mergeLaneOutcome("IDLE", "BACKLOG")).toBe("BACKLOG");
    expect(mergeLaneOutcome("ABORTED", null)).toBe("DONE");
    expect(mergeLaneOutcome("IDLE", "DONE")).toBe("DONE");
    expect(mergeLaneOutcome("DONE", "IDLE")).toBe("DONE");
    expect(mergeLaneOutcome("IDLE", "IDLE")).toBe("IDLE");
    expect(mergeLaneOutcome("IDLE", null)).toBe("IDLE");
  });
});

describe("Lát 9: nhận yêu cầu", () => {
  it("lọc đơn không xuất được kèm lý do; bấm trùng không sinh dòng thứ hai; tạo làn cho shop chưa có", async () => {
    const a = await deliveredOrder(fx2, product2Id);
    const b = await deliveredOrder(fx2, product2Id);
    const cancelledId = await fx2.createOrder(product2Id, 1);
    const cancelled = (
      await prisma.order.update({ where: { id: cancelledId }, data: { shippingStatus: ShippingStatus.CANCELLED }, select: { orderCode: true } })
    ).orderCode;
    const foreign = await deliveredOrder(fx, productId); // đơn của shop khác = ngoài phạm vi

    const r = await accept(fx2, [a, b, cancelled, foreign, "KHONG-CO-DON-NAY"]);
    expect(r.queued).toBe(2);
    expect(r.batchId).toBeTruthy();
    expect(r.skipped.map((s) => s.orderCode).sort()).toEqual([cancelled, foreign, "KHONG-CO-DON-NAY"].sort());
    expect(r.skipped.find((s) => s.orderCode === cancelled)?.reason).toContain("đã hủy");
    expect(r.skipped.find((s) => s.orderCode === foreign)?.reason).toContain("Không tìm thấy");
    expect(await prisma.invoiceLane.findUnique({ where: { ownerId: fx2.userId } })).not.toBeNull();
    expect(await findActiveBatchId(fx2.userId)).toBe(r.batchId);
    expect([...(await openIssueRequestCodes(fx2.userId, [a, b, cancelled]))].sort()).toEqual([a, b].sort());
    expect(called).toEqual([]); // nhận yêu cầu KHÔNG gọi nhà cung cấp

    const again = await accept(fx2, [a, b]);
    expect(again.batchId).toBeNull();
    expect(again.queued).toBe(0);
    expect(again.skipped.every((s) => s.reason.includes("lượt xuất khác"))).toBe(true);
    expect(await prisma.invoiceRequest.count({ where: { ownerId: fx2.userId } })).toBe(2);
  });

  it("đơn đã có hóa đơn thì không nhận", async () => {
    const a = await deliveredOrder(fx2, product2Id);
    const first = await accept(fx2, [a]);
    await sweepInvoiceRequests(new Date(), only());
    await whenInvoiceLanesIdle();
    expect((await getBatchProgress(fx2.userId, first.batchId!))?.issued).toBe(1);
    const r = await accept(fx2, [a]);
    expect(r.batchId).toBeNull();
    expect(r.skipped[0].reason).toContain("đã có hóa đơn số");
  });
});

describe("Lát 9: làn xử lý yêu cầu bấm tay", () => {
  it("shop không bật tự phát hành vẫn xuất được; lịch tự phát hành giữ nguyên; xong lô có một chuông", async () => {
    const codes = [await deliveredOrder(fx2, product2Id), await deliveredOrder(fx2, product2Id), await deliveredOrder(fx2, product2Id)];
    const r = await accept(fx2, codes);
    const future = new Date(Date.now() + 10 * MIN);
    await prisma.invoiceLane.update({ where: { ownerId: fx2.userId }, data: { nextRunAt: future } });

    expect(await sweepInvoiceRequests(new Date(), only())).toBe(1);
    await whenInvoiceLanesIdle();

    expect(called).toEqual(codes); // cũ trước
    const p = await getBatchProgress(fx2.userId, r.batchId!);
    expect(p).toMatchObject({ total: 3, issued: 3, failed: 0, pending: 0, checking: 0, active: false });
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx2.userId, status: InvoiceLogStatus.ISSUED } })).toBe(3);
    const rows = await requests(fx2);
    expect(rows.every((x) => x.status === "DONE" && x.resultLogId && x.finishedAt)).toBe(true);
    const lane = await prisma.invoiceLane.findUniqueOrThrow({ where: { ownerId: fx2.userId } });
    expect(lane.leasedBy).toBeNull();
    expect(lane.nextRunAt.getTime()).toBe(future.getTime());
    const bells = await prisma.notification.findMany({ where: { ownerId: fx2.userId, type: "INVOICE_BULK_DONE" } });
    expect(bells).toHaveLength(1);
    expect(bells[0].title).toBe("Đã xuất 3/3 hóa đơn");
    expect(await findActiveBatchId(fx2.userId)).toBeNull();
    expect(await sweepInvoiceRequests(new Date(), only())).toBe(0);
  });

  it("một lượt: yêu cầu bấm tay trước, tự phát hành sau", async () => {
    const auto1 = await deliveredOrder(fx, productId);
    const auto2 = await deliveredOrder(fx, productId);
    const manual1 = await deliveredOrder(fx, productId);
    const manual2 = await deliveredOrder(fx, productId);
    // Đơn tự phát hành chỉ tính đơn giao từ ngày bật công tắc.
    await prisma.invoiceConfig.updateMany({ where: { ownerId: fx.userId }, data: { autoIssueEnabledAt: new Date(Date.now() - 3 * DAY) } });
    // Làn đã tới giờ theo lịch tự phát hành → lượt này làm cả hai phần.
    await prisma.invoiceLane.create({ data: { ownerId: fx.userId, nextRunAt: new Date(Date.now() - 1_000) } });
    await accept(fx, [manual2, manual1]);

    expect(await runInvoiceLaneOnce(fx.userId, { forRequests: true })).toBe("DONE");
    expect(called.slice(0, 2).sort()).toEqual([manual1, manual2].sort());
    expect(called.slice(2).sort()).toEqual([auto1, auto2].sort());
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx.userId, status: InvoiceLogStatus.ISSUED } })).toBe(4);
  });

  it("lỗi riêng đơn: đơn đó FAILED kèm lý do, đơn sau vẫn chạy", async () => {
    const codes = [await deliveredOrder(fx2, product2Id), await deliveredOrder(fx2, product2Id), await deliveredOrder(fx2, product2Id)];
    nextResult = (input) => (input.orderCode === codes[1] ? orderFault() : issued());
    const r = await accept(fx2, codes);
    await sweepInvoiceRequests(new Date(), only());
    await whenInvoiceLanesIdle();
    const p = await getBatchProgress(fx2.userId, r.batchId!);
    expect(p).toMatchObject({ total: 3, issued: 2, failed: 1, pending: 0, active: false });
    expect(p!.errors).toEqual([{ orderCode: codes[1], error: "Tên thuế suất không hợp lệ (test)" }]);
    expect(called).toEqual(codes);
    const bell = await prisma.notification.findFirstOrThrow({ where: { ownerId: fx2.userId, type: "INVOICE_BULK_DONE" } });
    expect(bell.title).toBe("Đã xuất 2/3 hóa đơn");
    expect(bell.body).toContain("1 đơn lỗi");
  });

  it("lỗi tạm: dừng lượt, cả phần chờ tính một lượt và hẹn 1 phút; đủ 3 lượt thì FAILED", async () => {
    const codes = [await deliveredOrder(fx2, product2Id), await deliveredOrder(fx2, product2Id)];
    nextResult = transientFault;
    const r = await accept(fx2, codes);

    expect(await runInvoiceLaneOnce(fx2.userId, { forRequests: true })).toBe("TRANSIENT");
    expect(called).toEqual([codes[0]]); // dừng ngay sau tờ đầu
    let rows = await requests(fx2);
    expect(rows.map((x) => [x.status, x.attempts])).toEqual([
      ["PENDING", 1],
      ["PENDING", 1],
    ]);
    expect(near(rows[0].nextRetryAt, Date.now() + REQUEST_RETRY_MS)).toBe(true);
    expect(await sweepInvoiceRequests(new Date(), only())).toBe(0); // chưa tới hạn

    for (let turn = 2; turn <= REQUEST_MAX_ATTEMPTS; turn++) {
      await makeDue(fx2);
      expect(await runInvoiceLaneOnce(fx2.userId, { forRequests: true })).toBe("TRANSIENT");
    }
    rows = await requests(fx2);
    expect(rows.every((x) => x.status === "FAILED" && x.attempts === REQUEST_MAX_ATTEMPTS)).toBe(true);
    expect(rows[1].error).toContain("quá tải");
    expect(rows[1].error).toContain(`Đã thử ${REQUEST_MAX_ATTEMPTS} lượt`);
    expect(called).toHaveLength(REQUEST_MAX_ATTEMPTS); // mỗi lượt đúng một lệnh gọi
    expect((await getBatchProgress(fx2.userId, r.batchId!))?.active).toBe(false);
    // Đơn chưa đụng tới không có dòng nhật ký nào → vẫn nằm ở Hàng chờ để tick lại.
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx2.userId, orderCode: codes[1] } })).toBe(0);
  });

  it("lỗi tạm rồi nhà cung cấp ổn lại: lượt sau xuất hết", async () => {
    const codes = [await deliveredOrder(fx2, product2Id), await deliveredOrder(fx2, product2Id)];
    nextResult = transientFault;
    const r = await accept(fx2, codes);
    await runInvoiceLaneOnce(fx2.userId, { forRequests: true });
    nextResult = issued;
    await makeDue(fx2);
    expect(await runInvoiceLaneOnce(fx2.userId, { forRequests: true })).toBe("DONE");
    expect(await getBatchProgress(fx2.userId, r.batchId!)).toMatchObject({ issued: 2, failed: 0, active: false });
  });

  it("lỗi tài khoản: phần còn lại FAILED cùng lý do, gọi nhà cung cấp một lần, không ngắt mạch tự phát hành", async () => {
    const codes = [await deliveredOrder(fx, productId), await deliveredOrder(fx, productId), await deliveredOrder(fx, productId)];
    nextResult = accountFault;
    await prisma.invoiceLane.create({ data: { ownerId: fx.userId, nextRunAt: new Date(Date.now() + 10 * MIN) } });
    const r = await accept(fx, codes);
    expect(await runInvoiceLaneOnce(fx.userId, { forRequests: true })).toBe("DONE");
    expect(called).toEqual([codes[0]]);
    const rows = await requests(fx);
    expect(rows.every((x) => x.status === "FAILED" && x.error === "Sai mật khẩu meInvoice (test)")).toBe(true);
    expect(await getBatchProgress(fx.userId, r.batchId!)).toMatchObject({ failed: 3, issued: 0, active: false });
    const cfg = await prisma.invoiceConfig.findFirstOrThrow({ where: { ownerId: fx.userId, channelId: null } });
    expect(cfg.autoIssuePausedAt).toBeNull();
  });

  it("quá 20 yêu cầu: lượt đầu 20, phần còn lại nghỉ rồi mới chạy; lô bấm thêm xếp sau mốc nghỉ", async () => {
    const codes: string[] = [];
    for (let i = 0; i < 22; i++) codes.push(await deliveredOrder(fx2, product2Id));
    const r = await accept(fx2, codes);
    expect(r.queued).toBe(22);

    expect(await runInvoiceLaneOnce(fx2.userId, { forRequests: true })).toBe("BACKLOG");
    expect(called).toHaveLength(20);
    let p = await getBatchProgress(fx2.userId, r.batchId!);
    expect(p).toMatchObject({ issued: 20, pending: 2, active: true });
    const waiting = (await requests(fx2)).filter((x) => x.status === "PENDING");
    expect(waiting.every((x) => near(x.nextRetryAt, Date.now() + requestBacklogDelayMs()))).toBe(true);
    expect(await sweepInvoiceRequests(new Date(), only())).toBe(0); // đang nghỉ
    expect(await prisma.notification.count({ where: { ownerId: fx2.userId, type: "INVOICE_BULK_DONE" } })).toBe(0);

    // Bấm thêm một lô trong lúc nghỉ → xếp sau mốc nghỉ, không chạy ngay.
    const extra = await deliveredOrder(fx2, product2Id);
    const r2 = await accept(fx2, [extra]);
    expect(r2.queued).toBe(1);
    expect(await sweepInvoiceRequests(new Date(), only())).toBe(0);

    await makeDue(fx2);
    expect(await sweepInvoiceRequests(new Date(), only())).toBe(1);
    await whenInvoiceLanesIdle();
    p = await getBatchProgress(fx2.userId, r.batchId!);
    expect(p).toMatchObject({ issued: 22, pending: 0, active: false });
    expect((await getBatchProgress(fx2.userId, r2.batchId!))?.issued).toBe(1);
    expect(called).toHaveLength(23);
    expect(new Set(called).size).toBe(23);
  });

  it("dừng phần còn lại: yêu cầu chưa chạy CANCELLED, tờ đang dở vẫn xong", async () => {
    const codes = [await deliveredOrder(fx2, product2Id), await deliveredOrder(fx2, product2Id), await deliveredOrder(fx2, product2Id)];
    const r = await accept(fx2, codes);
    delayMs = 400;
    const turn = runInvoiceLaneOnce(fx2.userId, { forRequests: true });
    await new Promise((res) => setTimeout(res, 150)); // tờ đầu đang gọi dở
    expect(await cancelBatch(fx2.userId, r.batchId!)).toBe(3); // cả tờ đang dở cũng còn PENDING ở bảng yêu cầu
    await turn;
    expect(called).toEqual([codes[0]]);
    // Tờ đang dở đã phát hành thật → nhật ký hóa đơn ghi ISSUED dù yêu cầu mang CANCELLED.
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx2.userId, status: InvoiceLogStatus.ISSUED } })).toBe(1);
    const p = await getBatchProgress(fx2.userId, r.batchId!);
    expect(p).toMatchObject({ cancelled: 3, pending: 0, active: false });
    expect(await sweepInvoiceRequests(new Date(), only())).toBe(0);
  });

  it("dừng êm giữa lô: yêu cầu còn PENDING, lượt sau làm tiếp, không tờ nào lập hai lần", async () => {
    const codes = [await deliveredOrder(fx2, product2Id), await deliveredOrder(fx2, product2Id), await deliveredOrder(fx2, product2Id)];
    const r = await accept(fx2, codes);
    delayMs = 300;
    expect(await sweepInvoiceRequests(new Date(), only())).toBe(1);
    await new Promise((res) => setTimeout(res, 100));
    await stopInvoiceLanes(5_000);
    expect(called).toEqual([codes[0]]);
    let p = await getBatchProgress(fx2.userId, r.batchId!);
    expect(p).toMatchObject({ issued: 1, pending: 2, active: true });
    expect((await prisma.invoiceLane.findUniqueOrThrow({ where: { ownerId: fx2.userId } })).leasedBy).toBeNull();
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx2.userId, status: InvoiceLogStatus.PENDING } })).toBe(0);

    delayMs = 0;
    resumeInvoiceLanes();
    expect(await sweepInvoiceRequests(new Date(), only())).toBe(1);
    await whenInvoiceLanesIdle();
    p = await getBatchProgress(fx2.userId, r.batchId!);
    expect(p).toMatchObject({ issued: 3, pending: 0, active: false });
    expect(called).toEqual(codes);
  });

  it("chưa rõ kết quả: yêu cầu đóng với mã OUTCOME_UNKNOWN, đếm riêng là đang kiểm lại", async () => {
    const codes = [await deliveredOrder(fx2, product2Id), await deliveredOrder(fx2, product2Id)];
    nextResult = (input) => (input.orderCode === codes[0] ? unknownFault() : issued());
    const r = await accept(fx2, codes);
    await sweepInvoiceRequests(new Date(), only());
    await whenInvoiceLanesIdle();
    const p = await getBatchProgress(fx2.userId, r.batchId!);
    expect(p).toMatchObject({ total: 2, issued: 1, checking: 1, failed: 0, active: false });
    const rows = await requests(fx2);
    expect(rows[0]).toMatchObject({ status: "DONE", errorCode: "OUTCOME_UNKNOWN" });
    // Dòng nhật ký giữ PENDING = vé của đơn (lát 6b); bấm lại thì không nhận.
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx2.userId, orderCode: codes[0], status: InvoiceLogStatus.PENDING } })).toBe(1);
    const again = await accept(fx2, [codes[0]]);
    expect(again.batchId).toBeNull();
    expect(again.skipped[0].reason).toContain("chờ kết quả");
    const bell = await prisma.notification.findFirstOrThrow({ where: { ownerId: fx2.userId, type: "INVOICE_BULK_DONE" } });
    expect(bell.body).toContain("1 tờ đang kiểm lại");
  });

  it("làn đang do tiến trình khác thuê: không chạy, yêu cầu giữ nguyên", async () => {
    const codes = [await deliveredOrder(fx2, product2Id)];
    const r = await accept(fx2, codes);
    expect(await claimInvoiceLane(fx2.userId, "worker-khac", new Date(), { ignoreSchedule: true })).toBe(true);
    expect(await runInvoiceLaneOnce(fx2.userId, { forRequests: true })).toBeNull();
    expect(called).toEqual([]);
    expect((await getBatchProgress(fx2.userId, r.batchId!))?.pending).toBe(1);
  });
});
