// ============================================================
// TỰ XUẤT HĐĐT + GỬI EMAIL KHI KHÁCH MUA GÓI (06/10/2026) — kiểm trên DB dev,
// MISA + SMTP được MOCK (không gọi ra ngoài, không sinh hóa đơn thật):
//   · Khoản thu phí gói sau mốc bật → phát hành (RefID HQLEDGER-<id>, người mua
//     theo hồ sơ xuất hóa đơn của khách) → gửi email kèm PDF → bút toán ISSUED
//     có số, snapshot người mua, mốc gửi mail.
//   · Công tắc tắt / khoản thu cũ hơn mốc bật → not-eligible, không đụng MISA.
//   · meInvoice cấp số trễ → number-pending; lượt sau hỏi trạng thái → có số →
//     gửi mail.
//   · Khóa theo bút toán: đang bị lượt khác giữ → locked, không gọi MISA.
//   · Worker lưới an toàn nhặt đúng bút toán PENDING chưa xử lý.
// Cấu hình meInvoice công ty là SINGLETON — test lưu bản cũ và trả lại ở afterAll.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../invoice/misa-safety", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../invoice/misa-safety")>();
  return { ...mod, isPublishAllowed: () => true, assertPublishAllowed: () => undefined };
});

const misa = vi.hoisted(() => ({
  publish: vi.fn(),
  statuses: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../invoice/misa-einvoice", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../invoice/misa-einvoice")>();
  return {
    ...mod,
    publishStandardInvoice: misa.publish,
    getInvoiceStatuses: misa.statuses,
    downloadInvoiceFiles: misa.download,
  };
});

const mail = vi.hoisted(() => ({ sendInvoice: vi.fn() }));
vi.mock("../../services/customer-mails", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../services/customer-mails")>();
  return { ...mod, sendInvoiceIssuedMail: mail.sendInvoice };
});

import { prisma } from "../../lib/prisma";
import { recordPackagePayment } from "../../services/subscription-service";
import { processHqLedgerInvoice } from "../invoice/hq-auto-invoice";
import { runHqInvoiceAutoOnce } from "../../workers/hq-invoice-auto";

const STAMP = Date.now();
let userId = "";
let planId = "";
let savedConfig: Record<string, unknown> | null = null;
let configId = "";

async function setConfig(data: {
  autoIssueEnabled: boolean;
  autoIssueEnabledAt: Date | null;
  autoEmailEnabled?: boolean;
}) {
  await prisma.platformInvoiceConfig.update({
    where: { id: configId },
    data: {
      taxCode: "0111626360",
      companyName: "CÔNG TY TNHH HUBSELL TECHNOLOGY",
      companyAddress: "Hà Nội",
      invoicePattern: "1",
      invoiceSeries: "1C26THB",
      meinvoiceUsername: "test@hubsell.vn",
      meinvoicePassword: "plain-test-password",
      signMethod: "ESIGN_CLOUD",
      vatMode: "KCT",
      autoEmailEnabled: data.autoEmailEnabled ?? true,
      autoIssueEnabled: data.autoIssueEnabled,
      autoIssueEnabledAt: data.autoIssueEnabledAt,
    },
  });
}

/** Ghi nhận một khoản thanh toán chuyển khoản → trả về id bút toán THU sinh ra. */
async function payAndGetEntryId(occurredAt: Date): Promise<string> {
  const { payment } = await recordPackagePayment({
    userId,
    planId,
    cycle: "YEARLY",
    method: "BANK_TRANSFER",
    occurredAt,
    actorName: "Kế toán Test",
  });
  const entry = await prisma.platformLedgerEntry.findUniqueOrThrow({
    where: { packagePaymentId: payment.id },
    select: { id: true },
  });
  // Luồng tức thì (kick) chạy nền sau commit — chờ nó xong để test tự điều khiển.
  await new Promise((r) => setTimeout(r, 150));
  return entry.id;
}

beforeAll(async () => {
  const row =
    (await prisma.platformInvoiceConfig.findFirst()) ??
    (await prisma.platformInvoiceConfig.create({ data: {} }));
  configId = row.id;
  const { id: _id, updatedAt: _u, ...rest } = row;
  savedConfig = rest;

  const user = await prisma.user.create({
    data: {
      email: `test-hqinv-${STAMP}@hubsell.test`,
      passwordHash: "x",
      fullName: `TEST hqinv-${STAMP}`,
      role: "ADMIN",
      billingName: "CÔNG TY TNHH KHÁCH TEST",
      billingTaxCode: "0101243150",
      billingAddress: "12 Phố Test, Hà Nội",
      billingEmail: `ketoan-${STAMP}@khach.test`,
    },
  });
  userId = user.id;
  const plan = await prisma.servicePlan.create({
    data: {
      code: `THQ${STAMP}`,
      name: "Test Growth",
      priceMonthly: 299_000,
      priceYearly: 2_990_000,
      isActive: true,
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  await prisma.platformLedgerEntry.deleteMany({ where: { customerId: userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.servicePlan.deleteMany({ where: { id: planId } });
  if (savedConfig) {
    await prisma.platformInvoiceConfig.update({ where: { id: configId }, data: savedConfig });
  }
  await prisma.$disconnect();
});

beforeEach(() => {
  misa.publish.mockReset();
  misa.statuses.mockReset();
  misa.download.mockReset();
  mail.sendInvoice.mockReset();
  misa.download.mockResolvedValue([{ transactionId: "TX", data: "JVBERi0=", errorCode: null }]);
  mail.sendInvoice.mockResolvedValue(true);
});

describe("processHqLedgerInvoice — một khoản thu phí gói", () => {
  it("công tắc tắt → not-eligible, không gọi MISA, không đốt lượt thử", async () => {
    await setConfig({ autoIssueEnabled: false, autoIssueEnabledAt: null });
    const id = await payAndGetEntryId(new Date());
    const r = await processHqLedgerInvoice(id, { trigger: "worker" });
    expect(r.step).toBe("not-eligible");
    expect(misa.publish).not.toHaveBeenCalled();
    const e = await prisma.platformLedgerEntry.findUniqueOrThrow({ where: { id } });
    expect(e.invoiceStatus).toBe("PENDING");
    expect(e.einvoiceAutoAttempts).toBe(0);
  });

  it("khoản thu CŨ HƠN mốc bật → not-eligible (có thể đã lập tay trên meInvoice)", async () => {
    await setConfig({ autoIssueEnabled: true, autoIssueEnabledAt: new Date("2026-10-06T00:00:00Z") });
    const id = await payAndGetEntryId(new Date("2026-10-01T00:00:00Z"));
    const r = await processHqLedgerInvoice(id, { trigger: "worker" });
    expect(r.step).toBe("not-eligible");
    expect(misa.publish).not.toHaveBeenCalled();
  });

  it("đủ điều kiện → phát hành theo hồ sơ khách → gửi mail kèm PDF → ISSUED có số", async () => {
    await setConfig({ autoIssueEnabled: true, autoIssueEnabledAt: new Date("2026-10-06T00:00:00Z") });
    misa.publish.mockResolvedValue({ invoiceNo: "00000042", transactionId: "TX-42", raw: {} });
    const id = await payAndGetEntryId(new Date("2026-10-07T03:00:00Z"));

    // Kick nền có thể đã làm xong — gọi lại phải idempotent (không phát hành đôi).
    const r = await processHqLedgerInvoice(id, { trigger: "worker" });
    expect(["emailed", "nothing"]).toContain(r.step);
    expect(misa.publish).toHaveBeenCalledTimes(1);

    const input = misa.publish.mock.calls[0][0];
    expect(input.orderCode).toBe(`HQLEDGER-${id}`);
    expect(input.buyerName).toBe("CÔNG TY TNHH KHÁCH TEST");
    expect(input.buyerTaxCode).toBe("0101243150");
    expect(input.buyerAddress).toBe("12 Phố Test, Hà Nội");
    expect(input.totalAmount).toBe(2_990_000);
    expect(input.lines[0].name).toContain("gói Test Growth, 12 tháng");
    expect(input.lines[0].vatRate).toBe(-1); // KCT

    expect(mail.sendInvoice).toHaveBeenCalledTimes(1);
    const [to, mailInput, attachments] = mail.sendInvoice.mock.calls[0];
    expect(to).toBe(`ketoan-${STAMP}@khach.test`);
    expect(mailInput.invoiceNo).toBe("00000042");
    expect(mailInput.hasPdf).toBe(true);
    expect(attachments?.[0].filename).toBe("hoa-don-00000042.pdf");

    const e = await prisma.platformLedgerEntry.findUniqueOrThrow({ where: { id } });
    expect(e.invoiceStatus).toBe("ISSUED");
    expect(e.invoiceNo).toBe("00000042");
    expect(e.einvoiceTransactionId).toBe("TX-42");
    expect(e.invoiceBuyerName).toBe("CÔNG TY TNHH KHÁCH TEST");
    expect(e.invoiceBuyerTaxCode).toBe("0101243150");
    expect(e.invoiceEmailTo).toBe(`ketoan-${STAMP}@khach.test`);
    expect(e.invoiceEmailSentAt).not.toBeNull();
    expect(e.einvoiceAutoError).toBeNull();
    expect(e.einvoiceAutoLockedAt).toBeNull();

    // Gọi lại lần nữa: không còn gì để làm, không gửi mail đôi.
    const again = await processHqLedgerInvoice(id, { trigger: "worker" });
    expect(again.step).toBe("nothing");
    expect(mail.sendInvoice).toHaveBeenCalledTimes(1);
  });

  it("meInvoice cấp số trễ → number-pending; lượt sau hỏi trạng thái có số → gửi mail", async () => {
    await setConfig({ autoIssueEnabled: true, autoIssueEnabledAt: new Date("2026-10-06T00:00:00Z") });
    misa.publish.mockResolvedValue({ invoiceNo: null, transactionId: "TX-LATE", raw: {} });
    misa.statuses.mockResolvedValue([{ transactionId: "TX-LATE", invoiceNo: null, isDeleted: false }]);
    const id = await payAndGetEntryId(new Date("2026-10-07T04:00:00Z"));

    const r1 = await processHqLedgerInvoice(id, { trigger: "worker" });
    expect(r1.step).toBe("number-pending");
    expect(mail.sendInvoice).not.toHaveBeenCalled();
    let e = await prisma.platformLedgerEntry.findUniqueOrThrow({ where: { id } });
    expect(e.invoiceStatus).toBe("PENDING");
    expect(e.einvoiceTransactionId).toBe("TX-LATE");

    misa.statuses.mockResolvedValue([{ transactionId: "TX-LATE", invoiceNo: "00000043", isDeleted: false }]);
    const r2 = await processHqLedgerInvoice(id, { trigger: "worker" });
    expect(r2.step).toBe("emailed");
    expect(misa.publish).toHaveBeenCalledTimes(1); // không phát hành lại
    e = await prisma.platformLedgerEntry.findUniqueOrThrow({ where: { id } });
    expect(e.invoiceStatus).toBe("ISSUED");
    expect(e.invoiceNo).toBe("00000043");
    expect(e.invoiceEmailSentAt).not.toBeNull();
  });

  it("MISA từ chối → failed, lỗi ghi vào bút toán, khóa được nhả, lượt thử +1", async () => {
    await setConfig({ autoIssueEnabled: true, autoIssueEnabledAt: new Date("2026-10-06T00:00:00Z") });
    misa.publish.mockRejectedValue(new Error("meInvoice từ chối phát hành: ký hiệu không tồn tại"));
    const id = await payAndGetEntryId(new Date("2026-10-07T05:00:00Z"));
    const before = await prisma.platformLedgerEntry.findUniqueOrThrow({ where: { id } });

    // Lượt worker mới tính vào trần; lượt HQ bấm tay (manual) không đốt lượt.
    const r = await processHqLedgerInvoice(id, { trigger: "worker", ignoreEligibility: true });
    expect(r.step).toBe("failed");
    expect(r.error).toContain("ký hiệu không tồn tại");
    const e = await prisma.platformLedgerEntry.findUniqueOrThrow({ where: { id } });
    expect(e.invoiceStatus).toBe("PENDING");
    expect(e.einvoiceAutoError).toContain("ký hiệu không tồn tại");
    expect(e.einvoiceAutoAttempts).toBe(before.einvoiceAutoAttempts + 1);
    expect(e.einvoiceAutoLockedAt).toBeNull();
    expect(mail.sendInvoice).not.toHaveBeenCalled();

    // HQ bấm tay → không tăng lượt; meInvoice báo CallSignServiceFail → lời nhắn
    // "chờ phiên ký eSign", cũng không tăng lượt (máy cứ 30' thử lại).
    const r2 = await processHqLedgerInvoice(id, { trigger: "manual", ignoreEligibility: true });
    expect(r2.step).toBe("failed");
    misa.publish.mockRejectedValue(new Error("meInvoice từ chối phát hành hóa đơn (publishInvoiceResult): ErrorCode=CallSignServiceFail"));
    const r3 = await processHqLedgerInvoice(id, { trigger: "worker", ignoreEligibility: true });
    expect(r3.step).toBe("failed");
    expect(r3.error).toContain("Chờ phiên ký eSign");
    const e3 = await prisma.platformLedgerEntry.findUniqueOrThrow({ where: { id } });
    expect(e3.einvoiceAutoAttempts).toBe(e.einvoiceAutoAttempts);
    expect(e3.einvoiceAutoError).toContain("Ký phiên");
  });

  it("bút toán đang bị lượt khác khóa → locked, không gọi MISA", async () => {
    await setConfig({ autoIssueEnabled: true, autoIssueEnabledAt: new Date("2026-10-06T00:00:00Z") });
    misa.publish.mockRejectedValue(new Error("MISA tạm lỗi"));
    const id = await payAndGetEntryId(new Date("2026-10-07T06:00:00Z"));
    // Kick nền sau commit đã thử một lượt (và nhận lỗi) — xóa dấu vết đó rồi
    // mới dựng tình huống "lượt khác đang giữ khóa".
    misa.publish.mockClear();
    await prisma.platformLedgerEntry.update({
      where: { id },
      data: { einvoiceAutoLockedAt: new Date(), einvoiceTransactionId: null, invoiceStatus: "PENDING" },
    });
    const r = await processHqLedgerInvoice(id, { trigger: "worker" });
    expect(r.step).toBe("locked");
    expect(misa.publish).not.toHaveBeenCalled();
    await prisma.platformLedgerEntry.update({ where: { id }, data: { einvoiceAutoLockedAt: null } });
  });
});

describe("runHqInvoiceAutoOnce — lưới an toàn", () => {
  it("nhặt bút toán PENDING chưa xử lý và xuất xong", async () => {
    await setConfig({ autoIssueEnabled: true, autoIssueEnabledAt: new Date("2026-10-06T00:00:00Z") });
    // Khoản thu "lỡ": tạo khi công tắc tắt (kick bỏ qua) rồi bật lên — mô phỏng
    // web restart giữa chừng. Sau đó dọn sạch mọi bút toán khác của user để
    // worker chỉ còn đúng một ứng viên.
    await setConfig({ autoIssueEnabled: false, autoIssueEnabledAt: null });
    const id = await payAndGetEntryId(new Date("2026-10-07T07:00:00Z"));
    await prisma.platformLedgerEntry.deleteMany({ where: { customerId: userId, id: { not: id } } });
    await setConfig({ autoIssueEnabled: true, autoIssueEnabledAt: new Date("2026-10-06T00:00:00Z") });
    misa.publish.mockResolvedValue({ invoiceNo: "00000050", transactionId: "TX-50", raw: {} });

    const done = await runHqInvoiceAutoOnce(new Date());
    expect(done).toBeGreaterThanOrEqual(1);
    const e = await prisma.platformLedgerEntry.findUniqueOrThrow({ where: { id } });
    expect(e.invoiceStatus).toBe("ISSUED");
    expect(e.invoiceNo).toBe("00000050");
    expect(e.invoiceEmailSentAt).not.toBeNull();

    // Lượt sau: không còn ứng viên của khoản này (đã ISSUED + đã gửi mail).
    misa.publish.mockClear();
    mail.sendInvoice.mockClear();
    await runHqInvoiceAutoOnce(new Date());
    expect(misa.publish).not.toHaveBeenCalled();
    expect(mail.sendInvoice).not.toHaveBeenCalled();
  });
});
