// ============================================================
// CỘNG TÁC VIÊN ĐẶC BIỆT (07/11/2026): % hoa hồng hiệu lực theo khoảng thời
// gian — hàm thuần resolveCommissionPercent / isPartnerRateActive trong
// services/referral-wallet.ts. Luật anh Trung chốt: mọi tài khoản 10% vĩnh
// viễn; mức riêng chỉ áp TRONG [startsAt, endsAt); ngoài khoảng về 10%.
// ============================================================

import "../../integrations/__tests__/load-env";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMISSION_PERCENT,
  isPartnerRateActive,
  resolveCommissionPercent,
} from "../referral-wallet";

const d = (s: string) => new Date(s);

describe("resolveCommissionPercent — % hiệu lực của người giới thiệu", () => {
  it("không có dòng CTV đặc biệt → 10% mặc định", () => {
    expect(resolveCommissionPercent(null)).toBe(DEFAULT_COMMISSION_PERCENT);
    expect(resolveCommissionPercent(undefined)).toBe(10);
  });

  it("đang trong khoảng → dùng % riêng (nâng)", () => {
    const partner = { commissionPercent: 25, startsAt: d("2026-11-01"), endsAt: d("2027-11-01") };
    expect(resolveCommissionPercent(partner, d("2026-11-07"))).toBe(25);
    expect(isPartnerRateActive(partner, d("2026-11-07"))).toBe(true);
  });

  it("HQ cố tình HẠ dưới 10% vẫn áp đúng mức đã đặt (kể cả 0%)", () => {
    const partner = { commissionPercent: 5, startsAt: d("2026-11-01"), endsAt: null };
    expect(resolveCommissionPercent(partner, d("2026-12-01"))).toBe(5);
    expect(
      resolveCommissionPercent({ ...partner, commissionPercent: 0 }, d("2026-12-01"))
    ).toBe(0);
  });

  it("chưa tới ngày bắt đầu → 10%", () => {
    const partner = { commissionPercent: 30, startsAt: d("2026-12-01"), endsAt: null };
    expect(resolveCommissionPercent(partner, d("2026-11-30T23:59:59"))).toBe(10);
    expect(isPartnerRateActive(partner, d("2026-11-30"))).toBe(false);
  });

  it("đúng mốc bắt đầu thì đã áp; đúng mốc hết hạn thì đã về 10% (nửa mở)", () => {
    const partner = { commissionPercent: 30, startsAt: d("2026-12-01"), endsAt: d("2027-01-01") };
    expect(resolveCommissionPercent(partner, d("2026-12-01"))).toBe(30);
    expect(resolveCommissionPercent(partner, d("2026-12-31T23:59:59"))).toBe(30);
    expect(resolveCommissionPercent(partner, d("2027-01-01"))).toBe(10);
  });

  it("không thời hạn (endsAt null) → áp mãi từ ngày bắt đầu", () => {
    const partner = { commissionPercent: 20, startsAt: d("2026-01-01"), endsAt: null };
    expect(resolveCommissionPercent(partner, d("2030-01-01"))).toBe(20);
  });

  it("% hỏng (NaN / âm) → không làm vỡ hoa hồng, về 10%", () => {
    const base = { startsAt: d("2026-01-01"), endsAt: null };
    expect(resolveCommissionPercent({ ...base, commissionPercent: Number.NaN })).toBe(10);
    expect(resolveCommissionPercent({ ...base, commissionPercent: -5 })).toBe(10);
  });

  it("tiền hoa hồng = làm tròn (số tiền × % / 100) — khớp cách creditReferralCommission tính", () => {
    const percent = resolveCommissionPercent({
      commissionPercent: 12.5,
      startsAt: d("2026-01-01"),
      endsAt: null,
    });
    expect(Math.round((1_999_000 * percent) / 100)).toBe(249_875);
  });
});
