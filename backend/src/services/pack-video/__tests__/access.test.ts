// CỔNG MỞ Video đóng hàng — anh Trung 16/11/2026: "chỉ mở cho một mình tài khoản admin@hubsell.vn".
// Ba ca bị khóa (rào S2): tài khoản thường · nhân viên của tài khoản thí điểm · thí điểm khi thiếu kho.
import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";

// Cửa tính năng gọi việc tặng giờ quay (21/11/2026). Tệp này là test THUẦN, không chạm database → thay bằng hàm giả.
const { ensureWelcomeHours } = vi.hoisted(() => ({ ensureWelcomeHours: vi.fn(async (_ownerId: string) => false) }));
vi.mock("../hours", () => ({ ensureWelcomeHours }));

import { PACK_VIDEO_PILOT_EMAILS } from "../../../config/pack-video";
import type { AuthRequest } from "../../../middleware/auth";
import { requirePackVideo } from "../../../middleware/require-pack-video";
import { isR2Configured, r2ConfigFromEnv } from "../../../integrations/r2/client";
import { packVideoAccess, userFeatures } from "../access";

const R2_ENV = {
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  R2_BUCKET: "b",
  R2_ACCESS_KEY_ID: "k",
  R2_SECRET_ACCESS_KEY: "s",
};

describe("packVideoAccess", () => {
  const on = { r2Configured: true };

  it("danh sách thí điểm đúng một tài khoản", () => {
    expect(PACK_VIDEO_PILOT_EMAILS).toEqual(["admin@hubsell.vn"]);
  });

  it("chủ tài khoản thí điểm + kho đã cấu hình → open (không phân biệt hoa thường, khoảng trắng)", () => {
    expect(packVideoAccess({ email: "admin@hubsell.vn", ownerId: null }, on)).toBe("open");
    expect(packVideoAccess({ email: "  Admin@Hubsell.VN ", ownerId: undefined }, on)).toBe("open");
  });

  it("ca khóa 1 — tài khoản thường", () => {
    expect(packVideoAccess({ email: "khach@shop.vn", ownerId: null }, on)).toBe("locked");
    expect(packVideoAccess({ email: "admin@hubsell.vn.evil.com", ownerId: null }, on)).toBe("locked");
    expect(packVideoAccess({ email: "xadmin@hubsell.vn", ownerId: null }, on)).toBe("locked");
    expect(packVideoAccess({ email: null, ownerId: null }, on)).toBe("locked");
    expect(packVideoAccess({ email: "", ownerId: null }, on)).toBe("locked");
  });

  it("ca khóa 2 — NHÂN VIÊN của tài khoản thí điểm (kể cả khi trùng email thí điểm)", () => {
    expect(packVideoAccess({ email: "nv@hubsell.vn", ownerId: "owner-id" }, on)).toBe("locked");
    expect(packVideoAccess({ email: "admin@hubsell.vn", ownerId: "owner-id" }, on)).toBe("locked");
  });

  it("ca khóa 3 — tài khoản thí điểm nhưng kho R2 chưa cấu hình (hỏng thì ĐÓNG)", () => {
    expect(packVideoAccess({ email: "admin@hubsell.vn", ownerId: null }, { r2Configured: false })).toBe("locked");
  });

  it("danh sách thí điểm rỗng = tắt cho mọi người", () => {
    expect(packVideoAccess({ email: "admin@hubsell.vn", ownerId: null }, { ...on, pilotEmails: [] })).toBe("locked");
  });

  it("userFeatures trả đúng khối features", () => {
    expect(userFeatures({ email: "khach@shop.vn", ownerId: null })).toEqual({ packVideo: "locked" });
  });
});

describe("cấu hình R2 từ biến môi trường", () => {
  it("đủ bốn biến mới tính là đã cấu hình; thiếu / rỗng một biến là chưa", () => {
    expect(isR2Configured(R2_ENV)).toBe(true);
    expect(r2ConfigFromEnv(R2_ENV)?.bucket).toBe("b");
    for (const k of Object.keys(R2_ENV) as (keyof typeof R2_ENV)[]) {
      expect(isR2Configured({ ...R2_ENV, [k]: undefined })).toBe(false);
      expect(isR2Configured({ ...R2_ENV, [k]: "   " })).toBe(false);
    }
  });
});

describe("middleware requirePackVideo", () => {
  function run(req: Partial<AuthRequest>) {
    let status = 200;
    let body: unknown = null;
    let passed = false;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(b: unknown) {
        body = b;
        return this;
      },
    } as unknown as Response;
    requirePackVideo(req as AuthRequest, res, () => {
      passed = true;
    });
    // Bộ đọc (không chụp giá trị): cửa mở thì `next` chạy SAU khi việc tặng giờ xong, tức sau lúc hàm này trả về.
    return {
      get status() {
        return status;
      },
      get body() {
        return body;
      },
      get passed() {
        return passed;
      },
    };
  }

  function withR2<T>(env: Record<string, string | undefined>, fn: () => T): T {
    const saved = Object.fromEntries(Object.keys(R2_ENV).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  const LOCKED = { error: expect.any(String), code: "FEATURE_LOCKED" };

  it("chủ tài khoản thí điểm đi tiếp — SAU khi đã bảo đảm giờ quay tặng cho chủ shop", async () => {
    ensureWelcomeHours.mockClear();
    const r = withR2(R2_ENV, () => run({ userId: "u1", ownerId: "u1", userEmail: "admin@hubsell.vn" }));
    await vi.waitFor(() => expect(r.passed).toBe(true));
    expect(ensureWelcomeHours).toHaveBeenCalledExactlyOnceWith("u1");
  });

  it("tặng giờ hỏng (database trục trặc) KHÔNG chặn request", async () => {
    ensureWelcomeHours.mockRejectedValueOnce(new Error("mất kết nối"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = withR2(R2_ENV, () => run({ userId: "u1", ownerId: "u1", userEmail: "admin@hubsell.vn" }));
      await vi.waitFor(() => expect(r.passed).toBe(true));
      expect(r.status).toBe(200);
      expect(logged).toHaveBeenCalledOnce();
    } finally {
      logged.mockRestore();
    }
  });

  it("tài khoản thường → 403 FEATURE_LOCKED, không tặng giờ", () => {
    ensureWelcomeHours.mockClear();
    const r = withR2(R2_ENV, () => run({ userId: "u2", ownerId: "u2", userEmail: "khach@shop.vn" }));
    expect([r.passed, r.status]).toEqual([false, 403]);
    expect(r.body).toEqual(LOCKED);
    expect(ensureWelcomeHours).not.toHaveBeenCalled();
  });

  it("nhân viên của tài khoản thí điểm → 403 (ownerId khác userId)", () => {
    const r = withR2(R2_ENV, () => run({ userId: "nv1", ownerId: "u1", userEmail: "admin@hubsell.vn" }));
    expect([r.passed, r.status]).toEqual([false, 403]);
    expect(r.body).toEqual(LOCKED);
  });

  it("tài khoản thí điểm khi thiếu một biến R2 → 403", () => {
    const r = withR2({ ...R2_ENV, R2_SECRET_ACCESS_KEY: undefined }, () =>
      run({ userId: "u1", ownerId: "u1", userEmail: "admin@hubsell.vn" })
    );
    expect([r.passed, r.status]).toEqual([false, 403]);
    expect(r.body).toEqual(LOCKED);
  });
});
