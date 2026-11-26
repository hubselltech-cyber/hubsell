// ============================================================
// VIDEO ĐÓNG HÀNG — vé phiên quay (M2.1): ký / kiểm vé + danh sách đường nóng. Hàm thuần, không database.
// ============================================================

import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { PACK_SESSION_TTL_SEC } from "../../config/pack-video";
import { signToken } from "../../middleware/auth";
import { isPackHotPath } from "../../middleware/pack-session";
import { signPackSessionTicket, verifyPackSessionTicket, type PackSessionClaims } from "../pack-session-ticket";

const OWNER: PackSessionClaims = {
  userId: "u-owner",
  ownerId: "u-owner",
  staff: false,
  pack: true,
  unbox: true,
  pilot: false,
  allowedChannelIds: null,
};
const STAFF: PackSessionClaims = {
  userId: "u-staff",
  ownerId: "u-owner",
  staff: true,
  pack: true,
  unbox: false,
  pilot: true,
  allowedChannelIds: ["ch1", "ch2"],
};
const NOW = new Date("2026-11-26T10:00:00.000Z");
const after = (sec: number) => new Date(NOW.getTime() + sec * 1000);

describe("Vé phiên quay", () => {
  it("ký rồi kiểm ra đúng quyền đã ghi — chủ shop và nhân viên", () => {
    const o = signPackSessionTicket(OWNER, { now: NOW });
    expect(verifyPackSessionTicket(o.ticket, after(1))).toEqual(OWNER);
    expect(o.ttlSec).toBe(PACK_SESSION_TTL_SEC);
    expect(o.expiresAt).toBe(after(PACK_SESSION_TTL_SEC).toISOString());
    const s = signPackSessionTicket(STAFF, { now: NOW });
    expect(verifyPackSessionTicket(s.ticket, after(1))).toEqual(STAFF);
  });

  it("hết hạn → không dùng được", () => {
    const { ticket } = signPackSessionTicket(OWNER, { now: NOW });
    expect(verifyPackSessionTicket(ticket, after(PACK_SESSION_TTL_SEC - 1))).not.toBeNull();
    expect(verifyPackSessionTicket(ticket, after(PACK_SESSION_TTL_SEC + 1))).toBeNull();
  });

  it("sửa nội dung vé / chuỗi rác → từ chối", () => {
    const { ticket } = signPackSessionTicket(STAFF, { now: NOW });
    const [h, body, sig] = ticket.split(".");
    const forged = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
    forged.st = 0; // nhân viên tự nâng mình thành chủ shop
    const tampered = `${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
    expect(verifyPackSessionTicket(tampered, after(1))).toBeNull();
    expect(verifyPackSessionTicket("khong-phai-ve", after(1))).toBeNull();
    expect(verifyPackSessionTicket("", after(1))).toBeNull();
  });

  it("token đăng nhập KHÔNG giả làm vé được; vé KHÔNG mang `sub` nên không giả làm token đăng nhập", () => {
    expect(verifyPackSessionTicket(signToken("u-owner"))).toBeNull();
    const { ticket } = signPackSessionTicket(OWNER);
    const payload = jwt.decode(ticket) as jwt.JwtPayload;
    expect(payload.sub).toBeUndefined();
    expect(payload.aud).toBe("pack-video-session");
  });
});

describe("Đường nóng nhận vé", () => {
  it("đúng bốn đường của màn quay", () => {
    expect(isPackHotPath("GET", "/match")).toBe(true);
    expect(isPackHotPath("POST", "/")).toBe(true);
    expect(isPackHotPath("POST", "/abc123/parts")).toBe(true);
    expect(isPackHotPath("POST", "/abc123/complete")).toBe(true);
  });

  it("mọi đường khác đi xác thực thường — kể cả đường xin vé, mua giờ, xóa, tải về", () => {
    const cold: [string, string][] = [
      ["POST", "/session"],
      ["POST", "/consent"],
      ["POST", "/order-flags"],
      ["POST", "/hours/checkout"],
      ["POST", "/abc123/url"],
      ["POST", "/a/b/complete"],
      ["GET", "/"],
      ["GET", "/summary"],
      ["GET", "/hours"],
      ["GET", "/returns"],
      ["GET", "/deleted"],
      ["GET", "/stats"],
      ["GET", "/abc123/url"],
      ["GET", "/by-order/abc123"],
      ["GET", "/match/x"],
      ["DELETE", "/abc123"],
      ["DELETE", "/abc123/complete"],
    ];
    for (const [method, path] of cold) expect(isPackHotPath(method, path), `${method} ${path}`).toBe(false);
  });
});
