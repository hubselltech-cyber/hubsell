/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { accessOf, bellTabFor, hasPermission, homePathFor } from "./permissions";
import { resolveNotificationTarget, targetAllowed } from "./notification-target";
import type { AuthUser } from "../types/api";

/**
 * Chạy (không cần RN): từ backend/
 *   npx tsx --test ../hubsell-mobile/src/lib/permissions.test.ts
 *
 * Bảng chéo "quyền đã tick × thứ thấy trên app" (23/11/2026, anh Trung: "nhân viên
 * anh cấp full quyền nhưng vào thì lại không đủ"). Danh sách lá chép từ
 * backend/src/config/permission-registry.ts — thêm lá mới ở đó thì thêm vào FULL.
 */
const FULL = [
  "dashboard",
  "orders",
  "warehouse.products",
  "warehouse.returns",
  "warehouse.shipping-alerts",
  "finance.analytics",
  "finance.realized-pnl",
  "finance.fee-audit",
  "finance.expenses",
  "finance.cost-prices",
  "ads.shopee",
  "ads.lazada",
  "ads.tiktok",
  "operations.chat",
  "operations.reviews",
  "operations.loss-orders",
  "operations.ai-rules",
  "operations.copy-listing",
  "koc",
  "invoicing",
];

const staff = (permissions: string[]) => ({ role: "SALES", permissions }) as unknown as AuthUser;
const owner = { role: "ADMIN", permissions: [] } as unknown as AuthUser;

/** Các tab dưới người này thấy, theo đúng luật lọc ở (admin)/_layout.tsx. */
function tabsOf(user: AuthUser): string {
  const a = accessOf(user);
  return [
    a.home ? "Trang chủ" : null,
    a.orders ? "Đơn hàng" : null,
    a.orders ? "QR" : null,
    a.warehouse ? "Kho" : null,
    "Cấu hình",
  ]
    .filter(Boolean)
    .join(" · ");
}

test("nhân viên đủ quyền thấy đúng thanh tab của chủ shop", () => {
  assert.equal(tabsOf(staff(FULL)), "Trang chủ · Đơn hàng · QR · Kho · Cấu hình");
  assert.equal(tabsOf(staff(FULL)), tabsOf(owner));
  assert.equal(homePathFor(staff(FULL)), "/(admin)/home");
});

test("nhân viên đủ quyền: mọi cờ như chủ shop, trừ việc riêng của chủ", () => {
  const s = accessOf(staff(FULL));
  const o = accessOf(owner);
  assert.equal(o.owner, true);
  assert.equal(s.owner, false);
  assert.deepEqual({ ...s, owner: true }, o);
});

test("chủ shop không cần lá quyền nào", () => {
  const o = accessOf(owner);
  for (const [k, v] of Object.entries(o)) assert.equal(v, true, k);
});

test("ba mẫu quyền có sẵn trên web", () => {
  // Nhân viên vận hành: Tổng quan + Đơn hàng + kho, không tài chính.
  const sales = staff([
    "dashboard",
    "orders",
    "warehouse.products",
    "warehouse.returns",
    "operations.chat",
    "operations.reviews",
    "operations.ai-rules",
  ]);
  assert.equal(tabsOf(sales), "Trang chủ · Đơn hàng · QR · Kho · Cấu hình");
  const sa = accessOf(sales);
  assert.deepEqual([sa.overview, sa.finance, sa.ads], [true, false, false]);
  assert.deepEqual([sa.costPrices, sa.expenses], [false, false]);

  // Nhân viên kho: không có Trang chủ → vào thẳng Đơn hàng.
  const kho = staff(["orders", "warehouse.products", "warehouse.returns", "warehouse.shipping-alerts"]);
  assert.equal(tabsOf(kho), "Đơn hàng · QR · Kho · Cấu hình");
  assert.equal(homePathFor(kho), "/(admin)/orders");

  // Kế toán: Trang chủ (Tổng quan + Tài chính), không Đơn hàng, không Kho.
  const acc = staff([
    "dashboard",
    "finance.analytics",
    "finance.realized-pnl",
    "finance.fee-audit",
    "finance.expenses",
    "finance.cost-prices",
    "invoicing",
  ]);
  assert.equal(tabsOf(acc), "Trang chủ · Cấu hình");
  const aa = accessOf(acc);
  assert.deepEqual([aa.overview, aa.finance, aa.ads], [true, true, false]);
  assert.deepEqual([aa.costPrices, aa.expenses], [true, true]);
});

test("từng quyền lẻ mở đúng một chỗ", () => {
  // Chỉ Đối soát đơn hoàn: Kho (tab con Đơn hoàn), không nút QR.
  const ret = staff(["warehouse.returns"]);
  assert.equal(tabsOf(ret), "Kho · Cấu hình");
  assert.deepEqual([accessOf(ret).stock, accessOf(ret).returns], [false, true]);
  assert.equal(homePathFor(ret), "/(admin)/warehouse");

  // Chỉ Tổng kho: Kho (tab con Tồn kho).
  const prod = staff(["warehouse.products"]);
  assert.equal(tabsOf(prod), "Kho · Cấu hình");
  assert.deepEqual([accessOf(prod).stock, accessOf(prod).returns], [true, false]);

  // Chỉ Đơn hàng: có luôn Tồn kho (API kho mở cho quyền Đơn hàng), không Đơn hoàn.
  const ord = staff(["orders"]);
  assert.equal(tabsOf(ord), "Đơn hàng · QR · Kho · Cấu hình");
  assert.deepEqual([accessOf(ord).stock, accessOf(ord).returns], [true, false]);

  // Chỉ một sàn quảng cáo: Trang chủ chỉ có trang Quảng cáo, chip đúng sàn đó.
  const tt = accessOf(staff(["ads.tiktok"]));
  assert.deepEqual([tt.home, tt.overview, tt.finance, tt.ads], [true, false, false, true]);
  assert.deepEqual([tt.adsShopee, tt.adsLazada, tt.adsTiktok], [false, false, true]);

  // Tài chính nhưng KHÔNG phải Báo cáo dòng tiền: trang Tài chính của app đọc đúng API đó.
  const pnl = accessOf(staff(["finance.realized-pnl", "finance.fee-audit"]));
  assert.deepEqual([pnl.finance, pnl.home], [false, false]);
});

test("chỉ có quyền của mục app chưa có → màn chưa có quyền", () => {
  for (const perms of [[], ["koc"], ["invoicing"], ["operations.reviews"], ["finance.fee-audit"], ["warehouse.shipping-alerts"]]) {
    assert.equal(homePathFor(staff(perms)), "/no-access", perms.join(","));
  }
  // Giá vốn / Chi phí vận hành là màn con mở từ Tổng quan — không tự thành tab.
  assert.equal(homePathFor(staff(["finance.cost-prices", "finance.expenses"])), "/no-access");
});

test("hasPermission: lá khớp đúng lá, nhóm khớp mọi lá con, không khớp tiền tố lửng", () => {
  assert.equal(hasPermission(["finance.analytics"], "finance"), true);
  assert.equal(hasPermission(["finance.analytics"], "finance.analytics"), true);
  assert.equal(hasPermission(["finance.analytics"], "finance.expenses"), false);
  assert.equal(hasPermission(["orders"], "order"), false);
  assert.equal(hasPermission(["adsx.shopee"], "ads"), false);
});

test("chuông: ai có, nằm ở tab nào (23/11/2026)", () => {
  // Chủ shop: Trang chủ như cũ
  assert.equal(bellTabFor(owner), "home");
  assert.equal(bellTabFor(staff(FULL)), "home");
  // Mẫu Nhân viên kho: không Trang chủ → chuông ở Đơn hàng
  assert.equal(bellTabFor(staff(["orders", "warehouse.products", "warehouse.returns"])), "orders");
  // Chỉ quyền kho → chuông ở Kho
  assert.equal(bellTabFor(staff(["warehouse.returns"])), "warehouse");
  assert.equal(bellTabFor(staff(["warehouse.products"])), "warehouse");
  // Kế toán: Trang chủ
  assert.equal(bellTabFor(staff(["dashboard", "finance.analytics", "invoicing"])), "home");
  // Chỉ quảng cáo TikTok: Trang chủ (trang Quảng cáo)
  assert.equal(bellTabFor(staff(["ads.tiktok"])), "home");
  // Có Trang chủ nhưng không quyền nào ứng với một mục thông báo → không chuông
  assert.equal(bellTabFor(staff(["dashboard"])), null);
  assert.equal(accessOf(staff(["dashboard", "operations.reviews"])).notifications, false);
  // Chỉ KOC / Hóa đơn: có thông báo nhưng app không có tab nào → không chuông (màn "chưa có quyền")
  assert.equal(bellTabFor(staff(["koc"])), null);
  assert.equal(bellTabFor(staff(["invoicing"])), null);
});

test("bấm thông báo: chỉ mở màn người này vào được", () => {
  const kho = accessOf(staff(["orders", "warehouse.returns"]));
  const ads = accessOf(staff(["ads.tiktok"]));
  const own = accessOf(owner);
  const t = (link: string, type = "x") => {
    const r = resolveNotificationTarget({ type, link, title: "" });
    assert.ok(r, link);
    return r;
  };
  // Đơn hàng / hoàn hàng
  assert.equal(targetAllowed(t("/orders?cancelRequested=1", "cancel_request"), kho), true);
  assert.equal(targetAllowed(t("/warehouse/returns", "return"), kho), true);
  assert.equal(targetAllowed(t("/warehouse/returns", "return"), ads), false);
  // Quảng cáo TikTok: chỉ người có quyền TikTok
  const camp = t("/ads/tiktok/campaign?id=abc", "tiktok-ads-advice");
  assert.equal(targetAllowed(camp, ads), true);
  assert.equal(targetAllowed(camp, kho), false);
  // Chủ shop mở được mọi đích
  for (const x of [camp, t("/orders"), t("/warehouse/returns", "return")]) assert.equal(targetAllowed(x, own), true);
  // Đích chỉ chủ shop
  assert.equal(targetAllowed({ kind: "plan" }, accessOf(staff(FULL))), false);
  assert.equal(targetAllowed({ kind: "assistant", prompt: "x" }, accessOf(staff(FULL))), false);
  assert.equal(targetAllowed({ kind: "external", url: "https://seller.shopee.vn" }, accessOf(staff(FULL))), false);
});
