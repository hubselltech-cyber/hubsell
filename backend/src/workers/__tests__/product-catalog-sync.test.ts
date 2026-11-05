// Lịch kéo danh mục sản phẩm — phần thuần (workers/product-catalog-sync.ts, 28/09/2026).
import { describe, expect, it } from "vitest";
import { nextNightlySlot, NIGHTLY_WINDOW } from "../product-catalog-sync";

const vnHour = (d: Date) => new Date(d.getTime() + 7 * 3600_000).getUTCHours();
const vnMin = (d: Date) => new Date(d.getTime() + 7 * 3600_000).getUTCMinutes();
const vnDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

describe("nextNightlySlot — đêm sau 03:00 giờ VN, rải 120'", () => {
  it("kéo xong 22:50 VN → 03:00 ngày mai (rand 0)", () => {
    const now = new Date("2026-09-28T15:50:00Z"); // 22:50 VN
    const slot = nextNightlySlot(now, 0);
    expect(vnDate(slot)).toBe("2026-09-29");
    expect(vnHour(slot)).toBe(NIGHTLY_WINDOW.startHour);
    expect(vnMin(slot)).toBe(0);
  });
  it("kéo xong 01:00 VN vẫn là 03:00 NGÀY MAI, không phải 2 tiếng nữa", () => {
    const now = new Date("2026-09-28T18:00:00Z"); // 01:00 VN 29/09
    const slot = nextNightlySlot(now, 0);
    expect(vnDate(slot)).toBe("2026-09-30");
    expect(vnHour(slot)).toBe(3);
  });
  it("rand rải trong [03:00, 05:00)", () => {
    const now = new Date("2026-09-28T10:00:00Z");
    const early = nextNightlySlot(now, 0);
    const late = nextNightlySlot(now, 0.999);
    expect(vnHour(early)).toBe(3);
    expect(vnHour(late)).toBe(4);
    expect(vnMin(late)).toBe(59);
    expect(late.getTime() - early.getTime()).toBeLessThan(NIGHTLY_WINDOW.spreadMin * 60_000);
  });
  it("rand ngoài [0,1) bị kẹp", () => {
    const now = new Date("2026-09-28T10:00:00Z");
    expect(vnHour(nextNightlySlot(now, -5))).toBe(3);
    expect(vnHour(nextNightlySlot(now, 7))).toBe(4);
  });
});

// ---- Lát 3.7 (03/11/2026): nút bấm chỉ XIN kéo, worker kéo — phần thuần.
import {
  classifyProductSyncRequest,
  isCatalogPending,
  REQUEST_RECENT_MS,
  REQUEST_STALE_MS,
} from "../product-catalog-sync";

const NOW = new Date("2026-11-03T07:40:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const base = {
  channelName: "TIKTOK" as const,
  refreshToken: "rt",
  hibernatedAt: null,
  lastProductSyncAt: ago(24 * 3600_000),
  productSyncRequestedAt: null,
};

describe("classifyProductSyncRequest — một gian xin kéo thì ra gì", () => {
  it("gian online có ủy quyền, kéo lần cuối hôm qua → queued", () => {
    expect(classifyProductSyncRequest(base, NOW)).toBe("queued");
  });
  it("chưa từng kéo (lastProductSyncAt null) vẫn queued", () => {
    expect(classifyProductSyncRequest({ ...base, lastProductSyncAt: null }, NOW)).toBe("queued");
  });
  it("vừa kéo xong < 2' → recent (không gọi sàn lại)", () => {
    expect(classifyProductSyncRequest({ ...base, lastProductSyncAt: ago(REQUEST_RECENT_MS - 1000) }, NOW)).toBe("recent");
    expect(classifyProductSyncRequest({ ...base, lastProductSyncAt: ago(REQUEST_RECENT_MS + 1000) }, NOW)).toBe("queued");
  });
  it("đã xin trước đó (mốc xin 10') → already, không ghi lại", () => {
    expect(classifyProductSyncRequest({ ...base, productSyncRequestedAt: ago(10 * 60_000) }, NOW)).toBe("already");
  });
  it("mốc xin treo quá 2 giờ (worker sập) → cho xin lại = queued", () => {
    expect(classifyProductSyncRequest({ ...base, productSyncRequestedAt: ago(REQUEST_STALE_MS + 1000) }, NOW)).toBe("queued");
  });
  it("'already' thắng 'recent': đang kéo thì báo đang kéo", () => {
    expect(
      classifyProductSyncRequest({ ...base, productSyncRequestedAt: ago(30_000), lastProductSyncAt: ago(10_000) }, NOW)
    ).toBe("already");
  });
  it("không đủ điều kiện: Offline / không ủy quyền / ngủ đông → ineligible", () => {
    expect(classifyProductSyncRequest({ ...base, channelName: "OFFLINE" }, NOW)).toBe("ineligible");
    expect(classifyProductSyncRequest({ ...base, refreshToken: null }, NOW)).toBe("ineligible");
    expect(classifyProductSyncRequest({ ...base, hibernatedAt: ago(1000) }, NOW)).toBe("ineligible");
  });
});

describe("isCatalogPending — trang báo 'Đang kéo trong vài phút' khi nào", () => {
  const old = {
    createdAt: ago(30 * 24 * 3600_000),
    lastProductSyncAt: ago(24 * 3600_000),
    nextProductSyncAt: new Date(NOW.getTime() + 12 * 3600_000),
    productSyncError: null,
    productSyncRequestedAt: null,
  };
  it("gian cũ, lịch đêm bình thường → không pending", () => {
    expect(isCatalogPending(old, NOW)).toBe(false);
  });
  it("gian cũ vừa xin kéo → pending, kể cả khi lần trước lỗi", () => {
    expect(isCatalogPending({ ...old, productSyncRequestedAt: ago(60_000) }, NOW)).toBe(true);
    expect(isCatalogPending({ ...old, productSyncRequestedAt: ago(60_000), productSyncError: "token hỏng" }, NOW)).toBe(true);
  });
  it("mốc xin quá 2 giờ → hết pending (không treo chữ 'đang kéo' mãi)", () => {
    expect(isCatalogPending({ ...old, productSyncRequestedAt: ago(REQUEST_STALE_MS + 1) }, NOW)).toBe(false);
  });
  it("worker xong xóa mốc xin → hết pending", () => {
    expect(isCatalogPending({ ...old, lastProductSyncAt: NOW, productSyncRequestedAt: null }, NOW)).toBe(false);
  });
  it("gian VỪA NỐI chưa kéo lần đầu (luật 28/09 giữ nguyên): pending trong 60', lỗi/quá hạn thì thôi", () => {
    const fresh = { ...old, createdAt: ago(5 * 60_000), lastProductSyncAt: null, nextProductSyncAt: NOW };
    expect(isCatalogPending(fresh, NOW)).toBe(true);
    expect(isCatalogPending({ ...fresh, productSyncError: "sàn bận" }, NOW)).toBe(false);
    expect(isCatalogPending({ ...fresh, createdAt: ago(61 * 60_000) }, NOW)).toBe(false);
    expect(isCatalogPending({ ...fresh, nextProductSyncAt: null }, NOW)).toBe(false);
  });
});

// ---- Lát 3.9 (05/11/2026): dòng log nói rõ lượt tăng dần hay toàn bộ.
import { describeSyncMode } from "../product-catalog-sync";

describe("describeSyncMode — chữ để lọc log", () => {
  it("tăng dần kèm mốc đọc; toàn bộ kèm lý do", () => {
    expect(describeSyncMode({ mode: "incremental", since: new Date("2026-11-05T01:00:00Z"), fullReason: null })).toBe(
      "tăng dần từ 2026-11-05T01:00:00.000Z"
    );
    expect(describeSyncMode({ mode: "full", since: null, fullReason: "chạy bóng" })).toBe("toàn bộ (chạy bóng)");
    expect(describeSyncMode({ mode: "full", since: null, fullReason: null })).toBe("toàn bộ");
  });
});
