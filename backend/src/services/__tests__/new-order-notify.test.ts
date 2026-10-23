import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetNewOrderBuffers,
  _setNewOrderDeps,
  compactVnd,
  describeBatch,
  flushOwner,
  noteNewOrder,
  MERGE_WINDOW_MS,
} from "../new-order-notify";
import { categoryOf, groupOfCategory, isCategoryMuted, sanitizeMuted } from "../notification-categories";

type Call = { kind: "notify" | "amend"; args: unknown[] };

describe("new-order-notify — gom đợt đơn mới, hỏa tốc báo ngay", () => {
  let calls: Call[];
  let now: number;
  let amendOk: boolean;
  let muted: boolean;
  const base = {
    ownerId: "o1",
    shopName: "ANO",
    channelName: "SHOPEE",
    totalAmount: 500_000,
    carrierName: "SPX Express",
  };

  beforeEach(() => {
    calls = [];
    now = Date.parse("2026-10-23T10:00:00Z");
    amendOk = true;
    muted = false;
    _resetNewOrderBuffers();
    _setNewOrderDeps({
      now: () => now,
      flushDelayMs: 1_000_000, // test gọi flushOwner thẳng
      isMuted: async () => muted,
      notify: async (...args: unknown[]) => {
        calls.push({ kind: "notify", args });
        return { id: `n${calls.length}` };
      },
      amend: async (...args: unknown[]) => {
        calls.push({ kind: "amend", args });
        return amendOk;
      },
    });
  });
  afterEach(() => _resetNewOrderBuffers());

  it("đơn nạp lịch sử (đặt quá 2 giờ) không nổ chuông", async () => {
    noteNewOrder({ ...base, orderCode: "A1", placedAt: new Date(now - 3 * 3600_000) });
    noteNewOrder({ ...base, orderCode: "A2", placedAt: null });
    await flushOwner("o1");
    expect(calls).toHaveLength(0);
  });

  it("gom nhiều đơn thường: tiêu đề nói rõ đơn mới cần xử lý, thân = sàn · shop · số đơn · tiền từng gian", async () => {
    noteNewOrder({ ...base, orderCode: "A1", placedAt: new Date(now - 60_000) });
    noteNewOrder({ ...base, orderCode: "A2", placedAt: new Date(now - 30_000) });
    noteNewOrder({ ...base, orderCode: "B1", shopName: "Hi.Bé", channelName: "TIKTOK", totalAmount: 200_000, placedAt: new Date(now) });
    expect(calls).toHaveLength(0); // chưa flush = chưa báo
    await flushOwner("o1");
    expect(calls).toHaveLength(1);
    const [ownerId, input] = calls[0].args as [string, { type: string; title: string; body: string; dedupe: boolean }];
    expect(ownerId).toBe("o1");
    expect(input.type).toBe("order_new");
    expect(input.title).toBe("Có 3 đơn hàng mới cần xử lý");
    expect(input.body).toBe("Shopee · ANO: 2 đơn · 1 tr\nTikTok · Hi.Bé: 1 đơn · 200 k\nTổng 1,2 tr");
    expect(input.dedupe).toBe(false);
  });

  it("khách tắt Đơn hàng mới → cả đợt lẫn đợt cộng dồn đều im", async () => {
    noteNewOrder({ ...base, orderCode: "A1", placedAt: new Date(now) });
    await flushOwner("o1");
    expect(calls).toHaveLength(1);
    muted = true;
    now += 60_000;
    noteNewOrder({ ...base, orderCode: "A2", placedAt: new Date(now) });
    await flushOwner("o1");
    expect(calls).toHaveLength(1); // không amend, không notify
  });

  it("hỏa tốc báo ngay từng đơn, vẫn đếm vào đợt đơn mới", async () => {
    noteNewOrder({ ...base, orderCode: "H1", carrierName: "SPX Instant", placedAt: new Date(now) });
    expect(calls).toHaveLength(1);
    const input = calls[0].args[1] as { type: string; title: string; link: string };
    expect(input.type).toBe("order_express");
    expect(input.title).toContain("H1");
    expect(input.link).toBe("/orders?search=H1");
    await flushOwner("o1");
    expect(calls[1].args[1]).toMatchObject({ type: "order_new", title: "Có 1 đơn hàng mới cần xử lý" });
  });

  it("đợt sau trong 15 phút CỘNG DỒN vào bản ghi cũ, quá 15 phút mở bản ghi mới", async () => {
    noteNewOrder({ ...base, orderCode: "A1", placedAt: new Date(now) });
    await flushOwner("o1");
    now += 5 * 60_000;
    noteNewOrder({ ...base, orderCode: "A2", placedAt: new Date(now) });
    noteNewOrder({ ...base, orderCode: "A3", placedAt: new Date(now) });
    await flushOwner("o1");
    expect(calls.map((c) => c.kind)).toEqual(["notify", "amend"]);
    const [, id, patch, push] = calls[1].args as [string, string, { title: string; body: string }, { title: string }];
    expect(id).toBe("n1");
    expect(patch.title).toBe("Có 3 đơn hàng mới cần xử lý");
    expect(patch.body).toContain("(15 phút gần đây)");
    expect(push.title).toBe("Thêm 2 đơn hàng mới cần xử lý");

    now += MERGE_WINDOW_MS + 1;
    noteNewOrder({ ...base, orderCode: "A4", placedAt: new Date(now) });
    await flushOwner("o1");
    expect(calls[2].kind).toBe("notify");
    expect((calls[2].args[1] as { title: string }).title).toBe("Có 1 đơn hàng mới cần xử lý");
  });

  it("bản ghi cũ đã đọc → không cộng dồn, mở bản ghi mới", async () => {
    noteNewOrder({ ...base, orderCode: "A1", placedAt: new Date(now) });
    await flushOwner("o1");
    amendOk = false;
    noteNewOrder({ ...base, orderCode: "A2", placedAt: new Date(now) });
    await flushOwner("o1");
    expect(calls.map((c) => c.kind)).toEqual(["notify", "amend", "notify"]);
  });

  it("describeBatch / compactVnd gọn cho một dòng", () => {
    expect(compactVnd(850_000)).toBe("850 k");
    expect(compactVnd(2_140_000)).toBe("2,1 tr");
    expect(compactVnd(1_200_000_000)).toBe("1,2 tỷ");
    expect(compactVnd(500)).toBe("500 đ");
    const byShop = new Map<string, { label: string; count: number; amount: number }>();
    for (let i = 1; i <= 5; i++) byShop.set(`s${i}`, { label: `Shopee · S${i}`, count: 6 - i, amount: (6 - i) * 100_000 });
    expect(describeBatch({ count: 15, amount: 1_500_000, byShop })).toBe(
      "Shopee · S1: 5 đơn · 500 k\nShopee · S2: 4 đơn · 400 k\nShopee · S3: 3 đơn · 300 k\n+2 gian khác\nTổng 1,5 tr"
    );
  });
});

describe("notification-categories — type kỹ thuật → mục con → nhóm cha", () => {
  it("xếp đúng mục con", () => {
    expect(categoryOf("order_new")).toBe("order_new");
    expect(categoryOf("order_express")).toBe("order_express");
    expect(categoryOf("cancel_request")).toBe("cancel_request");
    expect(categoryOf("order_cancelled")).toBe("cancel_request");
    expect(categoryOf("return")).toBe("return");
    expect(categoryOf("delivery-fail")).toBe("delivery_fail");
    expect(categoryOf("ops-alert:delivery-fail")).toBe("delivery_fail");
    expect(categoryOf("weekly-report")).toBe("weekly_report");
    expect(categoryOf("ops-alert:loss-orders")).toBe("finance_alert");
    expect(categoryOf("ops-alert:fee-audit-shortfall")).toBe("finance_alert");
    expect(categoryOf("INVOICE_AUTO_ISSUE")).toBe("invoice");
    expect(categoryOf("tax-deadline")).toBe("tax_deadline");
    expect(categoryOf("tiktok-ads-advice")).toBe("ads_advice");
    expect(categoryOf("ops-alert:ads-roas-risk")).toBe("ads_advice");
    expect(categoryOf("tiktok-ads-auto")).toBe("ads_auto");
    expect(categoryOf("ops-alert:ads-auto-paused")).toBe("ads_auto");
    expect(categoryOf("ops-alert:ads-low-balance")).toBe("ads_wallet");
    expect(categoryOf("ads-daily-summary")).toBe("ads_daily");
    expect(categoryOf("ops-alert:ads-app-expired")).toBe("ads_link");
    expect(categoryOf("ops-alert:stockout")).toBe("stockout");
    expect(categoryOf("ops-alert:low-stock")).toBe("low_stock");
    expect(categoryOf("ops-alert:channel-disconnected")).toBe("channel_disconnected");
    expect(categoryOf("lazada-renewal")).toBe("channel_disconnected");
    expect(categoryOf("ops-alert:channel-sync-stalled")).toBe("sync_stalled");
    expect(categoryOf("ops-alert:koc-sample-overdue")).toBe("koc");
    expect(categoryOf("plan_expiry")).toBe("plan");
    expect(categoryOf("PLAN_CHANGED")).toBe("plan");
    expect(categoryOf("subscription")).toBe("plan");
    expect(categoryOf("system")).toBe("system_other");
    expect(groupOfCategory("return")).toBe("orders");
    expect(groupOfCategory("ads_wallet")).toBe("ads");
  });

  it("tắt cả nhóm hoặc từng mục; mục khóa không bao giờ tắt", () => {
    expect(isCategoryMuted(new Set(["orders"]), "order_express")).toBe(true);
    expect(isCategoryMuted(new Set(["order_express"]), "order_new")).toBe(false);
    expect(isCategoryMuted(new Set(["order_express"]), "order_express")).toBe(true);
    expect(isCategoryMuted(new Set(["system", "plan"]), "plan")).toBe(false);
    expect(sanitizeMuted(["orders", "plan", "system", "ads_wallet", "rác", "ads_wallet"])).toEqual(["orders", "ads_wallet"]);
  });
});
