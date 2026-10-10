// Tự trả lời đánh giá — phần thuần (services/review-auto-reply.ts, 10/10/2026).
import { describe, expect, it } from "vitest";
import {
  DAILY_WINDOW,
  DEFAULT_REPLY_TEMPLATES,
  isEnabledRating,
  nextDailySlot,
  normalizeStars,
  normalizeTemplates,
  pickReply,
  scheduleAfterConfigChange,
  templatesForStorage,
  toConfigDTO,
} from "../review-auto-reply";

const vn = (d: Date) => new Date(d.getTime() + 7 * 3600_000);
const vnDate = (d: Date) => vn(d).toISOString().slice(0, 10);
const vnMinuteOfDay = (d: Date) => vn(d).getUTCHours() * 60 + vn(d).getUTCMinutes();

describe("nextDailySlot — mỗi shop 1 lần/ngày, khung 08:00–20:00 VN", () => {
  it("luôn là NGÀY MAI theo giờ VN, kể cả chạy lúc 00:30 VN", () => {
    const now = new Date("2026-10-09T17:30:00Z"); // 00:30 VN 10/10
    expect(vnDate(nextDailySlot(now, "owner-a"))).toBe("2026-10-11");
  });
  it("nằm trong khung 08:00 → 20:00 VN", () => {
    for (const id of ["a", "owner-1", "cm1x2y3z4", "zzzzzzzzzzzzzzzz"]) {
      const m = vnMinuteOfDay(nextDailySlot(new Date("2026-10-10T03:00:00Z"), id));
      expect(m).toBeGreaterThanOrEqual(DAILY_WINDOW.startHour * 60);
      expect(m).toBeLessThan(DAILY_WINDOW.startHour * 60 + DAILY_WINDOW.spreadMin);
    }
  });
  it("cùng shop thì cùng giờ mỗi ngày", () => {
    const a = nextDailySlot(new Date("2026-10-10T03:00:00Z"), "owner-x");
    const b = nextDailySlot(new Date("2026-10-11T10:00:00Z"), "owner-x");
    expect(vnMinuteOfDay(a)).toBe(vnMinuteOfDay(b));
    expect(b.getTime() - a.getTime()).toBe(86_400_000);
  });
  it("nhiều shop rải ra nhiều phút khác nhau, không dồn một mốc", () => {
    const now = new Date("2026-10-10T03:00:00Z");
    const minutes = new Set(
      Array.from({ length: 200 }, (_, i) => vnMinuteOfDay(nextDailySlot(now, `owner-${i}`)))
    );
    expect(minutes.size).toBeGreaterThan(150);
  });
});

describe("normalizeStars / normalizeTemplates", () => {
  it("lọc mức sao lạ, khử trùng, sắp tăng dần", () => {
    expect(normalizeStars([5, "4", 4, 0, 6, 2.5, null, "x"])).toEqual([4, 5]);
    expect(normalizeStars("5")).toEqual([]);
  });
  it("mức thiếu/rỗng sạch đắp mặc định, mức có nội dung giữ nguyên (tối đa 5 mẫu)", () => {
    const t = normalizeTemplates({
      "5": ["a", "b", "c", "d", "e", "f"],
      "4": ["", "  "],
      "3": "không phải mảng",
    });
    expect(t["5"]).toEqual(["a", "b", "c", "d", "e"]);
    expect(t["4"]).toEqual(DEFAULT_REPLY_TEMPLATES["4"]);
    expect(t["3"]).toEqual(DEFAULT_REPLY_TEMPLATES["3"]);
    expect(t["1"]).toEqual(DEFAULT_REPLY_TEMPLATES["1"]);
  });
  it("null → toàn bộ mặc định", () => {
    expect(normalizeTemplates(null)).toEqual(DEFAULT_REPLY_TEMPLATES);
  });
});

describe("pickReply", () => {
  const vars = { customer: "Người mua Lazada", shopName: "ANO", productName: "Áo thun" };
  it("thay biến, khách ẩn danh thành 'bạn'", () => {
    const t = { ...DEFAULT_REPLY_TEMPLATES, "5": ["Cảm ơn {TEN_KHACH} mua {SAN_PHAM} ở {TEN_SHOP} $&"] };
    expect(pickReply(t, 5, vars, () => 0)).toBe("Cảm ơn bạn mua Áo thun ở ANO $&");
  });
  it("mức không còn mẫu → null", () => {
    const t = { ...DEFAULT_REPLY_TEMPLATES, "1": ["", " "] };
    expect(pickReply(t, 1, vars)).toBeNull();
  });
  it("rand = 1 không vượt mảng", () => {
    expect(pickReply(DEFAULT_REPLY_TEMPLATES, 5, vars, () => 1)).toBeTruthy();
  });
  it("cắt 500 ký tự (trần trả lời Lazada)", () => {
    const t = { ...DEFAULT_REPLY_TEMPLATES, "5": ["x".repeat(800)] };
    expect(pickReply(t, 5, vars)!.length).toBe(500);
  });
});

describe("scheduleAfterConfigChange", () => {
  const now = new Date("2026-10-10T05:00:00Z");
  const later = new Date("2026-10-11T02:00:00Z");
  it("tắt hết → bỏ lịch", () => {
    expect(scheduleAfterConfigChange([5], later, [], now)).toBeNull();
  });
  it("vừa bật từ trạng thái tắt → chạy ngay lượt quét kế", () => {
    expect(scheduleAfterConfigChange([], null, [5], now)).toBe(now);
  });
  it("đang bật, đổi mức → giữ lịch cũ (không chạy hai lần trong ngày)", () => {
    expect(scheduleAfterConfigChange([5], later, [4, 5], now)).toBe(later);
  });
});

describe("toConfigDTO", () => {
  it("chưa có dòng → saved false, tắt hết, mẫu mặc định", () => {
    const d = toConfigDTO(null);
    expect(d.saved).toBe(false);
    expect(d.enabledStars).toEqual([]);
    expect(d.templates).toEqual(DEFAULT_REPLY_TEMPLATES);
    expect(d.dueNow).toBe(false);
  });
});

describe("isEnabledRating", () => {
  it("chỉ mức đang bật; số sao 0/thiếu thì bỏ qua (không coi là 5 sao)", () => {
    const on = new Set([5]);
    expect(isEnabledRating(5, on)).toBe(true);
    expect(isEnabledRating(4, on)).toBe(false);
    expect(isEnabledRating(0, on)).toBe(false);
    expect(isEnabledRating(NaN, on)).toBe(false);
    expect(isEnabledRating(4.6, on)).toBe(true);
  });
});

describe("templatesForStorage", () => {
  it("trùng mặc định → null (không lưu ~5 KB JSON/shop)", () => {
    expect(templatesForStorage(DEFAULT_REPLY_TEMPLATES)).toBeNull();
    expect(templatesForStorage({ "4": [] })).toBeNull();
  });
  it("có sửa → lưu bản đã chuẩn hóa", () => {
    const t = templatesForStorage({ "5": ["Cảm ơn {TEN_KHACH}"] });
    expect(t?.["5"]).toEqual(["Cảm ơn {TEN_KHACH}"]);
    expect(t?.["1"]).toEqual(DEFAULT_REPLY_TEMPLATES["1"]);
  });
});
