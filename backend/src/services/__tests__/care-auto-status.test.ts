// Hàm thuần của CRM tự chuyển trạng thái theo thuê bao (22/10/2026,
// services/care-auto-status.ts): luật ưu tiên tay/tự động, dữ liệu ghi, điều
// kiện lọc ứng viên rời bỏ. Không chạm DB.
import { describe, expect, it } from "vitest";
import { PlatformCareStatus, PlatformCareStatusSource } from "@prisma/client";
import {
  careAutoActiveData,
  careAutoChurnData,
  careChurnCandidatesWhere,
  shouldAutoChurn,
} from "../care-auto-status";
import { hibernationCutoff } from "../plan-hibernation";

const DAY_MS = 86_400_000;
const now = new Date("2026-10-22T03:00:00.000Z");
// Dùng thử kết thúc 20 ngày trước — đã quá ân hạn 7 ngày.
const periodEnd = new Date(now.getTime() - 20 * DAY_MS);

const snap = (
  status: PlatformCareStatus,
  statusSource: PlatformCareStatusSource,
  changedDaysAgo: number
) => ({ status, statusSource, statusChangedAt: new Date(now.getTime() - changedDaysAgo * DAY_MS) });

describe("shouldAutoChurn — luật 1: hết gói quá ân hạn → Đã rời bỏ", () => {
  it("chưa có hồ sơ (NEW ngầm định) → rời bỏ", () => {
    expect(shouldAutoChurn(null, periodEnd)).toBe(true);
  });

  it("đã CHURNED (tay hay tự động) → không đụng nữa, mỗi kỳ hết hạn chỉ bắn một lần", () => {
    expect(shouldAutoChurn(snap("CHURNED", "AUTO_EXPIRED", 1), periodEnd)).toBe(false);
    expect(shouldAutoChurn(snap("CHURNED", "MANUAL", 1), periodEnd)).toBe(false);
  });

  it("Sale đặt tay TRƯỚC khi kỳ hạn kết thúc (Đang tư vấn / Nguy cơ) → vẫn rời bỏ", () => {
    expect(shouldAutoChurn(snap("CONTACTED", "MANUAL", 30), periodEnd)).toBe(true);
    expect(shouldAutoChurn(snap("CHURN_RISK", "MANUAL", 25), periodEnd)).toBe(true);
  });

  it("Sale đặt tay SAU khi kỳ hạn kết thúc → giữ (đang kéo khách lại)", () => {
    expect(shouldAutoChurn(snap("CONTACTED", "MANUAL", 3), periodEnd)).toBe(false);
    expect(shouldAutoChurn(snap("ACTIVE", "MANUAL", 10), periodEnd)).toBe(false);
  });

  it("đặt tay ĐÚNG lúc kỳ hạn kết thúc không tính là sau (so bằng >)", () => {
    expect(
      shouldAutoChurn({ status: "CONTACTED", statusSource: "MANUAL", statusChangedAt: periodEnd }, periodEnd)
    ).toBe(true);
  });

  it("ACTIVE do thanh toán kỳ TRƯỚC (AUTO_PAYMENT) mà kỳ ấy nay hết hạn → rời bỏ (luật 3 đi vòng ngược)", () => {
    // Thanh toán ghi statusChangedAt = ngày thu tiền, luôn trước periodEnd của kỳ đó.
    expect(shouldAutoChurn(snap("ACTIVE", "AUTO_PAYMENT", 50), periodEnd)).toBe(true);
  });

  it("hồ sơ NEW tạo lười khi ghi chú (statusChangedAt = ngày đăng ký, nguồn tay) → vẫn rời bỏ", () => {
    // PATCH /care đặt statusChangedAt = user.createdAt khi hồ sơ mới mà trạng thái vẫn NEW.
    expect(shouldAutoChurn(snap("NEW", "MANUAL", 40), periodEnd)).toBe(true);
  });
});

describe("dữ liệu ghi", () => {
  it("thanh toán → ACTIVE, nguồn AUTO_PAYMENT, mốc = ngày thu tiền, xóa người cập nhật; KHÔNG đụng ghi chú/phụ trách", () => {
    const at = new Date("2026-10-21T10:00:00.000Z");
    const d = careAutoActiveData(at);
    expect(d).toEqual({
      status: PlatformCareStatus.ACTIVE,
      statusSource: PlatformCareStatusSource.AUTO_PAYMENT,
      statusChangedAt: at,
      updatedById: null,
    });
    expect("note" in d).toBe(false);
    expect("assigneeId" in d).toBe(false);
  });

  it("hết gói → CHURNED, nguồn AUTO_EXPIRED, mốc = lúc quét", () => {
    const d = careAutoChurnData(now);
    expect(d).toEqual({
      status: PlatformCareStatus.CHURNED,
      statusSource: PlatformCareStatusSource.AUTO_EXPIRED,
      statusChangedAt: now,
      updatedById: null,
    });
    expect("note" in d).toBe(false);
  });
});

describe("careChurnCandidatesWhere — cùng mốc ân hạn với ngủ đông gian", () => {
  it("kỳ hạn < hibernationCutoff (7 ngày), chủ không phải điều hành, hồ sơ chưa CHURNED hoặc chưa có", () => {
    const w = careChurnCandidatesWhere(now);
    expect(w.currentPeriodEnd).toEqual({ lt: hibernationCutoff(now) });
    expect(w.user).toEqual({
      isPlatformAdmin: false,
      OR: [{ careProfile: null }, { careProfile: { status: { not: PlatformCareStatus.CHURNED } } }],
    });
  });

  it("KHÔNG lọc isTrial hay status thuê bao — gói trả tiền hết hạn không gia hạn cũng là rời bỏ", () => {
    const w = careChurnCandidatesWhere(now);
    expect("isTrial" in w).toBe(false);
    expect("status" in w).toBe(false);
  });

  it("KHÔNG đòi có gian hàng (khác ngủ đông): khách đăng ký rồi bỏ, chưa nối gian nào, vẫn rời bỏ", () => {
    const w = careChurnCandidatesWhere(now);
    expect("channels" in (w.user as object)).toBe(false);
  });
});
