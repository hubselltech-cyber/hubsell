// ============================================================
// VIDEO ĐÓNG HÀNG — vé tải (M2.4): ký / kiểm vé + id video cố định theo (chủ shop, clientId). Hàm thuần, không database.
// ============================================================

import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { PACK_UPLOAD_TICKET_TTL_SEC, packUploadV2Enabled } from "../../config/pack-video";
import { signToken } from "../../middleware/auth";
import { isPackHotPath } from "../../middleware/pack-session";
import { signPackSessionTicket, verifyPackSessionTicket } from "../pack-session-ticket";
import {
  packUploadIdOf,
  signPackUploadTicket,
  verifyPackUploadTicket,
  type PackUploadClaims,
} from "../pack-upload-ticket";

const NOW = new Date("2026-11-26T10:00:00.000Z");
const after = (sec: number) => new Date(NOW.getTime() + sec * 1000);

const SINGLE: PackUploadClaims = {
  id: packUploadIdOf("u-owner", "client-0001"),
  dateKey: "2026-11-26",
  ownerId: "u-owner",
  userId: "u-staff",
  staff: true,
  clientId: "client-0001",
  trackingCode: "SPXVN0123456789",
  kind: "PACK",
  recordedAt: new Date("2026-11-26T09:58:30.123Z"),
  durationSec: 61,
  sizeBytes: 6_500_000,
  width: 768,
  height: 1024,
  deviceName: "Bàn đóng hàng số 2",
  channelId: "ch1",
  orderId: "order1",
  orderCode: "2611ABC",
  uploadId: null,
};
const MULTI: PackUploadClaims = {
  ...SINGLE,
  userId: "u-owner",
  staff: false,
  kind: "UNBOX",
  sizeBytes: 90_291_111,
  width: null,
  height: null,
  deviceName: null,
  channelId: null,
  orderId: null,
  orderCode: null,
  uploadId: "AbCdEf-luot-tai-theo-manh",
};

describe("Vé tải", () => {
  it("ký rồi kiểm ra ĐÚNG mọi trường đã ghi — tải một lần và tải theo mảnh, có đơn và chưa khớp đơn", () => {
    const s = signPackUploadTicket(SINGLE, { now: NOW });
    expect(verifyPackUploadTicket(s.ticket, after(1))).toEqual(SINGLE);
    expect(s.expiresAt).toBe(after(PACK_UPLOAD_TICKET_TTL_SEC).toISOString());
    const m = signPackUploadTicket(MULTI, { now: NOW });
    expect(verifyPackUploadTicket(m.ticket, after(1))).toEqual(MULTI);
  });

  it("hạn 7 ngày: còn hạn thì dùng được, quá hạn thì không", () => {
    expect(PACK_UPLOAD_TICKET_TTL_SEC).toBe(7 * 24 * 3600);
    const { ticket } = signPackUploadTicket(SINGLE, { now: NOW });
    expect(verifyPackUploadTicket(ticket, after(PACK_UPLOAD_TICKET_TTL_SEC - 1))).not.toBeNull();
    expect(verifyPackUploadTicket(ticket, after(PACK_UPLOAD_TICKET_TTL_SEC + 1))).toBeNull();
  });

  it("sửa nội dung vé (đổi chủ shop, đổi cỡ tệp, đổi thời lượng) / chuỗi rác → từ chối", () => {
    const { ticket } = signPackUploadTicket(SINGLE, { now: NOW });
    const [h, body, sig] = ticket.split(".");
    for (const patch of [{ oid: "u-nguoi-khac" }, { sz: 1 }, { d: 1 }, { uid: "u-owner" }]) {
      const forged = { ...(JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>), ...patch };
      const tampered = `${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
      expect(verifyPackUploadTicket(tampered, after(1)), JSON.stringify(patch)).toBeNull();
    }
    expect(verifyPackUploadTicket("khong-phai-ve", after(1))).toBeNull();
    expect(verifyPackUploadTicket("", after(1))).toBeNull();
  });

  it("vé PHIÊN QUAY không dùng làm vé tải được, vé tải không dùng làm vé phiên quay được; token đăng nhập cũng không", () => {
    const session = signPackSessionTicket(
      { userId: "u-owner", ownerId: "u-owner", staff: false, pack: true, unbox: true, pilot: false, allowedChannelIds: null },
      { now: NOW }
    );
    expect(verifyPackUploadTicket(session.ticket, after(1))).toBeNull();
    const upload = signPackUploadTicket(SINGLE, { now: NOW });
    expect(verifyPackSessionTicket(upload.ticket, after(1))).toBeNull();
    expect(verifyPackUploadTicket(signToken("u-owner"))).toBeNull();
    const payload = jwt.decode(upload.ticket) as jwt.JwtPayload;
    expect(payload.sub).toBeUndefined();
    expect(payload.aud).toBe("pack-video-upload");
  });

  it("vé ký đúng khóa nhưng thiếu / sai kiểu trường → từ chối (không ghi dòng sổ từ vé hỏng)", () => {
    const secret = process.env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";
    const good = jwt.decode(signPackUploadTicket(SINGLE, { now: NOW }).ticket) as Record<string, unknown>;
    const patches: Record<string, unknown>[] = [{ sz: "6500000" }, { dk: "26/11/2026" }, { k: "KHAC" }, { cid: "" }, { d: 0 }, { ra: "hôm nay" }];
    // Vé nguyên vẹn ký lại bằng cách này thì kiểm QUA — để chắc các ca dưới bị từ chối vì trường hỏng, không vì cách ký.
    expect(verifyPackUploadTicket(jwt.sign(good, secret), after(1))).toEqual(SINGLE);
    for (const patch of patches) {
      const raw = jwt.sign({ ...good, ...patch }, secret);
      expect(verifyPackUploadTicket(raw, after(1)), JSON.stringify(patch)).toBeNull();
    }
  });

  it("vé gọn: dưới 1.000 ký tự cả khi mọi trường đều có", () => {
    expect(signPackUploadTicket({ ...SINGLE, uploadId: "x".repeat(120) }, { now: NOW }).ticket.length).toBeLessThan(1_000);
  });
});

describe("Id video cố định theo (chủ shop, clientId)", () => {
  it("cùng cặp → cùng id 32 ký tự hex; khác chủ shop hoặc khác clientId → khác id", () => {
    const a = packUploadIdOf("u-owner", "client-0001");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(packUploadIdOf("u-owner", "client-0001")).toBe(a);
    expect(packUploadIdOf("u-owner", "client-0002")).not.toBe(a);
    expect(packUploadIdOf("u-khac", "client-0001")).not.toBe(a);
  });
});

describe("Công tắc + đường nóng của bản 2", () => {
  it("PACK_UPLOAD_V2: chỉ đúng chữ `on` mới bật; không đặt = tắt", () => {
    expect(packUploadV2Enabled({})).toBe(false);
    expect(packUploadV2Enabled({ PACK_UPLOAD_V2: "on" })).toBe(true);
    for (const v of ["1", "true", "ON", "on ", "off", ""]) expect(packUploadV2Enabled({ PACK_UPLOAD_V2: v }), v).toBe(false);
  });

  it("ba đường /v2 là đường nóng (nhận vé phiên quay, có trong sổ đếm gọi dồn)", () => {
    expect(isPackHotPath("POST", "/v2")).toBe(true);
    expect(isPackHotPath("POST", "/v2/parts")).toBe(true);
    expect(isPackHotPath("POST", "/v2/complete")).toBe(true);
    expect(isPackHotPath("GET", "/v2")).toBe(false);
    expect(isPackHotPath("POST", "/v2/khac")).toBe(false);
  });
});
