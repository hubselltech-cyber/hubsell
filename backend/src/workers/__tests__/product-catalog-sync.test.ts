// Lịch kéo danh mục sản phẩm — phần thuần (workers/product-catalog-sync.ts, 28/09/2026).
import { describe, expect, it } from "vitest";
import { nextNightlySlot, NIGHTLY_WINDOW } from "../product-catalog-sync";

const vnHour = (d: Date) => new Date(d.getTime() + 7 * 3600_000).getUTCHours();
const vnMin = (d: Date) => new Date(d.getTime() + 7 * 3600_000).getUTCMinutes();
const vnDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

describe("nextNightlySlot — đêm sau 03:00 giờ VN, rải 120'", () => {
  it("kéo xong 22:50 VN → 03:00 ngày mai (rand 0)", () => {
    const now = new Date("2026-09-28T15:50:00Z"); // 22:50 VN
    const slot = nextNightlySlot(now, 0);
    expect(vnDate(slot)).toBe("2026-09-29");
    expect(vnHour(slot)).toBe(NIGHTLY_WINDOW.startHour);
    expect(vnMin(slot)).toBe(0);
  });
  it("kéo xong 01:00 VN vẫn là 03:00 NGÀY MAI, không phải 2 tiếng nữa", () => {
    const now = new Date("2026-09-28T18:00:00Z"); // 01:00 VN 29/09
    const slot = nextNightlySlot(now, 0);
    expect(vnDate(slot)).toBe("2026-09-30");
    expect(vnHour(slot)).toBe(3);
  });
  it("rand rải trong [03:00, 05:00)", () => {
    const now = new Date("2026-09-28T10:00:00Z");
    const early = nextNightlySlot(now, 0);
    const late = nextNightlySlot(now, 0.999);
    expect(vnHour(early)).toBe(3);
    expect(vnHour(late)).toBe(4);
    expect(vnMin(late)).toBe(59);
    expect(late.getTime() - early.getTime()).toBeLessThan(NIGHTLY_WINDOW.spreadMin * 60_000);
  });
  it("rand ngoài [0,1) bị kẹp", () => {
    const now = new Date("2026-09-28T10:00:00Z");
    expect(vnHour(nextNightlySlot(now, -5))).toBe(3);
    expect(vnHour(nextNightlySlot(now, 7))).toBe(4);
  });
});
