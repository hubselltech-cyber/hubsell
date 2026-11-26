// ============================================================
// Chuông một lần "Thuế GTGT quảng cáo" (26/11/2026, services/ads-vat-notice.ts) trên DB dev:
// đúng người nhận, không gửi hai lần, việc bỏ dở nhận lại không trùng. Mỗi ca dùng khóa việc
// riêng + chỉ giới hạn trong các chủ shop thử (không đụng chủ shop thật của DB dev).
// ============================================================

import "../../integrations/__tests__/load-env";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import {
  ADS_VAT_NOTICE_TITLE,
  ADS_VAT_NOTICE_TYPE,
  adsVatNoticeRecipients,
  runAdsVatNotice,
} from "../ads-vat-notice";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT "adsVatAsCost" FROM "ShopTaxSetting" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();
if (!dbReady) console.log("[ads-vat-notice-db.test] BỎ QUA: không nối được DB dev / chưa áp migration");

const TAG = `avn-test-${Date.now()}`;
const NOW = new Date("2026-11-26T04:00:00.000Z"); // 11:00 26/11 giờ VN
const users: string[] = [];
const keys: string[] = [];

async function makeOwner(opts: {
  platform: "SHOPEE" | "TIKTOK" | "LAZADA";
  spendDay?: string; // "yyyy-mm-dd"; bỏ trống = không có quảng cáo
  vatAsCost?: boolean;
}): Promise<string> {
  const n = users.length;
  const u = await prisma.user.create({
    data: { email: `${TAG}-${n}@test.local`, passwordHash: "x", fullName: "Thử chuông thuế quảng cáo" },
    select: { id: true },
  });
  users.push(u.id);
  const ch = await prisma.channel.create({
    data: { userId: u.id, channelName: opts.platform, shopName: `${TAG}-${n}` },
    select: { id: true },
  });
  if (opts.spendDay) {
    await prisma.adSpend.create({
      data: { channelId: ch.id, date: new Date(`${opts.spendDay}T00:00:00.000Z`), amount: 100_000 },
    });
  }
  if (opts.vatAsCost === false) {
    await prisma.shopTaxSetting.create({ data: { ownerId: u.id, adsVatAsCost: false } });
  }
  return u.id;
}

const noticesOf = (ownerId: string) =>
  prisma.notification.count({ where: { ownerId, type: ADS_VAT_NOTICE_TYPE, title: ADS_VAT_NOTICE_TITLE } });

afterAll(async () => {
  if (users.length) {
    await prisma.notification.deleteMany({ where: { ownerId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  if (keys.length) await prisma.maintenanceJob.deleteMany({ where: { key: { in: keys } } });
  await prisma.$disconnect();
});

describe.skipIf(!dbReady)("chuông một lần thuế GTGT quảng cáo", () => {
  it("chỉ chủ shop có quảng cáo TikTok / Shopee trong 30 ngày và chưa tắt tính thuế", async () => {
    const shopee = await makeOwner({ platform: "SHOPEE", spendDay: "2026-11-20" });
    const tiktok = await makeOwner({ platform: "TIKTOK", spendDay: "2026-10-28" }); // đúng ngày thứ 30
    const tooOld = await makeOwner({ platform: "TIKTOK", spendDay: "2026-10-27" }); // ngày thứ 31
    const lazada = await makeOwner({ platform: "LAZADA", spendDay: "2026-11-20" }); // chưa tính thuế
    const noAds = await makeOwner({ platform: "SHOPEE" });
    const turnedOff = await makeOwner({ platform: "SHOPEE", spendDay: "2026-11-20", vatAsCost: false });
    const all = [shopee, tiktok, tooOld, lazada, noAds, turnedOff];

    expect((await adsVatNoticeRecipients(NOW, all)).sort()).toEqual([shopee, tiktok].sort());

    const key = `${TAG}-a`;
    keys.push(key);
    const r = await runAdsVatNotice({ now: NOW, key, onlyOwnerIds: all });
    expect(r).toEqual({ outcome: "sent", recipients: 2, sent: 2 });
    expect(await noticesOf(shopee)).toBe(1);
    expect(await noticesOf(tiktok)).toBe(1);
    for (const id of [tooOld, lazada, noAds, turnedOff]) expect(await noticesOf(id)).toBe(0);

    const row = await prisma.notification.findFirstOrThrow({ where: { ownerId: shopee } });
    expect(row.category).toBe("system_other");
    expect(row.link).toBe("/finance/analytics");

    // Chạy lại → đã xong, không gửi thêm.
    const again = await runAdsVatNotice({ now: NOW, key, onlyOwnerIds: all });
    expect(again.outcome).toBe("done");
    expect(await noticesOf(shopee)).toBe(1);
  });

  it("đang có tiến trình khác gửi → nhường; việc bỏ dở quá 10 phút → nhận lại, không ai nhận hai lần", async () => {
    const a = await makeOwner({ platform: "SHOPEE", spendDay: "2026-11-20" });
    const b = await makeOwner({ platform: "TIKTOK", spendDay: "2026-11-21" });
    const key = `${TAG}-b`;
    keys.push(key);

    // Giả lập lượt trước: đã giữ việc, gửi được cho A rồi chết giữa chừng.
    await prisma.maintenanceJob.create({ data: { key, cursor: "sending", updatedAt: NOW } });
    await prisma.notification.create({
      data: { ownerId: a, type: ADS_VAT_NOTICE_TYPE, title: ADS_VAT_NOTICE_TITLE, category: "system_other" },
    });

    // 5 phút sau: vẫn coi là đang gửi.
    const busy = await runAdsVatNotice({ now: new Date(NOW.getTime() + 5 * 60_000), key, onlyOwnerIds: [a, b] });
    expect(busy.outcome).toBe("busy");
    expect(await noticesOf(b)).toBe(0);

    // 11 phút sau: nhận lại — chỉ B được gửi, A không nhận lần hai.
    const resumed = await runAdsVatNotice({ now: new Date(NOW.getTime() + 11 * 60_000), key, onlyOwnerIds: [a, b] });
    expect(resumed).toEqual({ outcome: "sent", recipients: 2, sent: 1 });
    expect(await noticesOf(a)).toBe(1);
    expect(await noticesOf(b)).toBe(1);
    const job = await prisma.maintenanceJob.findUniqueOrThrow({ where: { key } });
    expect(job.doneAt).not.toBeNull();
    expect(job.processed).toBe(2);
  });

  it("ADS_VAT_OFF=1 (báo cáo đang tắt thuế) → chưa gửi gì", async () => {
    const a = await makeOwner({ platform: "SHOPEE", spendDay: "2026-11-20" });
    const key = `${TAG}-c`;
    keys.push(key);
    process.env.ADS_VAT_OFF = "1";
    try {
      const r = await runAdsVatNotice({ now: NOW, key, onlyOwnerIds: [a] });
      expect(r.outcome).toBe("off");
      expect(await noticesOf(a)).toBe(0);
    } finally {
      delete process.env.ADS_VAT_OFF;
    }
  });
});
