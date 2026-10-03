// ============================================================
// XUẤT MỘT ĐƠN THEO MÃ + ĐIỀU CHỈNH TAY QUA LÀN — hóa đơn bước 5, lát 10 (03/10/2026).
// Chạy trên database dev. Nhà cung cấp thay bằng adapter giả; KHÔNG chạm MISA.
// pg-boss không khởi động trong test: làn được gọi thẳng (đúng việc tín hiệu sẽ làm).
//
//   1. Phạm vi điều chỉnh ghi được vào JSON rồi đọc lại đúng (hàm thuần).
//   2. Xuất một đơn: ghi yêu cầu → làn phát hành → nơi chờ nhận đúng kết quả; không chuông.
//   3. Đơn / hóa đơn đang có yêu cầu chờ → không ghi yêu cầu thứ hai.
//   4. Lỗi tạm với yêu cầu đơn lẻ: hỏng NGAY (không tự thử lại), các yêu cầu của lô vẫn hẹn lại.
//   5. Điều chỉnh tay qua làn: lập đúng mã <mã đơn>-DC1, nơi chờ nhận 201 + dòng nhật ký.
//   6. Điều chỉnh bị chặn (hóa đơn gốc đã xóa bên nhà cung cấp): nơi chờ nhận đủ mã + lý do + việc nên làm.
//   7. Hết thời gian chờ: trả "đã nhận", khi làn làm xong thì có MỘT chuông, kết quả vẫn được ghi.
//   8. Yêu cầu đơn lẻ không bị xếp sau mốc nghỉ của lô đang chạy.
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
import { issueInvoiceForOrder } from "../invoice/issue-order";
import { MISA_CAPABILITIES } from "../invoice/misa-provider";
import type { CreateInvoiceInput, InvoiceProvider, InvoiceResult, ReferenceLookup } from "../invoice/types";
import {
  acceptBulkIssue,
  awaitRequest,
  decodeAdjustScope,
  encodeAdjustScope,
  REQUEST_KIND_ADJUST,
  REQUEST_KIND_ISSUE,
  submitSingleRequest,
} from "../../services/invoice-requests";
import { resumeInvoiceLanes, runInvoiceLaneOnce, setInvoiceLaneWorkerId, whenInvoiceLanesIdle } from "../../workers/invoice-lanes";
import { createStockFixture, type StockFixture } from "./fixtures";

const NOT_FOUND: ReferenceLookup = { state: "NOT_FOUND" };

let fx: StockFixture;
let productId: string;
let seq = 0;
let atProvider: Record<string, ReferenceLookup>;
let createCalls: CreateInvoiceInput[];
let createResult: (input: CreateInvoiceInput) => InvoiceResult;

const issuedNow = (input: CreateInvoiceInput): InvoiceResult => {
  seq += 1;
  const invoiceNo = `S${String(seq).padStart(7, "0")}`;
  const transactionId = `SINGLE-TX-${fx.suffix}-${seq}`;
  atProvider[input.orderCode] = { state: "FOUND", invoiceNo, transactionId, issued: true, deleted: false, matches: 1 };
  return { status: InvoiceLogStatus.ISSUED, invoiceNo, transactionId };
};
const transientFault = (): InvoiceResult => ({
  status: InvoiceLogStatus.FAILED,
  errorScope: "TRANSIENT",
  errorCode: "HTTP_429",
  errorMessage: "meInvoice đang quá tải (test).",
});

async function deliveredOrder(): Promise<string> {
  const id = await fx.createOrder(productId, 1);
  const o = await prisma.order.update({
    where: { id },
    data: { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: new Date() },
    select: { orderCode: true },
  });
  return o.orderCode;
}

/** Hóa đơn gốc đã phát hành (qua lõi thật) để làm đích điều chỉnh. */
async function issuedOriginal(): Promise<{ id: string; orderCode: string; invoiceNo: string }> {
  const orderCode = await deliveredOrder();
  const r = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, orderCode);
  expect(r.ok).toBe(true);
  createCalls.length = 0;
  return { id: r.log!.id, orderCode, invoiceNo: r.log!.invoiceNo! };
}

const lane = () => runInvoiceLaneOnce(fx.userId, { forRequests: true });
const bells = () => prisma.notification.findMany({ where: { ownerId: fx.userId, type: "INVOICE_SINGLE_DONE" } });

beforeAll(async () => {
  fx = await createStockFixture("invsingle");
  productId = await fx.createProduct(500);
  await prisma.invoiceConfig.create({
    data: { ownerId: fx.userId, provider: "MISA", invoicePattern: "1", invoiceSeries: "1C26TAA" },
  });
  setInvoiceLaneWorkerId("test-worker-S");
});

beforeEach(async () => {
  atProvider = {};
  createCalls = [];
  createResult = issuedNow;
  providerHolder.current = {
    name: "MISA",
    capabilities: { ...MISA_CAPABILITIES, publishGapMs: 0 },
    async createInvoice(input: CreateInvoiceInput) {
      createCalls.push(input);
      return createResult(input);
    },
    async cancelInvoice() {
      return { status: InvoiceLogStatus.FAILED };
    },
    async checkStatus() {
      return { status: InvoiceLogStatus.FAILED };
    },
    async findByReference(reference: string) {
      return atProvider[reference] ?? NOT_FOUND;
    },
  } satisfies InvoiceProvider;
  resumeInvoiceLanes();
  await prisma.invoiceRequest.deleteMany({ where: { ownerId: fx.userId } });
  await prisma.notification.deleteMany({ where: { ownerId: fx.userId } });
  await prisma.invoiceLane.deleteMany({ where: { ownerId: fx.userId } });
});

afterEach(async () => {
  await whenInvoiceLanesIdle();
});

afterAll(async () => {
  await prisma.invoiceRequest.deleteMany({ where: { ownerId: fx.userId } });
  await prisma.notification.deleteMany({ where: { ownerId: fx.userId } });
  await prisma.invoiceStatusHistory.deleteMany({ where: { invoiceLog: { ownerId: fx.userId } } });
  await prisma.invoiceLog.deleteMany({ where: { ownerId: fx.userId } });
  await fx.cleanup();
});

describe("Lát 10: phạm vi điều chỉnh ghi vào JSON", () => {
  it("FULL / AMOUNT / ITEMS đọc lại đúng; dữ liệu lạ về FULL", () => {
    expect(decodeAdjustScope(encodeAdjustScope({ kind: "FULL" }))).toEqual({ kind: "FULL" });
    expect(decodeAdjustScope(encodeAdjustScope({ kind: "AMOUNT", amount: 120000 }))).toEqual({ kind: "AMOUNT", amount: 120000 });
    const items = decodeAdjustScope(JSON.parse(JSON.stringify(encodeAdjustScope({ kind: "ITEMS", bySku: new Map([["SKU-A", 2], ["SKU-B", 1]]) }))));
    expect(items.kind).toBe("ITEMS");
    expect(items.kind === "ITEMS" && [...items.bySku.entries()]).toEqual([["SKU-A", 2], ["SKU-B", 1]]);
    expect(decodeAdjustScope(null)).toEqual({ kind: "FULL" });
    expect(decodeAdjustScope({ kind: "LA" })).toEqual({ kind: "FULL" });
  });
});

describe("Lát 10: xuất một đơn theo mã qua làn", () => {
  it("ghi yêu cầu → làn phát hành → nơi chờ nhận đúng kết quả; không chuông", async () => {
    const orderCode = await deliveredOrder();
    const submitted = await submitSingleRequest({ ownerId: fx.userId, kind: REQUEST_KIND_ISSUE, targetKey: orderCode });
    expect(submitted).not.toBeNull();
    expect(createCalls).toHaveLength(0); // ghi yêu cầu KHÔNG gọi nhà cung cấp
    expect(await prisma.invoiceLane.findUnique({ where: { ownerId: fx.userId } })).not.toBeNull();

    const waiting = awaitRequest(fx.userId, submitted!.id, 5_000);
    expect(await lane()).toBe("DONE");
    const done = await waiting;
    expect(done).toMatchObject({ status: "DONE", result: { httpStatus: 201 } });
    const log = await prisma.invoiceLog.findUniqueOrThrow({ where: { id: done!.resultLogId! } });
    expect(log).toMatchObject({ orderCode, status: InvoiceLogStatus.ISSUED });
    expect(createCalls.map((c) => c.orderCode)).toEqual([orderCode]);
    expect(await bells()).toHaveLength(0);
  });

  it("đơn đang có yêu cầu chờ (đơn lẻ hoặc trong lô) → không ghi yêu cầu thứ hai", async () => {
    const a = await deliveredOrder();
    const b = await deliveredOrder();
    expect(await submitSingleRequest({ ownerId: fx.userId, kind: REQUEST_KIND_ISSUE, targetKey: a })).not.toBeNull();
    expect(await submitSingleRequest({ ownerId: fx.userId, kind: REQUEST_KIND_ISSUE, targetKey: a })).toBeNull();
    await acceptBulkIssue({ ownerId: fx.userId, channelWhere: { userId: fx.userId }, orderCodes: [b] });
    expect(await submitSingleRequest({ ownerId: fx.userId, kind: REQUEST_KIND_ISSUE, targetKey: b })).toBeNull();
    expect(await prisma.invoiceRequest.count({ where: { ownerId: fx.userId } })).toBe(2);
  });

  it("lỗi tạm: yêu cầu đơn lẻ hỏng NGAY kèm lý do, yêu cầu của lô vẫn hẹn lại", async () => {
    const single = await deliveredOrder();
    const inBatch = await deliveredOrder();
    createResult = transientFault;
    const submitted = await submitSingleRequest({ ownerId: fx.userId, kind: REQUEST_KIND_ISSUE, targetKey: single });
    const batch = await acceptBulkIssue({ ownerId: fx.userId, channelWhere: { userId: fx.userId }, orderCodes: [inBatch] });

    expect(await lane()).toBe("TRANSIENT");
    const done = await awaitRequest(fx.userId, submitted!.id, 1_000);
    expect(done).toMatchObject({ status: "FAILED", result: { httpStatus: 502 } });
    expect(done!.error).toContain("quá tải");
    const batchRow = await prisma.invoiceRequest.findFirstOrThrow({ where: { ownerId: fx.userId, batchId: batch.batchId } });
    expect(batchRow).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(batchRow.nextRetryAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect(createCalls).toHaveLength(1); // dừng lượt ngay sau tờ lỗi tạm
  });

  it("yêu cầu đơn lẻ không bị xếp sau mốc nghỉ của lô", async () => {
    const resting = await deliveredOrder();
    const urgent = await deliveredOrder();
    await acceptBulkIssue({ ownerId: fx.userId, channelWhere: { userId: fx.userId }, orderCodes: [resting] });
    await prisma.invoiceRequest.updateMany({ where: { ownerId: fx.userId }, data: { nextRetryAt: new Date(Date.now() + 60_000) } });
    const submitted = await submitSingleRequest({ ownerId: fx.userId, kind: REQUEST_KIND_ISSUE, targetKey: urgent });
    expect(await lane()).toBe("DONE");
    expect(createCalls.map((c) => c.orderCode)).toEqual([urgent]);
    expect((await awaitRequest(fx.userId, submitted!.id, 1_000))?.status).toBe("DONE");
  });
});

describe("Lát 10: điều chỉnh tay qua làn", () => {
  it("lập đúng mã <mã đơn>-DC1, nơi chờ nhận 201 + dòng nhật ký điều chỉnh", async () => {
    const original = await issuedOriginal();
    const submitted = await submitSingleRequest({
      ownerId: fx.userId,
      kind: REQUEST_KIND_ADJUST,
      targetKey: original.id,
      params: { reason: "Khách trả hàng hoàn tiền", scope: encodeAdjustScope({ kind: "FULL" }) },
    });
    expect(submitted).not.toBeNull();
    // Bấm lần hai khi yêu cầu còn chờ → không ghi thêm.
    expect(
      await submitSingleRequest({ ownerId: fx.userId, kind: REQUEST_KIND_ADJUST, targetKey: original.id, params: { reason: "x", scope: { kind: "FULL" } } })
    ).toBeNull();

    const waiting = awaitRequest(fx.userId, submitted!.id, 5_000);
    expect(await lane()).toBe("DONE");
    const done = await waiting;
    expect(done).toMatchObject({ status: "DONE", result: { httpStatus: 201 } });
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].orderCode).toBe(`${original.orderCode}-DC1`);
    expect(createCalls[0].adjustment?.orgInvNo).toBe(original.invoiceNo);
    const adj = await prisma.invoiceLog.findUniqueOrThrow({ where: { id: done!.resultLogId! } });
    expect(adj).toMatchObject({ adjustmentForLogId: original.id, status: InvoiceLogStatus.ISSUED });
  });

  it("bị chặn vì hóa đơn gốc đã xóa bên nhà cung cấp: nơi chờ nhận đủ mã + lý do + việc nên làm, không lập gì", async () => {
    const original = await issuedOriginal();
    atProvider[original.orderCode] = { ...(atProvider[original.orderCode] as object), deleted: true } as ReferenceLookup;
    const submitted = await submitSingleRequest({
      ownerId: fx.userId,
      kind: REQUEST_KIND_ADJUST,
      targetKey: original.id,
      params: { reason: "Khách trả hàng hoàn tiền", scope: { kind: "FULL" } },
    });
    await lane();
    const done = await awaitRequest(fx.userId, submitted!.id, 1_000);
    expect(done).toMatchObject({ status: "FAILED", result: { httpStatus: 409, code: "HUBSELL_ADJUST_ORIGINAL_DELETED" } });
    expect(done!.result!.reason).toContain(original.invoiceNo);
    expect(done!.result!.suggestion).toBeTruthy();
    expect(createCalls).toHaveLength(0);
    expect(await prisma.invoiceLog.count({ where: { adjustmentForLogId: original.id } })).toBe(0);
  });
});

describe("Lát 10: hết thời gian chờ", () => {
  it("trả 'đã nhận'; làn làm xong thì có MỘT chuông và kết quả vẫn được ghi", async () => {
    const orderCode = await deliveredOrder();
    const submitted = await submitSingleRequest({ ownerId: fx.userId, kind: REQUEST_KIND_ISSUE, targetKey: orderCode });
    // Làn chưa chạy (đang bận lượt khác) → nơi chờ hết kiên nhẫn.
    expect(await awaitRequest(fx.userId, submitted!.id, 0)).toBeNull();
    const row = await prisma.invoiceRequest.findUniqueOrThrow({ where: { id: submitted!.id } });
    expect(row.status).toBe("PENDING");
    expect((row.params as { notify?: boolean }).notify).toBe(true);

    expect(await lane()).toBe("DONE");
    const done = await awaitRequest(fx.userId, submitted!.id, 1_000);
    expect(done).toMatchObject({ status: "DONE", result: { httpStatus: 201 } });
    const rung = await bells();
    expect(rung).toHaveLength(1);
    expect(rung[0].title).toContain(`Đã lập hóa đơn cho đơn ${orderCode}`);
  });

  it("yêu cầu xong đúng lúc hết thời gian chờ → vẫn trả kết quả, không chuông", async () => {
    const orderCode = await deliveredOrder();
    const submitted = await submitSingleRequest({ ownerId: fx.userId, kind: REQUEST_KIND_ISSUE, targetKey: orderCode });
    await lane();
    const done = await awaitRequest(fx.userId, submitted!.id, 0);
    expect(done).toMatchObject({ status: "DONE", result: { httpStatus: 201 } });
    expect(await bells()).toHaveLength(0);
  });
});
