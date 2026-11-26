// ============================================================
// VIDEO ĐÓNG HÀNG — chặn gọi dồn trên đường nóng (M2.6): phép GCRA + sổ đếm + chế độ. Thuần, không database.
// ============================================================

import { describe, expect, it } from "vitest";
import { PACK_HOT_RATE } from "../../config/pack-video";
import { createPackRateLimiter, gcraAllow, packRateLimitMode } from "../pack-rate-limit";

const RULE = { perSec: 5, burst: 50 };

describe("GCRA", () => {
  it("cho dồn đúng `burst` lượt cùng một lúc, lượt kế bị chặn và nói phải chờ bao lâu", () => {
    let tat: number | undefined;
    for (let i = 0; i < 50; i++) {
      const v = gcraAllow(tat, 1_000, RULE);
      expect(v.ok, `lượt ${i + 1}`).toBe(true);
      tat = v.tatMs;
    }
    const blocked = gcraAllow(tat, 1_000, RULE);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(200); // 1 lượt / 200 ms
    // Bị chặn KHÔNG dời mốc: gọi dồn tiếp không tự phạt thêm.
    expect(blocked.tatMs).toBe(tat);
  });

  it("đều `perSec` lượt / giây thì không bao giờ bị chặn", () => {
    let tat: number | undefined;
    for (let i = 0; i < 1_000; i++) {
      const v = gcraAllow(tat, 1_000 + i * 200, RULE);
      expect(v.ok).toBe(true);
      tat = v.tatMs;
    }
  });

  it("nghỉ đủ lâu thì được dồn lại từ đầu", () => {
    let tat: number | undefined;
    for (let i = 0; i < 50; i++) tat = gcraAllow(tat, 0, RULE).tatMs;
    expect(gcraAllow(tat, 0, RULE).ok).toBe(false);
    expect(gcraAllow(tat, 200, RULE).ok).toBe(true); // nhả một lượt sau 200 ms
    let later = tat;
    for (let i = 0; i < 50; i++) {
      const v = gcraAllow(later, 60_000, RULE);
      expect(v.ok).toBe(true);
      later = v.tatMs;
    }
  });
});

describe("Sổ đếm theo tài khoản", () => {
  it("tài khoản gọi dồn bị chặn, tài khoản khác không bị vạ lây", () => {
    const lines: string[] = [];
    const limiter = createPackRateLimiter(RULE, (l) => lines.push(l));
    let blocked = 0;
    for (let i = 0; i < 300; i++) if (!limiter.take("may-hong", 10_000).ok) blocked += 1;
    expect(blocked).toBe(250);
    expect(limiter.take("may-binh-thuong", 10_000).ok).toBe(true);
    // Nhật ký: dòng đầu ghi ngay, rồi tối đa một dòng / phút — không ngập log.
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("may-hong");
    for (let i = 0; i < 100; i++) limiter.take("may-hong", 20_000);
    expect(lines.length).toBe(1);
    limiter.take("may-hong", 10_000 + 61_000);
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("1 tài khoản");
  });

  it("một bàn quay bình thường (1 clip / 40 giây = 3 lượt gọi) và 20 bàn chung một tài khoản đều không chạm hạn mức", () => {
    const limiter = createPackRateLimiter(PACK_HOT_RATE, () => {});
    let blocked = 0;
    // 20 bàn × 3 lượt mỗi 40 giây, chạy 1 giờ; các bàn lệch nhau 2 giây.
    for (let t = 0; t < 3_600_000; t += 40_000) {
      for (let table = 0; table < 20; table++) {
        for (let call = 0; call < 3; call++) if (!limiter.take("tai-khoan-chung", t + table * 2_000 + call * 300).ok) blocked += 1;
      }
    }
    expect(blocked).toBe(0);
    expect(limiter.pendingOver()).toBe(0);
  });
});

describe("Chế độ", () => {
  it("mặc định CHẠY BÓNG; chỉ `on` mới chặn thật", () => {
    expect(packRateLimitMode({})).toBe("shadow");
    expect(packRateLimitMode({ PACK_RATE_LIMIT: "shadow" })).toBe("shadow");
    expect(packRateLimitMode({ PACK_RATE_LIMIT: "linh-tinh" })).toBe("shadow");
    expect(packRateLimitMode({ PACK_RATE_LIMIT: " ON " })).toBe("on");
    expect(packRateLimitMode({ PACK_RATE_LIMIT: "off" })).toBe("off");
  });
});
