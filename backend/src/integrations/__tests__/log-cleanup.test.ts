// ============================================================
// CRON DỌN LOG KỸ THUẬT — TEST CHÍNH SÁCH XOAY VÒNG 7/30 NGÀY
//
// Cắm thẳng các dòng log với createdAt ép lùi quá khứ rồi chạy runOnce(),
// kiểm đúng ranh giới chính sách trên cả 4 bảng:
//
//   1. Webhook Shopee/MISA: SUCCESS quá 7 ngày XÓA, SUCCESS mới GIỮ;
//      FAILED 8 ngày GIỮ (chưa quá 30), FAILED/PENDING quá 30 ngày XÓA.
//   2. InventorySyncLog: cùng chính sách SUCCESS 7 / còn lại 30.
//   3. InventorySyncAlert: đã đóng quá 30 ngày XÓA; đã đóng gần đây GIỮ;
//      còn TREO thì GIỮ VĨNH VIỄN dù rất già (việc chưa xử lý không tự mất).
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebhookJobStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { runOnce } from "../../workers/log-cleanup";
import { createStockFixture, type StockFixture } from "./fixtures";

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

let fx: StockFixture;
const suffix = `logclean-${Date.now()}`;
/** id các dòng webhook test — bảng này không Cascade theo User, tự dọn tay. */
const shopeeIds: Record<string, string> = {};
const misaIds: Record<string, string> = {};

async function seedShopee(key: string, status: WebhookJobStatus, ageDays: number) {
  const row = await prisma.shopeeWebhookLog.create({
    data: {
      eventCode: 4,
      shopId: `TEST-${suffix}`,
      bodyHash: `TEST-${suffix}-shopee-${key}`,
      payload: "{}",
      status,
      createdAt: daysAgo(ageDays),
    },
  });
  shopeeIds[key] = row.id;
}

async function seedMisa(key: string, status: WebhookJobStatus, ageDays: number) {
  const row = await prisma.misaWebhookLog.create({
    data: {
      eventType: "InvoicePublished",
      bodyHash: `TEST-${suffix}-misa-${key}`,
      payload: "{}",
      status,
      createdAt: daysAgo(ageDays),
    },
  });
  misaIds[key] = row.id;
}

beforeAll(async () => {
  fx = await createStockFixture("logclean");

  await seedShopee("successOld", "SUCCESS", 8);
  await seedShopee("successFresh", "SUCCESS", 2);
  await seedShopee("failedMid", "FAILED", 8);
  await seedShopee("failedAncient", "FAILED", 31);
  await seedShopee("pendingAncient", "PENDING", 31);

  await seedMisa("successOld", "SUCCESS", 8);
  await seedMisa("pendingFresh", "PENDING", 2);
});

afterAll(async () => {
  await prisma.shopeeWebhookLog.deleteMany({
    where: { id: { in: Object.values(shopeeIds) } },
  });
  await prisma.misaWebhookLog.deleteMany({
    where: { id: { in: Object.values(misaIds) } },
  });
  await fx.cleanup(); // Channel Cascade kéo theo InventorySyncLog/Alert còn lại
});

describe("log-cleanup: chính sách xoay vòng 7/30 ngày", () => {
  it("dọn đúng ranh giới trên cả 4 bảng trong một lượt chạy", async () => {
    // InventorySyncLog + Alert cần channel thật (FK) — cắm qua fixture.
    const syncSuccessOld = await prisma.inventorySyncLog.create({
      data: {
        channelId: fx.channelId,
        channelSku: `TEST-${suffix}-S1`,
        oldQuantity: 10,
        newQuantity: 9,
        status: "SUCCESS",
        createdAt: daysAgo(8),
      },
    });
    const syncFailedMid = await prisma.inventorySyncLog.create({
      data: {
        channelId: fx.channelId,
        channelSku: `TEST-${suffix}-S2`,
        oldQuantity: 5,
        newQuantity: 4,
        status: "FAILED",
        createdAt: daysAgo(8),
      },
    });
    const alertClosedAncient = await prisma.inventorySyncAlert.create({
      data: {
        channelId: fx.channelId,
        message: "TEST đã đóng lâu",
        resolvedAt: daysAgo(31),
        createdAt: daysAgo(40),
      },
    });
    const alertClosedFresh = await prisma.inventorySyncAlert.create({
      data: {
        channelId: fx.channelId,
        message: "TEST mới đóng",
        resolvedAt: daysAgo(2),
        createdAt: daysAgo(40),
      },
    });
    const alertStillOpen = await prisma.inventorySyncAlert.create({
      data: {
        channelId: fx.channelId,
        message: "TEST còn treo",
        createdAt: daysAgo(100),
      },
    });

    await runOnce();

    // --- Webhook Shopee ---
    const shopeeLeft = await prisma.shopeeWebhookLog.findMany({
      where: { id: { in: Object.values(shopeeIds) } },
      select: { id: true },
    });
    const shopeeLeftIds = new Set(shopeeLeft.map((r) => r.id));
    expect(shopeeLeftIds.has(shopeeIds.successOld)).toBe(false); // SUCCESS 8 ngày → xóa
    expect(shopeeLeftIds.has(shopeeIds.successFresh)).toBe(true); // SUCCESS 2 ngày → giữ
    expect(shopeeLeftIds.has(shopeeIds.failedMid)).toBe(true); // FAILED 8 ngày → giữ
    expect(shopeeLeftIds.has(shopeeIds.failedAncient)).toBe(false); // FAILED 31 ngày → xóa
    expect(shopeeLeftIds.has(shopeeIds.pendingAncient)).toBe(false); // job chết → xóa

    // --- Webhook MISA ---
    expect(
      await prisma.misaWebhookLog.findUnique({ where: { id: misaIds.successOld } })
    ).toBeNull();
    expect(
      await prisma.misaWebhookLog.findUnique({ where: { id: misaIds.pendingFresh } })
    ).not.toBeNull();

    // --- InventorySyncLog ---
    expect(
      await prisma.inventorySyncLog.findUnique({ where: { id: syncSuccessOld.id } })
    ).toBeNull();
    expect(
      await prisma.inventorySyncLog.findUnique({ where: { id: syncFailedMid.id } })
    ).not.toBeNull();

    // --- InventorySyncAlert ---
    expect(
      await prisma.inventorySyncAlert.findUnique({ where: { id: alertClosedAncient.id } })
    ).toBeNull();
    expect(
      await prisma.inventorySyncAlert.findUnique({ where: { id: alertClosedFresh.id } })
    ).not.toBeNull();
    expect(
      await prisma.inventorySyncAlert.findUnique({ where: { id: alertStillOpen.id } })
    ).not.toBeNull();
  });
});
