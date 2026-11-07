// ============================================================
// HQ Sức khỏe — "Gian rớt kết nối" tách theo lý do (07/11/2026, integrations/channel-disconnect.ts).
// Chạy trên database dev: collectGrowth đọc MỌI gian rớt 24h trong DB nên chỉ khẳng định
// "có nhóm của gian thử" chứ không khẳng định tổng. Khóa 3 điều:
//   1. cột disconnectReason ghi tại nguồn được đọc lên thẻ (ACCOUNT_DELETED không tính phía sàn);
//   2. dòng cũ (cột trống) suy ra "khách xóa tài khoản" từ User.deletedAt qua join;
//   3. dòng cũ hạn ủy quyền ≤ lúc ngắt → "hết hạn ủy quyền", tính phía sàn.
// ============================================================
import "../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStockFixture, type StockFixture } from "../../integrations/__tests__/fixtures";
import { prisma } from "../../lib/prisma";
import { collectGrowth } from "../platform-health";

let fx: StockFixture;
let shopName = "";

beforeAll(async () => {
  fx = await createStockFixture("hqdrop");
  shopName = (await prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } })).shopName;
});

afterAll(async () => {
  await fx.cleanup();
});

async function groupOf(reason: string) {
  const g = await collectGrowth();
  const detail = g.channelsDisconnected24hDetail!;
  expect(g.channelsDisconnected24h).toBe(detail.total);
  return { detail, group: detail.groups.find((x) => x.reason === reason && x.names.some((n) => n.startsWith(`${shopName} ·`))) };
}

describe("collectGrowth — gian rớt 24h tách theo lý do", () => {
  it("cột ghi tại nguồn: khách xóa tài khoản → có trong nhóm ACCOUNT_DELETED, KHÔNG tính phía sàn", async () => {
    await prisma.channel.update({
      where: { id: fx.channelId },
      data: { status: "DISCONNECTED", disconnectedAt: new Date(), disconnectReason: "ACCOUNT_DELETED" },
    });
    const { detail, group } = await groupOf("ACCOUNT_DELETED");
    expect(group).toBeDefined();
    expect(group!.platformSide).toBe(false);
    expect(detail.total - detail.platformSide).toBeGreaterThanOrEqual(1);
  });

  it("dòng cũ (cột trống) + chủ shop đã xóa tài khoản → suy ACCOUNT_DELETED qua join User.deletedAt", async () => {
    await prisma.channel.update({ where: { id: fx.channelId }, data: { disconnectReason: null } });
    await prisma.user.update({ where: { id: fx.userId }, data: { deletedAt: new Date() } });
    try {
      const { group } = await groupOf("ACCOUNT_DELETED");
      expect(group).toBeDefined();
    } finally {
      await prisma.user.update({ where: { id: fx.userId }, data: { deletedAt: null } });
    }
  });

  it("dòng cũ + hạn ủy quyền đến trước lúc ngắt → AUTH_EXPIRED, tính phía sàn", async () => {
    const cut = new Date();
    await prisma.channel.update({
      where: { id: fx.channelId },
      data: { disconnectReason: null, disconnectedAt: cut, authExpireAt: new Date(cut.getTime() - 60_000) },
    });
    const { detail, group } = await groupOf("AUTH_EXPIRED");
    expect(group).toBeDefined();
    expect(group!.platformSide).toBe(true);
    expect(detail.platformSide).toBeGreaterThanOrEqual(1);
  });
});
