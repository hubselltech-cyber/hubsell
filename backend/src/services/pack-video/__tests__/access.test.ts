// CỔNG MỞ Video đóng hàng — anh Trung 16/11/2026: "chỉ mở cho một mình tài khoản admin@hubsell.vn".
// 24/11/2026: nhân viên của chủ đã mở vào được theo quyền CÓ SẴN (Đơn hàng → quay đóng; Đối soát đơn hoàn →
// quay khui; không bao giờ có việc của chủ). Các ca khóa: chủ thường · nhân viên thiếu quyền · nhân viên của chủ
// thường · thiếu kho.
import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";

// Cửa tính năng gọi việc tặng giờ quay (21/11/2026). Tệp này là test THUẦN, không chạm database → thay bằng hàm giả.
const { ensureWelcomeHours } = vi.hoisted(() => ({ ensureWelcomeHours: vi.fn(async (_ownerId: string) => false) }));
vi.mock("../hours", () => ({ ensureWelcomeHours }));

// Nhân viên → middleware tra email CHỦ shop trong database; test thuần thay bằng hàm giả (mặc định: không ra ai).
const { ownerEmailOf } = vi.hoisted(() => ({
  ownerEmailOf: vi.fn(async (_ownerId: string): Promise<string | null> => null),
}));
vi.mock("../subject", async () => {
  const { packVideoCaps } = await import("../access");
  return {
    capsForUser: async (u: { id: string; email: string | null; ownerId: string | null; permissions?: string[] }) => {
      const staffOwner = u.ownerId && u.ownerId !== u.id ? u.ownerId : null;
      return packVideoCaps({
        ownerEmail: staffOwner ? await ownerEmailOf(staffOwner) : u.email,
        isStaff: staffOwner !== null,
        permissions: u.permissions,
      });
    },
  };
});

import { PACK_VIDEO_PILOT_EMAILS } from "../../../config/pack-video";
import type { AuthRequest } from "../../../middleware/auth";
import { requirePackVideo } from "../../../middleware/require-pack-video";
import { isR2Configured, r2ConfigFromEnv } from "../../../integrations/r2/client";
import { featuresOf, packVideoAccess, packVideoCaps } from "../access";

const R2_ENV = {
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  R2_BUCKET: "b",
  R2_ACCESS_KEY_ID: "k",
  R2_SECRET_ACCESS_KEY: "s",
};

describe("packVideoCaps — cổng theo email CHỦ shop + quyền có sẵn của nhân viên", () => {
  const on = { r2Configured: true };
  const owner = (ownerEmail: string | null) => ({ ownerEmail, isStaff: false });
  const staff = (permissions: string[], ownerEmail: string | null = "admin@hubsell.vn") => ({
    ownerEmail,
    isStaff: true,
    permissions,
  });
  const ALL = { pack: true, unbox: true, manage: true };
  const NONE = { pack: false, unbox: false, manage: false };

  it("danh sách thí điểm đúng một tài khoản", () => {
    expect(PACK_VIDEO_PILOT_EMAILS).toEqual(["admin@hubsell.vn"]);
  });

  it("chủ thí điểm + kho đã cấu hình → toàn quyền (không phân biệt hoa thường, khoảng trắng)", () => {
    expect(packVideoCaps(owner("admin@hubsell.vn"), on)).toEqual(ALL);
    expect(packVideoCaps(owner("  Admin@Hubsell.VN "), on)).toEqual(ALL);
    expect(packVideoAccess(owner("admin@hubsell.vn"), on)).toBe("open");
  });

  it("ca khóa 1 — chủ tài khoản thường / email giả dạng / không có email", () => {
    for (const e of ["khach@shop.vn", "admin@hubsell.vn.evil.com", "xadmin@hubsell.vn", "", null]) {
      expect(packVideoCaps(owner(e), on), String(e)).toEqual(NONE);
      expect(packVideoAccess(owner(e), on)).toBe("locked");
    }
  });

  it("nhân viên của chủ thí điểm: Đơn hàng → quay đóng; Đối soát đơn hoàn → quay khui; không bao giờ manage", () => {
    expect(packVideoCaps(staff(["orders"]), on)).toEqual({ pack: true, unbox: false, manage: false });
    expect(packVideoCaps(staff(["warehouse.returns"]), on)).toEqual({ pack: false, unbox: true, manage: false });
    expect(packVideoCaps(staff(["orders", "warehouse.returns"]), on)).toEqual({
      pack: true,
      unbox: true,
      manage: false,
    });
  });

  it("ca khóa 2 — nhân viên không có hai quyền đó (kể cả các quyền kho khác)", () => {
    for (const perms of [[], ["dashboard"], ["warehouse.products", "warehouse.shipping-alerts"], ["finance.analytics"]]) {
      expect(packVideoCaps(staff(perms), on), perms.join(",")).toEqual(NONE);
      expect(packVideoAccess(staff(perms), on)).toBe("locked");
    }
  });

  it("ca khóa 3 — nhân viên của chủ KHÔNG thí điểm (dù đủ quyền), hoặc tra không ra email chủ", () => {
    expect(packVideoCaps(staff(["orders", "warehouse.returns"], "khach@shop.vn"), on)).toEqual(NONE);
    expect(packVideoCaps(staff(["orders", "warehouse.returns"], null), on)).toEqual(NONE);
  });

  it("ca khóa 4 — kho R2 chưa cấu hình (hỏng thì ĐÓNG), cả chủ lẫn nhân viên", () => {
    const off = { r2Configured: false };
    expect(packVideoCaps(owner("admin@hubsell.vn"), off)).toEqual(NONE);
    expect(packVideoCaps(staff(["orders"]), off)).toEqual(NONE);
  });

  it("danh sách thí điểm rỗng = tắt cho mọi người", () => {
    expect(packVideoCaps(owner("admin@hubsell.vn"), { ...on, pilotEmails: [] })).toEqual(NONE);
    expect(packVideoCaps(staff(["orders"]), { ...on, pilotEmails: [] })).toEqual(NONE);
  });

  it("featuresOf trả đúng khối features", () => {
    expect(featuresOf(owner("khach@shop.vn"), on)).toEqual({ packVideo: "locked", packVideoCaps: NONE });
    expect(featuresOf(owner("admin@hubsell.vn"), on)).toEqual({ packVideo: "open", packVideoCaps: ALL });
    expect(featuresOf(staff(["orders"]), on)).toEqual({
      packVideo: "open",
      packVideoCaps: { pack: true, unbox: false, manage: false },
    });
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
    void requirePackVideo(req as AuthRequest, res, () => {
      passed = true;
    });
    // Bộ đọc (không chụp giá trị): cổng tra quyền + tặng giờ là việc bất đồng bộ, kết quả tới SAU lúc hàm này trả về.
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

  // Giữ biến R2 trong suốt lượt chạy bất đồng bộ của middleware → đặt / trả lại bằng tay quanh cả ca test.
  async function withR2<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const saved = Object.fromEntries(Object.keys(R2_ENV).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return await fn();
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
    await withR2(R2_ENV, async () => {
      const r = run({ userId: "u1", ownerId: "u1", userEmail: "admin@hubsell.vn" });
      await vi.waitFor(() => expect(r.passed).toBe(true));
    });
    expect(ensureWelcomeHours).toHaveBeenCalledExactlyOnceWith("u1");
  });

  it("tặng giờ hỏng (database trục trặc) KHÔNG chặn request", async () => {
    ensureWelcomeHours.mockRejectedValueOnce(new Error("mất kết nối"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await withR2(R2_ENV, async () => {
        const r = run({ userId: "u1", ownerId: "u1", userEmail: "admin@hubsell.vn" });
        await vi.waitFor(() => expect(r.passed).toBe(true));
        expect(r.status).toBe(200);
      });
      expect(logged).toHaveBeenCalledOnce();
    } finally {
      logged.mockRestore();
    }
  });

  it("tài khoản thường → 403 FEATURE_LOCKED, không tặng giờ", async () => {
    ensureWelcomeHours.mockClear();
    await withR2(R2_ENV, async () => {
      const r = run({ userId: "u2", ownerId: "u2", userEmail: "khach@shop.vn" });
      await vi.waitFor(() => expect(r.status).toBe(403));
      expect(r.passed).toBe(false);
      expect(r.body).toEqual(LOCKED);
    });
    expect(ensureWelcomeHours).not.toHaveBeenCalled();
  });

  it("nhân viên thí điểm có quyền Đơn hàng → đi tiếp với quyền quay đóng; giờ tặng ghi cho CHỦ", async () => {
    ensureWelcomeHours.mockClear();
    ownerEmailOf.mockResolvedValueOnce("admin@hubsell.vn");
    const req: Partial<AuthRequest> = { userId: "nv1", ownerId: "u1", userEmail: "nv@shop.vn", permissions: ["orders"] };
    await withR2(R2_ENV, async () => {
      const r = run(req);
      await vi.waitFor(() => expect(r.passed).toBe(true));
    });
    expect(ownerEmailOf).toHaveBeenCalledWith("u1");
    expect((req as { packVideoCaps?: unknown }).packVideoCaps).toEqual({ pack: true, unbox: false, manage: false });
    expect(ensureWelcomeHours).toHaveBeenCalledExactlyOnceWith("u1");
  });

  it("nhân viên thí điểm thiếu quyền Đơn hàng / Đối soát đơn hoàn → 403, kể cả khi email trùng email thí điểm", async () => {
    ownerEmailOf.mockResolvedValueOnce("admin@hubsell.vn");
    await withR2(R2_ENV, async () => {
      const r = run({ userId: "nv1", ownerId: "u1", userEmail: "admin@hubsell.vn", permissions: ["warehouse.products"] });
      await vi.waitFor(() => expect(r.status).toBe(403));
      expect(r.passed).toBe(false);
      expect(r.body).toEqual(LOCKED);
    });
  });

  it("nhân viên của chủ thường (dù email nhân viên trùng email thí điểm) → 403", async () => {
    ownerEmailOf.mockResolvedValueOnce("khach@shop.vn");
    await withR2(R2_ENV, async () => {
      const r = run({ userId: "nv1", ownerId: "u9", userEmail: "admin@hubsell.vn", permissions: ["orders"] });
      await vi.waitFor(() => expect(r.status).toBe(403));
      expect(r.body).toEqual(LOCKED);
    });
  });

  it("tài khoản thí điểm khi thiếu một biến R2 → 403", async () => {
    await withR2({ ...R2_ENV, R2_SECRET_ACCESS_KEY: undefined }, async () => {
      const r = run({ userId: "u1", ownerId: "u1", userEmail: "admin@hubsell.vn" });
      await vi.waitFor(() => expect(r.status).toBe(403));
      expect(r.passed).toBe(false);
      expect(r.body).toEqual(LOCKED);
    });
  });
});
