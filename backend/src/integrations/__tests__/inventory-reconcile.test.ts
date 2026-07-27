// ============================================================
// DOUBLE-CHECK (RECONCILIATION) — update_stock trả 200 nhưng sàn ghi trễ
//
// Kiểm 4 mắt xích của cơ chế đối soát:
//   1. Đẩy tồn thành công → sinh job VERIFYING hẹn giờ +3 phút; đẩy lại lần
//      nữa cho cùng SKU thì GỘP về một job (upsert theo bodyHash ổn định).
//   2. Đến giờ, tồn sàn KHỚP Hubsell → job SUCCESS.
//   3. Tồn sàn LỆCH → đẩy lại update_stock ngay + hẹn giờ kiểm tra tiếp.
//   4. Hết 3 lượt vẫn lệch → FAILED + bắn InventorySyncAlert lên UI.
//
// Tầng gọi Shopee (client + lấy token) được MOCK — test không chạm API thật;
// hàng đợi, worker, DB là đồ thật.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookJobStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { createStockFixture, type StockFixture } from "./fixtures";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return {
    ...mod,
    updateShopeeStock: vi.fn().mockResolvedValue(undefined),
    getItemBaseInfo: vi.fn().mockResolvedValue([]),
    getModelList: vi.fn().mockResolvedValue([]),
  };
});
vi.mock("../shopee/service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/service")>();
  return {
    ...mod,
    getValidShopeeAccessToken: vi
      .fn()
      .mockResolvedValue({ accessToken: "test-token", shopId: "999" }),
  };
});

import { getItemBaseInfo, updateShopeeStock } from "../shopee/client";
import {
  STOCK_VERIFY_EVENT_CODE,
  syncShopeeStockForProducts,
} from "../shopee/inventory-sync";
import { drainShopeeWebhookQueueOnce } from "../shopee/webhook-queue";

const ITEM_ID = 555001;

let fx: StockFixture;
let productId: string;
let channelSku: string;
let bodyHash: string;

/** Đọc job đối soát của SKU test. */
const verifyJob = () =>
  prisma.shopeeWebhookLog.findUniqueOrThrow({ where: { bodyHash } });

/** Đưa job về trạng thái "đến giờ kiểm tra" với số lượt đã dùng cho trước. */
async function makeDue(attempts = 0): Promise<void> {
  await prisma.shopeeWebhookLog.update({
    where: { bodyHash },
    data: {
      status: WebhookJobStatus.VERIFYING,
      attempts,
      nextRetryAt: new Date(Date.now() - 1000),
    },
  });
}

/** Cho sàn "trả lời" số tồn cho trước ở lần đọc kế tiếp. */
function marketplaceStockIs(stock: number): void {
  vi.mocked(getItemBaseInfo).mockResolvedValue([
    { item_id: ITEM_ID, stock_info_v2: { seller_stock: [{ stock }] } },
  ]);
}

beforeAll(async () => {
  fx = await createStockFixture("verify");
  productId = await fx.createProduct(5); // tồn khả dụng kỳ vọng = 5
  channelSku = await fx.createMapping(productId, String(ITEM_ID));
  bodyHash = `stock-verify:${fx.channelId}:${channelSku}`;
});

afterAll(async () => {
  await prisma.shopeeWebhookLog.deleteMany({
    where: { bodyHash: { startsWith: `stock-verify:${fx.channelId}:` } },
  });
  await fx.cleanup();
});

beforeEach(() => {
  vi.mocked(updateShopeeStock).mockClear();
});

describe("Double-Check tồn kho sau update_stock (sàn ghi trễ)", () => {
  it("đẩy tồn thành công → sinh job VERIFYING hẹn giờ; đẩy lại → gộp về MỘT job", async () => {
    await syncShopeeStockForProducts(
      { orderSn: "TEST-VERIFY-SN", productIds: [productId], oldAvailable: {} },
      "test double-check"
    );

    const job = await verifyJob();
    expect(job.eventCode).toBe(STOCK_VERIFY_EVENT_CODE);
    expect(job.status).toBe(WebhookJobStatus.VERIFYING);
    // Hẹn giờ ~3 phút — chưa đến giờ thì worker không được đụng vào.
    expect(job.nextRetryAt!.getTime()).toBeGreaterThan(Date.now() + 2 * 60 * 1000);

    // Đẩy lần 2 cho cùng SKU: upsert đè, vẫn đúng MỘT job đối soát.
    await syncShopeeStockForProducts(
      { orderSn: "TEST-VERIFY-SN-2", productIds: [productId], oldAvailable: {} },
      "test double-check"
    );
    const rows = await prisma.shopeeWebhookLog.findMany({
      where: { bodyHash: { startsWith: `stock-verify:${fx.channelId}:` } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].orderSn).toBe("TEST-VERIFY-SN-2"); // mang thông tin lượt MỚI nhất
  });

  it("đến giờ kiểm tra, tồn sàn KHỚP → job chuyển SUCCESS, không đẩy lại gì", async () => {
    await makeDue();
    marketplaceStockIs(5); // sàn đã ghi đúng 5 = tồn khả dụng Hubsell

    await drainShopeeWebhookQueueOnce();

    const job = await verifyJob();
    expect(job.status).toBe(WebhookJobStatus.SUCCESS);
    expect(job.processedAt).not.toBeNull();
    expect(vi.mocked(updateShopeeStock)).not.toHaveBeenCalled();
  });

  it("tồn sàn LỆCH (ghi trễ) → đẩy lại update_stock ngay và hẹn giờ kiểm tra tiếp", async () => {
    await makeDue();
    marketplaceStockIs(3); // sàn còn 3 ≠ Hubsell 5

    await drainShopeeWebhookQueueOnce();

    // Đã đẩy lại số ĐÚNG lên sàn ngay trong lượt đối soát.
    expect(vi.mocked(updateShopeeStock)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateShopeeStock)).toHaveBeenCalledWith(
      "test-token",
      "999",
      ITEM_ID,
      5,
      undefined
    );

    const job = await verifyJob();
    expect(job.status).toBe(WebhookJobStatus.VERIFYING); // chưa tin — hẹn kiểm tiếp
    expect(job.attempts).toBe(1);
    expect(job.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
    expect(job.lastError).toContain("sàn còn 3");
  });

  it("hết 3 lượt vẫn lệch → job FAILED + bắn InventorySyncAlert lên UI", async () => {
    await makeDue(2); // đã dùng 2 lượt — lượt này là lượt thứ 3 (cuối)
    marketplaceStockIs(3);

    await drainShopeeWebhookQueueOnce();

    const job = await verifyJob();
    expect(job.status).toBe(WebhookJobStatus.FAILED);

    const alert = await prisma.inventorySyncAlert.findFirst({
      where: { channelId: fx.channelId, channelSku, resolvedAt: null },
    });
    expect(alert).not.toBeNull();
    expect(alert!.message).toContain("Đối soát tồn kho");
  });
});
