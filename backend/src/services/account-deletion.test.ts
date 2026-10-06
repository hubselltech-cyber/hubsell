import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { DELETED_USER_NAME, anonymizedUserData } from "./account-deletion";

describe("anonymizedUserData", () => {
  it("xóa sạch mọi trường nhận dạng và đặt mốc deletedAt", () => {
    const now = new Date("2026-10-06T09:00:00Z");
    const d = anonymizedUserData(now);
    expect(d.email).toBeNull();
    expect(d.username).toBeNull();
    expect(d.staffUsername).toBeNull();
    expect(d.phone).toBeNull();
    expect(d.avatar).toBeNull();
    expect(d.googleId).toBeNull();
    expect(d.resetTokenHash).toBeNull();
    expect(d.billingName).toBeNull();
    expect(d.billingTaxCode).toBeNull();
    expect(d.permissions).toEqual([]);
    expect(d.fullName).toBe(DELETED_USER_NAME);
    expect(d.deletedAt).toBe(now);
  });

  it("mật khẩu mới là hash ngẫu nhiên — không chuỗi rỗng/đoán được nào khớp, mỗi lần một khác", () => {
    const a = anonymizedUserData(new Date());
    const b = anonymizedUserData(new Date());
    expect(a.passwordHash).not.toBe(b.passwordHash);
    expect(bcrypt.compareSync("", a.passwordHash)).toBe(false);
    expect(bcrypt.compareSync("123456", a.passwordHash)).toBe(false);
  });
});
