// ============================================================
// VIDEO ĐÓNG HÀNG — VÉ PHIÊN QUAY ở tầng HTTP (M2.1 + M2.2, 26/11/2026).
// Rào kiểm: vé chỉ mở ĐÚNG các đường nóng · vé không thay được token đăng nhập (và ngược lại) · vé hỏng thì rơi về
// xác thực thường, không sinh lỗi mới · công tắc tắt gấp có hiệu lực NGAY cả khi vé còn hạn · quyền ghi trong vé
// được tôn trọng (nhân viên chỉ quay đóng thì không hỏi tem khui được) · đường nóng có vé KHÔNG đọc bảng User
// (tài khoản vừa bị xóa vẫn đi tiếp tới khi vé hết hạn — cái giá đã ghi ở config) · câu trả lời mang số giờ.
// Chạy app Express thật trên cổng ngẫu nhiên. Không nối được DB / chưa cấu hình R2 → cả file tự BỎ QUA.
// ============================================================

import "../../integrations/__tests__/load-env";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { createApp } from "../../app";
import { isR2Configured } from "../../integrations/r2/client";
import { prisma } from "../../lib/prisma";
import { signToken } from "../../middleware/auth";
import { PACK_SESSION_HEADER } from "../../middleware/pack-session";

const ready: boolean = await (async () => {
  if (!isR2Configured()) return false;
  try {
    await prisma.$queryRaw`SELECT 1 FROM "pack_videos" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `pvt-${Date.now()}`;

describe.skipIf(!ready)("Video đóng hàng — vé phiên quay ở tầng HTTP", () => {
  let server: Server;
  let baseUrl = "";
  let ownerId = "";
  let staffId = "";
  let ownerTicket = "";
  let staffTicket = "";
  const savedEnv = { gate: process.env.PACK_VIDEO_GATE, off: process.env.PACK_SESSION_OFF };

  async function call(
    method: string,
    path: string,
    opts: { login?: string | null; ticket?: string | null; body?: unknown } = {}
  ) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(opts.login ? { authorization: `Bearer ${signToken(opts.login)}` } : {}),
        ...(opts.ticket ? { [PACK_SESSION_HEADER]: opts.ticket } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(opts.body ?? {}) } : {}),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  }
  const MATCH = "/api/pack-videos/match?code=KHONGCODON123";

  beforeAll(async () => {
    delete process.env.PACK_VIDEO_GATE;
    delete process.env.PACK_SESSION_OFF;
    await new Promise<void>((resolve) => {
      server = createApp().listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ownerId = (
      await prisma.user.create({
        data: { email: `${TAG}@test.local`, passwordHash: "x", fullName: TAG },
        select: { id: true },
      })
    ).id;
    staffId = (
      await prisma.user.create({
        data: {
          email: `${TAG}-nv@test.local`,
          passwordHash: "x",
          fullName: `${TAG} nv`,
          role: Role.SALES,
          ownerId,
          permissions: ["orders"],
        },
        select: { id: true },
      })
    ).id;
    // Chủ shop đồng ý lần đầu (cổng "all": tài khoản chưa có thuê bao vẫn tính là còn hạn).
    expect((await call("POST", "/api/pack-videos/consent", { login: ownerId })).status).toBe(200);
  });

  afterAll(async () => {
    if (savedEnv.gate === undefined) delete process.env.PACK_VIDEO_GATE;
    else process.env.PACK_VIDEO_GATE = savedEnv.gate;
    if (savedEnv.off === undefined) delete process.env.PACK_SESSION_OFF;
    else process.env.PACK_SESSION_OFF = savedEnv.off;
    await prisma.packVideo.deleteMany({ where: { ownerId } });
    await prisma.packHourGrant.deleteMany({ where: { ownerId } });
    await prisma.termsAcceptance.deleteMany({ where: { userId: ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: [staffId, ownerId] } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("xin vé phải qua đăng nhập thường; vé không tự xin vé", async () => {
    expect((await call("POST", "/api/pack-videos/session")).status).toBe(401);
    const o = await call("POST", "/api/pack-videos/session", { login: ownerId });
    expect(o.status).toBe(200);
    expect(typeof o.body?.ticket).toBe("string");
    expect(o.body?.ttlSec).toBe(600);
    ownerTicket = String(o.body?.ticket);
    const s = await call("POST", "/api/pack-videos/session", { login: staffId });
    staffTicket = String(s.body?.ticket);
    expect(s.status).toBe(200);
    expect((await call("POST", "/api/pack-videos/session", { ticket: ownerTicket })).status).toBe(401);
  });

  it("chỉ có vé (không token đăng nhập): đường nóng đi được, đường khác 401", async () => {
    const hot = await call("GET", MATCH, { ticket: ownerTicket });
    expect([hot.status, hot.body]).toEqual([200, { order: null }]);
    for (const path of ["/summary", "/hours", "/", "/stats", "/deleted"]) {
      expect((await call("GET", `/api/pack-videos${path}`, { ticket: ownerTicket })).status, path).toBe(401);
    }
    expect((await call("DELETE", "/api/pack-videos/abc123", { ticket: ownerTicket })).status).toBe(401);
  });

  it("vé không dùng làm token đăng nhập được; token đăng nhập không dùng làm vé được", async () => {
    const asLogin = await fetch(`${baseUrl}/api/auth/me`, { headers: { authorization: `Bearer ${ownerTicket}` } });
    expect(asLogin.status).toBe(401);
    expect((await call("GET", MATCH, { ticket: signToken(ownerId) })).status).toBe(401);
  });

  it("vé hỏng + token đăng nhập còn tốt → rơi về xác thực thường, vẫn 200", async () => {
    const r = await call("GET", MATCH, { login: ownerId, ticket: `${ownerTicket.slice(0, -3)}xyz` });
    expect(r.status).toBe(200);
  });

  it("quyền ghi trong vé: nhân viên chỉ có quyền Đơn hàng → hỏi tem ĐÓNG được, tem KHUI bị từ chối", async () => {
    expect((await call("GET", MATCH, { ticket: staffTicket })).status).toBe(200);
    const unbox = await call("GET", `${MATCH}&kind=UNBOX`, { ticket: staffTicket });
    expect([unbox.status, unbox.body?.code]).toEqual([403, "PERMISSION_DENIED"]);
  });

  it("xin vé tải bằng vé phiên: câu trả lời mang số giờ (2 giờ tặng), báo tải xong khi chưa có tệp → 409", async () => {
    const begin = await call("POST", "/api/pack-videos", {
      ticket: ownerTicket,
      body: {
        clientId: `${TAG}-clip-1`,
        trackingCode: `${TAG.toUpperCase()}VD1`,
        kind: "PACK",
        recordedAt: new Date(Date.now() - 60_000).toISOString(),
        durationSec: 30,
        sizeBytes: 3_500_000,
        width: 720,
        height: 1280,
        deviceName: "webcam thu",
      },
    });
    expect(begin.status).toBe(200);
    expect(begin.body?.hours).toEqual({ purchasedSeconds: 7200, usedSeconds: 0, remainingSeconds: 7200 });
    expect((begin.body?.upload as { mode?: string } | null)?.mode).toBe("single");
    const row = await prisma.packVideo.findFirst({ where: { ownerId, clientId: `${TAG}-clip-1` }, select: { recordedById: true, status: true } });
    expect(row).toEqual({ recordedById: ownerId, status: "PENDING" });
    // Nhân viên cầm vé của mình không chạm được video người khác quay.
    const id = String((begin.body?.video as { id: string }).id);
    expect((await call("POST", `/api/pack-videos/${id}/parts`, { ticket: staffTicket, body: { partNumbers: [1] } })).status).toBe(404);
  });

  it("tắt gấp PACK_VIDEO_GATE=off: vé còn hạn cũng không qua; bật lại thì qua", async () => {
    process.env.PACK_VIDEO_GATE = "off";
    try {
      expect((await call("GET", MATCH, { ticket: ownerTicket })).status).toBe(401);
      const withLogin = await call("GET", MATCH, { ticket: ownerTicket, login: ownerId });
      expect([withLogin.status, withLogin.body?.code]).toEqual([403, "FEATURE_LOCKED"]);
      // Cổng "pilot": vé của chủ shop KHÔNG thuộc thí điểm cũng không qua.
      process.env.PACK_VIDEO_GATE = "pilot";
      expect((await call("GET", MATCH, { ticket: ownerTicket })).status).toBe(401);
    } finally {
      delete process.env.PACK_VIDEO_GATE;
    }
    expect((await call("GET", MATCH, { ticket: ownerTicket })).status).toBe(200);
  });

  it("PACK_SESSION_OFF=1: không cấp vé mới, vé cũ không được nhận — mọi thứ về xác thực thường", async () => {
    process.env.PACK_SESSION_OFF = "1";
    try {
      const s = await call("POST", "/api/pack-videos/session", { login: ownerId });
      expect([s.status, s.body?.ticket]).toEqual([200, null]);
      expect((await call("GET", MATCH, { ticket: ownerTicket })).status).toBe(401);
      expect((await call("GET", MATCH, { ticket: ownerTicket, login: ownerId })).status).toBe(200);
    } finally {
      delete process.env.PACK_SESSION_OFF;
    }
  });

  it("chặn gọi dồn (M2.6): mặc định CHẠY BÓNG không chặn ai; PACK_RATE_LIMIT=on → 429 + Retry-After, đường khác không dính", async () => {
    const savedMode = process.env.PACK_RATE_LIMIT;
    const hit = () => fetch(`${baseUrl}${MATCH}`, { headers: { [PACK_SESSION_HEADER]: ownerTicket } });
    try {
      // Chạy bóng: 80 lượt dồn (vượt mức dồn 50) vẫn 200 hết — chỉ ghi nhật ký.
      delete process.env.PACK_RATE_LIMIT;
      const shadow = await Promise.all(Array.from({ length: 80 }, hit));
      expect(shadow.every((r) => r.status === 200)).toBe(true);
      // Bật chặn thật: sổ đếm của tài khoản này đã cạn → lượt kế bị 429 kèm số giây phải chờ.
      process.env.PACK_RATE_LIMIT = "on";
      const on = await Promise.all(Array.from({ length: 30 }, hit));
      const limited = on.filter((r) => r.status === 429);
      expect(limited.length).toBeGreaterThan(0);
      expect(Number(limited[0].headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      expect(((await limited[0].json()) as { code?: string }).code).toBe("TOO_MANY_REQUESTS");
      // Đường KHÔNG nóng (xin vé, xem số giờ) không bị đếm; tài khoản khác không bị vạ lây.
      expect((await call("GET", "/api/pack-videos/hours", { login: ownerId })).status).toBe(200);
      expect((await call("GET", MATCH, { ticket: staffTicket })).status).toBe(200);
    } finally {
      if (savedMode === undefined) delete process.env.PACK_RATE_LIMIT;
      else process.env.PACK_RATE_LIMIT = savedMode;
    }
  });

  it("đường nóng có vé KHÔNG đọc bảng User: tài khoản vừa xóa vẫn đi tới khi vé hết hạn; đường thường chặn ngay", async () => {
    await prisma.user.update({ where: { id: staffId }, data: { deletedAt: new Date() } });
    try {
      expect((await call("GET", MATCH, { ticket: staffTicket })).status).toBe(200);
      expect((await call("GET", MATCH, { login: staffId })).status).toBe(401);
      expect((await call("POST", "/api/pack-videos/session", { login: staffId })).status).toBe(401);
    } finally {
      await prisma.user.update({ where: { id: staffId }, data: { deletedAt: null } });
    }
  });
});
