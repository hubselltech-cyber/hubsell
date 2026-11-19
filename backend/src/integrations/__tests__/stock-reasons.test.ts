// ============================================================
// LÝ DO NHẬP / XUẤT THEO DANH SÁCH + BÁO CÁO "HÀNG HỎNG, MẤT & CHÊNH KIỂM KÊ" — kho chuẩn quốc tế LÁT 4
// (20/11/2026, docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 5.4 + 16).
//
// Chạy app Express thật trên cổng ngẫu nhiên + DB dev. Điều phải giữ:
//   · không gửi mã lý do → mọi thứ y như trước (app cũ / mobile chưa cập nhật vẫn nhập xuất được);
//   · mã lý do ghi vào InventoryLog.kind, câu Lý do có tên lý do đứng trước ghi chú;
//   · mã sai chiều (vd "Hỏng" trên phiếu NHẬP) bị từ chối, KHÔNG ghi gì;
//   · báo cáo chỉ cộng dòng TAY của đúng shop, tách giảm / tăng, không tính dòng của đơn,
//     không tính Bán ngoài sàn / Nhập hàng; giá trị chỉ trả cho người thấy tài chính.
// ============================================================
import "./load-env";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { createApp } from "../../app";
import { signToken } from "../../middleware/auth";
import { deductStockTx } from "../order-stock";
import { createStockFixture, type StockFixture } from "./fixtures";

let shop: StockFixture;
let other: StockFixture;
let server: Server;
let baseUrl = "";

type Json = Record<string, any>;
async function call(fx: StockFixture, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${signToken(fx.userId)}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Json };
}
const lastLog = (productId: string) =>
  prisma.inventoryLog.findFirstOrThrow({ where: { productId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
const group = (body: Json, key: string) => (body.groups as Json[]).find((g) => g.key === key)!;

beforeAll(async () => {
  shop = await createStockFixture("rs-main");
  other = await createStockFixture("rs-other");
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const fx of [shop, other]) await fx.cleanup();
});

describe("Lý do theo danh sách (POST /api/inventory/adjust, /adjust-bulk)", () => {
  it("không gửi mã lý do: ghi như trước — kind NULL, câu lý do mặc định hoặc đúng ghi chú đã gõ", async () => {
    const p = await shop.createProduct(10);
    const a = await call(shop, "POST", "/api/inventory/adjust", { productId: p, type: "EXPORT", quantity: 2 });
    expect(a.status).toBe(200);
    expect(await lastLog(p)).toMatchObject({ kind: null, reason: "Xuất kho thủ công", changeQuantity: -2 });
    const b = await call(shop, "POST", "/api/inventory/adjust", { productId: p, type: "IMPORT", quantity: 1, reason: "  bù hàng  " });
    expect(b.status).toBe(200);
    expect(await lastLog(p)).toMatchObject({ kind: null, reason: "bù hàng", changeQuantity: 1 });
  });

  it("có mã lý do: kind = mã; câu lý do = tên lý do, có ghi chú thì nối sau", async () => {
    const p = await shop.createProduct(10);
    const a = await call(shop, "POST", "/api/inventory/adjust", { productId: p, type: "EXPORT", quantity: 3, reasonCode: "DAMAGED" });
    expect(a.status).toBe(200);
    expect(await lastLog(p)).toMatchObject({ kind: "DAMAGED", reason: "Hỏng", changeQuantity: -3 });
    const b = await call(shop, "POST", "/api/inventory/adjust", {
      productId: p,
      type: "EXPORT",
      quantity: 1,
      reasonCode: "LOST",
      reason: "rơi lúc chuyển kệ",
    });
    expect(b.status).toBe(200);
    expect(await lastLog(p)).toMatchObject({ kind: "LOST", reason: "Mất / thất lạc — rơi lúc chuyển kệ" });
  });

  it("app mobile bản cũ gửi nguyên câu chip, không có mã: máy chủ suy ra mã, giữ nguyên câu; câu tự gõ thì không suy", async () => {
    const p = await shop.createProduct(10);
    const a = await call(shop, "POST", "/api/inventory/adjust", { productId: p, type: "EXPORT", quantity: 1, reason: "Hàng hỏng" });
    expect(a.status).toBe(200);
    expect(await lastLog(p)).toMatchObject({ kind: "DAMAGED", reason: "Hàng hỏng" });
    const b = await call(shop, "POST", "/api/inventory/adjust-bulk", {
      type: "IMPORT",
      items: [{ productId: p, quantity: 2 }],
      reason: "Khách trả tại shop",
    });
    expect(b.status).toBe(200);
    expect(await lastLog(p)).toMatchObject({ kind: "RETURN_RESTOCK", reason: "Khách trả tại shop" });
    // Chip của chiều XUẤT gõ trên phiếu NHẬP, hoặc câu tự gõ gần giống → không suy.
    const c = await call(shop, "POST", "/api/inventory/adjust", { productId: p, type: "IMPORT", quantity: 1, reason: "Hàng hỏng" });
    expect(c.status).toBe(200);
    expect(await lastLog(p)).toMatchObject({ kind: null, reason: "Hàng hỏng" });
    const d = await call(shop, "POST", "/api/inventory/adjust", { productId: p, type: "EXPORT", quantity: 1, reason: "hàng hỏng do ẩm" });
    expect(d.status).toBe(200);
    expect(await lastLog(p)).toMatchObject({ kind: null, reason: "hàng hỏng do ẩm" });
  });

  it("mã không thuộc danh sách của chiều đó bị từ chối và KHÔNG ghi gì", async () => {
    const p = await shop.createProduct(10);
    const before = await prisma.inventoryLog.count({ where: { productId: p } });
    const a = await call(shop, "POST", "/api/inventory/adjust", { productId: p, type: "IMPORT", quantity: 1, reasonCode: "DAMAGED" });
    expect(a.status).toBe(400);
    const b = await call(shop, "POST", "/api/inventory/adjust", { productId: p, type: "EXPORT", quantity: 1, reasonCode: "KHONG-CO" });
    expect(b.status).toBe(400);
    const c = await call(shop, "POST", "/api/inventory/adjust-bulk", {
      type: "IMPORT",
      items: [{ productId: p, quantity: 1 }],
      reasonCode: "LOST",
    });
    expect(c.status).toBe(400);
    expect(await prisma.inventoryLog.count({ where: { productId: p } })).toBe(before);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p } })).quantityInStock).toBe(10);
  });

  it("phiếu nhiều mã: một lý do cho cả phiếu — mọi dòng cùng kind, phiếu kho ghi cùng câu lý do", async () => {
    const p1 = await shop.createProduct(10);
    const p2 = await shop.createProduct(10);
    const r = await call(shop, "POST", "/api/inventory/adjust-bulk", {
      type: "EXPORT",
      items: [
        { productId: p1, quantity: 2 },
        { productId: p2, quantity: 4 },
      ],
      reasonCode: "GIFT",
      reason: "tặng khách sỉ",
    });
    expect(r.status).toBe(200);
    for (const p of [p1, p2]) {
      expect(await lastLog(p)).toMatchObject({ kind: "GIFT", reason: "Tặng / dùng nội bộ — tặng khách sỉ" });
    }
    const voucher = await prisma.stockVoucher.findUniqueOrThrow({ where: { id: r.body.voucher.id } });
    expect(voucher.reason).toBe("Tặng / dùng nội bộ — tặng khách sỉ");
  });
});

describe("Báo cáo Hàng hỏng, mất & chênh kiểm kê (GET /api/inventory/loss-report)", () => {
  it("cộng theo lý do, tách giảm / tăng; không tính dòng của đơn, Bán ngoài sàn, Nhập hàng, shop khác", async () => {
    const fx = await createStockFixture("rs-report");
    try {
      const a = await fx.createProduct(100);
      const b = await fx.createProduct(100);
      await prisma.product.update({ where: { id: a }, data: { costPrice: 10_000 } });
      await prisma.product.update({ where: { id: b }, data: { costPrice: 5_000 } });
      const adj = (productId: string, type: string, quantity: number, reasonCode?: string) =>
        call(fx, "POST", "/api/inventory/adjust", { productId, type, quantity, reasonCode });
      await adj(a, "EXPORT", 5, "DAMAGED");
      await adj(b, "EXPORT", 2, "DAMAGED");
      await adj(a, "EXPORT", 1, "LOST");
      await adj(a, "EXPORT", 7, "OFFLINE_SALE"); // không vào báo cáo
      await adj(a, "IMPORT", 50, "RECEIVED"); // không vào báo cáo
      await adj(a, "IMPORT", 3, "CORRECTION");
      await adj(b, "EXPORT", 4, "CORRECTION");
      await adj(b, "EXPORT", 6); // không ghi lý do
      // Kiểm kê: a thiếu 2, b thừa 1 (shop cách cũ: số đếm đè sổ).
      const nowA = (await prisma.product.findUniqueOrThrow({ where: { id: a } })).quantityInStock;
      const nowB = (await prisma.product.findUniqueOrThrow({ where: { id: b } })).quantityInStock;
      const st = await call(fx, "POST", "/api/inventory/stocktake", {
        items: [
          { productId: a, counted: nowA - 2 },
          { productId: b, counted: nowB + 1 },
        ],
      });
      expect(st.status).toBe(200);
      // Sửa ô tồn: a giảm 1.
      const set = await call(fx, "POST", "/api/inventory/set", { productId: a, quantity: nowA - 3 });
      expect(set.status).toBe(200);
      // Đơn sàn trừ kho — KHÔNG phải dòng tay.
      const o = await fx.createOrder(a, 9);
      await prisma.$transaction((tx) => deductStockTx(tx, o, "test báo cáo"));
      // Shop khác có hàng hỏng — không được lẫn sang.
      const x = await other.createProduct(10);
      await call(other, "POST", "/api/inventory/adjust", { productId: x, type: "EXPORT", quantity: 9, reasonCode: "DAMAGED" });

      const r = await call(fx, "GET", "/api/inventory/loss-report");
      expect(r.status).toBe(200);
      expect(r.body.costPriceHidden).toBe(false);
      expect(group(r.body, "DAMAGED")).toMatchObject({ down: 7, up: 0, skus: 2, lines: 2, downValue: 5 * 10_000 + 2 * 5_000 });
      expect(group(r.body, "LOST")).toMatchObject({ down: 1, up: 0, downValue: 10_000 });
      expect(group(r.body, "GIFT")).toMatchObject({ down: 0, up: 0, lines: 0 });
      expect(group(r.body, "CORRECTION")).toMatchObject({ down: 4, up: 3, downValue: 20_000, upValue: 30_000 });
      expect(group(r.body, "STOCKTAKE")).toMatchObject({ down: 2, up: 1, skus: 2 });
      expect(group(r.body, "SET")).toMatchObject({ down: 1, up: 0 });
      expect(group(r.body, "EXPORT_NO_REASON")).toMatchObject({ down: 6, up: 0 });
      expect(group(r.body, "ADJUST_OLD")).toMatchObject({ down: 0, up: 0 });
      expect(r.body.total).toMatchObject({ down: 7 + 1 + 4 + 2 + 1 + 6, up: 3 + 1 });
      // Mã giảm ròng nhiều nhất: b = 2 + 4 + 6 − 1 = 11; a = 5 + 1 + 2 + 1 − 3 = 6.
      expect((r.body.top as Json[]).map((t) => [t.productId, t.down - t.up])).toEqual([
        [b, 11],
        [a, 6],
      ]);
      expect(r.body.top[0].netValue).toBe(11 * 5_000);

      // Kỳ đã qua (kết thúc trước mọi dòng trên) → không có gì.
      const past = await call(
        fx,
        "GET",
        `/api/inventory/loss-report?from=${encodeURIComponent("2020-01-01T00:00:00Z")}&to=${encodeURIComponent("2020-02-01T00:00:00Z")}`
      );
      expect(past.status).toBe(200);
      expect(past.body.total).toMatchObject({ down: 0, up: 0 });
      expect(past.body.top).toEqual([]);
    } finally {
      await fx.cleanup();
    }
  });

  it("khoảng ngày sai hoặc dài quá 366 ngày bị từ chối", async () => {
    const bad = await call(shop, "GET", "/api/inventory/loss-report?from=abc");
    expect(bad.status).toBe(400);
    const long = await call(
      shop,
      "GET",
      `/api/inventory/loss-report?from=${encodeURIComponent("2024-01-01T00:00:00Z")}&to=${encodeURIComponent("2026-01-01T00:00:00Z")}`
    );
    expect(long.status).toBe(400);
    const reversed = await call(
      shop,
      "GET",
      `/api/inventory/loss-report?from=${encodeURIComponent("2026-02-01T00:00:00Z")}&to=${encodeURIComponent("2026-01-01T00:00:00Z")}`
    );
    expect(reversed.status).toBe(400);
  });
});
