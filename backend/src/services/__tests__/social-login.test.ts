// Đăng nhập Google / Apple trong app (1.3.0): kiểm chữ ký bằng bộ khóa cục bộ
// tiêm vào (không gọi mạng), các hàm thuần tên hiển thị / email relay, và
// client_secret Apple ký ES256 đúng claim.
import { describe, expect, it } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
} from "jose";

import {
  SocialLoginError,
  appleDisplayName,
  buildAppleClientSecret,
  isPrivateRelayEmail,
  verifyAppleIdentityToken,
  verifyGoogleIdToken,
} from "../social-login";

async function googleKit() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "g1", alg: "RS256", use: "sig" };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string; exp?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "g1" })
      .setIssuer(opts.iss ?? "https://accounts.google.com")
      .setAudience(opts.aud ?? "ios-client")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "5m")
      .sign(privateKey);
  return { jwks, sign };
}

async function appleKit() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "a1", alg: "ES256", use: "sig" };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, aud = "vn.hubsell.app") =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: "a1" })
      .setIssuer("https://appleid.apple.com")
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  return { jwks, sign, privateKey, publicKey };
}

describe("verifyGoogleIdToken", () => {
  it("token hợp lệ → hồ sơ chuẩn hóa, email lower, tên từ claim", async () => {
    const { jwks, sign } = await googleKit();
    const token = await sign({ sub: "g-123", email: "Chu.Shop@Gmail.com", email_verified: true, name: "Chủ Shop" });
    const p = await verifyGoogleIdToken(token, { jwks, audiences: ["ios-client", "android-client"] });
    expect(p).toEqual({
      provider: "google",
      providerId: "g-123",
      email: "chu.shop@gmail.com",
      emailVerified: true,
      name: "Chủ Shop",
    });
  });

  it("aud không nằm trong danh sách client → INVALID_TOKEN (token của app khác không dùng được)", async () => {
    const { jwks, sign } = await googleKit();
    const token = await sign({ sub: "g-1", email: "a@b.com", email_verified: true }, { aud: "app-la" });
    await expect(verifyGoogleIdToken(token, { jwks, audiences: ["ios-client"] })).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
  });

  it("chữ ký bằng khóa khác → INVALID_TOKEN", async () => {
    const { sign } = await googleKit();
    const { jwks: otherJwks } = await googleKit();
    const token = await sign({ sub: "g-1", email: "a@b.com", email_verified: true });
    await expect(verifyGoogleIdToken(token, { jwks: otherJwks, audiences: ["ios-client"] })).rejects.toBeInstanceOf(
      SocialLoginError
    );
  });

  it("email_verified=false → EMAIL_NOT_VERIFIED", async () => {
    const { jwks, sign } = await googleKit();
    const token = await sign({ sub: "g-1", email: "a@b.com", email_verified: false });
    await expect(verifyGoogleIdToken(token, { jwks, audiences: ["ios-client"] })).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });
  });

  it("không cấu hình client nào → NOT_CONFIGURED (route trả 503)", async () => {
    const { jwks, sign } = await googleKit();
    const token = await sign({ sub: "g-1", email: "a@b.com", email_verified: true });
    await expect(verifyGoogleIdToken(token, { jwks, audiences: [] })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

describe("verifyAppleIdentityToken", () => {
  it("lần đầu: email relay + tên client gửi kèm; email_verified là chuỗi 'true'", async () => {
    const { jwks, sign } = await appleKit();
    const token = await sign({ sub: "001.apple", email: "abc@privaterelay.appleid.com", email_verified: "true", is_private_email: "true" });
    const p = await verifyAppleIdentityToken(token, { givenName: "Trung", familyName: "Nguyễn" }, { jwks });
    expect(p).toEqual({
      provider: "apple",
      providerId: "001.apple",
      email: "abc@privaterelay.appleid.com",
      emailVerified: true,
      name: "Trung Nguyễn",
    });
    expect(isPrivateRelayEmail(p.email)).toBe(true);
  });

  it("lần sau: không có email → email null, tên dự phòng 'Chủ shop'", async () => {
    const { jwks, sign } = await appleKit();
    const token = await sign({ sub: "001.apple" });
    const p = await verifyAppleIdentityToken(token, null, { jwks });
    expect(p.email).toBeNull();
    expect(p.emailVerified).toBe(false);
    expect(p.name).toBe("Chủ shop");
  });

  it("aud khác bundle id → INVALID_TOKEN", async () => {
    const { jwks, sign } = await appleKit();
    const token = await sign({ sub: "001.apple", email: "a@b.com" }, "vn.khac.app");
    await expect(verifyAppleIdentityToken(token, null, { jwks })).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });
});

describe("appleDisplayName", () => {
  it("ưu tiên tên Apple gửi, rồi phần trước @, rồi 'Chủ shop'", () => {
    expect(appleDisplayName({ givenName: " An ", familyName: null }, "x@y.com")).toBe("An");
    expect(appleDisplayName(null, "chu.shop@gmail.com")).toBe("chu.shop");
    expect(appleDisplayName({ givenName: "", familyName: "" }, null)).toBe("Chủ shop");
  });
});

describe("buildAppleClientSecret", () => {
  it("JWT ES256 có kid, iss=Team ID, sub=client id, aud=appleid.apple.com, hạn 1 giờ", async () => {
    const { privateKey, publicKey } = await appleKit();
    const pem = await exportPKCS8(privateKey);
    const now = new Date("2026-10-18T16:00:00Z");
    const secret = await buildAppleClientSecret({
      teamId: "BF6Y7D47P5",
      keyId: "KEY123",
      privateKeyPem: Buffer.from(pem).toString("base64"), // dạng base64 như dán lên Render
      clientId: "vn.hubsell.app",
      now,
    });
    const { payload, protectedHeader } = await jwtVerify(secret, publicKey, {
      issuer: "BF6Y7D47P5",
      audience: "https://appleid.apple.com",
      subject: "vn.hubsell.app",
      currentDate: now,
    });
    expect(protectedHeader).toMatchObject({ alg: "ES256", kid: "KEY123" });
    expect(payload.exp! - payload.iat!).toBe(3600);
  });

  it("thiếu env → NOT_CONFIGURED", async () => {
    await expect(buildAppleClientSecret({ teamId: "", keyId: "", privateKeyPem: "" })).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
  });
});
