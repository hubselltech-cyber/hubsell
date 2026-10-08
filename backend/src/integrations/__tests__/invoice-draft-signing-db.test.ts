// ============================================================
// TỜ NHÁP CHỜ CHỦ SHOP KÝ — lát T1 luồng tenant (08/10/2026). Phần chạy trên database dev
// (cần cột InvoiceLog.awaitingSignatureAt — migration 20261008140000). Nhà cung cấp là
// adapter giả: createInvoice trả "đang chờ ký", findDrafts đọc "sổ" tờ nháp. KHÔNG chạm MISA.
//
//   1. Xuất với eSign → dòng PENDING + awaitingSignatureAt + giờ hỏi 10 phút; đơn PENDING;
//      kết quả 202 awaitingSignature, không phải lỗi; bấm lại → 409 "đang chờ bạn ký".
//   2. Vòng quét tờ chưa rõ kết quả BỎ QUA dòng chờ ký (không ghi hỏng).
//   3. Vòng hỏi theo giờ: còn chờ → hẹn 30 phút; đã ký → ISSUED + số + mã + chuông;
//      nháp bị xóa → CANCELLED + đơn CANCELLED + chuông; tờ đã ký không bị hỏi lại kiểu nháp.
//   4. Hóa đơn điều chỉnh với eSign cũng đi tờ nháp.
//   5. Lượt tự động: tờ nháp không vào chuỗi lỗi.
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
import { runInvoiceCqtFollowOnce } from "../../workers/invoice-cqt-follow";
import { runInvoiceUnknownRecheckOnce } from "../../workers/invoice-unknown-recheck";
import { issueAdjustmentForOrder } from "../invoice/adjust-order";
import { CQT_FIRST_CHECK_MS } from "../invoice/cqt-follow";
import {
  AWAITING_SIGNATURE_CODE,
  DRAFT_FIRST_CHECK_MS,
  DRAFT_GONE_MIN_AGE_MS,
  DRAFT_RECHECK_MS,
  isDeferredAtProvider,
} from "../invoice/draft-signing";
import { issueInvoiceForOrder } from "../invoice/issue-order";
import { MISA_CAPABILITIES } from "../invoice/misa-provider";
import type {
  CreateInvoiceInput,
  DraftBatchResult,
  DraftLookup,
  InvoiceProvider,
  InvoiceResult,
} from "../invoice/types";
import { createStockFixture, type StockFixture } from "./fixtures";

const MIN = 60_000;

let fx: StockFixture;
let productId: string;
let seq = 0;

/** "Sổ" tờ nháp của nhà cung cấp giả: mã tham chiếu → trạng thái. Không có = GONE. */
const drafts = new Map<string, DraftLookup>();
let draftsMode: "ok" | "fail" = "ok";
let findCalls: string[][] = [];

const fake: InvoiceProvider = {
  name: "MISA",
  capabilities: MISA_CAPABILITIES,
  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    // Giả lập đường tờ nháp: đã đẩy, chờ chủ shop ký.
    drafts.set(input.orderCode, { state: "WAITING" });
    return {
      status: InvoiceLogStatus.PENDING,
      awaitingSignature: true,
      errorCode: AWAITING_SIGNATURE_CODE,
      errorMessage: "Chờ bạn ký: Hubsell đã lập tờ nháp đầy đủ dữ liệu trên MISA meInvoice (giả).",
      vatAmount: input.lines.reduce((s, l) => s + l.vatAmount, 0),
    };
  },
  async cancelInvoice() {
    return { status: InvoiceLogStatus.FAILED };
  },
  async checkStatus() {
    return { status: InvoiceLogStatus.FAILED };
  },
  async findByReference(reference: string) {
    // Hóa đơn gốc đã ký (sổ ghi SIGNED) thì tra ngược thấy — adjust-precheck cần xác nhận gốc còn hiệu lực.
    const d = drafts.get(reference);
    if (d?.state === "SIGNED" && d.transactionId) {
      return { state: "FOUND" as const, invoiceNo: d.invoiceNo, transactionId: d.transactionId, issued: true, deleted: false, matches: 1 };
    }
    return { state: "NOT_FOUND" as const };
  },
  async checkStatuses() {
    return { ok: true, found: new Map() };
  },
  async findDrafts(references: string[]): Promise<DraftBatchResult> {
    findCalls.push(references);
    if (draftsMode === "fail") return { ok: false, message: "nhà cung cấp giả lỗi", accountProblem: false };
    const found = new Map<string, DraftLookup>();
    for (const ref of references) found.set(ref, drafts.get(ref) ?? { state: "GONE" });
    return { ok: true, found };
  },
};

const scope = () => ({ userId: fx.userId });
const at = (ms: number) => new Date(Date.now() + ms);
const sweep = (now: Date) => runInvoiceCqtFollowOnce(now, { ownerId: fx.userId });
const reload = (id: string) => prisma.invoiceLog.findUniqueOrThrow({ where: { id } });
const near = (d: Date | null, expected: number, slack = 5_000) =>
  expect(Math.abs((d?.getTime() ?? 0) - expected)).toBeLessThan(slack);
const bells = (type: string) => prisma.notification.count({ where: { ownerId: fx.userId, type } });

async function newOrder(): Promise<{ orderId: string; orderCode: string }> {
  seq += 1;
  const orderId = await fx.createOrder(productId, 1);
  const { orderCode } = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  return { orderId, orderCode };
}

/** Xuất một đơn với eSign → trả dòng nhật ký tờ nháp đang chờ ký. */
async function issueDraft() {
  const o = await newOrder();
  const r = await issueInvoiceForOrder(fx.userId, scope(), o.orderCode);
  const log = await prisma.invoiceLog.findFirstOrThrow({ where: { ownerId: fx.userId, orderCode: o.orderCode } });
  return { ...o, r, log };
}

beforeAll(async () => {
  fx = await createStockFixture("invdraft");
  productId = await fx.createProduct(500);
  await prisma.invoiceConfig.create({
    data: { ownerId: fx.userId, provider: "MISA", invoicePattern: "1", invoiceSeries: "1C26TAA", signMethod: "ESIGN_CLOUD" },
  });
});

beforeEach(async () => {
  providerHolder.current = fake;
  draftsMode = "ok";
  findCalls = [];
  drafts.clear();
  await prisma.invoiceLog.updateMany({ where: { ownerId: fx.userId }, data: { cqtNextCheckAt: null } });
  await prisma.notification.deleteMany({ where: { ownerId: fx.userId } });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { ownerId: fx.userId } });
  await fx.cleanup();
});

describe("Xuất hóa đơn với chữ ký eSign → tờ nháp chờ ký", () => {
  it("dòng PENDING mang awaitingSignatureAt + giờ hỏi 10 phút; đơn PENDING; kết quả 202 không phải lỗi", async () => {
    const { r, log, orderId } = await issueDraft();
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(202);
    expect(r.awaitingSignature).toBe(true);
    expect(r.errorCode).toBe(AWAITING_SIGNATURE_CODE);
    expect(r.error).toBeUndefined();
    expect(r.message).toContain("Chờ bạn ký");
    expect(isDeferredAtProvider(r)).toBe(true);
    expect(r.orderErrorCount).toBeUndefined();

    expect(log.status).toBe(InvoiceLogStatus.PENDING);
    expect(log.transactionId).toBeNull();
    expect(log.awaitingSignatureAt).not.toBeNull();
    expect(log.errorScope).toBeNull();
    expect(log.orderErrorCount).toBeNull();
    near(log.cqtNextCheckAt, Date.now() + DRAFT_FIRST_CHECK_MS);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).einvoiceStatus).toBe(InvoiceLogStatus.PENDING);
    const hist = await prisma.invoiceStatusHistory.findFirst({ where: { invoiceLogId: log.id } });
    expect(hist?.note).toContain("tờ nháp");
  });

  it("bấm xuất lại đơn đang chờ ký → 409 nói rõ 'đang chờ bạn ký', không lập thêm", async () => {
    const { orderCode } = await issueDraft();
    const again = await issueInvoiceForOrder(fx.userId, scope(), orderCode);
    expect(again.httpStatus).toBe(409);
    expect(again.conflict).toBe("PENDING");
    expect(again.error).toContain("chờ bạn ký");
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx.userId, orderCode } })).toBe(1);
  });

  it("vòng quét tờ chưa rõ kết quả BỎ QUA dòng chờ ký (không ghi hỏng)", async () => {
    const { log } = await issueDraft();
    const stats = await runInvoiceUnknownRecheckOnce(at(30 * MIN), { ownerId: fx.userId });
    expect(stats.scanned).toBe(0);
    expect((await reload(log.id)).status).toBe(InvoiceLogStatus.PENDING);
  });
});

describe("Vòng hỏi theo giờ với tờ nháp", () => {
  it("chưa tới hạn → không hỏi; tới hạn mà còn chờ → hẹn 30 phút, ghi đã hỏi, giữ PENDING", async () => {
    const { log, orderCode } = await issueDraft();
    expect((await sweep(new Date())).draftsAsked).toBe(0);

    const now = at(DRAFT_FIRST_CHECK_MS + MIN);
    const stats = await sweep(now);
    expect(stats.draftsAsked).toBe(1);
    expect(stats.draftsSigned).toBe(0);
    expect(findCalls).toEqual([[orderCode]]);
    const after = await reload(log.id);
    expect(after.status).toBe(InvoiceLogStatus.PENDING);
    expect(after.awaitingSignatureAt).not.toBeNull();
    near(after.cqtCheckedAt, now.getTime());
    near(after.cqtNextCheckAt, now.getTime() + DRAFT_RECHECK_MS);
  });

  it("chủ shop đã ký → ISSUED + số + mã tra cứu, ngày lập = ngày đẩy, hẹn hỏi cơ quan thuế, đơn ISSUED, một chuông", async () => {
    const { log, orderCode, orderId } = await issueDraft();
    drafts.set(orderCode, { state: "SIGNED", invoiceNo: "00000041", transactionId: `TX-${fx.suffix}-41` });
    const now = at(DRAFT_FIRST_CHECK_MS + MIN);
    const stats = await sweep(now);
    expect(stats.draftsSigned).toBe(1);
    const after = await reload(log.id);
    expect(after.status).toBe(InvoiceLogStatus.ISSUED);
    expect(after.invoiceNo).toBe("00000041");
    expect(after.transactionId).toBe(`TX-${fx.suffix}-41`);
    expect(after.awaitingSignatureAt).toBeNull();
    expect(after.errorMessage).toBeNull();
    expect(after.issuedAt?.getTime()).toBe(log.createdAt.getTime());
    near(after.cqtNextCheckAt, now.getTime() + CQT_FIRST_CHECK_MS);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).einvoiceStatus).toBe(InvoiceLogStatus.ISSUED);
    const hist = await prisma.invoiceStatusHistory.findMany({ where: { invoiceLogId: log.id }, orderBy: { createdAt: "asc" } });
    expect(hist.at(-1)?.note).toContain("00000041");
    expect(await bells("INVOICE_DRAFT_SIGNED")).toBe(1);

    // Tờ đã ký không còn là tờ nháp: lượt sau không hỏi findDrafts cho nó nữa.
    findCalls = [];
    await sweep(at(DRAFT_FIRST_CHECK_MS + 2 * MIN));
    expect(findCalls.flat()).not.toContain(orderCode);
  });

  it("đã ký nhưng chưa có số → giữ PENDING kèm mã tra cứu (vòng hỏi trạng thái theo tiếp), chưa reo 'đã ký' lần hai", async () => {
    const { log, orderCode } = await issueDraft();
    drafts.set(orderCode, { state: "SIGNED", invoiceNo: null, transactionId: `TX-${fx.suffix}-42` });
    await sweep(at(DRAFT_FIRST_CHECK_MS + MIN));
    const after = await reload(log.id);
    expect(after.status).toBe(InvoiceLogStatus.PENDING);
    expect(after.transactionId).toBe(`TX-${fx.suffix}-42`);
    expect(after.awaitingSignatureAt).toBeNull();
    expect(after.cqtNextCheckAt).not.toBeNull();
  });

  it("nháp bị xóa trên web: mới đẩy thì chưa kết luận; đủ lâu → CANCELLED, đơn CANCELLED, chuông", async () => {
    const { log, orderCode, orderId } = await issueDraft();
    drafts.delete(orderCode); // nhà cung cấp giả trả GONE
    // Tờ mới đẩy (tuổi < DRAFT_GONE_MIN_AGE_MS): dời giờ hỏi về ngay để vòng quét nhận, nhưng không kết luận.
    await prisma.invoiceLog.update({ where: { id: log.id }, data: { cqtNextCheckAt: new Date() } });
    await sweep(new Date());
    expect((await reload(log.id)).status).toBe(InvoiceLogStatus.PENDING);

    // Lượt trước đã hẹn 30 phút; dời về ngay để lượt "đủ lâu" nhận được dòng.
    await prisma.invoiceLog.update({ where: { id: log.id }, data: { cqtNextCheckAt: new Date() } });
    const now = at(DRAFT_GONE_MIN_AGE_MS + MIN);
    const stats = await sweep(now);
    expect(stats.draftsGone).toBe(1);
    const after = await reload(log.id);
    expect(after.status).toBe(InvoiceLogStatus.CANCELLED);
    expect(after.awaitingSignatureAt).toBeNull();
    expect(after.cqtNextCheckAt).toBeNull();
    expect(after.errorMessage).toContain("đã bị xóa");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).einvoiceStatus).toBe(InvoiceLogStatus.CANCELLED);
    expect(await bells("INVOICE_DRAFT_GONE")).toBe(1);
    // Đơn quay lại hàng chờ: xuất lại được (dòng CANCELLED không còn là vé).
    const again = await issueInvoiceForOrder(fx.userId, scope(), orderCode);
    expect(again.awaitingSignature).toBe(true);
  });

  it("hỏi nhà cung cấp không được → giữ nguyên, dòng tự tới hạn lại sau; không chuông", async () => {
    const { log } = await issueDraft();
    draftsMode = "fail";
    const stats = await sweep(at(DRAFT_FIRST_CHECK_MS + MIN));
    expect(stats.failedOwners).toBe(1);
    const after = await reload(log.id);
    expect(after.status).toBe(InvoiceLogStatus.PENDING);
    expect(after.awaitingSignatureAt).not.toBeNull();
    expect(await bells("INVOICE_DRAFT_SIGNED")).toBe(0);
  });
});

describe("Hóa đơn điều chỉnh với eSign", () => {
  it("cũng đi tờ nháp: dòng điều chỉnh PENDING + awaitingSignatureAt; ký xong → ISSUED, đơn không đổi theo tờ điều chỉnh", async () => {
    const { log, orderCode, orderId } = await issueDraft();
    drafts.set(orderCode, { state: "SIGNED", invoiceNo: "00000050", transactionId: `TX-${fx.suffix}-50` });
    await sweep(at(DRAFT_FIRST_CHECK_MS + MIN));
    expect((await reload(log.id)).status).toBe(InvoiceLogStatus.ISSUED);

    const r = await issueAdjustmentForOrder(fx.userId, scope(), log.id, "Khách trả hàng hoàn tiền");
    expect(r.httpStatus).toBe(202);
    expect(r.awaitingSignature).toBe(true);
    const adj = await prisma.invoiceLog.findFirstOrThrow({ where: { adjustmentForLogId: log.id } });
    expect(adj.status).toBe(InvoiceLogStatus.PENDING);
    expect(adj.awaitingSignatureAt).not.toBeNull();
    expect(adj.providerRef).toBe(`${orderCode}-DC1`);

    drafts.set(adj.providerRef!, { state: "SIGNED", invoiceNo: "00000051", transactionId: `TX-${fx.suffix}-51` });
    await prisma.invoiceLog.update({ where: { id: adj.id }, data: { cqtNextCheckAt: new Date() } });
    await sweep(at(DRAFT_GONE_MIN_AGE_MS + MIN));
    const adjAfter = await reload(adj.id);
    expect(adjAfter.status).toBe(InvoiceLogStatus.ISSUED);
    expect(adjAfter.invoiceNo).toBe("00000051");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).einvoiceStatus).toBe(InvoiceLogStatus.ISSUED);
  });
});
