// Hàm thuần của ngủ đông gian hết gói (15/10/2026, services/plan-hibernation.ts):
// mốc ân hạn, dữ liệu đặt cờ / đánh thức, điều kiện lọc. Không chạm DB.
import { describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import {
  HIBERNATE_FAR_FUTURE,
  WAKE_CATCHUP_MAX_DAYS,
  awakeChannelsWhere,
  hibernateChannelData,
  hibernationCandidatesWhere,
  hibernationCutoff,
  isHibernated,
  wakeChannelData,
} from "../plan-hibernation";
import { EXPIRED_GRACE_DAYS } from "../plan-enforcement";
import { WATERMARK_FLOOR_DAYS, planOrderWindow } from "../order-watermark";

const DAY_MS = 86_400_000;
const now = new Date("2026-10-15T10:00:00.000Z");

describe("hibernationCutoff — cùng mốc với khóa tầng giá trị gia tăng", () => {
  it("lùi đúng EXPIRED_GRACE_DAYS (7) ngày", () => {
    expect(hibernationCutoff(now).getTime()).toBe(now.getTime() - EXPIRED_GRACE_DAYS * DAY_MS);
    expect(EXPIRED_GRACE_DAYS).toBe(7);
  });

  it("kỳ hạn kết thúc đúng 7 ngày trước thì CHƯA ngủ (lt, không lte) — khớp expiryLocked dùng '>'", () => {
    const periodEnd = new Date(now.getTime() - 7 * DAY_MS);
    expect(periodEnd.getTime() < hibernationCutoff(now).getTime()).toBe(false);
    const older = new Date(periodEnd.getTime() - 1);
    expect(older.getTime() < hibernationCutoff(now).getTime()).toBe(true);
  });
});

describe("hibernateChannelData / wakeChannelData", () => {
  it("đặt cờ = ghi hibernatedAt + đẩy MỌI tầng (nhanh/giờ/ads/xung) về 2100", () => {
    const d = hibernateChannelData(now);
    expect(d.hibernatedAt).toBe(now);
    expect(d.nextFastSyncAt).toBe(HIBERNATE_FAR_FUTURE);
    expect(d.nextHourlySyncAt).toBe(HIBERNATE_FAR_FUTURE);
    expect(d.nextAdsSyncAt).toBe(HIBERNATE_FAR_FUTURE);
    expect(d.nextAdsPulseAt).toBe(HIBERNATE_FAR_FUTURE);
    expect(HIBERNATE_FAR_FUTURE.getUTCFullYear()).toBe(2100);
  });

  it("không tầng nào bị để null — null nghĩa là 'chưa chạy bao giờ → quét ngay' trong tick()", () => {
    const d = hibernateChannelData(now) as Record<string, unknown>;
    for (const k of ["nextFastSyncAt", "nextHourlySyncAt", "nextAdsSyncAt", "nextAdsPulseAt"]) {
      expect(d[k]).not.toBeNull();
      expect(d[k]).not.toBeUndefined();
    }
  });

  it("đánh thức = xóa cờ, mọi tầng đến hạn ngay, nhịp về gốc; KHÔNG đụng mốc nước", () => {
    const d = wakeChannelData(now);
    expect(d.hibernatedAt).toBeNull();
    expect(d.nextFastSyncAt).toBe(now);
    expect(d.nextHourlySyncAt).toBe(now);
    expect(d.nextAdsSyncAt).toBe(now);
    expect(d.nextAdsPulseAt).toBe(now);
    expect(d.syncBackoffLevel).toBe(0);
    expect("ordersWatermarkAt" in d).toBe(false);
    expect("ordersCatchupBeforeAt" in d).toBe(false);
  });
});

describe("isHibernated", () => {
  it("theo cột hibernatedAt", () => {
    expect(isHibernated({ hibernatedAt: now })).toBe(true);
    expect(isHibernated({ hibernatedAt: null })).toBe(false);
    expect(isHibernated(null)).toBe(false);
    expect(isHibernated(undefined)).toBe(false);
  });
});

describe("điều kiện lọc", () => {
  it("awakeChannelsWhere: chỉ gian sàn thật, ACTIVE, chưa có cờ, của đúng các chủ", () => {
    const w = awakeChannelsWhere(["u1", "u2"]);
    expect(w).toEqual({
      userId: { in: ["u1", "u2"] },
      status: "ACTIVE",
      hibernatedAt: null,
      channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA, ChannelName.TIKTOK] },
    });
  });

  it("hibernationCandidatesWhere: kỳ hạn < mốc, chủ không phải điều hành nền tảng, còn gian thức", () => {
    const w = hibernationCandidatesWhere(now);
    expect(w.currentPeriodEnd).toEqual({ lt: hibernationCutoff(now) });
    expect(w.user).toMatchObject({ isPlatformAdmin: false });
    expect((w.user as { channels: unknown }).channels).toEqual({
      some: {
        status: "ACTIVE",
        hibernatedAt: null,
        channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA, ChannelName.TIKTOK] },
      },
    });
    // Không lọc theo status thuê bao: CANCELLED/EXPIRED có kỳ hạn cũng ngủ (cùng cách
    // suy `expired` của getOwnerPlanState); khách cũ không có dòng thì không bao giờ khớp.
    expect("status" in w).toBe(false);
  });
});

describe("thức lại → mốc nước tự vét bù, có trần", () => {
  it("trần vét bù = WATERMARK_FLOOR_DAYS (90) — số tự chọn, trùng trần nạp lịch sử gian mới", () => {
    expect(WAKE_CATCHUP_MAX_DAYS).toBe(WATERMARK_FLOOR_DAYS);
    expect(WAKE_CATCHUP_MAX_DAYS).toBe(90);
  });

  it("ngủ 20 ngày: lượt đầu đọc từ mốc cũ − OVERLAP tới now (chế độ advance)", () => {
    const slept = new Date(now.getTime() - 20 * DAY_MS);
    const plan = planOrderWindow({ ordersWatermarkAt: slept, ordersCatchupBeforeAt: null }, now.getTime(), undefined);
    expect(plan.mode).toBe("advance");
    expect(plan.fromSec).toBeLessThanOrEqual(Math.floor(slept.getTime() / 1000));
    expect(plan.toSec).toBe(Math.floor(now.getTime() / 1000));
  });

  it("ngủ 200 ngày: cửa sổ bị kẹp ở sàn 90 ngày, không quét xa hơn", () => {
    const slept = new Date(now.getTime() - 200 * DAY_MS);
    const plan = planOrderWindow({ ordersWatermarkAt: slept, ordersCatchupBeforeAt: null }, now.getTime(), undefined);
    expect(plan.fromSec).toBe(Math.floor(now.getTime() / 1000) - WATERMARK_FLOOR_DAYS * 86_400);
  });
});
