// ============================================================
// Trang Giá vốn: rào bộ nhớ chỉ áp cho gian LỚN (25/11/2026, docs/DONG-BO-GIAI-DOAN-3.md mục 8).
// Sự cố: RSS web kẹt ~470 MB sau đỉnh của trang Quảng cáo → rào "RSS > 400 MB" chặn 51/51 lượt, kể cả gian 31 dòng,
// khách mới kéo sản phẩm về mà không có ô để nhập giá vốn. Gian nhỏ phải luôn mở được dù RSS đang "vượt trần".
// Chạy trên DB dev với gian tự dựng, gọi qua app thật.
// ============================================================

import "./load-env";
import type { Server } from "http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { signToken } from "../../middleware/auth";
import { createStockFixture, type StockFixture } from "./fixtures";

describe("GET /api/finance/sku-products — rào bộ nhớ chỉ cho gian lớn", () => {
  let fx: StockFixture;
  let server: Server;
  let base = "";
  let token = "";

  beforeAll(async () => {
    fx = await createStockFixture("skuguard");
    for (let i = 1; i <= 3; i++) {
      await prisma.channelProduct.create({
        data: { channelId: fx.channelId, channelSku: `GUARD-${fx.suffix}-${i}`, productName: `SP ${i}` },
      });
    }
    token = signToken(fx.userId);
    // Nạp app SAU khi đặt trần RSS 1 MB: bản cũ đọc trần một lần lúc dựng router — test phải tái hiện được lỗi cũ.
    process.env.HEAVY_ROUTE_RSS_MB = "1";
    const { createApp } = await import("../../app");
    await new Promise<void>((resolve) => {
      server = createApp().listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterEach(() => {
    delete process.env.HEAVY_ROUTE_RSS_MB;
    delete process.env.SKU_PRODUCTS_MAX_ROWS;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fx.cleanup();
  });

  const get = () =>
    fetch(`${base}/api/finance/sku-products?channel=all&paged=1`, { headers: { Authorization: `Bearer ${token}` } });

  it("gian nhỏ: RSS đang vượt trần vẫn trả đủ danh sách (không 503)", async () => {
    process.env.HEAVY_ROUTE_RSS_MB = "1"; // tiến trình test chắc chắn > 1 MB — đúng cảnh RSS kẹt trên prod
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { sku: string }[]; truncated: boolean };
    expect(body.truncated).toBe(false);
    expect(body.items.filter((r) => r.sku.startsWith(`GUARD-${fx.suffix}-`))).toHaveLength(3);
  });

  it("gian lớn (vượt trần dòng): RSS vượt trần thì vẫn bị rào 503 SERVER_BUSY như cũ", async () => {
    process.env.HEAVY_ROUTE_RSS_MB = "1";
    process.env.SKU_PRODUCTS_MAX_ROWS = "2"; // 3 dòng > 2 → coi là gian lớn
    const res = await get();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("SERVER_BUSY");
  });

  it("gian lớn khi máy còn chỗ: cho qua, chia trang ở DB", async () => {
    process.env.HEAVY_ROUTE_RSS_MB = "100000";
    process.env.SKU_PRODUCTS_MAX_ROWS = "2";
    const res = await get();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { truncated: boolean }).truncated).toBe(true);
  });
});
