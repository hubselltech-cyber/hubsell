// ============================================================
// ĐIỀU CHỈNH TỰ ĐỘNG KHI SÀN CHỐT HOÀN THÀNH YÊU CẦU BỀN — hóa đơn bước 5, lát 11
// (03/10/2026). Chạy trên database dev. Nhà cung cấp thay bằng adapter giả; KHÔNG chạm MISA.
//
//   1. Chế độ legacy: "before" không ghi gì (đường cũ giữ nguyên).
//   2. Chế độ queue: "before" ghi MỘT dòng giữ chỗ (không gọi nhà cung cấp, gọi hai lần
//      vẫn một dòng); "after" thả cho chạy; làn lập điều chỉnh đúng phạm vi sàn báo.
//   3. Shop tắt công tắc / đơn chưa có hóa đơn / hóa đơn đã có điều chỉnh → không ghi.
//   4. Sàn chưa báo số → hẹn lại 60 phút; có số rồi → lập đúng phần tiền hoàn.
//   5. Đơn chưa mang trạng thái "hoàn đã chốt" (lượt ghi đơn chưa xong) → xem lại sau 1 phút.
//   6. Nhà cung cấp lỗi tạm → hẹn lại 60 phút, không chuông, lượt dừng.
//   7. Bị chặn (hóa đơn gốc đã xóa bên nhà cung cấp) → FAILED + MỘT chuông bảo làm tay.
//   8. Quá 7 ngày sàn vẫn chưa báo số → FAILED + chuông.
//   9. Lô bấm tay gặp lỗi tài khoản không kéo yêu cầu tự động hỏng theo.
//  10. Chủ shop bấm điều chỉnh tay khi yêu cầu tự động còn chờ → bấm tay thắng.
//  11. Shop tắt công tắc sau khi đã ghi yêu cầu → yêu cầu tự hủy, không lập gì.
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
import { PLATFORM_RETURN_DONE_STATUSES } from "../invoice/adjust-order";
import { issueInvoiceForOrder } from "../invoice/issue-order";
import { MISA_CAPABILITIES } from "../invoice/misa-provider";
import type { CreateInvoiceInput, InvoiceProvider, InvoiceResult, ReferenceLookup } from "../invoice/types";
import {
  AUTO_ADJUST_HOLD_MS,
  AUTO_ADJUST_NOT_READY_MS,
  AUTO_ADJUST_RETRY_MS,
  autoAdjustOnPlatformReturn,
  REQUEST_KIND_ADJUST,
  REQUEST_KIND_ISSUE,
  submitSingleRequest,
} from "../../services/invoice-requests";
import { resumeInvoiceLanes, runInvoiceLaneOnce, setInvoiceLaneWorkerId, whenInvoiceLanesIdle } from "../../workers/invoice-lanes";
import { createStockFixture, type StockFixture } from "./fixtures";

const NOT_FOUND: ReferenceLookup = { state: "NOT_FOUND" };
const DONE_STATUS = [...PLATFORM_RETURN_DONE_STATUSES][0];
const MIN = 60_000;
const DAY = 86_400_000;

let fx: StockFixture;
let productId: string;
let seq = 0;
let atProvider: Record<string, ReferenceLookup>;
let createCalls: CreateInvoiceInput[];
let createResult: (input: CreateInvoiceInput) => InvoiceResult;

const issuedNow = (input: CreateInvoiceInput): InvoiceResult => {
  seq += 1;
  const invoiceNo = `A${String(seq).padStart(7, "0")}`;
  const transactionId = `AUTOADJ-TX-${fx.suffix}-${seq}`;
  atProvider[input.orderCode] = { state: "FOUND", invoiceNo, transactionId, issued: true, deleted: false, matches: 1 };
  return { status: InvoiceLogStatus.ISSUED, invoiceNo, transactionId };
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

interface Original {
  logId: string;
  orderId: string;
  orderCode: string;
  invoiceNo: string;
  total: number;
}

/** Đơn đã giao + hóa đơn gốc đã phát hành (qua lõi thật). */
async function issuedOriginal(): Promise<Original> {
  const orderId = await fx.createOrder(productId, 1);
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: new Date() },
    select: { orderCode: true },
  });
  const r = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, order.orderCode);
  expect(r.ok).toBe(true);
  createCalls.length = 0;
  return { logId: r.log!.id, orderId, orderCode: order.orderCode, invoiceNo: r.log!.invoiceNo!, total: r.log!.totalAmount };
}

/** Việc đồng bộ hoàn làm: ghi trạng thái "hoàn đã chốt" + số tiền sàn hoàn lên đơn. */
const markReturnDone = (orderId: string, refund: number) =>
  prisma.order.update({ where: { id: orderId }, data: { platformReturnStatus: DONE_STATUS, platformRefundAmount: refund } });

const lane = () => runInvoiceLaneOnce(fx.userId, { forRequests: true });
const autoRow = (o: Original) =>
  prisma.invoiceRequest.findFirst({ where: { ownerId: fx.userId, source: "AUTO_RETURN", targetKey: o.logId }, orderBy: { createdAt: "desc" } });
const makeDue = () =>
  prisma.invoiceRequest.updateMany({ where: { ownerId: fx.userId, status: "PENDING" }, data: { nextRetryAt: new Date(Date.now() - 1_000) } });
const adjustments = (o: Original) => prisma.invoiceLog.findMany({ where: { adjustmentForLogId: o.logId } });
const bells = () => prisma.notification.findMany({ where: { ownerId: fx.userId, type: "INVOICE_AUTO_ADJUST_FAILED" } });
const near = (d: Date, expectedMs: number, slackMs = 5_000) => Math.abs(d.getTime() - expectedMs) <= slackMs;
const setAutoAdjust = (enabled: boolean) =>
  prisma.invoiceConfig.updateMany({ where: { ownerId: fx.userId, channelId: null }, data: { autoAdjustEnabled: enabled } });

beforeAll(async () => {
  fx = await createStockFixture("invautoadj");
  productId = await fx.createProduct(500);
  await prisma.invoiceConfig.create({
    data: { ownerId: fx.userId, provider: "MISA", invoicePattern: "1", invoiceSeries: "1C26TAA", autoAdjustEnabled: true },
  });
  setInvoiceLaneWorkerId("test-worker-AA");
});

beforeEach(async () => {
  process.env.INVOICE_AUTO_ADJUST_MODE = "queue";
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
  await setAutoAdjust(true);
  await prisma.invoiceRequest.deleteMany({ where: { ownerId: fx.userId } });
  await prisma.notification.deleteMany({ where: { ownerId: fx.userId } });
  await prisma.invoiceLane.deleteMany({ where: { ownerId: fx.userId } });
});

afterEach(async () => {
  delete process.env.INVOICE_AUTO_ADJUST_MODE;
  await whenInvoiceLanesIdle();
});

afterAll(async () => {
  await prisma.invoiceRequest.deleteMany({ where: { ownerId: fx.userId } });
  await prisma.notification.deleteMany({ where: { ownerId: fx.userId } });
  await prisma.invoiceStatusHistory.deleteMany({ where: { invoiceLog: { ownerId: fx.userId } } });
  await prisma.invoiceLog.deleteMany({ where: { ownerId: fx.userId, adjustmentForLogId: { not: null } } });
  await prisma.invoiceLog.deleteMany({ where: { ownerId: fx.userId } });
  await fx.cleanup();
});

describe("Lát 11: ghi yêu cầu điều chỉnh tự động", () => {
  it("chế độ legacy: 'before' không ghi gì", async () => {
    process.env.INVOICE_AUTO_ADJUST_MODE = "legacy";
    const o = await issuedOriginal();
    await autoAdjustOnPlatformReturn(fx.userId, o.orderId, "before");
    expect(await prisma.invoiceRequest.count({ where: { ownerId: fx.userId } })).toBe(0);
  });

  it("chế độ queue: 'before' ghi MỘT dòng giữ chỗ, gọi hai lần vẫn một dòng; 'after' thả; làn lập đúng phạm vi", async () => {
    const o = await issuedOriginal();
    await autoAdjustOnPlatformReturn(fx.userId, o.orderId, "before");
    await autoAdjustOnPlatformReturn(fx.userId, o.orderId, "before"); // lượt đồng bộ sau thấy lại lần chuyển trạng thái
    expect(await prisma.invoiceRequest.count({ where: { ownerId: fx.userId } })).toBe(1);
    let row = await autoRow(o);
    expect(row).toMatchObject({ kind: REQUEST_KIND_ADJUST, source: "AUTO_RETURN", status: "PENDING", batchId: null, attempts: 0 });
    expect((row!.params as { orderId?: string; scope?: unknown }).orderId).toBe(o.orderId);
    expect((row!.params as { scope?: unknown }).scope).toBeUndefined(); // phạm vi quyết lúc chạy
    expect(near(row!.nextRetryAt, Date.now() + AUTO_ADJUST_HOLD_MS)).toBe(true);
    expect(createCalls).toHaveLength(0);
    expect(await lane()).toBe("IDLE"); // đang giữ chỗ → làn chưa đụng tới

    await markReturnDone(o.orderId, o.total); // sàn hoàn toàn bộ tiền
    await autoAdjustOnPlatformReturn(fx.userId, o.orderId, "after");
    row = await autoRow(o);
    expect(row!.nextRetryAt.getTime()).toBeLessThan(Date.now());

    expect(await lane()).toBe("DONE");
    row = await autoRow(o);
    expect(row).toMatchObject({ status: "DONE" });
    const adj = await adjustments(o);
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ status: InvoiceLogStatus.ISSUED, providerRef: `${o.orderCode}-DC1` });
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].adjustment?.orgInvNo).toBe(o.invoiceNo);
    expect(await bells()).toHaveLength(0);
  });

  it("shop tắt công tắc / đơn chưa có hóa đơn / hóa đơn đã có điều chỉnh → không ghi", async () => {
    const o = await issuedOriginal();
    await setAutoAdjust(false);
    await autoAdjustOnPlatformReturn(fx.userId, o.orderId, "before");
    await setAutoAdjust(true);

    const bareOrderId = await fx.createOrder(productId, 1); // chưa từng xuất hóa đơn
    await autoAdjustOnPlatformReturn(fx.userId, bareOrderId, "before");

    const adjusted = await issuedOriginal();
    await submitSingleRequest({ ownerId: fx.userId, kind: REQUEST_KIND_ADJUST, targetKey: adjusted.logId, params: { reason: "tay", scope: { kind: "FULL" } } });
    await lane();
    expect(await adjustments(adjusted)).toHaveLength(1);
    await autoAdjustOnPlatformReturn(fx.userId, adjusted.orderId, "before");

    expect(await prisma.invoiceRequest.count({ where: { ownerId: fx.userId, source: "AUTO_RETURN" } })).toBe(0);
  });
});

describe("Lát 11: làn xử lý yêu cầu điều chỉnh tự động", () => {
  /** Ghi yêu cầu rồi thả ngay (đồng bộ hoàn đã ghi xong đơn). */
  async function enqueueReleased(o: Original, refund: number | null): Promise<void> {
    await autoAdjustOnPlatformReturn(fx.userId, o.orderId, "before");
    if (refund !== null) await markReturnDone(o.orderId, refund);
    await autoAdjustOnPlatformReturn(fx.userId, o.orderId, "after");
  }

  it("sàn chưa báo số → hẹn lại 60 phút; có số rồi → lập đúng phần tiền hoàn", async () => {
    const o = await issuedOriginal();
    await enqueueReleased(o, 0); // đã chốt hoàn nhưng chưa có số tiền, chưa có dòng hàng trả
    expect(await lane()).toBe("DONE");
    let row = await autoRow(o);
    expect(row).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(row!.error).toContain("Sàn chưa báo");
    expect(near(row!.nextRetryAt, Date.now() + AUTO_ADJUST_RETRY_MS)).toBe(true);
    expect(createCalls).toHaveLength(0);

    const part = Math.round(o.total / 2);
    await markReturnDone(o.orderId, part);
    await makeDue();
    expect(await lane()).toBe("DONE");
    row = await autoRow(o);
    expect(row).toMatchObject({ status: "DONE" });
    const adj = await adjustments(o);
    expect(adj).toHaveLength(1);
    // Giảm đúng phần sàn hoàn (số âm), không giảm toàn bộ.
    expect(Math.abs(Number(adj[0].totalAmount))).toBe(part);
    expect(await bells()).toHaveLength(0);
  });

  it("đơn chưa mang trạng thái hoàn đã chốt (lượt ghi đơn chưa xong) → xem lại sau 1 phút", async () => {
    const o = await issuedOriginal();
    await autoAdjustOnPlatformReturn(fx.userId, o.orderId, "before");
    await makeDue(); // hết thời gian giữ chỗ mà đồng bộ hoàn chưa ghi đơn (tiến trình chết)
    await lane();
    const row = await autoRow(o);
    expect(row).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(near(row!.nextRetryAt, Date.now() + AUTO_ADJUST_NOT_READY_MS)).toBe(true);
    expect(createCalls).toHaveLength(0);
  });

  it("nhà cung cấp lỗi tạm → hẹn lại 60 phút, không chuông, lượt dừng", async () => {
    const o = await issuedOriginal();
    await enqueueReleased(o, o.total);
    createResult = transientFault;
    expect(await lane()).toBe("TRANSIENT");
    const row = await autoRow(o);
    expect(row).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(near(row!.nextRetryAt, Date.now() + AUTO_ADJUST_RETRY_MS)).toBe(true);
    expect(await bells()).toHaveLength(0);

    createResult = issuedNow;
    await makeDue();
    expect(await lane()).toBe("DONE");
    expect((await autoRow(o))!.status).toBe("DONE");
    // Lượt lỗi tạm và lượt thành công dùng CÙNG mã tham chiếu (luật lát 3).
    expect(createCalls.map((c) => c.orderCode)).toEqual([`${o.orderCode}-DC1`, `${o.orderCode}-DC1`]);
  });

  it("bị chặn vì hóa đơn gốc đã xóa bên nhà cung cấp → FAILED + MỘT chuông bảo làm tay", async () => {
    const o = await issuedOriginal();
    atProvider[o.orderCode] = { ...(atProvider[o.orderCode] as object), deleted: true } as ReferenceLookup;
    await enqueueReleased(o, o.total);
    await lane();
    const row = await autoRow(o);
    expect(row).toMatchObject({ status: "FAILED", errorCode: "HUBSELL_ADJUST_ORIGINAL_DELETED" });
    expect(createCalls).toHaveLength(0);
    const rung = await bells();
    expect(rung).toHaveLength(1);
    expect(rung[0].title).toContain(o.orderCode);
    expect(rung[0].body).toContain("Lập tay");
  });

  it("quá 7 ngày sàn vẫn chưa báo số → FAILED + chuông", async () => {
    const o = await issuedOriginal();
    await enqueueReleased(o, 0);
    await prisma.invoiceRequest.updateMany({ where: { ownerId: fx.userId }, data: { createdAt: new Date(Date.now() - 8 * DAY) } });
    await lane();
    const row = await autoRow(o);
    expect(row).toMatchObject({ status: "FAILED" });
    expect(row!.error).toContain("7 ngày");
    expect(await bells()).toHaveLength(1);
    expect(createCalls).toHaveLength(0);
  });

  it("lô bấm tay gặp lỗi tài khoản không kéo yêu cầu tự động hỏng theo", async () => {
    const o = await issuedOriginal();
    await autoAdjustOnPlatformReturn(fx.userId, o.orderId, "before"); // đang giữ chỗ
    const otherOrderId = await fx.createOrder(productId, 1);
    const other = await prisma.order.findUniqueOrThrow({ where: { id: otherOrderId }, select: { orderCode: true } });
    createResult = accountFault;
    await submitSingleRequest({ ownerId: fx.userId, kind: REQUEST_KIND_ISSUE, targetKey: other.orderCode });
    await lane();
    expect((await autoRow(o))!.status).toBe("PENDING");
  });

  it("chủ shop bấm điều chỉnh tay khi yêu cầu tự động còn chờ → bấm tay thắng, chỉ một tờ điều chỉnh", async () => {
    const o = await issuedOriginal();
    await enqueueReleased(o, 0);
    await lane(); // tự động: sàn chưa báo số → chờ 60 phút
    const manual = await submitSingleRequest({
      ownerId: fx.userId,
      kind: REQUEST_KIND_ADJUST,
      targetKey: o.logId,
      params: { reason: "Khách trả hàng hoàn tiền", scope: { kind: "FULL" } },
    });
    expect(manual).not.toBeNull();
    const auto = await prisma.invoiceRequest.findFirstOrThrow({ where: { ownerId: fx.userId, source: "AUTO_RETURN", targetKey: o.logId } });
    expect(auto.status).toBe("CANCELLED");
    await lane();
    expect(await adjustments(o)).toHaveLength(1);
    expect(await bells()).toHaveLength(0);
  });

  it("shop tắt công tắc sau khi đã ghi yêu cầu → yêu cầu tự hủy, không lập gì", async () => {
    const o = await issuedOriginal();
    await enqueueReleased(o, o.total);
    await setAutoAdjust(false);
    await lane();
    expect(await autoRow(o)).toMatchObject({ status: "CANCELLED" });
    expect(createCalls).toHaveLength(0);
    expect(await bells()).toHaveLength(0);
  });
});
