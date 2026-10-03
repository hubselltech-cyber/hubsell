// ============================================================
// ĐƠN LỖI VÌ DỮ LIỆU CỦA CHÍNH NÓ DỪNG TỰ THỬ SAU 3 LƯỢT — hóa đơn bước 5, lát 7
// (03/10/2026). Chạy trên database dev (cần migration 20261003120000_invoice_order_error_count).
// Nhà cung cấp thay bằng adapter giả; KHÔNG chạm MISA.
//
//   1. Lỗi tầm ORDER cộng lượt 1 → 2 → 3; dòng FAILED ghi errorScope + orderErrorCount.
//   2. Lỗi TRANSIENT / ACCOUNT ghi tầm nhưng KHÔNG cộng lượt (chép lại số cũ).
//   3. Câu chọn đơn của worker: 2 lượt (quá 24 giờ) vẫn được chọn; 3 lượt thì KHÔNG;
//      mức dừng 0 (tắt) thì vẫn chọn; đơn chưa từng lỗi luôn được chọn.
//   4. Lượt vừa chạm mức mang cờ autoRetryJustStopped ĐÚNG MỘT LẦN; lượt 4 không.
//   5. Bấm tay trên đơn đã dừng vẫn gọi nhà cung cấp; thành công → ISSUED, rời hàng chờ.
//   6. Dòng FAILED do vòng quét "không thấy" (tầm TRANSIENT) không làm đổi số lượt.
// ============================================================
import "./load-env";
import { InvoiceLogStatus, ShippingStatus } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { providerHolder } = vi.hoisted(() => ({ providerHolder: { current: null as unknown } }));

vi.mock("../invoice/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/index")>();
  return { ...actual, getInvoiceProvider: async () => providerHolder.current };
});

import { prisma } from "../../lib/prisma";
import { issueInvoiceForOrder } from "../invoice/issue-order";
import type { CreateInvoiceInput, InvoiceProvider, InvoiceResult } from "../invoice/types";
import { MISA_CAPABILITIES } from "../invoice/misa-provider";
import { findAutoIssueCandidates } from "../../workers/invoice-auto-issue";
import { createStockFixture, type StockFixture } from "./fixtures";

let fx: StockFixture;
let productId: string;
let calls = 0;
let nextResult: (input: CreateInvoiceInput) => InvoiceResult;
let seq = 0;

const fakeProvider: InvoiceProvider = {
  name: "MISA",
  capabilities: MISA_CAPABILITIES,
  async createInvoice(input) {
    calls += 1;
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
  return {
    status: InvoiceLogStatus.ISSUED,
    invoiceNo: `S${String(seq).padStart(7, "0")}`,
    transactionId: `STOP-TX-${fx.suffix}-${seq}`,
  };
};
const orderFault = (): InvoiceResult => ({
  status: InvoiceLogStatus.FAILED,
  errorScope: "ORDER",
  errorCode: "TaxRateInfo_VATRateName",
  errorMessage: "Tên thuế suất không hợp lệ (test)",
});
const transientFault = (): InvoiceResult => ({
  status: InvoiceLogStatus.FAILED,
  errorScope: "TRANSIENT",
  errorCode: "HTTP_429",
  errorMessage: "meInvoice đang quá tải (test)",
});
const accountFault = (): InvoiceResult => ({
  status: InvoiceLogStatus.FAILED,
  errorScope: "ACCOUNT",
  errorCode: "UnAuthorize",
  errorMessage: "Sai mật khẩu meInvoice (test)",
});

const DAY = 24 * 60 * 60 * 1000;

/** Đơn ĐÃ GIAO hôm qua (đủ điều kiện tự phát hành với mốc DELIVERED). */
async function deliveredOrder(): Promise<{ id: string; orderCode: string }> {
  const id = await fx.createOrder(productId, 1);
  const o = await prisma.order.update({
    where: { id },
    data: { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: new Date(Date.now() - DAY) },
    select: { id: true, orderCode: true },
  });
  return o;
}

/** Lùi mọi dòng nhật ký của đơn về quá khứ để qua cửa sổ 24 giờ "thử lại 1 lần/ngày". */
async function ageLogs(orderId: string, days: number): Promise<void> {
  await prisma.invoiceLog.updateMany({
    where: { orderId },
    data: { createdAt: new Date(Date.now() - days * DAY) },
  });
}

async function failedLogs(orderId: string) {
  return prisma.invoiceLog.findMany({
    where: { orderId, status: InvoiceLogStatus.FAILED },
    orderBy: { createdAt: "asc" },
    select: { errorScope: true, orderErrorCount: true },
  });
}

const cfg = () => ({ ownerId: fx.userId, trigger: "DELIVERED" as const, autoIssueEnabledAt: null });

beforeAll(async () => {
  fx = await createStockFixture("invstop");
  productId = await fx.createProduct(100);
  await prisma.invoiceConfig.create({
    data: { ownerId: fx.userId, provider: "MISA", invoicePattern: "1", invoiceSeries: "1C26TAA" },
  });
  providerHolder.current = fakeProvider;
});

beforeEach(() => {
  calls = 0;
  nextResult = issued;
});

afterAll(async () => {
  await fx.cleanup();
});

describe("Lát 7: đếm lượt lỗi riêng đơn", () => {
  it("lỗi tầm ORDER cộng 1 → 2 → 3; dòng FAILED ghi tầm + số lượt; cờ dừng đúng một lần", async () => {
    const o = await deliveredOrder();
    nextResult = orderFault;

    const r1 = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    expect(r1.ok).toBe(false);
    expect(r1.orderErrorCount).toBe(1);
    expect(r1.autoRetryJustStopped).toBeUndefined();

    const r2 = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    expect(r2.orderErrorCount).toBe(2);
    expect(r2.autoRetryJustStopped).toBeUndefined();

    const r3 = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    expect(r3.orderErrorCount).toBe(3);
    expect(r3.autoRetryJustStopped).toBe(true);

    // Lượt 4 (bấm tay sau khi máy dừng) vẫn gọi nhà cung cấp, đếm tiếp, KHÔNG mang cờ nữa.
    const r4 = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    expect(r4.orderErrorCount).toBe(4);
    expect(r4.autoRetryJustStopped).toBeUndefined();
    expect(calls).toBe(4);

    expect(await failedLogs(o.id)).toEqual([
      { errorScope: "ORDER", orderErrorCount: 1 },
      { errorScope: "ORDER", orderErrorCount: 2 },
      { errorScope: "ORDER", orderErrorCount: 3 },
      { errorScope: "ORDER", orderErrorCount: 4 },
    ]);
  });

  it("lỗi TRANSIENT / ACCOUNT ghi tầm nhưng không cộng lượt", async () => {
    const o = await deliveredOrder();
    nextResult = orderFault;
    await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    nextResult = transientFault;
    const rt = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    expect(rt.orderErrorCount).toBe(1);
    nextResult = accountFault;
    const ra = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    expect(ra.orderErrorCount).toBe(1);
    nextResult = orderFault;
    const ro = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    expect(ro.orderErrorCount).toBe(2);

    expect(await failedLogs(o.id)).toEqual([
      { errorScope: "ORDER", orderErrorCount: 1 },
      { errorScope: "TRANSIENT", orderErrorCount: 1 },
      { errorScope: "ACCOUNT", orderErrorCount: 1 },
      { errorScope: "ORDER", orderErrorCount: 2 },
    ]);
  });

  it("mã số thuế người mua sai dạng (Hubsell chặn trước khi gọi NCC) cũng là lỗi riêng đơn, đếm lượt", async () => {
    const o = await deliveredOrder();
    await prisma.order.update({
      where: { id: o.id },
      data: { invoiceRequestType: "COMPANY", buyerInvoiceInfo: { companyName: "Cty test", companyTaxId: "ABC-xyz" } },
    });
    const r = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("HUBSELL_BUYER_TAXCODE_INVALID");
    expect(r.orderErrorCount).toBe(1);
    expect(calls).toBe(0);
    expect(await failedLogs(o.id)).toEqual([{ errorScope: "ORDER", orderErrorCount: 1 }]);
  });
});

describe("Lát 7: câu chọn đơn của worker tự phát hành", () => {
  it("đơn chưa từng lỗi được chọn; 2 lượt (đã qua 24 giờ) vẫn được chọn; 3 lượt thì không; mức 0 thì vẫn chọn", async () => {
    const fresh = await deliveredOrder();
    const twice = await deliveredOrder();
    const thrice = await deliveredOrder();

    nextResult = orderFault;
    for (let i = 0; i < 2; i++) await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, twice.orderCode);
    for (let i = 0; i < 3; i++) await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, thrice.orderCode);
    // Vừa lỗi xong → cả hai còn trong cửa sổ 24 giờ, chỉ đơn mới được chọn.
    let picked = await findAutoIssueCandidates(cfg());
    expect(picked).toContain(fresh.orderCode);
    expect(picked).not.toContain(twice.orderCode);
    expect(picked).not.toContain(thrice.orderCode);

    await ageLogs(twice.id, 2);
    await ageLogs(thrice.id, 2);
    picked = await findAutoIssueCandidates(cfg());
    expect(picked).toContain(fresh.orderCode);
    expect(picked).toContain(twice.orderCode); // 2 lượt: mai máy thử tiếp
    expect(picked).not.toContain(thrice.orderCode); // 3 lượt: máy dừng hẳn

    // Đường lui: mức dừng 0 → hành vi cũ, đơn 3 lượt lại được chọn.
    const prev = process.env.INVOICE_AUTO_ISSUE_MAX_ATTEMPTS;
    process.env.INVOICE_AUTO_ISSUE_MAX_ATTEMPTS = "0";
    try {
      picked = await findAutoIssueCandidates(cfg());
      expect(picked).toContain(thrice.orderCode);
    } finally {
      if (prev === undefined) delete process.env.INVOICE_AUTO_ISSUE_MAX_ATTEMPTS;
      else process.env.INVOICE_AUTO_ISSUE_MAX_ATTEMPTS = prev;
    }
  });

  it("lỗi tạm 3 lần KHÔNG làm máy dừng (đơn tốt gặp ba ngày nhà cung cấp trục trặc)", async () => {
    const o = await deliveredOrder();
    nextResult = transientFault;
    for (let i = 0; i < 3; i++) await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    await ageLogs(o.id, 2);
    expect(await findAutoIssueCandidates(cfg())).toContain(o.orderCode);
  });

  it("bấm tay trên đơn máy đã dừng: nhà cung cấp vẫn được gọi; thành công → ISSUED, rời hàng chờ", async () => {
    const o = await deliveredOrder();
    nextResult = orderFault;
    for (let i = 0; i < 3; i++) await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    await ageLogs(o.id, 2);
    expect(await findAutoIssueCandidates(cfg())).not.toContain(o.orderCode);

    calls = 0;
    nextResult = issued;
    const r = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    expect(r.ok).toBe(true);
    expect(calls).toBe(1);
    const log = await prisma.invoiceLog.findFirst({
      where: { orderId: o.id, status: InvoiceLogStatus.ISSUED },
      select: { errorScope: true, orderErrorCount: true },
    });
    expect(log).toEqual({ errorScope: null, orderErrorCount: null });
    // Có hóa đơn ISSUED → không còn trong hàng chờ / không còn là ứng viên.
    expect(await findAutoIssueCandidates(cfg())).not.toContain(o.orderCode);
  });

  it("dòng FAILED của vòng quét 'không thấy' (tầm TRANSIENT, không số lượt) không chặn và không đổi số", async () => {
    const o = await deliveredOrder();
    nextResult = orderFault;
    await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    // Giả dòng do unknown-outcome.ts kết luận: FAILED, tầm TRANSIENT, không orderErrorCount.
    await prisma.invoiceLog.create({
      data: {
        ownerId: fx.userId,
        orderId: o.id,
        orderCode: o.orderCode,
        provider: "MISA",
        providerRef: o.orderCode,
        status: InvoiceLogStatus.FAILED,
        errorScope: "TRANSIENT",
        errorMessage: "Đã kiểm lại: chưa có hóa đơn nào được lập (test)",
      },
    });
    const r = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    expect(r.orderErrorCount).toBe(2); // 1 cũ + lượt này; dòng vòng quét không tính
    await ageLogs(o.id, 2);
    expect(await findAutoIssueCandidates(cfg())).toContain(o.orderCode);
  });
});
