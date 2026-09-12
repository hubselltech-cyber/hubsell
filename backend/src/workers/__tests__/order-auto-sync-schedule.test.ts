// Hàm thuần của lịch quét theo gian (12/09): bậc giãn nhịp, jitter, tầng đến hạn,
// vai tiến trình. Không chạm DB / API sàn.
import { afterEach, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { dueTiers, nextFastSchedule, nextPulseDelayMin, withJitter } from "../order-auto-sync";
import { ADS_CADENCE } from "../../config/ads-cadence";
import { resolveHubsellRole } from "../index";

const cadence = { baseMin: 10, maxMin: 60 };
const noJitter = () => 0.5; // rand=0.5 → factor 1.0

describe("nextFastSchedule — giãn nhịp gian im ắng", () => {
  it("có biến động → về bậc 0, đúng nhịp gốc", () => {
    const r = nextFastSchedule(3, true, cadence, noJitter);
    expect(r.level).toBe(0);
    expect(r.delayMs).toBe(10 * 60 * 1000);
  });

  it("không biến động → bậc +1, nhịp ×2 (10' → 20' → 40')", () => {
    expect(nextFastSchedule(0, false, cadence, noJitter)).toEqual({ level: 1, delayMs: 20 * 60 * 1000 });
    expect(nextFastSchedule(1, false, cadence, noJitter)).toEqual({ level: 2, delayMs: 40 * 60 * 1000 });
  });

  it("chạm trần 60' thì kẹp ở trần, bậc không phình vô hạn", () => {
    const a = nextFastSchedule(2, false, cadence, noJitter);
    expect(a.delayMs).toBe(60 * 60 * 1000);
    const b = nextFastSchedule(a.level, false, cadence, noJitter);
    expect(b.delayMs).toBe(60 * 60 * 1000);
    expect(b.level).toBe(a.level);
  });

  it("trần bằng nhịp gốc (AUTO_SYNC_MAX_MINUTES=AUTO_SYNC_MINUTES) → không bao giờ giãn", () => {
    const r = nextFastSchedule(0, false, { baseMin: 10, maxMin: 10 }, noJitter);
    expect(r.delayMs).toBe(10 * 60 * 1000);
    expect(r.level).toBe(0);
  });
});

describe("withJitter", () => {
  it("dao động trong ±15%", () => {
    expect(withJitter(1000, () => 0)).toBe(850);
    expect(withJitter(1000, () => 1)).toBe(1150);
    expect(withJitter(1000, () => 0.5)).toBe(1000);
  });
});

describe("dueTiers", () => {
  const now = Date.parse("2026-09-12T10:00:00Z");
  it("null = chưa từng chạy = đến hạn mọi tầng", () => {
    expect(
      dueTiers({ nextFastSyncAt: null, nextHourlySyncAt: null, nextAdsSyncAt: null, nextAdsPulseAt: null }, now)
    ).toEqual({ fast: true, hourly: true, ads: true, pulse: true });
  });
  it("chỉ tầng có hạn ≤ now mới đến hạn", () => {
    expect(
      dueTiers(
        {
          nextFastSyncAt: new Date(now + 60_000),
          nextHourlySyncAt: new Date(now),
          nextAdsSyncAt: new Date(now + 1),
          nextAdsPulseAt: new Date(now - 1),
        },
        now
      )
    ).toEqual({ fast: false, hourly: true, ads: false, pulse: true });
  });
});

describe("resolveHubsellRole", () => {
  const prev = process.env.HUBSELL_ROLE;
  afterEach(() => {
    if (prev === undefined) delete process.env.HUBSELL_ROLE;
    else process.env.HUBSELL_ROLE = prev;
  });
  it("mặc định all; nhận web/worker; giá trị lạ → all", () => {
    delete process.env.HUBSELL_ROLE;
    expect(resolveHubsellRole()).toBe("all");
    process.env.HUBSELL_ROLE = " Worker ";
    expect(resolveHubsellRole()).toBe("worker");
    process.env.HUBSELL_ROLE = "web";
    expect(resolveHubsellRole()).toBe("web");
    process.env.HUBSELL_ROLE = "banana";
    expect(resolveHubsellRole()).toBe("all");
  });
});

describe("nextPulseDelayMin — hạn xung ads (tầng A)", () => {
  const base = { channelName: ChannelName.SHOPEE, adsReady: true, liveCampaigns: 3, spentRecently: true, foundNew: false };
  it("đang tiêu tiền → PULSE_MIN (Shopee 30')", () => {
    expect(nextPulseDelayMin(base)).toBe(ADS_CADENCE.PULSE_MIN);
  });
  it("Lazada đang tiêu tiền → PULSE_LAZADA_MIN (60' tới khi có quota)", () => {
    expect(nextPulseDelayMin({ ...base, channelName: ChannelName.LAZADA })).toBe(ADS_CADENCE.PULSE_LAZADA_MIN);
  });
  it("có campaign chạy nhưng 2 ngày không chi → giãn PULSE_IDLE_MIN", () => {
    expect(nextPulseDelayMin({ ...base, spentRecently: false })).toBe(ADS_CADENCE.PULSE_IDLE_MIN);
  });
  it("không campaign chạy, không thấy mới → xung nhẹ PULSE_NO_CAMPAIGN_MIN", () => {
    expect(nextPulseDelayMin({ ...base, liveCampaigns: 0, spentRecently: false })).toBe(ADS_CADENCE.PULSE_NO_CAMPAIGN_MIN);
  });
  it("vừa thấy campaign mới → về nhịp gốc ngay dù DB chưa có campaign chạy", () => {
    expect(nextPulseDelayMin({ ...base, liveCampaigns: 0, spentRecently: false, foundNew: true })).toBe(ADS_CADENCE.PULSE_MIN);
  });
  it("chưa ủy quyền Ads API → xung nhẹ, không gọi sàn", () => {
    expect(nextPulseDelayMin({ ...base, adsReady: false })).toBe(ADS_CADENCE.PULSE_NO_CAMPAIGN_MIN);
  });
});
