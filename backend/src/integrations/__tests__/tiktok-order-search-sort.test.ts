// ============================================================
// THỨ TỰ XIN SÀN KHI TÌM ĐƠN TIKTOK — Pha A 18/10/2026 (docs/CUNG-HOA-LOP-GOI-SAN.md 3b H1)
//
// Đo 24/24 gian: không gửi sort_field thì TikTok trả create_time TĂNG dần dù lọc
// update_time → lượt bị cắt giữ phần cũ, mốc vét lát 3.2 trỏ sai, mốc nước Siêu Thị
// 8686 kẹt. Hợp đồng: sort theo ĐÚNG trục lọc, DESC; và client phải đưa đúng hai
// tham số ấy lên query. Không DB, không gọi sàn (fetch giả).
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOrders } from "../tiktok/client";
import type { TikTokConfig } from "../tiktok/config";
import { resetTiktokRateLimitLanes } from "../tiktok/rate-limit";
import { tiktokOrderSearchSort } from "../tiktok/service";

const cfg: TikTokConfig = { appKey: "k", appSecret: "s", serviceId: "1", redirectUri: "https://x/cb" };
const fetchSpy = vi.fn();
const ok = (data: unknown) => ({ status: 200, headers: new Headers(), json: async () => ({ code: 0, message: "Success", data }) });

beforeEach(() => {
  resetTiktokRateLimitLanes();
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(ok({ orders: [], total_count: 0 }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

const calledUrl = () => new URL(String(fetchSpy.mock.calls[0][0]));

describe("tiktokOrderSearchSort — cùng trục với bộ lọc, mới nhất trước", () => {
  it("quét theo update_time (worker, mốc nước) → sort_field=update_time DESC", () => {
    expect(tiktokOrderSearchSort(true)).toEqual({ sortField: "update_time", sortOrder: "DESC" });
  });
  it("quét theo create_time (đồng bộ tay 90 ngày) → sort_field=create_time DESC", () => {
    expect(tiktokOrderSearchSort(false)).toEqual({ sortField: "create_time", sortOrder: "DESC" });
  });
});

describe("fetchOrders — sort_field / sort_order nằm trên query", () => {
  it("truyền sortField/sortOrder → có mặt trên URL, bộ lọc thời gian vẫn ở body", async () => {
    await fetchOrders(
      { accessToken: "t", shopCipher: "c", updateTimeGe: 100, updateTimeLt: 200, pageSize: 100, ...tiktokOrderSearchSort(true) },
      cfg
    );
    const url = calledUrl();
    expect(url.pathname).toBe("/order/202309/orders/search");
    expect(url.searchParams.get("sort_field")).toBe("update_time");
    expect(url.searchParams.get("sort_order")).toBe("DESC");
    expect(url.searchParams.get("page_size")).toBe("100");
    const init = fetchSpy.mock.calls[0][1] as { body?: string };
    expect(JSON.parse(init.body ?? "{}")).toEqual({ update_time_ge: 100, update_time_lt: 200 });
  });

  it("không truyền → không gửi sort_* (hành vi cũ cho nơi khác còn dùng)", async () => {
    await fetchOrders({ accessToken: "t", shopCipher: "c", createTimeGe: 1, createTimeLt: 2 }, cfg);
    const url = calledUrl();
    expect(url.searchParams.has("sort_field")).toBe(false);
    expect(url.searchParams.has("sort_order")).toBe(false);
  });
});
