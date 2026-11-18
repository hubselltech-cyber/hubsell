// ============================================================
// VIDEO ĐÓNG HÀNG — cổng ở TẦNG HTTP (rào S2): cả nhóm /api/pack-videos phải bị chặn với tài khoản
// chưa mở, và `features.packVideo` trong /api/auth/me phải nói đúng điều middleware làm.
// Chạy app Express thật trên cổng ngẫu nhiên; không gọi R2. Không nối được DB → cả file tự BỎ QUA.
// ============================================================

import "../../integrations/__tests__/load-env";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { createApp } from "../../app";
import { PACK_VIDEO_PILOT_EMAILS } from "../../config/pack-video";
import { isR2Configured } from "../../integrations/r2/client";
import { prisma } from "../../lib/prisma";
import { signToken } from "../../middleware/auth";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "pack_videos" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `pvh-${Date.now()}`;

/** Mọi đường của nhóm — thêm đường mới vào routes/pack-videos.ts thì thêm vào đây. */
const ROUTES: [method: "GET" | "POST", path: string][] = [
  ["POST", "/"],
  ["POST", "/order-flags"],
  ["POST", "/abc123/parts"],
  ["POST", "/abc123/complete"],
  ["GET", "/"],
  ["GET", "/summary"],
  ["GET", "/returns"],
  ["GET", "/stats"],
  ["GET", "/by-order/abc123"],
  ["GET", "/abc123/url"],
];

describe.skipIf(!dbReady)("Video đóng hàng — cổng ở tầng HTTP", () => {
  let server: Server;
  let baseUrl = "";
  let normalId = "";
  let staffId = "";
  let pilotId: string | null = null;

  async function call(userId: string | null, method: string, path: string) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(userId ? { authorization: `Bearer ${signToken(userId)}` } : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = createApp().listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    normalId = (
      await prisma.user.create({
        data: { email: `${TAG}@test.local`, passwordHash: "x", fullName: TAG },
        select: { id: true },
      })
    ).id;
    const pilot = await prisma.user.findFirst({
      where: { email: PACK_VIDEO_PILOT_EMAILS[0], ownerId: null, deletedAt: null },
      select: { id: true },
    });
    pilotId = pilot?.id ?? null;
    if (pilotId) {
      staffId = (
        await prisma.user.create({
          data: {
            email: `${TAG}-nv@test.local`,
            passwordHash: "x",
            fullName: `${TAG} nhân viên`,
            role: Role.SALES,
            ownerId: pilotId,
            permissions: ["orders", "warehouse.returns"],
          },
          select: { id: true },
        })
      ).id;
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [normalId, staffId].filter(Boolean) } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("chưa đăng nhập → 401 ở mọi đường", async () => {
    for (const [method, path] of ROUTES) {
      expect((await call(null, method, `/api/pack-videos${path}`)).status, `${method} ${path}`).toBe(401);
    }
  });

  it("tài khoản thường → 403 FEATURE_LOCKED ở mọi đường", async () => {
    for (const [method, path] of ROUTES) {
      const r = await call(normalId, method, `/api/pack-videos${path}`);
      expect([r.status, r.body?.code], `${method} ${path}`).toEqual([403, "FEATURE_LOCKED"]);
    }
  });

  it("nhân viên của tài khoản thí điểm (có quyền Đơn hàng) → vẫn 403 FEATURE_LOCKED ở mọi đường", async (ctx) => {
    if (!pilotId) return ctx.skip();
    for (const [method, path] of ROUTES) {
      const r = await call(staffId, method, `/api/pack-videos${path}`);
      expect([r.status, r.body?.code], `${method} ${path}`).toEqual([403, "FEATURE_LOCKED"]);
    }
  });

  it("/api/auth/me báo features.packVideo = locked cho tài khoản thường và nhân viên", async (ctx) => {
    const me = await call(normalId, "GET", "/api/auth/me");
    expect((me.body?.user as { features?: unknown }).features).toEqual({ packVideo: "locked" });
    if (!pilotId) return ctx.skip();
    const staff = await call(staffId, "GET", "/api/auth/me");
    expect((staff.body?.user as { features?: unknown }).features).toEqual({ packVideo: "locked" });
  });

  it("tài khoản thí điểm: /me và middleware nói CÙNG một điều (mở khi kho đã cấu hình, khóa khi chưa)", async (ctx) => {
    if (!pilotId) return ctx.skip();
    const expected = isR2Configured() ? "open" : "locked";
    const me = await call(pilotId, "GET", "/api/auth/me");
    expect((me.body?.user as { features?: unknown }).features).toEqual({ packVideo: expected });
    const summary = await call(pilotId, "GET", "/api/pack-videos/summary");
    expect(summary.status).toBe(expected === "open" ? 200 : 403);
    if (expected === "open") {
      expect(Object.keys(summary.body ?? {}).sort()).toEqual(["all", "expiring", "pending", "returns", "unmatched"]);
      // Thân sai → 400 có lời, không phải 500.
      const bad = await call(pilotId, "POST", "/api/pack-videos");
      expect([bad.status, bad.body?.code]).toEqual([400, "BAD_INPUT"]);
      const flags = await call(pilotId, "POST", "/api/pack-videos/order-flags");
      expect([flags.status, flags.body?.code]).toEqual([400, "BAD_INPUT"]);
      const missing = await call(pilotId, "GET", "/api/pack-videos/khong-co/url");
      expect([missing.status, missing.body?.code]).toEqual([404, "NOT_FOUND"]);
      // Các đường đọc trả đúng khuôn hợp đồng, kể cả khi tham số lọc là rác.
      const list = await call(
        pilotId,
        "GET",
        "/api/pack-videos?chip=rac&kind=rac&from=2026-11-01&to=2026-11-30&channelIds=a,b&recordedById=x&q=%25&cursor=rac&limit=abc"
      );
      expect(list.status).toBe(200);
      expect(Object.keys(list.body ?? {}).sort()).toEqual(["items", "nextCursor"]);
      const returns = await call(pilotId, "GET", "/api/pack-videos/returns?card=rac&limit=5");
      expect(returns.status).toBe(200);
      expect(Object.keys(returns.body ?? {}).sort()).toEqual(["cards", "items", "nextCursor"]);
      expect(Object.keys((returns.body?.cards ?? {}) as object).sort()).toEqual([
        "all",
        "damaged_no_unbox",
        "has_pack",
        "no_video",
      ]);
      const stats = await call(pilotId, "GET", "/api/pack-videos/stats?from=2026-11-01&to=2026-11-30");
      expect(stats.status).toBe(200);
      expect(Object.keys(stats.body ?? {}).sort()).toEqual([
        "avgSeconds",
        "byChannel",
        "byDay",
        "byRecorder",
        "longest",
        "totalSeconds",
        "totalVideos",
      ]);
      const dossier = await call(pilotId, "GET", "/api/pack-videos/by-order/khong-co");
      expect([dossier.status, dossier.body?.code]).toEqual([404, "NOT_FOUND"]);
    }
  });
});
