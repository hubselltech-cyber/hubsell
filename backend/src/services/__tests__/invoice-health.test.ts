// ============================================================
// DẤU HIỆU "HÓA ĐƠN" TRÊN HQ SỨC KHỎE — bước 5, lát 14 (03/10/2026).
//   1. invoiceSignal: mức xanh / vàng / đỏ theo từng số đo (thuần, không database).
//   2. collectInvoiceHealth: đọc đúng năm số đo trên database dev. Database dev có dữ
//      liệu của shop khác nên phần này so CHÊNH LỆCH trước / sau khi dựng dữ liệu.
// ============================================================
import "../../integrations/__tests__/load-env";
import { InvoiceLogStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createStockFixture, type StockFixture } from "../../integrations/__tests__/fixtures";
import { prisma } from "../../lib/prisma";
import { collectInvoiceHealth, INVOICE_HEALTH, invoiceSignal, type InvoiceHealth } from "../invoice-health";

const clean: InvoiceHealth = {
  requestsDue: 0,
  requestsOldestMin: null,
  unknownPending: 0,
  unknownOldestMin: null,
  cqtOverdue: 0,
  cqtOverdueMaxMin: null,
  lanesStale: 0,
  lanesLate: 0,
  pausedShops: 0,
  pausedShops24h: 0,
};

describe("invoiceSignal", () => {
  it("mọi số bằng 0 → xanh", () => {
    const [value, level] = invoiceSignal(clean);
    expect(level).toBe("ok");
    expect(value).toContain("0 yêu cầu tới hạn chưa làm");
    expect(value).toContain("0 tờ quá hạn hỏi cơ quan thuế");
    expect(value).toContain("0 shop ngắt mạch");
  });

  it("không đọc được → vàng", () => {
    expect(invoiceSignal(null)[1]).toBe("warn");
  });

  it("yêu cầu tới hạn: dưới 5 phút xanh, từ 5 phút vàng, từ 30 phút đỏ", () => {
    const at = (min: number) => invoiceSignal({ ...clean, requestsDue: 2, requestsOldestMin: min });
    expect(at(INVOICE_HEALTH.requestWarnMin - 1)[1]).toBe("ok");
    expect(at(INVOICE_HEALTH.requestWarnMin)[1]).toBe("warn");
    expect(at(INVOICE_HEALTH.requestCritMin)[1]).toBe("crit");
    expect(at(40)[0]).toContain("2 yêu cầu tới hạn chưa làm, cũ nhất 40'");
    expect(at(40)[2]).toContain("Invoice-requests");
  });

  it("tờ chưa rõ kết quả: mới thì xanh (vòng tra lại đang lo), quá 30 phút vàng", () => {
    expect(invoiceSignal({ ...clean, unknownPending: 1, unknownOldestMin: 10 })[1]).toBe("ok");
    const old = invoiceSignal({ ...clean, unknownPending: 1, unknownOldestMin: INVOICE_HEALTH.unknownWarnMin });
    expect(old[1]).toBe("warn");
    expect(old[2]).toContain("Invoice-recheck");
  });

  it("tờ quá hạn hỏi cơ quan thuế: có là vàng, quá 12 giờ đỏ", () => {
    const warn = invoiceSignal({ ...clean, cqtOverdue: 3, cqtOverdueMaxMin: 90 });
    expect(warn[1]).toBe("warn");
    expect(warn[0]).toContain("3 tờ quá hạn hỏi cơ quan thuế (lâu nhất 90')");
    expect(warn[2]).toContain("CQT-follow");
    expect(invoiceSignal({ ...clean, cqtOverdue: 3, cqtOverdueMaxMin: INVOICE_HEALTH.cqtCritMin })[1]).toBe("crit");
  });

  it("làn bị bỏ dở hoặc trễ lịch → vàng", () => {
    expect(invoiceSignal({ ...clean, lanesStale: 1 })[1]).toBe("warn");
    expect(invoiceSignal({ ...clean, lanesLate: 2 })[1]).toBe("warn");
  });

  it("shop ngắt mạch: lẻ tẻ thì xanh (lỗi riêng shop), từ 3 shop trong 24 giờ vàng", () => {
    expect(invoiceSignal({ ...clean, pausedShops: 5, pausedShops24h: 2 })[1]).toBe("ok");
    expect(invoiceSignal({ ...clean, pausedShops: 5, pausedShops24h: INVOICE_HEALTH.pausedWarn24h })[1]).toBe("warn");
  });

  it("nhiều vấn đề cùng lúc → lấy mức nặng nhất và gợi ý của vấn đề đỏ", () => {
    const [, level, hint] = invoiceSignal({ ...clean, lanesStale: 1, requestsDue: 1, requestsOldestMin: 45 });
    expect(level).toBe("crit");
    expect(hint).toContain("Invoice-requests");
  });
});

describe("collectInvoiceHealth trên database dev", () => {
  let fx: StockFixture;
  const now = new Date();
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  beforeAll(async () => {
    fx = await createStockFixture("invhealth");
  });

  afterAll(async () => {
    await prisma.invoiceRequest.deleteMany({ where: { ownerId: fx.userId } });
    await prisma.invoiceLane.deleteMany({ where: { ownerId: fx.userId } });
    await fx.cleanup();
  });

  it("đếm đúng từng loại dòng vừa dựng, không đếm dòng chưa tới hạn", async () => {
    const before = await collectInvoiceHealth(now);

    await prisma.invoiceRequest.createMany({
      data: [
        { ownerId: fx.userId, kind: "ISSUE", source: "MANUAL", targetKey: `H-${fx.suffix}-1`, nextRetryAt: ago(100_000) },
        // chưa tới hạn
        { ownerId: fx.userId, kind: "ISSUE", source: "MANUAL", targetKey: `H-${fx.suffix}-2`, nextRetryAt: new Date(now.getTime() + 600_000) },
        // đã xong
        { ownerId: fx.userId, kind: "ISSUE", source: "MANUAL", targetKey: `H-${fx.suffix}-3`, status: "DONE", nextRetryAt: ago(50) },
      ],
    });
    let n = 0;
    const log = (over: object) => ({ ownerId: fx.userId, provider: "MISA", orderCode: `H-${fx.suffix}-${++n}`, ...over });
    await prisma.invoiceLog.createMany({
      data: [
        log({ status: InvoiceLogStatus.PENDING, createdAt: ago(200_000) }), // chưa rõ kết quả
        log({ status: InvoiceLogStatus.ISSUED, transactionId: `H-${fx.suffix}-A`, cqtNextCheckAt: ago(300_000) }), // quá hạn hỏi
        log({ status: InvoiceLogStatus.ISSUED, transactionId: `H-${fx.suffix}-B`, cqtNextCheckAt: ago(10) }), // tới hạn 10 phút: chưa tính
        log({ status: InvoiceLogStatus.ISSUED, transactionId: `H-${fx.suffix}-C`, cqtNextCheckAt: null }), // đã có kết luận
      ],
    });
    await prisma.invoiceConfig.create({
      data: {
        ownerId: fx.userId,
        provider: "MISA",
        invoicePattern: "1",
        invoiceSeries: "1C26TAA",
        autoIssueEnabled: true,
        autoIssuePausedAt: ago(60),
        autoIssuePauseReason: "test",
      },
    });
    await prisma.invoiceLane.create({
      data: { ownerId: fx.userId, leasedBy: "test:1:dead", leasedUntil: ago(30), nextRunAt: ago(30) },
    });

    const after = await collectInvoiceHealth(now);
    expect(after.requestsDue - before.requestsDue).toBe(1);
    expect(after.requestsOldestMin).toBe(100_000);
    expect(after.unknownPending - before.unknownPending).toBe(1);
    expect(after.unknownOldestMin).toBe(200_000);
    expect(after.cqtOverdue - before.cqtOverdue).toBe(1);
    expect(after.cqtOverdueMaxMin).toBe(300_000);
    expect(after.lanesStale - before.lanesStale).toBe(1);
    expect(after.lanesLate - before.lanesLate).toBe(0); // shop đang ngắt mạch: làn không tính là trễ lịch
    expect(after.pausedShops - before.pausedShops).toBe(1);
    expect(after.pausedShops24h - before.pausedShops24h).toBe(1);

    // Hết ngắt mạch + làn không còn ai giữ → thành "trễ lịch".
    await prisma.invoiceConfig.updateMany({ where: { ownerId: fx.userId }, data: { autoIssuePausedAt: null } });
    await prisma.invoiceLane.update({ where: { ownerId: fx.userId }, data: { leasedBy: null, leasedUntil: null } });
    const late = await collectInvoiceHealth(now);
    expect(late.lanesStale - before.lanesStale).toBe(0);
    expect(late.lanesLate - before.lanesLate).toBe(1);
    expect(late.pausedShops - before.pausedShops).toBe(0);
  });
});
