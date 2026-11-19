/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupChannelsByPlatform } from "./channel-groups";

const ch = (channelName: string, shopName: string) => ({ id: `${channelName}:${shopName}`, channelName, shopName });

test("xếp sàn theo Shopee → TikTok → Lazada → Offline, bất kể thứ tự đầu vào", () => {
  const out = groupChannelsByPlatform([
    ch("OFFLINE", "Offline"),
    ch("LAZADA", "Mộc LazMall"),
    ch("TIKTOK", "Mộc.Store"),
    ch("SHOPEE", "Mộc Outlet"),
  ]);
  assert.deepEqual(
    out.map((g) => g.platform),
    ["SHOPEE", "TIKTOK", "LAZADA", "OFFLINE"]
  );
});

test("gian trong một sàn xếp theo tên: không phân biệt hoa thường, số đọc theo giá trị", () => {
  const out = groupChannelsByPlatform([
    ch("SHOPEE", "mộc Outlet"),
    ch("SHOPEE", "Shop 10"),
    ch("SHOPEE", "Demo Shopee"),
    ch("SHOPEE", "Shop 2"),
    ch("SHOPEE", "Mộc Official Store"),
  ]);
  assert.deepEqual(
    out[0].rows.map((r) => r.shopName),
    ["Demo Shopee", "Mộc Official Store", "mộc Outlet", "Shop 2", "Shop 10"]
  );
});

test("sàn không có gian thì không sinh nhóm; danh sách rỗng trả mảng rỗng", () => {
  assert.deepEqual(groupChannelsByPlatform([]), []);
  const out = groupChannelsByPlatform([ch("LAZADA", "Hi.Bé")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].platform, "LAZADA");
});

test("sàn lạ không làm rơi gian — xếp sau các sàn đã biết", () => {
  const out = groupChannelsByPlatform([ch("ZALO", "Gian Zalo"), ch("SHOPEE", "A"), ch("AMAZON", "Gian Amazon")]);
  assert.deepEqual(
    out.map((g) => g.platform),
    ["SHOPEE", "AMAZON", "ZALO"]
  );
  assert.equal(out.reduce((n, g) => n + g.rows.length, 0), 3);
});

test("không sửa mảng đầu vào", () => {
  const input = [ch("SHOPEE", "B"), ch("SHOPEE", "A")];
  groupChannelsByPlatform(input);
  assert.deepEqual(
    input.map((c) => c.shopName),
    ["B", "A"]
  );
});
