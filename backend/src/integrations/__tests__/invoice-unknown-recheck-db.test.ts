// ============================================================
// TỜ HÓA ĐƠN CHƯA RÕ KẾT QUẢ: GIỮ ĐANG CHỜ RỒI TỰ TRA LẠI — bước 5, lát 6b (03/10/2026).
//
// Chạy trên database dev. Nhà cung cấp là adapter giả có "sổ" riêng (mã tham chiếu →
// tờ đã lập), mô phỏng đúng ca đời thật: lệnh tới nơi, tờ ĐÃ lập, nhưng Hubsell
// không nhận được câu trả lời. KHÔNG chạm MISA.
//
//   1. Chưa rõ kết quả → dòng GIỮ đang chờ, đơn không quay lại hàng chờ, bấm lại bị
//      chặn trước khi gọi nhà cung cấp.
//   2. Vòng quét: chưa đủ 5 phút thì không hỏi; đủ tuổi thì tra ngược:
//        thấy tờ → nối số · đã xóa → đã hủy · không có → hỏng, xuất lại được ·
//        không tra được → giữ, 15 phút sau mới hỏi lại, một shop chỉ hỏi hỏng một lần mỗi lượt.
//   3. Dòng mồ côi (tiến trình chết giữa lúc gọi) cũng được dọn.
//   4. Hai tiến trình cùng xử lý một dòng → chỉ một bên ghi.
//   5. Nhà cung cấp không tra ngược được → trả về "hỏng" kèm lời nhắn tự kiểm.
//   6. Hóa đơn điều chỉnh đi cùng đường, không đụng trạng thái hóa đơn của đơn.
// ============================================================
import "./load-env";
import { InvoiceLogStatus } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { providerHolder } = vi.hoisted(() => ({ providerHolder: { current: null as unknown } }));

vi.mock("../invoice/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/index")>();
  return { ...actual, getInvoiceProvider: async () => providerHolder.current };
});

import { prisma } from "../../lib/prisma";
import { RECHECK_RETRY_MS, runInvoiceUnknownRecheckOnce } from "../../workers/invoice-unknown-recheck";
import { issueAdjustmentForOrder } from "../invoice/adjust-order";
import { issueInvoiceForOrder } from "../invoice/issue-order";
import { MISA_CAPABILITIES } from "../invoice/misa-provider";
import type { CreateInvoiceInput, InvoiceProvider, InvoiceResult, ReferenceLookup } from "../invoice/types";
import { recheckUnknownLog, UNKNOWN_MIN_AGE_MS, type UnknownLog } from "../invoice/unknown-outcome";
import { createStockFixture, type StockFixture } from "./fixtures";

let fx: StockFixture;
let productId: string;
let seq = 0;

/** "Sổ" của nhà cung cấp giả: mã tham chiếu → tờ đã lập. */
const book = new Map<string, { invoiceNo: string; transactionId: string; issued: boolean; deleted: boolean }>();
/** Lệnh phát hành kế tiếp: lập bình thường / lập xong nhưng mất câu trả lời / không lập và mất câu trả lời. */
let publishMode: "ok" | "lost-after-issue" | "lost-not-issued" = "ok";
let lookupMode: "ok" | "fail" | "account-fail" = "ok";
let publishCalls: string[] = [];
let lookupCalls: string[] = [];

const UNKNOWN: InvoiceResult = {
  status: InvoiceLogStatus.FAILED,
  outcomeUnknown: true,
  errorScope: "TRANSIENT",
  errorCode: "HUBSELL_OUTCOME_UNKNOWN",
  errorMessage: "Chưa rõ hóa đơn này đã lập hay chưa (adapter giả)",
};

function writeToBook(ref: string): { invoiceNo: string; transactionId: string } {
  seq += 1;
  const entry = { invoiceNo: `U${String(seq).padStart(7, "0")}`, transactionId: `TEST-UNK-${fx.suffix}-${seq}`, issued: true, deleted: false };
  book.set(ref, entry);
  return entry;
}

const lookupCapable: InvoiceProvider = {
  name: "MISA",
  capabilities: MISA_CAPABILITIES,
  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    publishCalls.push(input.orderCode);
    if (publishMode === "lost-not-issued") return UNKNOWN;
    const entry = writeToBook(input.orderCode);
    if (publishMode === "lost-after-issue") return UNKNOWN;
    return { status: InvoiceLogStatus.ISSUED, invoiceNo: entry.invoiceNo, transactionId: entry.transactionId };
  },
  async cancelInvoice() {
    return { status: InvoiceLogStatus.FAILED };
  },
  async checkStatus() {
    return { status: InvoiceLogStatus.FAILED };
  },
  async findByReference(reference: string): Promise<ReferenceLookup> {
    lookupCalls.push(reference);
    if (lookupMode !== "ok") {
      return { state: "LOOKUP_FAILED", message: "nhà cung cấp giả đang bận.", accountProblem: lookupMode === "account-fail" };
    }
    const entry = book.get(reference);
    if (!entry) return { state: "NOT_FOUND" };
    return { state: "FOUND", invoiceNo: entry.invoiceNo, transactionId: entry.transactionId, issued: entry.issued, deleted: entry.deleted, matches: 1 };
  },
};

/** Nhà cung cấp khai KHÔNG tra ngược được. */
const noLookup: InvoiceProvider = {
  ...lookupCapable,
  capabilities: { ...MISA_CAPABILITIES, findByReference: { supported: false } },
  findByReference: undefined,
};

const scope = () => ({ userId: fx.userId });
const afterMinutes = (min: number) => new Date(Date.now() + min * 60_000);
const sweep = (now: Date) => runInvoiceUnknownRecheckOnce(now, { ownerId: fx.userId });

async function newOrderCode(): Promise<string> {
  const orderId = await fx.createOrder(productId, 1);
  return (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).orderCode;
}
const logOf = (orderCode: string) =>
  prisma.invoiceLog.findFirstOrThrow({ where: { ownerId: fx.userId, orderCode, adjustmentForLogId: null }, orderBy: { createdAt: "desc" } });
const orderOf = (orderCode: string) => prisma.order.findFirstOrThrow({ where: { orderCode, channel: { userId: fx.userId } } });

/** Xuất một đơn ở chế độ "mất câu trả lời" → dòng đang chờ chưa rõ kết quả. */
async function issueLost(mode: "lost-after-issue" | "lost-not-issued"): Promise<string> {
  const orderCode = await newOrderCode();
  publishMode = mode;
  const r = await issueInvoiceForOrder(fx.userId, scope(), orderCode);
  publishMode = "ok";
  expect(r.ok).toBe(false);
  expect(r.outcomeUnknown).toBe(true);
  return orderCode;
}

beforeAll(async () => {
  fx = await createStockFixture("invunk");
  productId = await fx.createProduct(100);
  await prisma.invoiceConfig.create({
    data: { ownerId: fx.userId, provider: "MISA", invoicePattern: "1", invoiceSeries: "1C26TAA" },
  });
});

beforeEach(async () => {
  providerHolder.current = lookupCapable;
  publishMode = "ok";
  lookupMode = "ok";
  publishCalls = [];
  lookupCalls = [];
  // Mỗi test bắt đầu với shop không còn dòng "đang chờ chưa có mã tra cứu" nào của test trước.
  await prisma.invoiceLog.updateMany({
    where: { ownerId: fx.userId, status: InvoiceLogStatus.PENDING, transactionId: null },
    data: { status: InvoiceLogStatus.FAILED },
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { ownerId: fx.userId } });
  await fx.cleanup();
});

describe("Giữ đang chờ khi chưa rõ kết quả", () => {
  it("dòng giữ PENDING kèm lời nhắn, đơn mang trạng thái đang chờ; bấm lại bị chặn TRƯỚC khi gọi nhà cung cấp", async () => {
    const orderCode = await newOrderCode();
    publishMode = "lost-after-issue";
    const r = await issueInvoiceForOrder(fx.userId, scope(), orderCode);
    expect(r).toMatchObject({ ok: false, httpStatus: 502, outcomeUnknown: true, errorCode: "HUBSELL_OUTCOME_UNKNOWN", errorScope: "TRANSIENT" });
    expect(r.error).toContain("Hubsell đang tự kiểm lại");
    expect(r.error).toContain("ĐỪNG lập tay");

    const log = await logOf(orderCode);
    expect(log.status).toBe(InvoiceLogStatus.PENDING);
    expect(log.transactionId).toBeNull();
    expect(log.errorMessage).toContain("Hubsell đang tự kiểm lại");
    expect((await orderOf(orderCode)).einvoiceStatus).toBe(InvoiceLogStatus.PENDING);

    publishMode = "ok";
    const again = await issueInvoiceForOrder(fx.userId, scope(), orderCode);
    expect(again.httpStatus).toBe(409);
    expect(again.error).toContain("đang kiểm lại");
    expect(publishCalls).toEqual([orderCode]); // không có lệnh phát hành thứ hai
  });
});

describe("Vòng quét tra lại", () => {
  it("chưa đủ 5 phút: không hỏi nhà cung cấp, dòng giữ nguyên", async () => {
    const orderCode = await issueLost("lost-after-issue");
    const stats = await sweep(afterMinutes(UNKNOWN_MIN_AGE_MS / 60_000 - 1));
    expect(stats.scanned).toBe(0);
    expect(lookupCalls).toEqual([]);
    expect((await logOf(orderCode)).status).toBe(InvoiceLogStatus.PENDING);
  });

  it("thấy tờ đã lập → nối số, ĐÃ PHÁT HÀNH, ngày phát hành = lúc gửi, đơn theo; không lập thêm", async () => {
    const orderCode = await issueLost("lost-after-issue");
    const entry = book.get(orderCode)!;
    const stats = await sweep(afterMinutes(6));
    expect(stats).toMatchObject({ scanned: 1, linked: 1, notIssued: 0, kept: 0 });
    expect(lookupCalls).toEqual([orderCode]);

    const log = await logOf(orderCode);
    expect(log.status).toBe(InvoiceLogStatus.ISSUED);
    expect(log.invoiceNo).toBe(entry.invoiceNo);
    expect(log.transactionId).toBe(entry.transactionId);
    expect(log.errorMessage).toBeNull();
    expect(log.issuedAt?.getTime()).toBe(log.createdAt.getTime());
    expect((await orderOf(orderCode)).einvoiceStatus).toBe(InvoiceLogStatus.ISSUED);
    const history = await prisma.invoiceStatusHistory.findMany({ where: { invoiceLogId: log.id, toStatus: InvoiceLogStatus.ISSUED } });
    expect(history).toHaveLength(1);
    expect(history[0].note).toContain("nối lại số");
    expect(publishCalls).toEqual([orderCode]);

    // Lượt quét sau không còn gì để làm.
    lookupCalls = [];
    expect((await sweep(afterMinutes(30))).scanned).toBe(0);
    expect(lookupCalls).toEqual([]);
  });

  it("nhà cung cấp không có tờ nào → HỎNG, báo chuông, đơn xuất lại được với đúng mã cũ", async () => {
    const orderCode = await issueLost("lost-not-issued");
    const stats = await sweep(afterMinutes(6));
    expect(stats).toMatchObject({ scanned: 1, linked: 0, notIssued: 1 });

    const log = await logOf(orderCode);
    expect(log.status).toBe(InvoiceLogStatus.FAILED);
    expect(log.errorMessage).toContain("chưa có hóa đơn nào được lập");
    expect((await orderOf(orderCode)).einvoiceStatus).toBe(InvoiceLogStatus.FAILED);
    const bell = await prisma.notification.findMany({ where: { ownerId: fx.userId, type: "INVOICE_UNKNOWN_RESOLVED" } });
    expect(bell).toHaveLength(1);

    const retry = await issueInvoiceForOrder(fx.userId, scope(), orderCode);
    expect(retry.ok).toBe(true);
    expect(publishCalls).toEqual([orderCode, orderCode]);
  });

  it("tờ đã bị xóa bên nhà cung cấp → ĐÃ HỦY", async () => {
    const orderCode = await issueLost("lost-after-issue");
    book.get(orderCode)!.deleted = true;
    const stats = await sweep(afterMinutes(6));
    expect(stats.cancelled).toBe(1);
    expect((await logOf(orderCode)).status).toBe(InvoiceLogStatus.CANCELLED);
    expect((await orderOf(orderCode)).einvoiceStatus).toBe(InvoiceLogStatus.CANCELLED);
  });

  it("không tra được → giữ đang chờ; một shop chỉ bị hỏi hỏng MỘT lần mỗi lượt; 15 phút sau mới hỏi lại", async () => {
    const first = await issueLost("lost-after-issue");
    const second = await issueLost("lost-after-issue");
    lookupMode = "fail";
    const t1 = afterMinutes(6);
    const stats = await sweep(t1);
    expect(stats).toMatchObject({ scanned: 2, linked: 0, kept: 1 });
    expect(lookupCalls).toHaveLength(1); // dòng thứ hai được hoãn, không hỏi
    for (const code of [first, second]) {
      const log = await logOf(code);
      expect(log.status).toBe(InvoiceLogStatus.PENDING);
      expect(log.cqtCheckedAt?.getTime()).toBe(t1.getTime());
    }
    expect((await logOf(first)).errorMessage).toContain("Chưa kiểm lại được");

    // Còn trong 15 phút: không hỏi lại.
    lookupCalls = [];
    lookupMode = "ok";
    expect((await sweep(new Date(t1.getTime() + RECHECK_RETRY_MS - 1000))).scanned).toBe(0);
    expect(lookupCalls).toEqual([]);

    // Hết 15 phút, nhà cung cấp đã hồi: nối số cả hai.
    const later = await sweep(new Date(t1.getTime() + RECHECK_RETRY_MS + 1000));
    expect(later).toMatchObject({ scanned: 2, linked: 2 });
    expect((await logOf(first)).status).toBe(InvoiceLogStatus.ISSUED);
    expect((await logOf(second)).status).toBe(InvoiceLogStatus.ISSUED);
  });

  it("tờ có bên nhà cung cấp nhưng chưa phát hành xong → giữ đang chờ, ghi mã tra cứu, rời vòng quét", async () => {
    const orderCode = await issueLost("lost-after-issue");
    book.get(orderCode)!.issued = false;
    const stats = await sweep(afterMinutes(6));
    expect(stats).toMatchObject({ scanned: 1, linked: 0, kept: 1 });
    const log = await logOf(orderCode);
    expect(log.status).toBe(InvoiceLogStatus.PENDING);
    expect(log.transactionId).toBe(book.get(orderCode)!.transactionId);
    expect((await sweep(afterMinutes(60))).scanned).toBe(0);
  });

  it("dòng mồ côi (tiến trình chết giữa lúc gọi, không có lời nhắn) cũng được tra lại", async () => {
    const orderCode = await newOrderCode();
    const order = await orderOf(orderCode);
    const entry = writeToBook(orderCode); // nhà cung cấp đã lập, Hubsell chết trước khi ghi kết quả
    await prisma.invoiceLog.create({
      data: {
        ownerId: fx.userId,
        orderId: order.id,
        orderCode,
        provider: "MISA",
        providerRef: orderCode,
        status: InvoiceLogStatus.PENDING,
        createdAt: new Date(Date.now() - 20 * 60_000),
      },
    });
    const stats = await sweep(new Date());
    expect(stats.linked).toBe(1);
    const log = await logOf(orderCode);
    expect(log.status).toBe(InvoiceLogStatus.ISSUED);
    expect(log.invoiceNo).toBe(entry.invoiceNo);
  });

  it("hai tiến trình cùng xử lý một dòng → đúng một bên ghi, một dòng lịch sử", async () => {
    const orderCode = await issueLost("lost-after-issue");
    const row = await logOf(orderCode);
    const log: UnknownLog = {
      id: row.id,
      ownerId: row.ownerId,
      orderId: row.orderId,
      orderCode: row.orderCode,
      provider: row.provider,
      providerRef: row.providerRef,
      adjustmentForLogId: row.adjustmentForLogId,
      createdAt: row.createdAt,
    };
    const now = afterMinutes(6);
    const outcomes = await Promise.all([recheckUnknownLog(log, lookupCapable, now), recheckUnknownLog(log, lookupCapable, now)]);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(["LINKED", "SKIPPED"]);
    const history = await prisma.invoiceStatusHistory.findMany({ where: { invoiceLogId: row.id, toStatus: InvoiceLogStatus.ISSUED } });
    expect(history).toHaveLength(1);
  });
});

describe("Nhà cung cấp KHÔNG tra ngược được", () => {
  it("chưa rõ kết quả → ghi hỏng ngay như lát 5 (không giữ đang chờ)", async () => {
    providerHolder.current = noLookup;
    const orderCode = await newOrderCode();
    publishMode = "lost-after-issue";
    const r = await issueInvoiceForOrder(fx.userId, scope(), orderCode);
    expect(r).toMatchObject({ ok: false, outcomeUnknown: true });
    expect((await logOf(orderCode)).status).toBe(InvoiceLogStatus.FAILED);
  });

  it("dòng mồ côi → vòng quét trả về hỏng kèm lời nhắn tự kiểm bên nhà cung cấp, có báo chuông", async () => {
    providerHolder.current = noLookup;
    const orderCode = await newOrderCode();
    const order = await orderOf(orderCode);
    await prisma.invoiceLog.create({
      data: {
        ownerId: fx.userId,
        orderId: order.id,
        orderCode,
        provider: "MISA",
        providerRef: orderCode,
        status: InvoiceLogStatus.PENDING,
        createdAt: new Date(Date.now() - 20 * 60_000),
      },
    });
    const stats = await sweep(new Date());
    expect(stats.cannotVerify).toBe(1);
    const log = await logOf(orderCode);
    expect(log.status).toBe(InvoiceLogStatus.FAILED);
    expect(log.errorMessage).toContain("TRƯỚC khi làm lại");
    expect(lookupCalls).toEqual([]);
  });
});

describe("Hóa đơn điều chỉnh", () => {
  it("chưa rõ kết quả → giữ đang chờ, bấm lại bị chặn; vòng quét nối số; trạng thái hóa đơn của đơn không đổi", async () => {
    const orderCode = await newOrderCode();
    const original = await issueInvoiceForOrder(fx.userId, scope(), orderCode);
    expect(original.ok).toBe(true);
    publishCalls = [];

    publishMode = "lost-after-issue";
    const adj = await issueAdjustmentForOrder(fx.userId, scope(), original.log!.id, "Khách trả hàng");
    publishMode = "ok";
    expect(adj).toMatchObject({ ok: false, outcomeUnknown: true, errorCode: "HUBSELL_OUTCOME_UNKNOWN" });
    const ref = `${orderCode}-DC1`;
    expect(publishCalls).toEqual([ref]);
    const pending = await prisma.invoiceLog.findFirstOrThrow({ where: { adjustmentForLogId: original.log!.id } });
    expect(pending.status).toBe(InvoiceLogStatus.PENDING);

    const again = await issueAdjustmentForOrder(fx.userId, scope(), original.log!.id, "Khách trả hàng");
    expect(again.httpStatus).toBe(409);
    expect(again.error).toContain("đang kiểm lại");
    expect(publishCalls).toEqual([ref]);

    const stats = await sweep(afterMinutes(6));
    expect(stats.linked).toBe(1);
    const linked = await prisma.invoiceLog.findUniqueOrThrow({ where: { id: pending.id } });
    expect(linked.status).toBe(InvoiceLogStatus.ISSUED);
    expect(linked.invoiceNo).toBe(book.get(ref)!.invoiceNo);
    expect((await orderOf(orderCode)).einvoiceStatus).toBe(InvoiceLogStatus.ISSUED); // vẫn theo hóa đơn gốc
  });
});
