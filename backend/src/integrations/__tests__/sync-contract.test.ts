// ============================================================
// HỢP ĐỒNG "DỮ LIỆU + ĐẦY ĐỦ" — khóa bằng KIỂU (lát 3.1 giai đoạn 3, 14/10/2026).
//
// Mọi hàm kéo dữ liệu theo trang từ sàn phải trả cờ đầy đủ (integrations/
// sync-contract.ts). Các `expectTypeOf` dưới đây không chạy gì lúc runtime —
// chúng được `tsc` kiểm khi build (Render biên dịch cả test, xem
// gotcha-render-build-tests): ai bỏ cờ `truncated` / `complete` khỏi một hàm
// là build đỏ, không phải chờ đến lúc mất đơn trên prod mới biết.
// ============================================================

import { describe, expect, expectTypeOf, it } from "vitest";
import type { ReadCompleteness, SyncCompleteness } from "../sync-contract";
import { incompleteReadMessage } from "../sync-contract";
import type { syncShopeeOrders } from "../shopee/service";
import type { syncShopeeReturns } from "../shopee/returns-sync";
import type { syncTiktokOrders } from "../tiktok/service";
import type { syncTiktokReturns } from "../tiktok/returns-sync";
import type { syncLazadaOrders } from "../lazada/service";
import type { syncLazadaReturns } from "../lazada/returns-sync";
import type { MarketplaceProductAdapter } from "../../marketplace/types";

type Resolved<F extends (...a: never[]) => Promise<unknown>> = Awaited<ReturnType<F>>;

describe("hợp đồng dữ liệu + đầy đủ (khóa bằng kiểu)", () => {
  it("ba hàm đồng bộ đơn trả { pages, truncated }", () => {
    expectTypeOf<Resolved<typeof syncShopeeOrders>>().toMatchTypeOf<SyncCompleteness>();
    expectTypeOf<Resolved<typeof syncTiktokOrders>>().toMatchTypeOf<SyncCompleteness>();
    expectTypeOf<Resolved<typeof syncLazadaOrders>>().toMatchTypeOf<SyncCompleteness>();
  });

  it("ba hàm quét yêu cầu hoàn trả { pages, truncated }", () => {
    expectTypeOf<Resolved<typeof syncShopeeReturns>>().toMatchTypeOf<SyncCompleteness>();
    expectTypeOf<Resolved<typeof syncTiktokReturns>>().toMatchTypeOf<SyncCompleteness>();
    expectTypeOf<Resolved<typeof syncLazadaReturns>>().toMatchTypeOf<SyncCompleteness>();
  });

  it("adapter danh mục trả { complete } — chưa đủ thì không được đánh dấu 'sàn đã gỡ'", () => {
    expectTypeOf<Awaited<ReturnType<MarketplaceProductAdapter["fetchProducts"]>>>().toMatchTypeOf<ReadCompleteness>();
  });

  it("dòng log chưa đủ mang từ khóa CHƯA ĐỦ, số trang và số dòng", () => {
    const ch = { channelName: "SHOPEE", shopName: "Gian thử", id: "c1" };
    expect(incompleteReadMessage(ch, "đơn", { pages: 100, truncated: true, fetched: 9_870 }, "quét biến động")).toBe(
      `[Auto-sync] SHOPEE "Gian thử" (c1): lượt quét biến động đơn CHƯA ĐỦ — dừng ở 100 trang, 9870 đơn; phần cũ hơn chưa đọc`
    );
    expect(incompleteReadMessage(ch, "yêu cầu hoàn", { pages: 50, truncated: true, scanned: 2_500 }, "quét biến động")).toContain(
      "yêu cầu hoàn CHƯA ĐỦ — dừng ở 50 trang, 2500 dòng"
    );
    expect(incompleteReadMessage(ch, "đơn", { pages: 3, truncated: true }, "nạp lịch sử")).toBe(
      `[Auto-sync] SHOPEE "Gian thử" (c1): lượt nạp lịch sử đơn CHƯA ĐỦ — dừng ở 3 trang; phần cũ hơn chưa đọc`
    );
  });
});
