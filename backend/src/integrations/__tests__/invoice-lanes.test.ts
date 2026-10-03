// ============================================================
// LÀN TỰ PHÁT HÀNH THEO SHOP — hóa đơn bước 5, lát 8 (03/10/2026).
// Chạy trên database dev (cần migration 20261003140000_invoice_lanes + lát 7).
// Nhà cung cấp thay bằng adapter giả; KHÔNG chạm MISA. Cờ cho phép phát hành giả là bật.
//
//   1. Lịch lượt kế (hàm thuần): còn tồn 1 phút; hết 15 phút; lỗi tạm lùi 1 → 5 → 15
//      và trần 15; dừng giữa chừng → ngay, giữ chuỗi.
//   2. Thuê làn: hai tiến trình cùng xin một shop chỉ một bên được; hết hạn thuê thì
//      bên khác nhận; gia hạn / trả làn của người khác không ăn.
//   3. Một lượt trọn: 2 đơn → DONE, cả hai ISSUED, làn trả, hẹn 15 phút.
//   4. 21 đơn → BACKLOG hẹn 1 phút, lượt sau DONE.
//   5. Lỗi tạm → TRANSIENT, chuỗi 1, hẹn 1 phút; đơn đó KHÔNG bị chặn 24 giờ ở đường
//      làn (đường cũ vẫn chặn); thành công thì chuỗi về 0.
//   6. Lỗi tài khoản → PAUSED + ngắt mạch; lưới quét không nhận; Chạy lại (nextRunAt
//      về ngay + gỡ ngắt mạch) thì nhận lại.
//   7. Lưới quét: tự tạo làn cho shop bật công tắc; tôn trọng số shop cùng lúc.
//   8. Dừng êm giữa lượt: tờ chưa đụng tới để lại, làn hẹn ngay, trả làn.
//   9. Đơn đã tới mức dừng của lát 7 vẫn không được chọn ở đường làn.
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
import type { CreateInvoiceInput, InvoiceProvider, InvoiceResult } from "../invoice/types";
import { MISA_CAPABILITIES } from "../invoice/misa-provider";
import { findAutoIssueCandidates } from "../../workers/invoice-auto-issue";
import {
  BACKLOG_DELAY_MS,
  claimInvoiceLane,
  LANE_LEASE_MS,
  releaseInvoiceLane,
  renewInvoiceLane,
  resumeInvoiceLanes,
  runInvoiceLaneOnce,
  scheduleAfter,
  setInvoiceLaneWorkerId,
  stopInvoiceLanes,
  sweepInvoiceLanes,
  TRANSIENT_BACKOFF_MS,
  whenInvoiceLanesIdle,
} from "../../workers/invoice-lanes";
import { createStockFixture, type StockFixture } from "./fixtures";

let fx: StockFixture;
let fx2: StockFixture;
let productId: string;
let product2Id: string;
let calls = 0;
let delayMs = 0;
let nextResult: (input: CreateInvoiceInput) => InvoiceResult;
let seq = 0;

const fakeProvider: InvoiceProvider = {
  name: "MISA",
  capabilities: { ...MISA_CAPABILITIES, publishGapMs: 0 },
  async createInvoice(input) {
    calls += 1;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
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
    invoiceNo: `L${String(seq).padStart(7, "0")}`,
    transactionId: `LANE-TX-${fx.suffix}-${seq}`,
  };
};
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
const orderFault = (): InvoiceResult => ({
  status: InvoiceLogStatus.FAILED,
  errorScope: "ORDER",
  errorCode: "TaxRateInfo_VATRateName",
  errorMessage: "Tên thuế suất không hợp lệ (test)",
});

const DAY = 86_400_000;
const MIN = 60_000;

async function deliveredOrder(f: StockFixture, pid: string): Promise<{ id: string; orderCode: string }> {
  const id = await f.createOrder(pid, 1);
  return prisma.order.update({
    where: { id },
    data: { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: new Date(Date.now() - DAY) },
    select: { id: true, orderCode: true },
  });
}

async function lane(ownerId: string) {
  return prisma.invoiceLane.findUniqueOrThrow({ where: { ownerId } });
}

/** Làn rảnh, tới giờ, chuỗi 0 — trạng thái xuất phát của mỗi ca. */
async function resetLane(ownerId: string, patch: { transientStreak?: number } = {}) {
  await prisma.invoiceLane.upsert({
    where: { ownerId },
    create: { ownerId, ...patch },
    update: { leasedBy: null, leasedUntil: null, nextRunAt: new Date(), transientStreak: 0, ...patch },
  });
}

async function enableAutoIssue(ownerId: string, enabled = true) {
  await prisma.invoiceConfig.updateMany({
    where: { ownerId, channelId: null },
    data: { autoIssueEnabled: enabled, autoIssuePausedAt: null, autoIssuePauseReason: null },
  });
}

async function clearOrders(f: StockFixture) {
  const orders = await prisma.order.findMany({ where: { channel: { userId: f.userId } }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  await prisma.invoiceStatusHistory.deleteMany({ where: { invoiceLog: { ownerId: f.userId } } });
  await prisma.invoiceLog.deleteMany({ where: { ownerId: f.userId } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
}

const near = (d: Date, expectedMs: number, slackMs = 5_000) =>
  Math.abs(d.getTime() - expectedMs) <= slackMs;

beforeAll(async () => {
  fx = await createStockFixture("invlane");
  fx2 = await createStockFixture("invlane2");
  productId = await fx.createProduct(100);
  product2Id = await fx2.createProduct(100);
  for (const f of [fx, fx2]) {
    await prisma.invoiceConfig.create({
      data: {
        ownerId: f.userId,
        provider: "MISA",
        invoicePattern: "1",
        invoiceSeries: "1C26TAA",
        taxCode: "0101234567",
        meinvoiceUsername: "lane@test",
        meinvoicePassword: "x",
        autoIssueEnabled: true,
        autoIssueTrigger: "DELIVERED",
      },
    });
  }
  providerHolder.current = fakeProvider;
  setInvoiceLaneWorkerId("test-worker-A");
});

beforeEach(async () => {
  calls = 0;
  delayMs = 0;
  nextResult = issued;
  resumeInvoiceLanes();
  await enableAutoIssue(fx.userId);
  await enableAutoIssue(fx2.userId, false);
  await resetLane(fx.userId);
  await prisma.invoiceLane.deleteMany({ where: { ownerId: fx2.userId } });
  await clearOrders(fx);
  await clearOrders(fx2);
});

afterEach(async () => {
  await whenInvoiceLanesIdle();
  resumeInvoiceLanes();
});

afterAll(async () => {
  await fx.cleanup();
  await fx2.cleanup();
});

describe("Lát 8: lịch lượt kế (hàm thuần)", () => {
  it("còn tồn 1 phút; hết 15 phút; lỗi tạm lùi 1 → 5 → 15 và trần 15; dừng giữa chừng → ngay, giữ chuỗi", () => {
    const now = new Date("2026-10-03T03:00:00Z");
    const t = now.getTime();
    expect(scheduleAfter("BACKLOG", 2, now, { idleMs: 15 * MIN })).toEqual({
      nextRunAt: new Date(t + BACKLOG_DELAY_MS),
      transientStreak: 0,
    });
    expect(scheduleAfter("DONE", 2, now, { idleMs: 15 * MIN })).toEqual({ nextRunAt: new Date(t + 15 * MIN), transientStreak: 0 });
    expect(scheduleAfter("IDLE", 0, now, { idleMs: 15 * MIN }).nextRunAt).toEqual(new Date(t + 15 * MIN));
    expect(scheduleAfter("PAUSED", 0, now, { idleMs: 15 * MIN }).nextRunAt).toEqual(new Date(t + 15 * MIN));
    expect(scheduleAfter("TRANSIENT", 0, now)).toEqual({ nextRunAt: new Date(t + TRANSIENT_BACKOFF_MS[0]), transientStreak: 1 });
    expect(scheduleAfter("TRANSIENT", 1, now)).toEqual({ nextRunAt: new Date(t + TRANSIENT_BACKOFF_MS[1]), transientStreak: 2 });
    expect(scheduleAfter("TRANSIENT", 2, now)).toEqual({ nextRunAt: new Date(t + TRANSIENT_BACKOFF_MS[2]), transientStreak: 3 });
    expect(scheduleAfter("TRANSIENT", 9, now)).toEqual({ nextRunAt: new Date(t + TRANSIENT_BACKOFF_MS[2]), transientStreak: 10 });
    expect(scheduleAfter("BACKLOG", 2, now, { interrupted: true })).toEqual({ nextRunAt: now, transientStreak: 2 });
  });
});

describe("Lát 8: thuê làn ở database", () => {
  it("hai tiến trình cùng xin một shop chỉ một bên được; hết hạn thì bên khác nhận; gia hạn / trả của người khác không ăn", async () => {
    const owner = fx.userId;
    const [a, b] = await Promise.all([claimInvoiceLane(owner, "A"), claimInvoiceLane(owner, "B")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const holder = a ? "A" : "B";
    const other = a ? "B" : "A";
    expect(await claimInvoiceLane(owner, other)).toBe(false);
    expect(await renewInvoiceLane(owner, other)).toBe(false);
    expect(await releaseInvoiceLane(owner, { nextRunAt: new Date(), transientStreak: 0 }, other)).toBe(false);
    expect((await lane(owner)).leasedBy).toBe(holder);
    expect(await renewInvoiceLane(owner, holder)).toBe(true);

    // Tiến trình giữ làn chết: hết hạn thuê → bên khác nhận được.
    await prisma.invoiceLane.update({
      where: { ownerId: owner },
      data: { leasedUntil: new Date(Date.now() - 1_000) },
    });
    expect(await claimInvoiceLane(owner, other)).toBe(true);
    expect((await lane(owner)).leasedBy).toBe(other);
    expect(await releaseInvoiceLane(owner, { nextRunAt: new Date(), transientStreak: 0 }, other)).toBe(true);
    expect((await lane(owner)).leasedBy).toBeNull();
  });

  it("chưa tới giờ thì không thuê được", async () => {
    await prisma.invoiceLane.update({
      where: { ownerId: fx.userId },
      data: { nextRunAt: new Date(Date.now() + 10 * MIN) },
    });
    expect(await claimInvoiceLane(fx.userId)).toBe(false);
  });
});

describe("Lát 8: một lượt của một shop qua làn", () => {
  it("2 đơn → DONE, cả hai ISSUED, làn trả, hẹn 15 phút", async () => {
    await deliveredOrder(fx, productId);
    await deliveredOrder(fx, productId);
    const before = Date.now();
    expect(await runInvoiceLaneOnce(fx.userId)).toBe("DONE");
    expect(calls).toBe(2);
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx.userId, status: InvoiceLogStatus.ISSUED } })).toBe(2);
    const l = await lane(fx.userId);
    expect(l.leasedBy).toBeNull();
    expect(l.leasedUntil).toBeNull();
    expect(l.lastRunAt).not.toBeNull();
    expect(near(l.nextRunAt, before + 15 * MIN, 10_000)).toBe(true);
    // Chưa tới giờ → lượt kế không thuê được.
    expect(await runInvoiceLaneOnce(fx.userId)).toBeNull();
  });

  it("21 đơn → BACKLOG hẹn 1 phút (20 tờ), lượt sau DONE (tờ còn lại)", async () => {
    for (let i = 0; i < 21; i++) await deliveredOrder(fx, productId);
    const before = Date.now();
    expect(await runInvoiceLaneOnce(fx.userId)).toBe("BACKLOG");
    expect(calls).toBe(20);
    const l = await lane(fx.userId);
    expect(near(l.nextRunAt, before + BACKLOG_DELAY_MS, 10_000)).toBe(true);
    expect(l.transientStreak).toBe(0);
    await resetLane(fx.userId);
    expect(await runInvoiceLaneOnce(fx.userId)).toBe("DONE");
    expect(calls).toBe(21);
  });

  it("lỗi tạm → TRANSIENT, chuỗi 1, hẹn 1 phút; đơn không bị chặn 24 giờ ở đường làn (đường cũ vẫn chặn); thành công thì chuỗi về 0", async () => {
    const o = await deliveredOrder(fx, productId);
    nextResult = transientFault;
    const before = Date.now();
    expect(await runInvoiceLaneOnce(fx.userId)).toBe("TRANSIENT");
    let l = await lane(fx.userId);
    expect(l.transientStreak).toBe(1);
    expect(near(l.nextRunAt, before + TRANSIENT_BACKOFF_MS[0], 10_000)).toBe(true);

    const cfg = { ownerId: fx.userId, trigger: "DELIVERED" as const, autoIssueEnabledAt: null };
    expect(await findAutoIssueCandidates(cfg, new Date(), 20, { transientBlocks: false })).toContain(o.orderCode);
    expect(await findAutoIssueCandidates(cfg, new Date(), 20, { transientBlocks: true })).not.toContain(o.orderCode);

    // Lượt kế (nấc 2) vẫn lỗi tạm → chuỗi 2, hẹn 5 phút.
    await prisma.invoiceLane.update({ where: { ownerId: fx.userId }, data: { nextRunAt: new Date() } });
    const before2 = Date.now();
    expect(await runInvoiceLaneOnce(fx.userId)).toBe("TRANSIENT");
    l = await lane(fx.userId);
    expect(l.transientStreak).toBe(2);
    expect(near(l.nextRunAt, before2 + TRANSIENT_BACKOFF_MS[1], 10_000)).toBe(true);

    // Nhà cung cấp hồi → tờ lập được, chuỗi về 0.
    nextResult = issued;
    await prisma.invoiceLane.update({ where: { ownerId: fx.userId }, data: { nextRunAt: new Date() } });
    expect(await runInvoiceLaneOnce(fx.userId)).toBe("DONE");
    expect((await lane(fx.userId)).transientStreak).toBe(0);
    expect(await prisma.invoiceLog.count({ where: { orderId: o.id, status: InvoiceLogStatus.ISSUED } })).toBe(1);
  });

  it("lỗi tài khoản → PAUSED + ngắt mạch; lưới quét không nhận; Chạy lại thì nhận và các đơn đó được thử ngay", async () => {
    await deliveredOrder(fx, productId);
    await deliveredOrder(fx, productId);
    nextResult = accountFault;
    expect(await runInvoiceLaneOnce(fx.userId)).toBe("PAUSED");
    expect(calls).toBe(1); // ngắt ngay từ đơn đầu
    const cfg = await prisma.invoiceConfig.findFirstOrThrow({ where: { ownerId: fx.userId, channelId: null } });
    expect(cfg.autoIssuePausedAt).not.toBeNull();

    await resetLane(fx.userId); // tới giờ, rảnh — nhưng shop đang ngắt mạch
    expect(await sweepInvoiceLanes(new Date(), { onlyOwnerIds: [fx.userId, fx2.userId] })).toBe(0);

    // "Chạy lại" như route: gỡ ngắt mạch + nextRunAt về ngay.
    await enableAutoIssue(fx.userId);
    await resetLane(fx.userId);
    nextResult = issued;
    expect(await sweepInvoiceLanes(new Date(), { onlyOwnerIds: [fx.userId, fx2.userId] })).toBe(1);
    await whenInvoiceLanesIdle();
    // Hai đơn từng hỏng vì tài khoản (chưa qua 24 giờ) vẫn được thử ngay ở đường làn.
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx.userId, status: InvoiceLogStatus.ISSUED } })).toBe(2);
  });

  it("đơn đã tới mức dừng của lát 7 không được chọn ở đường làn", async () => {
    const o = await deliveredOrder(fx, productId);
    nextResult = orderFault;
    for (let i = 0; i < 3; i++) await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, o.orderCode);
    await prisma.invoiceLog.updateMany({ where: { orderId: o.id }, data: { createdAt: new Date(Date.now() - 2 * DAY) } });
    calls = 0;
    nextResult = issued;
    expect(await runInvoiceLaneOnce(fx.userId)).toBe("IDLE");
    expect(calls).toBe(0);
  });
});

describe("Lát 8: lưới quét và dừng êm", () => {
  it("tự tạo làn cho shop bật công tắc chưa có làn; tôn trọng số shop cùng lúc", async () => {
    await enableAutoIssue(fx2.userId, true);
    await deliveredOrder(fx, productId);
    await deliveredOrder(fx2, product2Id);
    const prev = process.env.INVOICE_LANE_CONCURRENCY;
    process.env.INVOICE_LANE_CONCURRENCY = "1";
    try {
      expect(await prisma.invoiceLane.findUnique({ where: { ownerId: fx2.userId } })).toBeNull();
      expect(await sweepInvoiceLanes(new Date(), { onlyOwnerIds: [fx.userId, fx2.userId] })).toBe(1); // chỉ 1 shop vì trần = 1
      expect(await prisma.invoiceLane.findUnique({ where: { ownerId: fx2.userId } })).not.toBeNull();
      await whenInvoiceLanesIdle();
      expect(await sweepInvoiceLanes(new Date(), { onlyOwnerIds: [fx.userId, fx2.userId] })).toBe(1); // shop còn lại
      await whenInvoiceLanesIdle();
    } finally {
      if (prev === undefined) delete process.env.INVOICE_LANE_CONCURRENCY;
      else process.env.INVOICE_LANE_CONCURRENCY = prev;
    }
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx.userId, status: InvoiceLogStatus.ISSUED } })).toBe(1);
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx2.userId, status: InvoiceLogStatus.ISSUED } })).toBe(1);
    expect(await sweepInvoiceLanes(new Date(), { onlyOwnerIds: [fx.userId, fx2.userId] })).toBe(0); // cả hai đã hẹn 15 phút
  });

  it("dừng êm giữa lượt: tờ đang dở xong, tờ chưa đụng tới để lại, làn hẹn ngay và được trả", async () => {
    for (let i = 0; i < 5; i++) await deliveredOrder(fx, productId);
    delayMs = 300;
    expect(await sweepInvoiceLanes(new Date(), { onlyOwnerIds: [fx.userId, fx2.userId] })).toBe(1);
    await new Promise((r) => setTimeout(r, 450)); // đang ở tờ 1–2
    await stopInvoiceLanes(5_000);
    await whenInvoiceLanesIdle();
    const issuedCount = await prisma.invoiceLog.count({ where: { ownerId: fx.userId, status: InvoiceLogStatus.ISSUED } });
    expect(issuedCount).toBeGreaterThanOrEqual(1);
    expect(issuedCount).toBeLessThan(5);
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx.userId, status: InvoiceLogStatus.PENDING } })).toBe(0);
    const l = await lane(fx.userId);
    expect(l.leasedBy).toBeNull();
    expect(l.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());
    // Worker (khác) lên lại: nhặt tiếp phần còn lại.
    resumeInvoiceLanes();
    delayMs = 0;
    expect(await runInvoiceLaneOnce(fx.userId)).toBe("DONE");
    expect(await prisma.invoiceLog.count({ where: { ownerId: fx.userId, status: InvoiceLogStatus.ISSUED } })).toBe(5);
  });
});
