import { describe, expect, it } from "vitest";
import { groupQueue, parseQueueStage, type QueueRow } from "../process-queue";

let seq = 0;
function row(over: Partial<QueueRow>): QueueRow {
  seq += 1;
  return {
    id: `o${seq}`,
    channelId: "c1",
    channelName: "SHOPEE",
    shopName: "Shop A",
    carrier: "SPX",
    shippingCarrierName: "SPX Express",
    cancelRequested: false,
    ...over,
  };
}

describe("parseQueueStage", () => {
  it("chỉ nhận ba công đoạn", () => {
    expect(parseQueueStage("ARRANGE")).toBe("ARRANGE");
    expect(parseQueueStage("PRINT")).toBe("PRINT");
    expect(parseQueueStage("REPRINT")).toBe("REPRINT");
    expect(parseQueueStage("PENDING")).toBeNull();
    expect(parseQueueStage(undefined)).toBeNull();
  });
});

describe("groupQueue", () => {
  it("gom theo gian rồi theo hãng, cộng lại bằng đúng số đơn vào", () => {
    const rows = [
      row({}),
      row({}),
      row({ carrier: "GHN", shippingCarrierName: "GHN" }),
      row({ channelId: "c2", channelName: "TIKTOK", shopName: "Shop B", carrier: "JT", shippingCarrierName: "J&T Express" }),
    ];
    const groups = groupQueue(rows);
    expect(groups.map((g) => [g.shopName, g.count])).toEqual([
      ["Shop A", 3],
      ["Shop B", 1],
    ]);
    expect(groups.reduce((s, g) => s + g.carriers.reduce((n, c) => n + c.orderIds.length, 0), 0)).toBe(rows.length);
    expect(groups[0].carriers.map((c) => [c.key, c.count])).toEqual([
      ["SPX", 2],
      ["GHN", 1],
    ]);
  });

  it("hỏa tốc thành nhóm riêng đứng đầu dù ít đơn hơn — 'SPX Express' KHÔNG phải hỏa tốc", () => {
    const groups = groupQueue([
      row({}),
      row({}),
      row({}),
      row({ shippingCarrierName: "SPX Instant" }),
      row({ carrier: "KHAC", shippingCarrierName: "AhaMove" }),
    ]);
    expect(groups[0].express).toBe(2);
    expect(groups[0].carriers.map((c) => [c.key, c.express, c.count])).toEqual([
      ["EXPRESS", true, 2],
      ["SPX", false, 3],
    ]);
  });

  it("đơn sàn chưa gán hãng vào nhóm 'Chưa gán hãng', không rơi mất", () => {
    const groups = groupQueue([row({ carrier: null, shippingCarrierName: null })]);
    expect(groups[0].carriers).toHaveLength(1);
    expect(groups[0].carriers[0]).toMatchObject({ key: "NONE", label: "Chưa gán hãng", count: 1 });
  });

  it("giữ thứ tự đơn đầu vào trong từng hãng (route đã xếp hỏa tốc + đơn cũ trước)", () => {
    const a = row({});
    const b = row({});
    const c = row({});
    expect(groupQueue([b, a, c])[0].carriers[0].orderIds).toEqual([b.id, a.id, c.id]);
  });

  it("xếp gian theo sàn Shopee → TikTok → Lazada rồi theo tên; đếm đơn khách xin hủy", () => {
    const groups = groupQueue([
      row({ channelId: "l1", channelName: "LAZADA", shopName: "Z" }),
      row({ channelId: "t1", channelName: "TIKTOK", shopName: "B", cancelRequested: true }),
      row({ channelId: "s2", channelName: "SHOPEE", shopName: "Ô tô" }),
      row({ channelId: "s1", channelName: "SHOPEE", shopName: "An" }),
    ]);
    expect(groups.map((g) => g.shopName)).toEqual(["An", "Ô tô", "B", "Z"]);
    expect(groups[2].cancelRequested).toBe(1);
  });
});
