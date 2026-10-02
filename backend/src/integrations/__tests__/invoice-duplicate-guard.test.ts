// ============================================================
// CHỐNG PHÁT HÀNH TRÙNG Ở DATABASE — hóa đơn bước 5, lát 2 (02/10/2026).
//
// Chạy trên database dev (cần migration 20261002150000_invoice_provider_ref).
// Nhà cung cấp được thay bằng adapter giả đếm số lệnh gọi; KHÔNG chạm MISA.
//
//   1. Hai luồng CÙNG LÚC phát hành một đơn → đúng MỘT lệnh gọi nhà cung cấp, đúng
//      một dòng nhật ký; luồng kia nhận 409 trước khi gọi nhà cung cấp.
//   2. Dòng nhật ký lưu mã tham chiếu đã gửi (hóa đơn gốc = mã đơn).
//   3. Đơn đã có hóa đơn → 409 kèm số hóa đơn. Lượt trước HỎNG thì được phát hành lại.
//   4. Hai luồng CÙNG LÚC điều chỉnh một hóa đơn gốc → đúng một lệnh gọi.
//   5. Database tự từ chối dòng "đang chờ" thứ hai (không phụ thuộc mã ứng dụng).
// ============================================================
import "./load-env";
import { InvoiceLogStatus } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { providerHolder } = vi.hoisted(() => ({
  providerHolder: { current: null as unknown, gate: null as Promise<void> | null },
}));

vi.mock("../invoice/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/index")>();
  return {
    ...actual,
    // Luồng thật lấy adapter SAU lớp kiểm sớm và TRƯỚC khi ghi dòng PENDING. Cổng
    // `gate` giữ các luồng lại ở đúng chỗ đó để chúng cùng lao vào bước ghi.
    getInvoiceProvider: async () => {
      if (providerHolder.gate) await providerHolder.gate;
      return providerHolder.current;
    },
  };
});

import { prisma } from "../../lib/prisma";
import { issueAdjustmentForOrder } from "../invoice/adjust-order";
import { isUniqueViolation, issueInvoiceForOrder } from "../invoice/issue-order";
import type { CreateInvoiceInput, InvoiceProvider, InvoiceResult } from "../invoice/types";
import { MISA_CAPABILITIES } from "../invoice/misa-provider";
import { createStockFixture, type StockFixture } from "./fixtures";

let fx: StockFixture;
let productId: string;
let calls: CreateInvoiceInput[] = [];
let nextResult: (input: CreateInvoiceInput) => InvoiceResult;
let seq = 0;

const fakeProvider: InvoiceProvider = {
  name: "MISA",
  capabilities: MISA_CAPABILITIES,
  async createInvoice(input) {
    calls.push(input);
    await new Promise((r) => setTimeout(r, 30)); // nhà cung cấp trả lời chậm một chút
    return nextResult(input);
  },
  async cancelInvoice() {
    return { status: InvoiceLogStatus.FAILED };
  },
  async checkStatus() {
    return { status: InvoiceLogStatus.FAILED };
  },
};

const issued = (): InvoiceResult => {
  seq += 1;
  return { status: InvoiceLogStatus.ISSUED, invoiceNo: `T${String(seq).padStart(7, "0")}`, transactionId: `TEST-TX-${fx.suffix}-${seq}` };
};

/** Cho N luồng cùng đứng ở bước "lấy adapter" rồi thả cùng lúc. */
async function raceThroughGate<T>(starters: Array<() => Promise<T>>): Promise<T[]> {
  let open!: () => void;
  providerHolder.gate = new Promise<void>((r) => (open = r));
  const running = starters.map((s) => s());
  await new Promise((r) => setTimeout(r, 300)); // đủ để mọi luồng qua lớp kiểm sớm
  open();
  providerHolder.gate = null;
  return Promise.all(running);
}

async function newOrderCode(): Promise<string> {
  const orderId = await fx.createOrder(productId, 1);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  return order.orderCode;
}

beforeAll(async () => {
  fx = await createStockFixture("invdup");
  productId = await fx.createProduct(100);
  // Hóa đơn điều chỉnh cần ký hiệu của hóa đơn gốc → shop test có cấu hình tối thiểu.
  await prisma.invoiceConfig.create({
    data: { ownerId: fx.userId, provider: "MISA", invoicePattern: "1", invoiceSeries: "1C26TAA" },
  });
  providerHolder.current = fakeProvider;
});

beforeEach(() => {
  calls = [];
  nextResult = issued;
  providerHolder.gate = null;
});

afterAll(async () => {
  await fx.cleanup(); // InvoiceLog xóa theo chủ shop (Cascade)
});

describe("Hóa đơn gốc: một đơn một hóa đơn đang chờ / đã phát hành", () => {
  it("hai luồng cùng lúc → đúng một lệnh gọi nhà cung cấp, một dòng nhật ký, luồng kia 409", async () => {
    const orderCode = await newOrderCode();
    const scope = { userId: fx.userId };
    const results = await raceThroughGate([
      () => issueInvoiceForOrder(fx.userId, scope, orderCode),
      () => issueInvoiceForOrder(fx.userId, scope, orderCode),
    ]);

    expect(calls).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok)!;
    expect(loser.httpStatus).toBe(409);
    expect(loser.error).toMatch(/đang có yêu cầu phát hành|đã có hóa đơn số/);

    const logs = await prisma.invoiceLog.findMany({ where: { ownerId: fx.userId, orderCode } });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe(InvoiceLogStatus.ISSUED);
  });

  it("dòng nhật ký lưu mã tham chiếu đã gửi nhà cung cấp (= mã đơn)", async () => {
    const orderCode = await newOrderCode();
    const r = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, orderCode);
    expect(r.ok).toBe(true);
    expect(calls[0].orderCode).toBe(orderCode);
    const log = await prisma.invoiceLog.findFirstOrThrow({ where: { ownerId: fx.userId, orderCode } });
    expect(log.providerRef).toBe(orderCode);
  });

  it("đơn đã có hóa đơn → 409 kèm số hóa đơn, không gọi nhà cung cấp lần nữa", async () => {
    const orderCode = await newOrderCode();
    const first = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, orderCode);
    const again = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, orderCode);
    expect(calls).toHaveLength(1);
    expect(again.httpStatus).toBe(409);
    expect(again.error).toContain(first.log!.invoiceNo!);
  });

  it("lượt trước HỎNG thì phát hành lại được, vẫn dùng đúng mã tham chiếu cũ", async () => {
    const orderCode = await newOrderCode();
    nextResult = () => ({ status: InvoiceLogStatus.FAILED, errorMessage: "NCC từ chối", errorScope: "ORDER" });
    const failed = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, orderCode);
    expect(failed.ok).toBe(false);
    nextResult = issued;
    const retry = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, orderCode);
    expect(retry.ok).toBe(true);
    expect(calls.map((c) => c.orderCode)).toEqual([orderCode, orderCode]);
    const logs = await prisma.invoiceLog.findMany({ where: { ownerId: fx.userId, orderCode }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.status)).toEqual([InvoiceLogStatus.FAILED, InvoiceLogStatus.ISSUED]);
    expect(logs.map((l) => l.providerRef)).toEqual([orderCode, orderCode]);
  });

  it("database tự từ chối dòng 'đang chờ' thứ hai cho cùng shop + mã đơn", async () => {
    const orderCode = await newOrderCode();
    const data = { ownerId: fx.userId, orderCode, provider: "MISA", status: InvoiceLogStatus.PENDING };
    await prisma.invoiceLog.create({ data });
    const second = await prisma.invoiceLog.create({ data }).then(
      () => null,
      (err: unknown) => err
    );
    expect(isUniqueViolation(second)).toBe(true);
    // Dòng HỎNG không bị ràng buộc: một đơn có thể có nhiều lượt hỏng.
    await prisma.invoiceLog.create({ data: { ...data, status: InvoiceLogStatus.FAILED } });
    await prisma.invoiceLog.create({ data: { ...data, status: InvoiceLogStatus.FAILED } });
  });
});

describe("Hóa đơn điều chỉnh: một hóa đơn gốc một điều chỉnh đang chờ / đã phát hành", () => {
  async function issuedOriginal(): Promise<{ id: string; orderCode: string }> {
    const orderCode = await newOrderCode();
    const r = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, orderCode);
    expect(r.ok).toBe(true);
    calls = [];
    return { id: r.log!.id, orderCode };
  }

  it("hai luồng cùng lúc → đúng một lệnh gọi nhà cung cấp; dòng lưu mã tham chiếu <mã đơn>-DC1", async () => {
    const original = await issuedOriginal();
    const scope = { userId: fx.userId };
    const results = await raceThroughGate([
      () => issueAdjustmentForOrder(fx.userId, scope, original.id, "Khách trả hàng"),
      () => issueAdjustmentForOrder(fx.userId, scope, original.id, "Khách trả hàng"),
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].orderCode).toBe(`${original.orderCode}-DC1`);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)!.httpStatus).toBe(409);

    const adjustments = await prisma.invoiceLog.findMany({ where: { adjustmentForLogId: original.id } });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].providerRef).toBe(`${original.orderCode}-DC1`);
    expect(Number(adjustments[0].totalAmount)).toBeLessThan(0);
  });

  it("database tự từ chối dòng điều chỉnh 'đang chờ' thứ hai cho cùng hóa đơn gốc", async () => {
    const original = await issuedOriginal();
    const data = {
      ownerId: fx.userId,
      orderCode: original.orderCode,
      provider: "MISA",
      status: InvoiceLogStatus.PENDING,
      adjustmentForLogId: original.id,
    };
    await prisma.invoiceLog.create({ data });
    const second = await prisma.invoiceLog.create({ data }).then(
      () => null,
      (err: unknown) => err
    );
    expect(isUniqueViolation(second)).toBe(true);
  });
});
