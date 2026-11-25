// Hai chốt kiểm tra requireAuth / requireChannel khi DATABASE quá tải (25/11/2026, docs/DONG-BO-GIAI-DOAN-3.md mục 8.8):
//   - lỗi database → 503 SERVER_BUSY, KHÔNG phải 401 (401 làm web / app đăng xuất khách);
//   - không ném lỗi ra ngoài (middleware async của Express 4 ném là cả tiến trình thoát);
//   - token sai vẫn 401 như cũ, đường thường vẫn đi tiếp.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Response } from "express";

const db = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  staffFindMany: vi.fn(),
  channelCount: vi.fn(),
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    user: { findUnique: db.userFindUnique, update: db.userUpdate },
    staffChannel: { findMany: db.staffFindMany },
    channel: { count: db.channelCount },
  },
}));

import { SERVER_BUSY_CODE } from "../../lib/request-ledger";
import { type AuthRequest, requireAuth, requireChannel, signToken } from "../auth";

function fakeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    headersSent: false,
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      res.headersSent = true;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
  };
  return res;
}

function poolTimeout(): Error {
  return Object.assign(
    new Error(
      "\nInvalid `prisma.channel.count()` invocation:\n\n\nTimed out fetching a new connection from the connection pool. (Current connection pool timeout: 30, connection limit: 5)"
    ),
    { code: "P2024" }
  );
}

const reqWith = (token?: string) =>
  ({ headers: token ? { authorization: `Bearer ${token}` } : {} }) as unknown as AuthRequest;

describe("requireAuth / requireChannel khi database quá tải", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.userUpdate.mockResolvedValue({});
  });

  it("requireAuth: database hết kết nối → 503 SERVER_BUSY, không 401, không ném", async () => {
    db.userFindUnique.mockRejectedValue(poolTimeout());
    const res = fakeRes();
    const next = vi.fn();
    await expect(requireAuth(reqWith(signToken("u1")), res as unknown as Response, next as NextFunction)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(503);
    expect((res.body as { code: string }).code).toBe(SERVER_BUSY_CODE);
    expect(res.headers["Retry-After"]).toBe("10");
    expect(next).not.toHaveBeenCalled();
  });

  it("requireAuth: lỗi database ở bước đọc gian của nhân viên cũng là 503", async () => {
    db.userFindUnique.mockResolvedValue({
      id: "s1",
      email: "s@x",
      role: "SALES",
      ownerId: "o1",
      isPlatformAdmin: false,
      permissions: [],
      lastActiveAt: new Date(),
      deletedAt: null,
    });
    db.staffFindMany.mockRejectedValue(poolTimeout());
    const res = fakeRes();
    const next = vi.fn();
    await requireAuth(reqWith(signToken("s1")), res as unknown as Response, next as NextFunction);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("requireAuth: token sai / thiếu vẫn 401 và không chạm database", async () => {
    for (const token of [undefined, "khong-phai-token"]) {
      const res = fakeRes();
      const next = vi.fn();
      await requireAuth(reqWith(token), res as unknown as Response, next as NextFunction);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    }
    expect(db.userFindUnique).not.toHaveBeenCalled();
  });

  it("requireAuth: tài khoản đã xóa vẫn 401; tài khoản thường đi tiếp và gắn đúng chủ shop", async () => {
    db.userFindUnique.mockResolvedValueOnce(null);
    const gone = fakeRes();
    await requireAuth(reqWith(signToken("x")), gone as unknown as Response, vi.fn() as NextFunction);
    expect(gone.statusCode).toBe(401);

    db.userFindUnique.mockResolvedValueOnce({
      id: "u1",
      email: "a@x",
      role: "ADMIN",
      ownerId: null,
      isPlatformAdmin: false,
      permissions: [],
      lastActiveAt: new Date(),
      deletedAt: null,
    });
    const req = reqWith(signToken("u1"));
    const res = fakeRes();
    const next = vi.fn();
    await requireAuth(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.ownerId).toBe("u1");
    expect(req.allowedChannelIds).toBeNull();
    expect(res.statusCode).toBe(200);
  });

  it("requireChannel: database hết kết nối → 503, KHÔNG ném (bản cũ ném → cả web thoát)", async () => {
    db.channelCount.mockRejectedValue(poolTimeout());
    const req = { ownerId: "o1" } as AuthRequest;
    const res = fakeRes();
    const next = vi.fn();
    await expect(requireChannel(req, res as unknown as Response, next as NextFunction)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(503);
    expect((res.body as { code: string }).code).toBe(SERVER_BUSY_CODE);
    expect(next).not.toHaveBeenCalled();
  });

  it("requireChannel: chưa nối gian vẫn 409 NO_CHANNEL; có gian thì đi tiếp", async () => {
    db.channelCount.mockResolvedValueOnce(0);
    const none = fakeRes();
    await requireChannel({ ownerId: "o1" } as AuthRequest, none as unknown as Response, vi.fn() as NextFunction);
    expect(none.statusCode).toBe(409);
    expect((none.body as { code: string }).code).toBe("NO_CHANNEL");

    db.channelCount.mockResolvedValueOnce(2);
    const next = vi.fn();
    await requireChannel({ ownerId: "o1" } as AuthRequest, fakeRes() as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
