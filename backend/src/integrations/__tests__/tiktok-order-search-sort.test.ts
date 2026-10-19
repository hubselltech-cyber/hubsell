// ============================================================
// THỨ TỰ XIN SÀN KHI TÌM ĐƠN TIKTOK — Pha A 18/10/2026 (docs/CUNG-HOA-LOP-GOI-SAN.md 3b H1)
// + 19/10/2026: đường mốc nước đọc CŨ → MỚI (docs/DONG-BO-GIAI-DOAN-3.md mục 2.8)
//
// Đo 24/24 gian: không gửi sort_field thì TikTok trả create_time TĂNG dần dù lọc
// update_time → lượt bị cắt giữ phần cũ, mốc vét lát 3.2 trỏ sai, mốc nước Siêu Thị
// 8686 kẹt. 19/10 kẹt kiểu hai: đọc MỚI → CŨ bị cắt thì phần đã đọc không được ghi
// nhận, gian > 2.500 biến động/cửa sổ đọc lại mãi. Hợp đồng: sort theo ĐÚNG trục
// lọc; đường mốc nước ASC (cũ → mới) và chỉ tin khi dãy không giảm; đường tay DESC;
// client phải đưa đúng hai tham số ấy lên query. Không DB, không gọi sàn (fetch giả).
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOrders } from "../tiktok/client";
import type { TikTokConfig } from "../tiktok/config";
import { resetTiktokRateLimitLanes } from "../tiktok/rate-limit";
import { tiktokAscCoveredUpTo, tiktokOrderSearchSort } from "../tiktok/service";

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

describe("tiktokOrderSearchSort — cùng trục với bộ lọc", () => {
  it("quét theo update_time có MỐC NƯỚC (worker) → sort_field=update_time ASC (cũ → mới)", () => {
    expect(tiktokOrderSearchSort(true, true)).toEqual({ sortField: "update_time", sortOrder: "ASC" });
  });
  it("quét theo update_time đường tay (daysBack, không mốc nước) → update_time DESC như cũ", () => {
    expect(tiktokOrderSearchSort(true)).toEqual({ sortField: "update_time", sortOrder: "DESC" });
    expect(tiktokOrderSearchSort(true, false)).toEqual({ sortField: "update_time", sortOrder: "DESC" });
  });
  it("quét theo create_time (đồng bộ tay 90 ngày) → sort_field=create_time DESC, oldestFirst không tác dụng", () => {
    expect(tiktokOrderSearchSort(false)).toEqual({ sortField: "create_time", sortOrder: "DESC" });
    expect(tiktokOrderSearchSort(false, true)).toEqual({ sortField: "create_time", sortOrder: "DESC" });
  });
});

describe("tiktokAscCoveredUpTo — lượt cũ → mới bị cắt ghi nhận phần đã đọc", () => {
  it("bị cắt, dãy không giảm (cho phép bằng nhau) → mốc = update_time cuối", () => {
    expect(tiktokAscCoveredUpTo([100, 100, 150, 200], true)).toBe(200);
  });
  it("không bị cắt → undefined (mốc nước tự tiến tới now0, không cần mốc này)", () => {
    expect(tiktokAscCoveredUpTo([100, 150], false)).toBeUndefined();
  });
  it("sàn trả sai thứ tự → undefined: không bao giờ tiến mốc sai", () => {
    expect(tiktokAscCoveredUpTo([100, 200, 150], true)).toBeUndefined();
  });
  it("không có dòng → undefined", () => {
    expect(tiktokAscCoveredUpTo([], true)).toBeUndefined();
  });
});

describe("fetchOrders — sort_field / sort_order nằm trên query", () => {
  it("truyền sortField/sortOrder → có mặt trên URL, bộ lọc thời gian vẫn ở body", async () => {
    await fetchOrders(
      { accessToken: "t", shopCipher: "c", updateTimeGe: 100, updateTimeLt: 200, pageSize: 100, ...tiktokOrderSearchSort(true, true) },
      cfg
    );
    const url = calledUrl();
    expect(url.pathname).toBe("/order/202309/orders/search");
    expect(url.searchParams.get("sort_field")).toBe("update_time");
    expect(url.searchParams.get("sort_order")).toBe("ASC");
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
