// ============================================================
// VÒNG HỎI TRẠNG THÁI CƠ QUAN THUẾ THEO GIỜ HỎI KẾ TIẾP — bước 5, lát 12 (03/10/2026).
//
// Chạy trên database dev (cần migration 20261003190000_invoice_cqt_next_check). Nhà
// cung cấp là adapter giả có "sổ" mã tra cứu → trạng thái. KHÔNG chạm MISA.
//
//   1. Mọi đường ghi mã tra cứu đều đặt giờ hỏi: phát hành, điều chỉnh, nối lại tờ chưa rõ.
//   2. Vòng quét: chưa tới hạn không hỏi; tới hạn thì hỏi theo lô, ghi kết quả + hẹn giờ kế.
//   3. Bị từ chối → một dòng lịch sử + một chuông; lượt sau không báo lại.
//   4. Tờ đã xóa: hóa đơn gốc kéo trạng thái của đơn; tờ ĐIỀU CHỈNH thì không đụng đơn.
//   5. Nhà cung cấp không trả dòng → không suy diễn. Hỏi không được → dòng tự tới hạn lại.
//   6. Dòng đã nhận không bị nhận lần hai; dòng bị tiến trình khác đổi không bị ghi đè.
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
import { CQT_CLAIM_MS, runInvoiceCqtFollowOnce } from "../../workers/invoice-cqt-follow";
import { runInvoiceUnknownRecheckOnce } from "../../workers/invoice-unknown-recheck";
import { issueAdjustmentForOrder } from "../invoice/adjust-order";
import { applyFollowPlan, CQT_FIRST_CHECK_MS, planFollow, type FollowLog } from "../invoice/cqt-follow";
import { issueInvoiceForOrder } from "../invoice/issue-order";
import { MISA_CAPABILITIES } from "../invoice/misa-provider";
import type {
  CreateInvoiceInput,
  InvoiceProvider,
  InvoiceResult,
  ProviderInvoiceStatus,
  ReferenceLookup,
  StatusBatchResult,
  StatusQuery,
} from "../invoice/types";
import { createStockFixture, type StockFixture } from "./fixtures";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

let fx: StockFixture;
let productId: string;
let seq = 0;

/** "Sổ" của nhà cung cấp giả: mã tra cứu → trạng thái. Mã không có trong sổ = không trả dòng. */
const book = new Map<string, Omit<ProviderInvoiceStatus, "transactionId">>();
/** Tờ đã lập theo mã tham chiếu (cho đường tra ngược của vòng quét tờ chưa rõ). */
const refs = new Map<string, { invoiceNo: string; transactionId: string }>();
let statusMode: "ok" | "fail" | "account-fail" = "ok";
let publishMode: "ok" | "reject" | "lost-after-issue" = "ok";
let statusCalls: string[][] = [];

const fake: InvoiceProvider = {
  name: "MISA",
  capabilities: MISA_CAPABILITIES,
  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    if (publishMode === "reject") return { status: InvoiceLogStatus.FAILED, errorMessage: "từ chối (giả)", errorScope: "ORDER" };
    seq += 1;
    const entry = { invoiceNo: `Q${String(seq).padStart(7, "0")}`, transactionId: `TEST-CQT-${fx.suffix}-P${seq}` };
    refs.set(input.orderCode, entry);
    if (publishMode === "lost-after-issue") {
      return { status: InvoiceLogStatus.FAILED, outcomeUnknown: true, errorScope: "TRANSIENT", errorMessage: "chưa rõ (giả)" };
    }
    return { status: InvoiceLogStatus.ISSUED, ...entry };
  },
  async cancelInvoice() {
    return { status: InvoiceLogStatus.FAILED };
  },
  async checkStatus() {
    return { status: InvoiceLogStatus.FAILED };
  },
  async findByReference(reference: string): Promise<ReferenceLookup> {
    const entry = refs.get(reference);
    if (!entry) return { state: "NOT_FOUND" };
    return { state: "FOUND", ...entry, issued: true, deleted: false, matches: 1 };
  },
  async checkStatuses(items: StatusQuery[]): Promise<StatusBatchResult> {
    statusCalls.push(items.map((i) => i.transactionId));
    if (statusMode !== "ok") {
      return { ok: false, message: "nhà cung cấp giả từ chối.", accountProblem: statusMode === "account-fail" };
    }
    const found = new Map<string, ProviderInvoiceStatus>();
    for (const { transactionId } of items) {
      const entry = book.get(transactionId);
      if (entry) found.set(transactionId, { transactionId, ...entry });
    }
    return { ok: true, found };
  },
};

const scope = () => ({ userId: fx.userId });
const at = (ms: number) => new Date(Date.now() + ms);
const sweep = (now: Date) => runInvoiceCqtFollowOnce(now, { ownerId: fx.userId });
const st = (over: Partial<Omit<ProviderInvoiceStatus, "transactionId">> = {}) => ({
  issued: true,
  deleted: false,
  invoiceNo: null,
  taxStatus: null,
  ...over,
});

async function newOrder(): Promise<{ orderId: string; orderCode: string }> {
  const orderId = await fx.createOrder(productId, 1);
  const { orderCode } = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  return { orderId, orderCode };
}

/** Một dòng nhật ký đã có mã tra cứu, tới hạn hỏi ngay. */
async function mkLog(
  over: Partial<{
    status: InvoiceLogStatus;
    cqtStatus: string | null;
    createdAt: Date;
    cqtNextCheckAt: Date | null;
    orderId: string;
    orderCode: string;
    adjustmentForLogId: string;
    invoiceNo: string | null;
  }> = {}
) {
  seq += 1;
  return prisma.invoiceLog.create({
    data: {
      ownerId: fx.userId,
      orderCode: over.orderCode ?? `CQT-${fx.suffix}-${seq}`,
      provider: "MISA",
      providerRef: `CQT-${fx.suffix}-${seq}`,
      transactionId: `TEST-CQT-${fx.suffix}-${seq}`,
      invoiceSeries: "1C26TAA",
      status: InvoiceLogStatus.ISSUED,
      invoiceNo: `N${String(seq).padStart(7, "0")}`,
      cqtNextCheckAt: new Date(Date.now() - 60_000),
      ...over,
    },
  });
}
const reload = (id: string) => prisma.invoiceLog.findUniqueOrThrow({ where: { id } });
const bells = () => prisma.notification.count({ where: { ownerId: fx.userId, type: "INVOICE_CQT_ALERT" } });
const near = (d: Date | null, expected: number, slack = 5_000) =>
  expect(Math.abs((d?.getTime() ?? 0) - expected)).toBeLessThan(slack);

beforeAll(async () => {
  fx = await createStockFixture("invcqt");
  productId = await fx.createProduct(500);
  await prisma.invoiceConfig.create({
    data: { ownerId: fx.userId, provider: "MISA", invoicePattern: "1", invoiceSeries: "1C26TAA" },
  });
});

beforeEach(async () => {
  providerHolder.current = fake;
  statusMode = "ok";
  publishMode = "ok";
  statusCalls = [];
  // Mỗi test bắt đầu với shop không còn dòng nào chờ hỏi của test trước.
  await prisma.invoiceLog.updateMany({ where: { ownerId: fx.userId }, data: { cqtNextCheckAt: null } });
  await prisma.notification.deleteMany({ where: { ownerId: fx.userId } });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { ownerId: fx.userId } });
  await fx.cleanup();
});

describe("Mọi đường ghi mã tra cứu đều đặt giờ hỏi", () => {
  it("phát hành xong → hẹn 1 giờ sau; phát hành bị từ chối → không hẹn", async () => {
    const ok = await newOrder();
    expect((await issueInvoiceForOrder(fx.userId, scope(), ok.orderCode)).ok).toBe(true);
    const log = await prisma.invoiceLog.findFirstOrThrow({ where: { ownerId: fx.userId, orderCode: ok.orderCode } });
    expect(log.transactionId).not.toBeNull();
    near(log.cqtNextCheckAt, Date.now() + CQT_FIRST_CHECK_MS);

    const bad = await newOrder();
    publishMode = "reject";
    expect((await issueInvoiceForOrder(fx.userId, scope(), bad.orderCode)).ok).toBe(false);
    const failed = await prisma.invoiceLog.findFirstOrThrow({ where: { ownerId: fx.userId, orderCode: bad.orderCode } });
    expect(failed.status).toBe(InvoiceLogStatus.FAILED);
    expect(failed.cqtNextCheckAt).toBeNull();
  });

  it("hóa đơn điều chỉnh phát hành xong → cũng hẹn giờ hỏi", async () => {
    const o = await newOrder();
    expect((await issueInvoiceForOrder(fx.userId, scope(), o.orderCode)).ok).toBe(true);
    const original = await prisma.invoiceLog.findFirstOrThrow({ where: { ownerId: fx.userId, orderCode: o.orderCode } });
    const r = await issueAdjustmentForOrder(fx.userId, scope(), original.id, "Khách trả hàng hoàn tiền");
    expect(r.ok).toBe(true);
    const adj = await prisma.invoiceLog.findFirstOrThrow({ where: { adjustmentForLogId: original.id } });
    near(adj.cqtNextCheckAt, Date.now() + CQT_FIRST_CHECK_MS);
  });

  it("tờ chưa rõ kết quả: giữ đang chờ thì chưa hẹn; vòng quét nối được số thì hẹn theo lúc gửi", async () => {
    const o = await newOrder();
    publishMode = "lost-after-issue";
    expect((await issueInvoiceForOrder(fx.userId, scope(), o.orderCode)).outcomeUnknown).toBe(true);
    const pending = await prisma.invoiceLog.findFirstOrThrow({ where: { ownerId: fx.userId, orderCode: o.orderCode } });
    expect(pending.status).toBe(InvoiceLogStatus.PENDING);
    expect(pending.cqtNextCheckAt).toBeNull();

    const stats = await runInvoiceUnknownRecheckOnce(at(10 * 60_000), { ownerId: fx.userId });
    expect(stats.linked).toBe(1);
    const linked = await reload(pending.id);
    expect(linked.status).toBe(InvoiceLogStatus.ISSUED);
    expect(linked.cqtNextCheckAt?.getTime()).toBe(pending.createdAt.getTime() + CQT_FIRST_CHECK_MS);
  });
});

describe("Vòng quét hỏi trạng thái", () => {
  it("chưa tới hạn: không nhận, không hỏi", async () => {
    const log = await mkLog({ cqtNextCheckAt: at(HOUR) });
    const stats = await sweep(new Date());
    expect(stats.claimed).toBe(0);
    expect(statusCalls).toEqual([]);
    expect((await reload(log.id)).cqtCheckedAt).toBeNull();
  });

  it("tới hạn: ghi trạng thái cơ quan thuế, mốc đã hỏi, hẹn 12 giờ khi chưa có kết luận", async () => {
    const log = await mkLog();
    book.set(log.transactionId!, st({ taxStatus: "WAITING" }));
    const now = at(0);
    const stats = await sweep(now);
    expect(stats).toMatchObject({ claimed: 1, asked: 1, noRow: 0, rejected: 0 });
    const after = await reload(log.id);
    expect(after.cqtStatus).toBe("WAITING");
    expect(after.cqtCheckedAt?.getTime()).toBe(now.getTime());
    expect(after.cqtNextCheckAt?.getTime()).toBe(now.getTime() + 12 * HOUR);
  });

  it("đã tiếp nhận: trong 7 ngày hẹn 24 giờ; quá 7 ngày thì thôi hỏi", async () => {
    const fresh = await mkLog();
    const old = await mkLog({ createdAt: at(-8 * DAY) });
    book.set(fresh.transactionId!, st({ taxStatus: "ACCEPTED" }));
    book.set(old.transactionId!, st({ taxStatus: "ACCEPTED" }));
    const now = at(0);
    await sweep(now);
    expect((await reload(fresh.id)).cqtNextCheckAt?.getTime()).toBe(now.getTime() + 24 * HOUR);
    const done = await reload(old.id);
    expect(done.cqtStatus).toBe("ACCEPTED");
    expect(done.cqtNextCheckAt).toBeNull();
  });

  it("tờ quá 30 ngày chưa có kết luận vẫn được hỏi, hẹn 24 giờ", async () => {
    const log = await mkLog({ createdAt: at(-45 * DAY), cqtStatus: "WAITING" });
    book.set(log.transactionId!, st({ taxStatus: "WAITING" }));
    const now = at(0);
    await sweep(now);
    const after = await reload(log.id);
    expect(after.cqtCheckedAt?.getTime()).toBe(now.getTime());
    expect(after.cqtNextCheckAt?.getTime()).toBe(now.getTime() + 24 * HOUR);
  });

  it("đang chờ mà nhà cung cấp đã phát hành → đã phát hành, đơn đi theo", async () => {
    const o = await newOrder();
    const log = await mkLog({ ...o, status: InvoiceLogStatus.PENDING, invoiceNo: null });
    book.set(log.transactionId!, st({ invoiceNo: "00000777", taxStatus: "WAITING" }));
    const stats = await sweep(at(0));
    expect(stats.issuedFixed).toBe(1);
    const after = await reload(log.id);
    expect(after).toMatchObject({ status: InvoiceLogStatus.ISSUED, invoiceNo: "00000777", cqtStatus: "WAITING" });
    expect(after.issuedAt).not.toBeNull();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).einvoiceStatus).toBe(InvoiceLogStatus.ISSUED);
  });

  it("bị từ chối: một dòng lịch sử + một chuông; lượt sau vẫn hỏi nhưng không báo lại", async () => {
    const log = await mkLog({ cqtStatus: "WAITING" });
    book.set(log.transactionId!, st({ taxStatus: "REJECTED" }));
    const now = at(0);
    expect((await sweep(now)).rejected).toBe(1);
    const after = await reload(log.id);
    expect(after.cqtStatus).toBe("REJECTED");
    expect(after.status).toBe(InvoiceLogStatus.ISSUED);
    expect(await prisma.invoiceStatusHistory.count({ where: { invoiceLogId: log.id, source: "MISA_STATUS_SYNC" } })).toBe(1);
    expect(await bells()).toBe(1);

    const later = new Date(now.getTime() + 13 * HOUR);
    const again = await sweep(later);
    expect(again).toMatchObject({ claimed: 1, asked: 1, rejected: 0 });
    expect(await prisma.invoiceStatusHistory.count({ where: { invoiceLogId: log.id } })).toBe(1);
    expect(await bells()).toBe(1);
  });

  it("hóa đơn GỐC bị xóa bên nhà cung cấp → đã hủy, đơn đi theo, thôi hỏi, có chuông", async () => {
    const o = await newOrder();
    await prisma.order.update({ where: { id: o.orderId }, data: { einvoiceStatus: InvoiceLogStatus.ISSUED } });
    const log = await mkLog(o);
    book.set(log.transactionId!, st({ deleted: true }));
    expect((await sweep(at(0))).cancelled).toBe(1);
    const after = await reload(log.id);
    expect(after.status).toBe(InvoiceLogStatus.CANCELLED);
    expect(after.cqtNextCheckAt).toBeNull();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).einvoiceStatus).toBe(InvoiceLogStatus.CANCELLED);
    expect(await bells()).toBe(1);
  });

  it("tờ ĐIỀU CHỈNH bị xóa → tờ đó đã hủy, trạng thái hóa đơn của ĐƠN giữ nguyên", async () => {
    const o = await newOrder();
    await prisma.order.update({ where: { id: o.orderId }, data: { einvoiceStatus: InvoiceLogStatus.ISSUED } });
    const original = await mkLog({ ...o, cqtNextCheckAt: null });
    const adj = await mkLog({ ...o, adjustmentForLogId: original.id });
    book.set(adj.transactionId!, st({ deleted: true }));
    expect((await sweep(at(0))).cancelled).toBe(1);
    expect((await reload(adj.id)).status).toBe(InvoiceLogStatus.CANCELLED);
    expect((await reload(original.id)).status).toBe(InvoiceLogStatus.ISSUED);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).einvoiceStatus).toBe(InvoiceLogStatus.ISSUED);
  });

  it("nhà cung cấp không trả dòng → không suy diễn: giữ nguyên, ghi mốc đã hỏi, hẹn lại", async () => {
    const log = await mkLog({ cqtStatus: "WAITING" });
    const now = at(0);
    const stats = await sweep(now);
    expect(stats).toMatchObject({ claimed: 1, asked: 1, noRow: 1 });
    const after = await reload(log.id);
    expect(after).toMatchObject({ status: InvoiceLogStatus.ISSUED, cqtStatus: "WAITING" });
    expect(after.cqtCheckedAt?.getTime()).toBe(now.getTime());
    expect(after.cqtNextCheckAt?.getTime()).toBe(now.getTime() + 12 * HOUR);
    expect(await bells()).toBe(0);
  });

  it("hỏi không được: gọi đúng MỘT lệnh cho shop, dòng tự tới hạn lại sau 15 phút, không bị nhận lần hai", async () => {
    const logs = await Promise.all(Array.from({ length: 60 }, () => mkLog()));
    statusMode = "fail";
    const now = at(0);
    const stats = await sweep(now);
    expect(stats).toMatchObject({ claimed: 60, asked: 0, failedOwners: 1 });
    expect(statusCalls).toHaveLength(1);
    const after = await reload(logs[0].id);
    expect(after.cqtCheckedAt).toBeNull();
    expect(after.cqtNextCheckAt?.getTime()).toBe(now.getTime() + CQT_CLAIM_MS);

    // Cùng mốc giờ: dòng đã nhận không tới hạn nữa → lượt hai không nhận, không gọi.
    expect((await sweep(now)).claimed).toBe(0);
    expect(statusCalls).toHaveLength(1);

    // Sau 15 phút nhà cung cấp hết lỗi → hỏi lại đủ, theo lô 50.
    statusMode = "ok";
    const retry = await sweep(new Date(now.getTime() + CQT_CLAIM_MS + 1000));
    expect(retry).toMatchObject({ claimed: 60, asked: 60, noRow: 60 });
    expect(statusCalls.slice(1).map((c) => c.length)).toEqual([50, 10]);
  });

  it("lỗi TÀI KHOẢN nhà cung cấp → một chuông cho chủ shop, lượt sau không reo thêm; lỗi tạm thì không chuông", async () => {
    const blocked = () => prisma.notification.count({ where: { ownerId: fx.userId, type: "INVOICE_STATUS_CHECK_BLOCKED" } });
    await mkLog();
    statusMode = "fail";
    const now = at(0);
    await sweep(now);
    expect(await blocked()).toBe(0);

    statusMode = "account-fail";
    const second = await sweep(new Date(now.getTime() + CQT_CLAIM_MS + 1000));
    expect(second).toMatchObject({ claimed: 1, failedOwners: 1 });
    expect(await blocked()).toBe(1);
    const bell = await prisma.notification.findFirstOrThrow({ where: { ownerId: fx.userId, type: "INVOICE_STATUS_CHECK_BLOCKED" } });
    expect(bell.title).toContain("MISA meInvoice");
    expect(bell.link).toBe("/invoicing/connect");

    await sweep(new Date(now.getTime() + 2 * CQT_CLAIM_MS + 2000));
    expect(await blocked()).toBe(1); // chuông trước chưa đọc → không reo thêm
  });

  it("một lượt nhận hết dòng tới hạn dù nhiều hơn một câu nhận (không trần theo shop)", async () => {
    await prisma.invoiceLog.createMany({
      data: Array.from({ length: 230 }, (_, i) => ({
        ownerId: fx.userId,
        orderCode: `CQT-${fx.suffix}-BULK-${i}`,
        provider: "MISA",
        transactionId: `TEST-CQT-${fx.suffix}-BULK-${i}`,
        invoiceSeries: "1C26TAA",
        status: InvoiceLogStatus.ISSUED,
        cqtNextCheckAt: new Date(Date.now() - 60_000),
      })),
    });
    const stats = await sweep(at(0));
    expect(stats).toMatchObject({ claimed: 230, asked: 230, leftover: false });
    expect(statusCalls.map((c) => c.length)).toEqual([50, 50, 50, 50, 30]);
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx.userId, cqtNextCheckAt: { lte: new Date() } } })).toBe(0);
  });

  it("shop không còn nhà cung cấp đã lập tờ → không hỏi, giữ trong diện theo dõi", async () => {
    const log = await mkLog();
    providerHolder.current = { ...fake, name: "KHAC" };
    const now = at(0);
    const stats = await sweep(now);
    expect(stats).toMatchObject({ claimed: 1, asked: 0, unaskable: 1 });
    expect(statusCalls).toEqual([]);
    const after = await reload(log.id);
    expect(after.cqtCheckedAt).toBeNull();
    expect(after.cqtNextCheckAt?.getTime()).toBe(now.getTime() + 12 * HOUR);

    providerHolder.current = null; // shop đã gỡ cấu hình
    const again = await sweep(new Date(now.getTime() + 13 * HOUR));
    expect(again).toMatchObject({ claimed: 1, unaskable: 1 });
  });

  it("dòng hỏng / đã hủy còn sót giờ hỏi → gỡ giờ hỏi, không hỏi", async () => {
    const log = await mkLog({ status: InvoiceLogStatus.FAILED });
    const stats = await sweep(at(0));
    expect(stats).toMatchObject({ claimed: 1, asked: 0 });
    expect(statusCalls).toEqual([]);
    expect((await reload(log.id)).cqtNextCheckAt).toBeNull();
  });

  it("dòng bị tiến trình khác đổi giữa lúc hỏi → không ghi đè", async () => {
    const row = await mkLog({ cqtStatus: "WAITING" });
    const stale: FollowLog = { ...row };
    await prisma.invoiceLog.update({ where: { id: row.id }, data: { status: InvoiceLogStatus.CANCELLED } });
    const now = at(0);
    const plan = planFollow(stale, { transactionId: row.transactionId!, ...st({ taxStatus: "REJECTED" }) }, now);
    expect(await applyFollowPlan(stale, plan, now)).toBe(false);
    const after = await reload(row.id);
    expect(after).toMatchObject({ status: InvoiceLogStatus.CANCELLED, cqtStatus: "WAITING" });
    expect(await prisma.invoiceStatusHistory.count({ where: { invoiceLogId: row.id } })).toBe(0);
  });
});
